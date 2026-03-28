import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

// ==========================================
// 1. 글로벌 메인 쓰레드 상태 변수
// ==========================================
let g_worker = null;            // 백그라운드 Web Worker 제어 객체
let g_numFrames = 0;            // 전체 데이터 프레임 수
let g_currentFrameIdx = 0;      // 현재 재생 중인 프레임 인덱스
let g_isPlaying = false;        // 실시간 렌더링(재생) 상태 여부
let g_isFrameFetching = false;  // 비동기 통신: 현재 워커에서 VBO 데이터를 요청 중인지 여부 (프레임 락)

// Three.js 코어 렌더링 컨텍스트
let g_scene, g_camera, g_renderer, g_controls, g_stats;
let g_dataRoot = null;        // HDF5 데이터 오브젝트들을 담을 루트 컨테이너
let g_skelMesh = null;        // 렌더링할 Mesh 인스턴스
let g_baseGeometry = null;    // 정적 구조(Index Buffer 등)를 유지하고 동적 시점 버퍼(VBO)를 교체할 Geometry 객체

// GUI 관련 변수
let g_gui;
let g_frameController;
const g_guiParams = {
    Frame: 0,
    "Load File": () => { document.getElementById('file-input').click(); },
    "Play / Pause": false
};

const g_materialParams = {
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.1,
    wireframe: false,
    flatShading: false
};

function setStatus(msg) {
    document.getElementById('status-overlay').textContent = msg;
}

// ==========================================
// 2. Web Worker 초기화 및 메세지 큐 연동
// ==========================================
function initWorker() {
    // Vite 빌더가 Module Worker를 해석할 수 있도록 선언
    g_worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    // 워커로부터의 콜백(Signal) 수신부
    g_worker.onmessage = (e) => {
        const { type, payload } = e.data;

        switch (type) {
            case 'FILE_LOADED':
                // 1. 파일이 마운트되고 초기 세팅(정적 Topology) 완료
                const { faces, numFrames: loadedFrames } = payload;

                g_numFrames = loadedFrames;

                // 기초 메쉬(EBO) 할당
                setupBaseGeometry(faces);

                if (g_numFrames > 0) {
                    g_currentFrameIdx = 0;
                    setStatus(`Ready (${g_numFrames} frames)`);

                    // 슬라이더 범위 동적 갱신
                    if (g_frameController) {
                        g_frameController.max(g_numFrames - 1);
                        g_frameController.updateDisplay();
                    }

                    // 초기 0번 프레임 VBO 요청
                    requestFrameFromWorker(0);
                } else {
                    setStatus("0 frame data found.");
                }
                g_gui.controllersRecursive().forEach(c => c.updateDisplay());
                break;

            case 'FRAME_DATA':
                // 2. 워커가 Float32Array VBO 데이터를 던져줬을 때
                const { frameIndex, verts } = payload;
                g_isFrameFetching = false; // 워커 쓰레드 잠금 해제

                // 프레임 인덱스가 꼬이지 않고 현재 그려야 할 화면일 때만 반영
                if (frameIndex === g_currentFrameIdx && verts) {
                    updateMeshVBOWithVerts(verts);
                }
                break;

            case 'ERROR':
                console.error("Worker Error:", payload);
                setStatus("Error: " + payload);
                g_guiParams["Play / Pause"] = false;
                g_isPlaying = false;
                g_gui.controllersRecursive().forEach(c => c.updateDisplay());
                break;
        }
    };
}


// ==========================================
// 3. Three.js 설정 (초기화)
// ==========================================
function initGraphics() {
    g_scene = new THREE.Scene();
    g_scene.background = new THREE.Color(0xa0a0a0);
    g_scene.fog = new THREE.Fog(0xa0a0a0, 5.5, 30);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.15);
    hemiLight.position.set(0, 20, 0);
    g_scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(- 3, 10, - 10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 4;
    dirLight.shadow.camera.bottom = - 4;
    dirLight.shadow.camera.left = - 4;
    dirLight.shadow.camera.right = 4;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 40;

    // 고해상도 그림자 맵 활성화
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    g_scene.add(dirLight);

    // Procedural Checkerboard (체커보드) 텍스처 생성 (가로세로 2x2 사이즈 베이스)
    const checkerSize = 2; // 텍스처 픽셀 크기
    const checkerTextureData = new Uint8Array(4 * checkerSize * checkerSize);
    for (let i = 0; i < checkerSize * checkerSize; i++) {
        // 체스판처럼 번갈아가며 흰색(255) / 회색(200) 세팅
        const x = i % checkerSize;
        const y = Math.floor(i / checkerSize);
        const color = (x + y) % 2 === 0 ? 255 : 200;

        checkerTextureData[i * 4] = color;     // R
        checkerTextureData[i * 4 + 1] = color; // G
        checkerTextureData[i * 4 + 2] = color; // B
        checkerTextureData[i * 4 + 3] = 255;   // A
    }

    const checkerTexture = new THREE.DataTexture(checkerTextureData, checkerSize, checkerSize, THREE.RGBAFormat);
    checkerTexture.wrapS = THREE.RepeatWrapping;
    checkerTexture.wrapT = THREE.RepeatWrapping;
    checkerTexture.repeat.set(50, 50); // 체커보드 반복 크기 조절 (더 굵직하게)
    checkerTexture.magFilter = THREE.NearestFilter; // 깔끔한 경계선을 위해 Nearest
    checkerTexture.needsUpdate = true;

    // 바닥면 (체커보드 적용)
    const planeMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshStandardMaterial({
            map: checkerTexture,
            color: 0xcbcbcb, // 베이스 컬러를 약간 톤다운하여 회색빛과 잘 어울리게 함
            roughness: 0.8,
            metalness: 0.1
        })
    );
    planeMesh.rotation.x = -Math.PI / 2;
    planeMesh.receiveShadow = true;
    g_scene.add(planeMesh);

    const container = document.getElementById('canvas-container');

    g_renderer = new THREE.WebGLRenderer({ antialias: true });
    g_renderer.setSize(container.clientWidth, container.clientHeight);
    g_renderer.setPixelRatio(window.devicePixelRatio);
    g_renderer.shadowMap.enabled = true;
    g_renderer.shadowMap.type = THREE.PCFSoftShadowMap; // PCF 고품질 소프트 섀도우 적용
    container.appendChild(g_renderer.domElement);

    // 리사이즈 될 때 윈도우 전체가 아닌 container 사이즈 기반으로 비율 조정
    g_camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    g_camera.position.set(0, 1.5, 3);

    g_controls = new OrbitControls(g_camera, g_renderer.domElement);
    g_controls.enableDamping = true;
    g_controls.target.set(0, 1, 0);

    // 데이터 오브젝트를 담을 루트 컨테이너
    g_dataRoot = new THREE.Group();
    g_scene.add(g_dataRoot);

    g_stats = new Stats();
    document.getElementById('stats-container').appendChild(g_stats.dom);

    window.addEventListener('resize', () => {
        const container = document.getElementById('canvas-container');
        g_camera.aspect = container.clientWidth / container.clientHeight;
        g_camera.updateProjectionMatrix();
        g_renderer.setSize(container.clientWidth, container.clientHeight);
    });

    // GUI 설정
    g_gui = new GUI();
    const pbFolder = g_gui.addFolder('Playback Control');
    pbFolder.add(g_guiParams, 'Load File');

    g_frameController = pbFolder.add(g_guiParams, 'Frame', 0, 0, 1).listen().onChange((val) => {
        g_currentFrameIdx = parseInt(val, 10);
        g_guiParams["Play / Pause"] = false;
        g_isPlaying = false;
        requestFrameFromWorker(g_currentFrameIdx);
    });

    pbFolder.add(g_guiParams, 'Play / Pause').onChange((val) => {
        g_isPlaying = val;
    });

    const sceneFolder = g_gui.addFolder('Scene Control');
    sceneFolder.add(hemiLight, 'intensity', 0, 10).name('Hemi Intensity');
    sceneFolder.add(dirLight, 'intensity', 0, 10).name('Dir Intensity');

    const dirPosFolder = sceneFolder.addFolder('Dir Light Position');
    dirPosFolder.add(dirLight.position, 'x', -50, 50).name('X');
    dirPosFolder.add(dirLight.position, 'y', 0, 50).name('Y');
    dirPosFolder.add(dirLight.position, 'z', -50, 50).name('Z');

    dirLight.shadow.bias = -0.001; // Shadow acne(물결 그림자) 방지용 하드코딩

    const fogFolder = sceneFolder.addFolder('Fog Range');
    fogFolder.add(g_scene.fog, 'near', 0, 50).name('Near');
    fogFolder.add(g_scene.fog, 'far', 10, 150).name('Far');

    const matFolder = g_gui.addFolder('Material Control');
    matFolder.addColor(g_materialParams, 'color').name('Color').onChange(v => {
        if (g_skelMesh) g_skelMesh.material.color.setHex(v);
    });
    matFolder.add(g_materialParams, 'roughness', 0, 1).name('Roughness').onChange(v => {
        if (g_skelMesh) g_skelMesh.material.roughness = v;
    });
    matFolder.add(g_materialParams, 'metalness', 0, 1).name('Metalness').onChange(v => {
        if (g_skelMesh) g_skelMesh.material.metalness = v;
    });
    matFolder.add(g_materialParams, 'wireframe').name('Wireframe').onChange(v => {
        if (g_skelMesh) g_skelMesh.material.wireframe = v;
    });
    matFolder.add(g_materialParams, 'flatShading').name('Flat Shading').onChange(v => {
        if (g_skelMesh) {
            g_skelMesh.material.flatShading = v;
            g_skelMesh.material.needsUpdate = true;
        }
    });

    // Directional light 객체가 initGraphics 안에 클로저 스코프로 살아있으므로 그대로 바인딩 가능
    document.getElementById('file-input').addEventListener('change', handleFileSelect);

    // 렌더링 루프 진입
    appLoop();
}


// 매 프레임마다 호출되는 메인 루프 (Main UI Thread - Paint 시점)
function appLoop() {
    requestAnimationFrame(appLoop);

    g_controls.update();

    // 워커가 VBO 던져주기를 기다리는 중이 아니라면 (비동기 락-프리)
    if (g_isPlaying && g_numFrames > 0 && !g_isFrameFetching) {

        // 현재 인덱스를 다음 인덱스로 이동시키고 그 다음 데이터를 워커에 요구
        g_currentFrameIdx = (g_currentFrameIdx + 1) % g_numFrames;
        requestFrameFromWorker(g_currentFrameIdx);

        g_guiParams.Frame = g_currentFrameIdx;
    }

    g_renderer.render(g_scene, g_camera);
    g_stats.update();
}

// ==========================================
// 4. 이벤트 & GPU 통신 함수
// ==========================================
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    setStatus("Mounting file (WORKERFS)...");
    g_guiParams["Play / Pause"] = false;
    g_isPlaying = false;

    // UI 쓰레드에서는 JS 브라우저 File 객체 레퍼런스(Blobs)만 워커로 전송
    g_worker.postMessage({ type: 'LOAD_FILE', payload: file });
}

// 워커에 특정 프레임 버텍스를 계산해서 보내달라고 비동기 요청
function requestFrameFromWorker(index) {
    if (!g_worker) return;
    g_isFrameFetching = true;
    g_worker.postMessage({ type: 'GET_FRAME', payload: index });
}

// 정적 얼굴(Face / Topology) 데이터를 가지고 Three.js의 Object 생성
function setupBaseGeometry(facesInt32Array) {
    if (g_skelMesh) {
        g_dataRoot.remove(g_skelMesh);
        g_skelMesh.geometry.dispose();
        g_skelMesh.material.dispose();
    }

    g_baseGeometry = new THREE.BufferGeometry();
    const indicesBuffer = new Uint32Array(facesInt32Array);

    g_baseGeometry.setIndex(new THREE.BufferAttribute(indicesBuffer, 1));
    g_baseGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));

    const material = new THREE.MeshStandardMaterial({
        color: g_materialParams.color,
        roughness: g_materialParams.roughness,
        metalness: g_materialParams.metalness,
        wireframe: g_materialParams.wireframe,
        flatShading: g_materialParams.flatShading,
        side: THREE.DoubleSide,
    });

    g_skelMesh = new THREE.Mesh(g_baseGeometry, material);
    g_skelMesh.castShadow = true;
    g_skelMesh.receiveShadow = true;
    g_skelMesh.frustumCulled = false; // 동적 VBO 갱신 시 BoundingBox가 업데이트되지 않아 시야 밖으로 인식되어 컬링되는 현상 방지
    g_dataRoot.add(g_skelMesh);
}

// 워커가 던져준 Transferable VBO (Float32Array)를 직접 VRAM에 꽂기
function updateMeshVBOWithVerts(verts1DArray) {
    if (!g_baseGeometry) return;
    const positionAttr = g_baseGeometry.getAttribute('position');

    let isLayoutChanged = false;

    // glBufferData (최초 할당 시) vs glBufferSubData (기존 버퍼 갱신 시)
    if (positionAttr.array.length !== verts1DArray.length) {
        g_baseGeometry.setAttribute('position', new THREE.BufferAttribute(verts1DArray, 3));
        isLayoutChanged = true;
    } else {
        positionAttr.array.set(verts1DArray);
        positionAttr.needsUpdate = true;
    }

    g_baseGeometry.computeVertexNormals();

    // VBO 최초 할당(또는 크기 변경) 시 normal attribute가 새로 추가되므로,
    // 이에 맞춰 머티리얼 셰이더가 올바르게 flat shading 등을 적용받도록 재컴파일 트리거
    if (isLayoutChanged && g_skelMesh) {
        g_skelMesh.material.needsUpdate = true;
    }
}

// 애플리케이션 스타트
initWorker();
initGraphics();
