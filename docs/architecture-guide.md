# C++ 그래픽스 엔지니어를 위한 WebGL 및 WebAssembly 실시간 렌더링 가이드

본 문서는 C/C++ 네이티브 그래픽스 엔지니어가 웹 프론트엔드 환경(JavaScript, WebAssembly, WebGL)에서 대용량 HDF5 데이터를 실시간 렌더링하는 통신 구조와 렌더링 파이프라인을 학습할 수 있도록 작성된 가이드 문서이다.

---

## 1. 개요 및 기술 스택 매핑

웹 브라우저의 렌더링 및 실행 환경은 V8 엔진과 WebGL, WebAssembly(WASM)의 도입으로 기존 네이티브 환경(C++ OpenGL/DirectX)과 구조적으로 유사해졌다. 본 프로젝트에 사용된 기술 스택과 C++ 네이티브 환경의 대응 관계는 다음과 같다.

| C++ 네이티브 환경 | 웹 프론트엔드 환경 | 역할 및 설명 |
| :--- | :--- | :--- |
| **OpenGL / DirectX** | **WebGL (Three.js)** | 브라우저 내 GPU 하드웨어 가속 렌더링 API. Three.js는 Scene Graph 기반의 렌더링 엔진(Ogre3D, bgfx 등과 유사) 역할을 수행한다. |
| **Pthreads / `std::thread`** | **Web Worker** | UI 스레드(렌더 루프)와 분리된 완전한 백그라운드 스레드. 별도의 V8 엔진 인스턴스에서 독립적으로 실행된다. |
| **C/C++ HDF5 Library** | **h5wasm (WebAssembly)** | C로 작성된 HDF5 라이브러리를 LLVM 기반(Emscripten)으로 포팅한 바이너리. 네이티브에 준하는 메모리 포인터 접근 속도를 제공한다. |
| **`std::memcpy` / Zero-copy** | **Transferable Objects** | 스레드 간 배열 복사로 인한 병목을 제거하고, 메모리 블록의 소유권(Ownership) 자체를 이전하여 Zero-copy 통신을 구현한다. |

<br>

## 2. HDF5 데이터를 WebGL 화면에 띄우기 (Step-by-Step)

먼저 웹 브라우저에서 C레벨 바이너리 포맷인 HDF5 데이터를 읽고, 이를 WebGL로 렌더링하는 전체적인 파이프라인 과정을 소개한다.  
C++의 네이티브 그래픽스 파이프라인 구성과 놀랍도록 닮아 있음을 확인할 수 있다.

### [STEP 1] 정적 지오메트리 구조 구성 (Index Buffer) 및 보정

파일 전반에 걸쳐 불변하는 정보를 `/static` 그룹에서 읽어와 초기 세팅을 진행한다.

##### **Topology 설정**
Three.js에는 `BufferGeometry.setIndex`와 같은 기능을 제공하는데, 이는 C++ OpenGL에서의 `glGenBuffers` 및 `glBindBuffer(GL_ELEMENT_ARRAY_BUFFER)`를 수행하는 것과 동일한 개념이다. (EBO/IBO)
아래와 같이 파일의 `/static/skel_mesh_faces` 노드에서 Face Index 배열을 추출하여 `Uint32Array` 형태로 변환한 뒤 인덱스 버퍼로 세팅한다.

```javascript
// HDF5에서 추출한 Faces 데이터
const indicesBuffer = new Uint32Array(facesInt32Array); // JS TypedArray (C 배열과 메모리 구조 동일)

// baseGeometry는 Three.js의 Vertex Array Object (VAO) 역할
baseGeometry = new THREE.BufferGeometry();
baseGeometry.setIndex(new THREE.BufferAttribute(indicesBuffer, 1)); // 1: 스칼라 인덱스
```
이로써 GPU에는 정점들의 연결 정보(Topology)가 캐싱되게 된다.

##### **World Up-Vector 보정**
스켈레톤 데이터는 제작된 모델링 환경에 따라 기준 좌표계의 상향 벡터(예: Z-Up)가 서로 다를 수 있다. 반면 Three.js는 기본적으로 Y-Up 우수 좌표계를 채택하고 있으므로 렌더링 시 축 보정이 필수적이다. 
이를 위해 C++ 수학 라이브러리의 `setFromTwoVectors`와 동일한 역할을 수행하는 Three.js의 `Quaternion.setFromUnitVectors` 기능을 활용한다. 아래와 같이 데이터의 상향 벡터를 WebGL 상향 벡터(+Y)에 맞추는 쿼터니언을 구한 뒤, 이를 모델의 최상위 컨테이너(`dataRoot`)에 일괄 적용함으로써 하위 모델들이 지면에 올바르게 서 있도록 세팅한다.

```javascript
const dataUpVector = new THREE.Vector3(upArr[0], upArr[1], upArr[2]).normalize();
const webglUpVector = new THREE.Vector3(0, 1, 0); 

// 데이터 상향 벡터와 WebGL 상향 벡터 간의 회전 사원수 도출
const rotQuat = new THREE.Quaternion().setFromUnitVectors(dataUpVector, webglUpVector);

// 최상위 컨테이너 객체에 회전 보정값 적용
dataRoot.quaternion.copy(rotQuat); 
```

### [STEP 2] 동적 VBO 프레임 데이터 파싱

프레임이 진행될 때마다 `/frames/.../skel_mesh_verts` 노드에 접근하여  
현재 프레임의 정점 좌표(가 될 Float32 배열)를 HDF5 파일로부터 즉각적으로 추출한다.  
`h5wasm` 라이브러리의 `.value` 속성은 거추장스러운 JS 변환 없이 WebAssembly 메모리상주 배열 포인터를 그대로 반환해준다.

### [STEP 3] 매 프레임 실시간 VRAM 갱신 (Update VBOs)

파싱된 Float32Array 정점 VBO 배열을 메인 스레드에서 메쉬 버퍼에 통으로 매핑(할당)한다.  
이는 OpenGL의 `glBufferSubData()`와 동일한 메커니즘으로 동작하며, 객체 순회 오버헤드 없이 C 포인터 레벨의 빠른 덮어쓰기 복사가 수행된다.

```javascript
// 특정 프레임에서 가져온 verts1DArray (스켈레톤 정점의 나열)
function updateMeshVBOWithVerts(verts1DArray) {
    const positionAttr = baseGeometry.getAttribute('position');

    if (positionAttr.array.length !== verts1DArray.length) {
        // [초기 할당] 버퍼 크기가 불일치하면 새로 GPU에 파싱 및 전송 (glBufferData)
        baseGeometry.setAttribute('position', new THREE.BufferAttribute(verts1DArray, 3));
    } else {
        // [실시간 렌더링 루프] 기존 배열 뷰에 값 덮어쓰기 실시
        positionAttr.array.set(verts1DArray);
        
        // Dirty Flag 설정: WebGL 코어 모듈이 내부적으로 glBufferSubData 호출을 예약함
        positionAttr.needsUpdate = true;
    }
    
    // 조명(라이팅) 계산을 위한 표면 노멀 재계산 (Compute Shader 대용)
    baseGeometry.computeVertexNormals();
}
```

<br>

## 3. 대규모(2GB+) HDF5 파일 로드 트러블슈팅 및 비동기 고도화

기본적인 파일 처리 흐름을 구현하고 난 뒤, MB 단위가 아닌 GB 단위에 달하는 데이터 시퀀스를  
로컬 브라우저 상에서 로딩 시 치명적인 환경 제약들에 직면하게 된다.

### 문제 발생 원인: "The requested file could not be read..." (Permission/Memory issue)

웹 브라우저는 기본적으로 보안 샌드박스 정책을 적용받기 때문에,  
디스크 내 절대경로 파일에 직접 `fopen` 이나 `mmap` 같은 명령을 수행할 수 없다.  
따라서 C++의 논리를 웹으로 가져오려는 경우 흔히 아래와 같은 실수를 범하게 된다:

1. `<input type="file">`에서 HTML File 객체 획득
2. `await file.arrayBuffer()`를 호출하여 파일을 통째로 브라우저 힙 배열 메모리에 로드 (1차 복사: 2GB 점유)
3. WASM 파일 시스템(Emscripten `MEMFS`)의 가상 경로에 ArrayBuffer 값을 할당 (2차 복사: 2GB 점유)

결과적으로 2GB짜리 파일을 읽는 순간, Chrome V8 엔진의 단일 탭 힙 메모리 스펙트럼(~2~4GB) 한계를 돌파하게 되어  
OOM 크래시가 나거나, 블록된 File I/O의 Permission 에러가 뱉어지게 된다.

### 해결책 1: WORKERFS 마운트를 통한 가상 파일 스트리밍

Emscripten 기능 중 하나인 `WORKERFS` 모델을 사용하면, 파일을 전부 메모리에 올리지 않고  
C++의 `fopen`/`fread` 콜이 브라우저의 File 객체 입출력으로 다이렉트 직결(Zero-copy streaming)통신 하도록 만들 수 있다.

하지만 가장 큰 제약이 있는데, `WORKERFS`는 오직 백그라운드 스레드(Web Worker) 전용 API라는 점이다.  
따라서 코드를 UI 렌더링 스레드와 파일 I/O 스레드로 분리해야만 한다.

```javascript
// 메인 스레드 (src/main.js)
// 포인터 레퍼런스(HTML File 객체 껍데기)만 Worker 스레드로 전송
worker.postMessage({ type: 'LOAD_FILE', payload: file });

// --------------------------------------------------------------------
// 워커 스레드 (src/worker.js)
const mountDir = "/work";
// WORKERFS 백엔드를 통해 HTML File 객체를 WASM 런타임의 가상 디렉토리에 다이렉트로 마운트
h5wasm.FS.mount(h5wasm.FS.filesystems.WORKERFS, { files: [file] }, mountDir);
```
이렇게 함으로써 2GB 파일도 RAM에 적재되지 않고 스트리밍 방식으로  
필요한 프레임의 청크만 지연 로딩(Lazy Read)되어 HDF5 라이브러리로 접근할 수 있게 되었다!

### 해결책 2: 메인 스레드로의 Transferable Objects 통신 (Zero-copy)

Worker 스레드에서 추출한 정점 배열 데이터를 메인 WebGL 스레드로 단순 값 복사 방식으로 전달하면, 자바스크립트 엔진 내부의 `Structured Clone Algorithm`이 개입해 대상 배열 전체를 직렬화하고 복사하는 무거운 과정을 거친다. 초당 60프레임(60FPS) 이상으로 렌더링되는 실시간 환경에서 이런 메모리 복사 작업이 매 프레임 일어난다면 병목 오버헤드가 막대해질 것이다.

이를 해결하기 위해서는 C++의 `std::move`나 `std::unique_ptr`처럼  
메모리 블록에 대한 소유권(Ownership) 자체를 양도하는 **Transferable Objects** 기법이 필요하다.

자바스크립트 내의 `ArrayBuffer`는 물리적 메모리 블록을 가리킨다. 이를 `postMessage`의 두 번째 인자인 Transfer 배열에 명시해 넘겨주면, 자바스크립트 엔진은 값을 일절 복사하지 않고 해당 버퍼의 소유권 포인터만을 메인 스레드로 이동시킨다. 제어권이 이관되는 즉시 데이터를 보낸 워커 측에서는 해당 버퍼가 무효화(Detached)되며 메모리 접근 권한을 잃게 된다. 
이는 스레드 간 동기화 충돌의 여지를 원천 차단할 뿐만 아니라, 프레임마다 발생하는 대량의 VBO 데이터 전송 오버헤드를 제로 수준으로 만들어 준다.

```javascript
// src/worker.js 단에서 HDF5 WASM 힙의 정점 데이터를 반환받음
const wasmVerts = vertsDataset.value; 

// WASM 힙 외부의 자바스크립트 힙에 개별 ArrayBuffer 생성 (프레임당 수십~수백 KB로 할당 비용 미미)
const vertsArr = new Float32Array(wasmVerts);

// 소유권 양도 연산: Transferable Objects 명시
// 배열의 두 번째 인자인 `[vertsArr.buffer]`는 엔진에게 이 버퍼의 제어권을 통째로 양도하라는 지시어다.
self.postMessage({
    type: 'FRAME_DATA',
    payload: { frameIndex, verts: vertsArr }
}, [vertsArr.buffer]); 

// NOTE: 이 시점 이후로 현재 Worker 스레드 내에서 vertsArr 배열에 
//       R/W 접근을 시도하면 Detached ArrayBuffer 연산 메모리 에러가 발생한다.
```

<br>

## 결론

자바스크립트 프론트엔드 생태계는 메모리 관리 측면에서 샌드박스의 제약을 크게 받는다.  
그러나 Three.js가 제공하는 WebGL 저수준 VBO 제어 기능과 더불어 Web Worker의 다중 스레드, 가상 파일시스템 직접 마운트(WORKERFS), Transferable zero-copy 메모리 이전 기법을 결합하면 위계적인 제약을 우회할 수 있다.  
이를 통해 대용량 C++ 그래픽스 에셋 처리 시에도 시스템 메모리 초과 현상 및 프레임 드랍 없이 네이티브에 근접한 수준의 고성능 렌더링 파이프라인 구축이 가능함을 본 구조를 통해 확인할 수 있다.
