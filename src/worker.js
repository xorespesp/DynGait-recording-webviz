import * as h5wasm from 'h5wasm';

// HDF5 가상 환경을 담당할 Web Worker
// 메인 UI 쓰레드와 분리되어 대용량 파일을 백그라운드에서 읽어들입니다.
let h5File = null;
let framesKeys = [];
let targetBodyId = "00";

// LBS 정적 데이터 (파일 로드 시 1회 적재, 매 프레임 재사용)
let tposeVerts = null;              // Float32Array (V*3), T-pose world vertices
let lbsWeights = null;              // Float32Array (V*J), soft LBS weights (row-major)
let numVerts = 0;                   // V (vertex count)
let numJoints = 0;                  // J (joint count)
let worldOffsetTransform = null;    // Float32Array(16), optional 4x4 column-major offset matrix

// ==========================================
// LBS Helper Functions
// ==========================================

/**
 * 4x4 column-major 행렬 곱셈: out[outOff..+15] = A[aOff..+15] * B[bOff..+15]
 * Eigen::Matrix4f가 HDF5에 column-major로 직렬화되므로 column-major 연산 사용.
 * Column-major layout: element(row, col) = flat[col * 4 + row]
 */
function mulMat4ColMajor(A, aOff, B, bOff, out, outOff) {
    for (let c = 0; c < 4; c++) {
        const bc = bOff + c * 4;
        const oc = outOff + c * 4;
        for (let r = 0; r < 4; r++) {
            out[oc + r] =
                A[aOff + r]      * B[bc] +
                A[aOff + 4 + r]  * B[bc + 1] +
                A[aOff + 8 + r]  * B[bc + 2] +
                A[aOff + 12 + r] * B[bc + 3];
        }
    }
}

/**
 * Soft Linear Blend Skinning 재구성.
 * C++ reconstruct_skel_verts_from_lbs()의 JS 포팅.
 *
 * 공식: v'_i = Σ_j W[i,j] * G[j] * [v_tpose_i; 1]
 *
 * 행렬 저장 순서: Eigen::Matrix4f가 column-major로 HDF5에 직렬화됨.
 * Column-major layout: element(row, col) = flat[col * 4 + row]
 *
 * @param {Float32Array} tpose      - T-pose vertices, flat (V*3)
 * @param {Float32Array} weights    - LBS weights, flat (V*J), C-order row-major
 * @param {Float32Array} transforms - Bone transforms, flat (J*16), each 4x4 column-major
 * @param {number} V - vertex count
 * @param {number} J - joint count
 * @param {Float32Array} out - output vertices, flat (V*3)
 */
function performLBS(tpose, weights, transforms, V, J, out) {
    for (let v = 0; v < V; v++) {
        const vx = tpose[v * 3];
        const vy = tpose[v * 3 + 1];
        const vz = tpose[v * 3 + 2];

        // Blended transform 누적 (상위 3행만 — 4행은 항상 [0,0,0,1])
        // tRC = 논리적 행렬의 (R, C) 원소
        let t00 = 0, t01 = 0, t02 = 0, t03 = 0;
        let t10 = 0, t11 = 0, t12 = 0, t13 = 0;
        let t20 = 0, t21 = 0, t22 = 0, t23 = 0;

        const wBase = v * J;
        for (let j = 0; j < J; j++) {
            const w = weights[wBase + j];
            if (w === 0) continue; // Zero-weight 스킵 (vertex당 보통 1~4개 joint만 non-zero)

            // Column-major: G(row, col) = transforms[b + col*4 + row]
            const b = j * 16;
            t00 += w * transforms[b];      t01 += w * transforms[b + 4];
            t02 += w * transforms[b + 8];  t03 += w * transforms[b + 12];
            t10 += w * transforms[b + 1];  t11 += w * transforms[b + 5];
            t12 += w * transforms[b + 9];  t13 += w * transforms[b + 13];
            t20 += w * transforms[b + 2];  t21 += w * transforms[b + 6];
            t22 += w * transforms[b + 10]; t23 += w * transforms[b + 14];
        }

        // Blended transform * [vx, vy, vz, 1]
        const o = v * 3;
        out[o]     = t00 * vx + t01 * vy + t02 * vz + t03;
        out[o + 1] = t10 * vx + t11 * vy + t12 * vz + t13;
        out[o + 2] = t20 * vx + t21 * vy + t22 * vz + t23;
    }
}

// ==========================================
// Message Handler
// ==========================================
self.onmessage = async (e) => {
    const { type, payload } = e.data;

    // 1. 파일 초기 로드 및 FS 마운트
    if (type === 'LOAD_FILE') {
        const file = payload;

        try {
            await h5wasm.ready;

            const mountDir = "/work";
            const vFileName = `${mountDir}/${file.name}`;

            // 기존 디렉토리나 마운트가 꼬이지 않도록 정리
            try { h5wasm.FS.unmount(mountDir); } catch (err) { }
            try { h5wasm.FS.mkdir(mountDir); } catch (err) { }

            // [핵심] WORKERFS는 오직 Web Worker 쓰레드 내부에서만 사용 가능합니다!
            // 브라우저의 File 객체를 C/C++ 파일시스템으로 제로-카피(Zero-Copy) 직결시킵니다.
            h5wasm.FS.mount(h5wasm.FS.filesystems.WORKERFS, { files: [file] }, mountDir);

            if (h5File) h5File.close();
            h5File = new h5wasm.File(vFileName, 'r');

            // ---- 정적 데이터(Static Data) 추출 ----

            // Skel template faces (v1.5: 경로 변경 static/skel_mesh_faces → static/skel_template/faces)
            const facesDataset = h5File.get('static/skel_template/faces');
            if (!facesDataset) throw new Error('Missing /static/skel_template/faces dataset.');
            const facesArr = new Int32Array(facesDataset.value);

            // Skel template T-pose vertices (v1.5 신규: body별 정적 T-pose world verts)
            const tposeDataset = h5File.get(`static/skel_template/bodies/${targetBodyId}/tpose_verts`);
            if (!tposeDataset) throw new Error('Missing tpose_verts dataset.');
            tposeVerts = new Float32Array(tposeDataset.value);
            // shape이 2D (V,3)이면 shape[0]=V, 1D (V*3)이면 shape[0]/3
            numVerts = tposeDataset.shape.length >= 2 ? tposeDataset.shape[0] : tposeDataset.shape[0] / 3;

            // Skel template LBS weights (v1.5 신규: soft per-vertex bone weights)
            const lbsDataset = h5File.get('static/skel_template/lbs_weights');
            if (!lbsDataset) throw new Error('Missing lbs_weights dataset.');
            lbsWeights = new Float32Array(lbsDataset.value);
            // shape이 2D (V,J)이면 shape[1]=J, 1D (V*J)이면 total/V
            numJoints = lbsDataset.shape.length >= 2 ? lbsDataset.shape[1] : lbsWeights.length / numVerts;

            // World offset transform (optional 4x4 column-major 변환 행렬)
            // h5wasm get()이 존재하지 않는 경로에서 throw할 수 있으므로,
            // static 그룹의 keys()로 존재 여부를 먼저 확인
            worldOffsetTransform = null;
            {
                const staticGroup = h5File.get('static');
                const staticKeys = staticGroup ? staticGroup.keys() : [];
                if (staticGroup && staticKeys.includes('world_offset_transform')) {
                    const offsetDataset = staticGroup.get('world_offset_transform');
                    worldOffsetTransform = new Float32Array(offsetDataset.value);
                }
            }

            // Frame keys
            const framesGroup = h5File.get('frames');
            if (!framesGroup) throw new Error('Missing /frames group.');
            framesKeys = framesGroup.keys().sort();

            // 메인 쓰레드로 정적 구성요소 응답 (Zero-Copy Transfer)
            self.postMessage({
                type: 'FILE_LOADED',
                payload: {
                    faces: facesArr,
                    numFrames: framesKeys.length,
                }
            }, [facesArr.buffer]);

        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        }
    }
    // 2. 프레임별 LBS 재구성 및 VBO 데이터 전송 (실시간)
    else if (type === 'GET_FRAME') {
        const frameIndex = payload;

        if (!h5File || frameIndex >= framesKeys.length) return;

        try {
            const frameKey = framesKeys[frameIndex];

            // Per-frame bone transforms 읽기 (v1.5: skel_mesh_verts 대신 skel_bone_transforms)
            const transformsPath = `frames/${frameKey}/bodies/${targetBodyId}/skel_model_output/skel_bone_transforms`;
            const transformsDataset = h5File.get(transformsPath);

            if (transformsDataset) {
                const boneTransforms = new Float32Array(transformsDataset.value); // Copy to avoid WASM heap invalidation

                // world_offset_transform이 있으면 bone transforms에 pre-multiply
                // G'[j] = M_offset * G[j] — V회 vertex 변환 대신 J회 행렬곱으로 효율적 적용
                let effectiveTransforms;
                if (worldOffsetTransform) {
                    effectiveTransforms = new Float32Array(numJoints * 16);
                    for (let j = 0; j < numJoints; j++) {
                        mulMat4ColMajor(worldOffsetTransform, 0, boneTransforms, j * 16, effectiveTransforms, j * 16);
                    }
                } else {
                    effectiveTransforms = boneTransforms;
                }

                // LBS 재구성: v'_i = Σ_j W[i,j] * G[j] * [v_tpose_i; 1]
                const resultVerts = new Float32Array(numVerts * 3);
                performLBS(tposeVerts, lbsWeights, effectiveTransforms, numVerts, numJoints, resultVerts);

                self.postMessage({
                    type: 'FRAME_DATA',
                    payload: { frameIndex, verts: resultVerts }
                }, [resultVerts.buffer]); // Ownership Transfer
            } else {
                self.postMessage({
                    type: 'FRAME_DATA',
                    payload: { frameIndex, verts: null }
                });
            }
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        }
    }
};
