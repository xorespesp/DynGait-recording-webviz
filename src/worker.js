import * as h5wasm from 'h5wasm';

// HDF5 가상 환경을 담당할 Web Worker
// 메인 UI 쓰레드와 분리되어 대용량 파일을 백그라운드에서 읽어들입니다.
let h5File = null;
let framesKeys = [];
let targetBodyId = "00";

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

            // 메타데이터 및 정적 데이터(Static Data) 추출
            const upDataset = h5File.get('static/world_up_vector');
            const upVector = upDataset ? Array.from(upDataset.value) : null;

            const facesDataset = h5File.get('static/skel_mesh_faces');
            if (!facesDataset) throw new Error('Missing /static/skel_mesh_faces dataset.');

            // VBO 구성을 위한 Face Index 
            // Transferable Object 사용을 위해 명시적으로 메모리를 복사하여 옮길 준비를 합니다.
            const facesArr = new Int32Array(facesDataset.value);

            const framesGroup = h5File.get('frames');
            if (!framesGroup) throw new Error('Missing /frames group.');

            framesKeys = framesGroup.keys().sort();

            // 메인 쓰레드로 정적 구성요소 응답 (Zero-Copy Transfer)
            self.postMessage({
                type: 'FILE_LOADED',
                payload: {
                    upVector: upVector,
                    faces: facesArr,
                    numFrames: framesKeys.length
                }
            }, [facesArr.buffer]);

        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        }
    }
    // 2. 프레임별 VBO 데이터 파싱 요청 (실시간)
    else if (type === 'GET_FRAME') {
        const frameIndex = payload;

        if (!h5File || frameIndex >= framesKeys.length) return;

        try {
            const frameKey = framesKeys[frameIndex];
            const vertsPath = `frames/${frameKey}/bodies/${targetBodyId}/skel_model_output/skel_mesh_verts`;
            const vertsDataset = h5File.get(vertsPath);

            if (vertsDataset) {
                // HDF5 WASM 힙에 있는 Float32Array 뷰
                const wasmVerts = vertsDataset.value;

                // 구조적 복제(Structured Clone) 오버헤드를 막고 소유권을 완전히 메인 쓰레드로 넘겨주기 위해,
                // 새로운 ArrayBuffer를 할당받아 WASM 메모리 바깥으로 꺼냅니다. (매 프레임 ~100KB 수준이라 극도로 빠름)
                const vertsArr = new Float32Array(wasmVerts);

                self.postMessage({
                    type: 'FRAME_DATA',
                    payload: { frameIndex, verts: vertsArr }
                }, [vertsArr.buffer]); // Ownership Transfer (메인 쓰레드에 버퍼 던져버림)
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
