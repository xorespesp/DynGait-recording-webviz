import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

// ==========================================
// 1. 글로벌 메인 쓰레드 상태 변수
// ==========================================
let worker = null;            // 백그라운드 Web Worker 제어 객체
let numFrames = 0;            // 전체 데이터 프레임 수
let currentFrameIdx = 0;      // 현재 재생 중인 프레임 인덱스
let isPlaying = false;        // 실시간 렌더링(재생) 상태 여부
let isFrameFetching = false;  // 비동기 통신: 현재 워커에서 VBO 데이터를 요청 중인지 여부 (프레임 락)

// Three.js 코어 렌더링 컨텍스트
let scene, camera, renderer, controls, stats;
let dataRoot = null;        // HDF5 데이터 오브젝트들을 담을 루트 컨테이너 (Up 벡터 등 씬 보정용)
let skelMesh = null;        // 렌더링할 Mesh 인스턴스
let baseGeometry = null;    // 정적 구조(Index Buffer 등)를 유지하고 동적 시점 버퍼(VBO)를 교체할 Geometry 객체

// GUI 관련 변수
let gui;
let frameController;
const guiParams = {
    Frame: 0,
    "Load File": () => { document.getElementById('file-input').click(); },
    "Play / Pause": false
};

const materialParams = {
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
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    // 워커로부터의 콜백(Signal) 수신부
    worker.onmessage = (e) => {
        const { type, payload } = e.data;

        switch (type) {
            case 'FILE_LOADED':
                // 1. 파일이 마운트되고 초기 세팅(정적 Topology) 완료
                const { upVector, faces, numFrames: loadedFrames } = payload;

                numFrames = loadedFrames;

                // 루트 노드 회전 보정 (데이터측 벡터를 Three.js 씬 상향벡터인 Y축으로 정렬)
                if (upVector && dataRoot) {
                    const dataUpVector = new THREE.Vector3(upVector[0], upVector[1], upVector[2]).normalize();
                    const webglUpVector = new THREE.Vector3(0, 1, 0);
                    const rotQuat = new THREE.Quaternion().setFromUnitVectors(dataUpVector, webglUpVector);
                    dataRoot.quaternion.copy(rotQuat);
                }

                // 기초 메쉬(EBO) 할당
                setupBaseGeometry(faces);

                if (numFrames > 0) {
                    currentFrameIdx = 0;
                    setStatus(`Ready (${numFrames} frames)`);

                    // 슬라이더 범위 동적 갱신
                    if (frameController) {
                        frameController.max(numFrames - 1);
                        frameController.updateDisplay();
                    }

                    // 초기 0번 프레임 VBO 요청
                    requestFrameFromWorker(0);
                } else {
                    setStatus("0 frame data found.");
                }
                gui.controllersRecursive().forEach(c => c.updateDisplay());
                break;

            case 'FRAME_DATA':
                // 2. 워커가 Float32Array VBO 데이터를 던져줬을 때
                const { frameIndex, verts } = payload;
                isFrameFetching = false; // 워커 쓰레드 잠금 해제

                // 프레임 인덱스가 꼬이지 않고 현재 그려야 할 화면일 때만 반영
                if (frameIndex === currentFrameIdx && verts) {
                    updateMeshVBOWithVerts(verts);
                }
                break;

            case 'ERROR':
                console.error("Worker Error:", payload);
                setStatus("Error: " + payload);
                guiParams["Play / Pause"] = false;
                isPlaying = false;
                gui.controllersRecursive().forEach(c => c.updateDisplay());
                break;
        }
    };
}


// ==========================================
// 3. Three.js 설정 (초기화)
// ==========================================
function initGraphics() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa0a0a0);
    scene.fog = new THREE.Fog(0xa0a0a0, 5.5, 30);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.15);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

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
    scene.add(dirLight);

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
    scene.add(planeMesh);

    const container = document.getElementById('canvas-container');

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // PCF 고품질 소프트 섀도우 적용
    container.appendChild(renderer.domElement);

    // 리사이즈 될 때 윈도우 전체가 아닌 container 사이즈 기반으로 비율 조정
    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 3);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);

    // 데이터 보정을 위한 공간 최상위 루트 그룹 생성
    dataRoot = new THREE.Group();
    scene.add(dataRoot);

    stats = new Stats();
    document.getElementById('stats-container').appendChild(stats.dom);

    window.addEventListener('resize', () => {
        const container = document.getElementById('canvas-container');
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });

    // GUI 설정
    gui = new GUI();
    const pbFolder = gui.addFolder('Playback Control');
    pbFolder.add(guiParams, 'Load File');

    frameController = pbFolder.add(guiParams, 'Frame', 0, 0, 1).listen().onChange((val) => {
        currentFrameIdx = parseInt(val, 10);
        guiParams["Play / Pause"] = false;
        isPlaying = false;
        requestFrameFromWorker(currentFrameIdx);
    });

    pbFolder.add(guiParams, 'Play / Pause').onChange((val) => {
        isPlaying = val;
    });

    const sceneFolder = gui.addFolder('Scene Control');
    sceneFolder.add(hemiLight, 'intensity', 0, 10).name('Hemi Intensity');
    sceneFolder.add(dirLight, 'intensity', 0, 10).name('Dir Intensity');

    const dirPosFolder = sceneFolder.addFolder('Dir Light Position');
    dirPosFolder.add(dirLight.position, 'x', -50, 50).name('X');
    dirPosFolder.add(dirLight.position, 'y', 0, 50).name('Y');
    dirPosFolder.add(dirLight.position, 'z', -50, 50).name('Z');

    dirLight.shadow.bias = -0.001; // Shadow acne(물결 그림자) 방지용 하드코딩

    const fogFolder = sceneFolder.addFolder('Fog Range');
    fogFolder.add(scene.fog, 'near', 0, 50).name('Near');
    fogFolder.add(scene.fog, 'far', 10, 150).name('Far');

    const matFolder = gui.addFolder('Material Control');
    matFolder.addColor(materialParams, 'color').name('Color').onChange(v => {
        if (skelMesh) skelMesh.material.color.setHex(v);
    });
    matFolder.add(materialParams, 'roughness', 0, 1).name('Roughness').onChange(v => {
        if (skelMesh) skelMesh.material.roughness = v;
    });
    matFolder.add(materialParams, 'metalness', 0, 1).name('Metalness').onChange(v => {
        if (skelMesh) skelMesh.material.metalness = v;
    });
    matFolder.add(materialParams, 'wireframe').name('Wireframe').onChange(v => {
        if (skelMesh) skelMesh.material.wireframe = v;
    });
    matFolder.add(materialParams, 'flatShading').name('Flat Shading').onChange(v => {
        if (skelMesh) {
            skelMesh.material.flatShading = v;
            skelMesh.material.needsUpdate = true;
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

    controls.update();

    // 워커가 VBO 던져주기를 기다리는 중이 아니라면 (비동기 락-프리)
    if (isPlaying && numFrames > 0 && !isFrameFetching) {

        // 현재 인덱스를 다음 인덱스로 이동시키고 그 다음 데이터를 워커에 요구
        currentFrameIdx = (currentFrameIdx + 1) % numFrames;
        requestFrameFromWorker(currentFrameIdx);

        guiParams.Frame = currentFrameIdx;
    }

    renderer.render(scene, camera);
    stats.update();
}

// ==========================================
// 4. 이벤트 & GPU 통신 함수
// ==========================================
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    setStatus("Mounting file (WORKERFS)...");
    guiParams["Play / Pause"] = false;
    isPlaying = false;

    // UI 쓰레드에서는 JS 브라우저 File 객체 레퍼런스(Blobs)만 워커로 전송
    worker.postMessage({ type: 'LOAD_FILE', payload: file });
}

// 워커에 특정 프레임 버텍스를 계산해서 보내달라고 비동기 요청
function requestFrameFromWorker(index) {
    if (!worker) return;
    isFrameFetching = true;
    worker.postMessage({ type: 'GET_FRAME', payload: index });
}

// 정적 얼굴(Face / Topology) 데이터를 가지고 Three.js의 Object 생성
function setupBaseGeometry(facesInt32Array) {
    if (skelMesh) {
        dataRoot.remove(skelMesh);
        skelMesh.geometry.dispose();
        skelMesh.material.dispose();
    }

    baseGeometry = new THREE.BufferGeometry();
    const indicesBuffer = new Uint32Array(facesInt32Array);

    baseGeometry.setIndex(new THREE.BufferAttribute(indicesBuffer, 1));
    baseGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));

    const material = new THREE.MeshStandardMaterial({
        color: materialParams.color,
        roughness: materialParams.roughness,
        metalness: materialParams.metalness,
        wireframe: materialParams.wireframe,
        flatShading: materialParams.flatShading,
        side: THREE.DoubleSide,
    });

    skelMesh = new THREE.Mesh(baseGeometry, material);
    skelMesh.castShadow = true;
    skelMesh.receiveShadow = true;
    skelMesh.frustumCulled = false; // 동적 VBO 갱신 시 BoundingBox가 업데이트되지 않아 시야 밖으로 인식되어 컬링되는 현상 방지
    dataRoot.add(skelMesh);
}

// 워커가 던져준 Transferable VBO (Float32Array)를 직접 VRAM에 꽂기
function updateMeshVBOWithVerts(verts1DArray) {
    if (!baseGeometry) return;
    const positionAttr = baseGeometry.getAttribute('position');

    let isLayoutChanged = false;

    // glBufferData (최초 할당 시) vs glBufferSubData (기존 버퍼 갱신 시)
    if (positionAttr.array.length !== verts1DArray.length) {
        baseGeometry.setAttribute('position', new THREE.BufferAttribute(verts1DArray, 3));
        isLayoutChanged = true;
    } else {
        positionAttr.array.set(verts1DArray);
        positionAttr.needsUpdate = true;
    }

    baseGeometry.computeVertexNormals();

    // VBO 최초 할당(또는 크기 변경) 시 normal attribute가 새로 추가되므로, 
    // 이에 맞춰 머티리얼 셰이더가 올바르게 flat shading 등을 적용받도록 재컴파일 트리거
    if (isLayoutChanged && skelMesh) {
        skelMesh.material.needsUpdate = true;
    }
}

// 애플리케이션 스타트
initWorker();
initGraphics();
