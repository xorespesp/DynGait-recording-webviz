# SKELpp sequence recording format (v1.0)

### Objectives for Format Design

- Scalability: 단일 바디 및 다중 바디 시나리오를 모두 지원
- Clarity: 데이터의 성격(정적/동적, 원본/추출/분석)에 따라 논리적으로 계층을 분리하여 명확성 향상
- Completeness: 최종 렌더링에 필요한 데이터와 디버깅 및 시각화를 위한 원본 소스 데이터를 모두 포함하는 독립적인(self-contained) 파일 포맷 지향


### Format Hierarchy Overview (HDF5)

```
/ (Root Group)
│
├── metadata/ (H5Group)
│   ├── file_format_version (H5Dataset)
│   ├── creation_time (H5Dataset) -> Optional
│   ├── capture_fps (H5Dataset) -> Optional
│   └── description (H5Dataset) -> Optional
│
├── static/ (H5Group)
│   ├── offset_Tr (H5Dataset) -> Optional
│   ├── world_up_vector (H5Dataset)
│   ├── skel_mesh_faces (H5Dataset)
│   ├── skin_mesh_faces (H5Dataset)
│   │
│   └── bodies/ (H5Group) -> Optional
│       ├── 00/ (H5Group)
│       │   └── skel_shape_params (H5Dataset)
│       ├── 01/ (H5Group)
│       │   └── skel_shape_params (H5Dataset)
│       └── ...
│
└── frames/ (H5Group)
    ├── 00000/ (H5Group)
    │   ├── timestamp (H5Dataset)
    │   │
    │   └── bodies/ (H5Group)
    │       ├── 00/ (H5Group)
    │       │   └── skel_model_output/ (H5Group)
    │       │       ├── skel_mesh_verts (H5Dataset)
    │       │       ├── skin_mesh_verts (H5Dataset)
    │       │       ├── skel_joint_positions (H5Dataset)
    │       │       ├── skel_joint_rotations (H5Dataset)
    │       │       └── skin_v_markers_positions (H5Dataset)
    │       │
    │       └── 01/ (H5Group)
    │           └── ...
    │
    └── 00001/ (H5Group)
        └── ...
```

---


### Hierarchy Description

#### 1. `/` (Root H5Group)

파일의 최상위 그룹.

#### 2. `/metadata` (Metadata Group)

파일 전체를 설명하는 메타데이터와 분석 요약 정보를 저장하는 그룹.

- **`/metadata/file_format_version` (H5Dataset):**
    - 파일 포맷 버전. e.g: `"1.2"`, `dtype: string`.
- **`/metadata/creation_time` (H5Dataset):**
    - 파일 생성 시각. ISO 8601 형식. e.g: `"2025-06-13T10:26:35+09:00"`, `dtype: string`. (Optional)
- **`/metadata/capture_fps` (H5Dataset):**
    - 캡처 프레임레이트. e.g: `30`, `dtype: u32`. (Optional)
- **`/metadata/description` (H5Dataset):**
    - 파일 설명. `dtype: string`. (Optional)

#### 3. `/static` (Static Data Group)

시퀀스 전체에 걸쳐 변하지 않는(객체의 기본 shape, faces 등) 정적 데이터를 저장한다.

- **`/static/offset_Tr` (H5Dataset):**
    - 전체 scene의 기준 좌표계 오프셋 변환 행렬. `(4, 4)`, `dtype: f32`. (Optional)
- **`/static/world_up_vector` (H5Dataset):**
    - World Up 벡터 정보. `(3,)`, `dtype: f32`.
- **`/static/skel_mesh_faces` (H5Dataset):**
    - 모든 skel model이 공유하는 mesh face 연결 구조 정보. `(F_skel, 3)`, `dtype: i32`.
- **`/static/skin_mesh_faces` (H5Dataset):**
    - 모든 skin model이 공유하는 mesh face 연결 구조 정보. `(F_skin, 3)`, `dtype: i32`.

- **`/static/bodies/` (H5Group):**
    - scene 에 등장하는 각 body의 고유한 정적 정보를 담는 컨테이너 그룹.
    - **`/static/bodies/00/` (H5Group):**
        - `00`, `01` 등은 각 body의 고유 ID를 나타낸다.
        - **`skel_shape_params` (H5Dataset):** 해당 바디의 골격 구조, 체형 등 고유한 shape 파라미터 정보. shape 및 dtype은 스켈레톤 모델에 의존.

#### 4. `/frames` (Frameset Data Group)

시간의 흐름에 따라 변화하는 동적 데이터를 프레임 단위로 저장한다.

- **`/frames/00000/` (H5Group):**
    - `00000`, `00001` 등은 프레임 번호를 나타낸다.

- **`/frames/00000/timestamp` (H5Dataset):**
    - 해당 프레임의 캡처 타임스탬프. (단위: microsecond), `dtype: u64`

- **`/frames/00000/bodies/` (H5Group):**
    - 해당 프레임에 존재하는 모든 body의 동적 상태 정보를 담는 컨테이너 그룹.
    - **`/frames/00000/bodies/00/` (H5Group):**
        - 해당 프레임에 나타나는 0번 body의 그룹.
        - **`/frames/00000/bodies/00/skel_model_output/` (H5Group):**
            - 특정 프레임에서 특정 바디에 대한 스켈레톤 모델의 모든 출력값을 담는 그룹.
            - **`skel_mesh_verts` (H5Dataset):** skel mesh vertex 데이터 `(N_skel, 3)`, `dtype: f32`.
            - **`skin_mesh_verts` (H5Dataset):** skin mesh vertex 데이터 `(N_skin, 3)`, `dtype: f32`.
            - **`skel_joint_positions` (H5Dataset):** skel 모델의 각 joint 3D 위치값 `(J, 3)`, `dtype: f32`. (`J`: 관절 개수)
            - **`skel_joint_rotations` (H5Dataset):** skel 모델의 각 joint 3D 회전값. `(J, 3, 3)`의 회전 행렬 또는 `(J, 4)`의 쿼터니언(w, x, y, z order). `dtype: f32`
            - **`skin_v_markers_positions` (H5Dataset):** skin mesh의 특정 marker vertex 3D 위치값. `(M, 3)`, `dtype: f32`. (`M`: 마커 개수)

---

### Revision History

| Version | Date       | Description                                                                 |
|---------|------------|-----------------------------------------------------------------------------|
| 1.0     | 2025-06-13 | 초기 포맷 정의. 정적/동적 데이터 계층 구조 및 skel_model_output 그룹 정의.  |