# HDF5 Skeletal Animation Viewer (Three.js PoC)

본 프로젝트는 Three.js를 활용하여 **로컬 `.h5` (HDF5) 파일에 저장된 연속적인 골격 메시 애니메이션 데이터를 실시간으로 읽어와 웹페이지상에서 렌더링하는 Proof of Concept (PoC)** 입니다.

C++ 그래픽스/엔진 개발자분들의 빠른 이해를 돕을 수 있도록 WebGL과 Three.js의 구조(VBO 갱신 메커니즘 등)에 비유한 주석을 소스코드 상에 포함했습니다.

---

## 🛠 아키텍처 및 구현 핵심 (C++ 개발자를 위한 요약)
1. **파일 I/O 및 파싱 (`h5wasm`)**
   - 웹 브라우징 환경의 샌드박스 정책으로 인해 C/C++ `fopen/fread` 형태의 파일 직접 Stream I/O는 불가합니다.
   - 따라서 `.h5` 파일을 브라우저 힙 메모리(`ArrayBuffer`)로 복사 후 **WebAssembly (Emscripten) 가상 파일 시스템**에 탑재하여 C언어 네이티브 기반 `h5wasm` 코어가 직접 포인터 연산을 수행해 파싱합니다. 파싱 시 발생하는 JS와 C 메모리 바인딩 비용이 거의 무료에 가깝습니다.

2. **메쉬 생성 및 Draw Call 처리 (정적 데이터)**
   - `HDF5 /static/skel_mesh_faces` 에서 읽어온 Triangle Index 데이터를 `Int32` 배열로 반환받습니다.
   - OpenGL의 `EBO` (Element Buffer Object) 혹은 `IBO` 역할을 하는 Three.js의 `BufferGeometry.setIndex` 에 Uint32Array로 넘겨 줍니다.

3. **실시간 VBO(Vertex Buffer Object) 갱신 (동적 데이터)**
   - 프레임마다 `/frames/.../skel_mesh_verts` 노드에 접근하여 반환 받은 `Float32Array` 배열 버퍼를 통째로 Three.js 렌더링 파이프라인(Attribute)에 덧씌우기 (`.set()`) 합니다.
   - 이는 네이티브 그래픽스 API의 `glBufferSubData()`, `vkCmdUpdateBuffer()` 등과 원리가 같습니다. JIT 컴파일러와 WebGL 구현체 단에서 최적화가 이뤄지므로 자바스크립트의 for 루프가 필요 없는 `O(1)` 포인터 카피급 성능이 보장됩니다.

## 🚀 실행(빌드) 방법

Node.js (v18+) 환경이 데스크탑에 필요합니다.

```bash
# 1. 터미널에서 이 폴더로 이동합니다.
cd c:\Users\Min\Desktop\jshdf5-read-test

# 2. 패키지 매니저로 의존성(Three.js, h5wasm, Vite) 설치를 수행합니다.
npm install

# 3. 개발 서버 실행
npm run dev
```

서버가 구동되면 CLI 상에 출력되는 **로컬호스트 주소 (`http://localhost:5173/`)** 를 크롬이나 엣지 브라우저에 접속하시면 됩니다.

화면 좌측 상단 패널에서 `.h5` 파일을 선택해 불러오면 자동으로 3D 뷰어가 화면에 그려집니다.

---
## 💡 코드 파일 구조
- **`index.html`**     : 진입점 (Three.js 캔버스 요소 선언, UI 레이아웃, CSS)
- **`src/main.js`**    : WebGL 메인 렌더링 루프 (HDF5 파싱, Three.js VBO 동적 갱신 핵심 로직)
- **`vite.config.js`** : Wasm 파일 번들링을 최적화하기 위한 개발 서버 환경설정 파일
