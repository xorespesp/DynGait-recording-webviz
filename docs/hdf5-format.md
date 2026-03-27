# DynGait motion recording format (v1.5)

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
│   ├── description (H5Dataset) -> Optional
│   │
│   └── motion_analysis_result/ (H5Group) -> Optional
│       └── bodies/ (H5Group)
│           ├── 00/ (H5Group)
│           │   └── sarcopenia_indices/ (H5Group)
│           │       ├── peak_ankle_power (H5Dataset)
│           │       ├── lower_limb_coordination (H5Dataset)
│           │       ├── stance_phase_duration (H5Dataset)
│           │       ├── peak_ankle_plantarflexion_moment (H5Dataset)
│           │       ├── normalized_step_length (H5Dataset)
│           │       └── peak_hip_flexion_moment (H5Dataset)
│           │
│           └── 01/ (H5Group)
│               └── ...
│
├── static/ (H5Group)
│   ├── world_offset_transform (H5Dataset) -> Optional
│   ├── world_up_vector (H5Dataset)
│   │
│   ├── skel_template/ (H5Group)
│   │   ├── faces (H5Dataset)
│   │   ├── lbs_weights (H5Dataset)
│   │   └── bodies/ (H5Group)
│   │       └── 00/ (H5Group)
│   │           └── tpose_verts (H5Dataset)
│   │
│   ├── skin_template/ (H5Group) -> Optional
│   │   ├── faces (H5Dataset) -> Optional
│   │   ├── lbs_weights (H5Dataset) -> Optional
│   │   ├── posedirs (H5Dataset) -> Optional
│   │   └── bodies/ (H5Group)
│   │       ├── 00/ (H5Group)
│   │       │   └── shaped_rest_verts (H5Dataset) -> Optional
│   │       ├── 01/ (H5Group)
│   │       │   └── ...
│   │       └── ...
│   │
│   └── source_images_info/ (H5Group) -> Optional
│       ├── color/ (H5Group)
│       │   ├── format (H5Dataset)
│       │   ├── width_pixels (H5Dataset)
│       │   ├── height_pixels (H5Dataset)
│       │   └── stride_bytes (H5Dataset)
│       ├── depth/ (H5Group)
│       │   ├── format (H5Dataset)
│       │   └── ...
│       └── ir/ (H5Group)
│           ├── format (H5Dataset)
│           └── ...
│
└── frames/ (H5Group)
    ├── 00000/ (H5Group)
    │   ├── timestamp (H5Dataset)
    │   ├── source_images/ (H5Group) -> Optional
    │   │   ├── color_data (H5Dataset)
    │   │   ├── depth_data (H5Dataset)
    │   │   └── ir_data (H5Dataset)
    │   │
    │   └── bodies/ (H5Group)
    │       ├── 00/ (H5Group)
    │       │   ├── skel_model_output/ (H5Group)
    │       │   │   ├── skin_lbs_world_transforms (H5Dataset) -> Optional
    │       │   │   ├── skin_pose_features (H5Dataset) -> Optional
    │       │   │   ├── skel_joint_positions (H5Dataset)
    │       │   │   ├── skel_joint_rotations (H5Dataset)
    │       │   │   ├── skel_bone_transforms (H5Dataset)
    │       │   │   └── skin_v_marker_positions (H5Dataset)
    │       │   │
    │       │   └── motion_analysis_data/ (H5Group) -> Optional
    │       │       ├── grf/ (H5Group)
    │       │       │   ├── grf_total_body (H5Dataset)
    │       │       │   ├── grf_l_foot (H5Dataset)
    │       │       │   ├── grf_r_foot (H5Dataset)
    │       │       │   ├── accel_total_body_com (H5Dataset)
    │       │       │   ├── ground_l_contact_weight (H5Dataset)
    │       │       │   └── ground_r_contact_weight (H5Dataset)
    │       │       │
    │       │       └── inverse_dynamics/ (H5Group)
    │       │           ├── l_ankle_moment (H5Dataset)
    │       │           ├── r_ankle_moment (H5Dataset)
    │       │           ├── l_knee_moment (H5Dataset)
    │       │           ├── r_knee_moment (H5Dataset)
    │       │           ├── l_hip_moment (H5Dataset)
    │       │           └── r_hip_moment (H5Dataset)
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
    - 파일 포맷 버전. e.g: `"1.0"`, `dtype: string`.
- **`/metadata/creation_time` (H5Dataset):**
    - 파일 생성 시각. ISO 8601 UTC 형식. e.g: `"2025-06-13T10:26:35Z"`, `dtype: string`. (Optional)
- **`/metadata/capture_fps` (H5Dataset):**
    - 캡처 프레임레이트. e.g: `30`, `dtype: u32`. (Optional)
- **`/metadata/description` (H5Dataset):**
    - 파일 설명. `dtype: string`. (Optional)

- **`/metadata/motion_analysis_result/` (H5Group):**
    - 모션 시퀀스 전체에 대한 분석 결과 데이터를 저장한다. (Optional)
    - **`/metadata/motion_analysis_result/bodies/` (H5Group):**
        - scene 에 등장하는 각 body의 분석 결과 정보를 담는 컨테이너 그룹.
        - **`/metadata/motion_analysis_result/bodies/00/` (H5Group):**
            - `00`, `01` 등은 각 body의 고유 ID를 나타낸다.
            - 최소 1개의 body ID는 필수. body ID는 00부터 시작하는 2자리 숫자.
            - **`/metadata/motion_analysis_result/bodies/00/sarcopenia_indices/` (H5Group):**
                - 근감소증 진단에 필요한 6가지 지표값을 저장하는 그룹.
                - **`peak_ankle_power` (H5Dataset):** 최대 족관절 파워 지표값. `dtype: f32`
                - **`lower_limb_coordination` (H5Dataset):** 하지 관절 협응 지표값. `dtype: f32`
                - **`stance_phase_duration` (H5Dataset):** 입각기 비율 지표값. `dtype: f32`
                - **`peak_ankle_plantarflexion_moment` (H5Dataset):** 최대 족관절 저굴 모멘트 지표값. `dtype: f32`
                - **`normalized_step_length` (H5Dataset):** 보정 보폭 지표값. `dtype: f32`
                - **`peak_hip_flexion_moment` (H5Dataset):** 최대 고관절 굴곡 모멘트 지표값. `dtype: f32`

#### 3. `/static` (Static Data Group)

시퀀스 전체에 걸쳐 변하지 않는(객체의 기본 shape, faces 등) 정적 데이터를 저장한다.

- **`/static/world_offset_transform` (H5Dataset):**
    - 전체 scene의 기준 좌표계 오프셋 변환 행렬. `(4, 4)`, `dtype: f32`. (Optional)
- **`/static/world_up_vector` (H5Dataset):**
    - World Up 벡터 정보. `(3,)`, `dtype: f32`.

- **`/static/source_images_info/` (H5Group):**
    - 소스 이미지의 정적 메타데이터를 담는 그룹. 프레임 전체에서 변하지 않는 이미지 속성 정보. 
    - 디버깅 및 시각화 목적으로 사용되며, 필요에 따라 생략될 수 있음. (Optional)
    - **`color/` (H5Group):** 컬러 이미지 메타데이터.
    - **`depth/` (H5Group):** 깊이 이미지 메타데이터.
    - **`ir/` (H5Group):** 적외선 이미지 메타데이터.
    - 각 이미지 그룹은 아래의 하위 구조를 가짐:
        - **`format` (H5Dataset):** 이미지 포맷 (e.g: `"BGRA"`, `"MJPG"`, `"DEPTH16"`, `"IR16"`), `dtype: string`.
        - **`width_pixels` (H5Dataset):** 이미지 너비 (픽셀), `dtype: u32`.
        - **`height_pixels` (H5Dataset):** 이미지 높이 (픽셀), `dtype: u32`.
        - **`stride_bytes` (H5Dataset):** 한 행(row)의 바이트 크기, `dtype: u32`.

- **`/static/skel_template/` (H5Group):**
    - skel mesh soft LBS 재구성에 필요한 정적 데이터를 담는다. Forward pass 내부 skel mesh를 생성하는 두 가지 단계의 결과물은 각각 다음과 같이 나뉘어 저장된다:
      - **Stage 1의 결과물** (`tpose_verts`): 체형(betas)에만 의존하고 포즈와 무관하므로, body별 **static 데이터**로 이 그룹에 저장.
      - **Stage 2의 변환 행렬** (`skel_bone_transforms`): 포즈마다 달라지므로 **per-frame 데이터**로 저장 (→ `/frames/.../skel_model_output/skel_bone_transforms`).
      - **Stage 2의 가중치** (`lbs_weights`): 모델 상수이므로 **static 데이터**로 이 그룹에 저장.
    - **`/static/skel_template/faces` (H5Dataset):** skel 전체 mesh face 연결 구조. `(F_skel, 3)`, `dtype: i32`. 모든 body 공유.
    - **`/static/skel_template/lbs_weights` (H5Dataset):** soft per-vertex bone 가중치 (`_skel_weights`). `(V_skel, J)`, `dtype: f32`. 관절 경계 버텍스는 인접 bone 간에 분산된 soft weight를 가지며, 이로 인해 포즈 변화 시 부드러운 연결이 보장된다. 모든 body 공유.
    - **`/static/skel_template/bodies/` (H5Group):** body별 T-pose world vertices.
        - **`00/` (H5Group):** body ID.
            - **`tpose_verts` (H5Dataset):** Stage 1의 결과인 T-pose world 버텍스 (`skel_v_align`). `(V_skel, 3)`, `dtype: f32`. 이는 체형 파라미터(betas)에 따라 달라지므로 body별로 나눠서 저장.

- **`/static/skin_template/` (H5Group):**
    - Skin mesh 관련 정적 데이터를 담는 컨테이너 그룹. skin mesh export가 활성화된 경우에만 존재. (Optional)
    - **`/static/skin_template/faces` (H5Dataset):**
        - 모든 skin model이 공유하는 mesh face 연결 구조 정보. `(F_skin, 3)`, `dtype: i32`. (Optional)
    - **`/static/skin_template/lbs_weights` (H5Dataset):**
        - Skin mesh의 Linear Blend Skinning(LBS) 가중치 행렬. 모든 바디가 공유하는 모델 상수값. `(V_skin, J)`, `dtype: f32`. (Optional)
    - **`/static/skin_template/posedirs` (H5Dataset):**
        - Pose-Dependent Blend Shape 기저 행렬 $P$. `(V_skin × 3, D)`, `dtype: f32`. (Optional)
        - $D = (J-1) \times 9$ (root joint 제외한 관절 수 × 회전 행렬 원소 수). SMPL 기준 $D = 207$.
        - `export_skin_pose_dependent_shape` 옵션이 활성화된 경우에만 존재한다.
        - Per-frame `skin_pose_features`와 행렬곱으로 Pose-Dependent Blend Shape offset을 재구성:
          $$\delta^{\text{pose}} = P \cdot f^{\text{pose}}, \quad P \in \mathbb{R}^{3V \times D},\quad f^{\text{pose}} \in \mathbb{R}^D$$
    - **`/static/skin_template/bodies/` (H5Group):**
        - scene에 등장하는 각 body의 고유한 정적 skin 정보를 담는 컨테이너 그룹.
        - **`/static/skin_template/bodies/00/` (H5Group):**
            - `00`, `01` 등은 각 body의 고유 ID를 나타낸다.
            - **`shaped_rest_verts` (H5Dataset):** 해당 바디의 shape blend shapes만 적용된 skin mesh의 rest-pose vertex 데이터. LBS 재구성의 기반이 되는 정적 메쉬. `(V_skin, 3)`, `dtype: f32`. (Optional)
                이 필드는 SMPL forward pass에서 shape blend shapes(betas)만 적용된 상태의 T-pose 버텍스, 즉 SMPL 논문의 $v_{\text{shaped}}$ 이다:
                $$v_{\text{shaped}} = \bar{v} + B_S(\vec{\beta}) = \bar{v} + \sum_n \beta_n \mathbf{S}_n$$
                다시 말해, 기본 T-pose 템플릿 메시 $\bar{v}$에 blend shapes(betas)만 적용되고 pose-dependent shape와 LBS skinning은 적용되지 않은 상태의 vertex 데이터, 즉 "체형이 적용된 T-pose mesh" 를 의미한다.
                - **Note:** shape 파라미터(betas)가 프레임별로 변하지 않는 경우(일반적인 경우) 이 데이터 하나로 전체 시퀀스에 적용된다.

#### 4. `/frames` (Frameset Data Group)

시간의 흐름에 따라 변화하는 동적 데이터를 프레임 단위로 저장한다.

- **`/frames/00000/` (H5Group):**
    - `00000`, `00001` 등은 프레임 번호를 나타낸다.

- **`/frames/00000/timestamp` (H5Dataset):**
    - 해당 프레임의 캡처 타임스탬프. (단위: microsecond), `dtype: u64`

- **`/frames/00000/source_images/` (H5Group):**
    - 해당 프레임의 원본 소스 이미지 데이터.
    - 디버깅 및 시각화 목적으로 사용되며, 필요에 따라 생략될 수 있음. (Optional)
    - 이미지 메타데이터(format, width, height, stride)는 `/static/source_images_info/`에 저장됨.
    - **`color_data` (H5Dataset):** 컬러 이미지 데이터 `(H, W, C)`, `dtype: u8`.
    - **`depth_data` (H5Dataset):** 깊이 이미지 데이터 `(H, W)`, `dtype: u16`.
    - **`ir_data` (H5Dataset):** 적외선 이미지 데이터 `(H, W)`, `dtype: u16`.

- **`/frames/00000/bodies/` (H5Group):**
    - 해당 프레임에 존재하는 모든 body의 동적 상태 정보를 담는 컨테이너 그룹.
    - **`/frames/00000/bodies/00/` (H5Group):**
        - 해당 프레임에 나타나는 0번 body의 그룹.
        - **`/frames/00000/bodies/00/skel_model_output/` (H5Group):**
            - 특정 프레임에서 특정 바디에 대한 스켈레톤 모델의 모든 출력값을 담는 그룹.
            - **`skin_lbs_world_transforms` (H5Dataset):** skin mesh LBS 재구성에 사용되는 per-joint 스키닝 행렬. Global translation이 baked-in된 $G^{\text{skin}}_j$. skin mesh export가 활성화되었을 때만 존재. `(J, 4, 4)`, `dtype: f32`. (Optional)
                - $G^{\text{skin}}_j$의 정의: SMPL global transformation $G_j$에서 rest joint 위치를 제거하고 global translation을 bake-in한 행렬:
                  $$G^{\text{skin}}_j = G_j \cdot \begin{bmatrix} I & -J^{\text{rest}}_j \\ 0 & 1 \end{bmatrix}, \quad G^{\text{skin}}_j[\text{:3, 3}] \mathrel{+}= t_{\text{global}}$$
                - **전체 재구성 방법 (`skin_pose_features` 포함 시):**
                  - 1단계: `/static/skin_template/posedirs`와 `skin_pose_features`로 Pose-Dependent Blend Shape offset 계산:
                    $$\delta^{\text{pose}} = P \cdot f^{\text{pose}}, \quad P \in \mathbb{R}^{3V \times D}$$
                    (없으면 $\delta^{\text{pose}} = 0$)
                  - 2단계: Pose-corrected rest vertex:
                    $$\tilde{v}^{\text{pd}}_i = v^{\text{rest}}_i + \delta^{\text{pose}}_i$$
                  - 3단계: LBS 적용:
                    $$v'_i = \sum_{j=0}^{J-1} W_{i,j} \cdot G^{\text{skin}}_j \cdot \begin{bmatrix} \tilde{v}^{\text{pd}}_i \\ 1 \end{bmatrix}$$
                  - 여기서 $W$는 `/static/skin_template/lbs_weights`, $v^{\text{rest}}$는 `/static/skin_template/bodies/XX/shaped_rest_verts`
            - **`skin_pose_features` (H5Dataset):** Pose feature vector $f^{\text{pose}} \in \mathbb{R}^D$. `(D,)`, `dtype: f32`. Pose-Dependent Blend Shape export 옵션이 활성화된 경우에만 존재. (Optional)
                - **의미:** Root joint를 제외한 각 관절의 회전 행렬에서 단위 행렬을 뺀 값의 연결:
                  $$f^{\text{pose}} = \operatorname{vec}\!\left(\mathbf{R}_1 - \mathbf{I}\right) \,\|\, \cdots \,\|\, \operatorname{vec}\!\left(\mathbf{R}_{J-1} - \mathbf{I}\right) \in \mathbb{R}^{(J-1) \times 9}$$
                  관절이 T-pose(회전 없음)일 때 $f^{\text{pose}} = \mathbf{0}$이므로 Pose-Dependent Blend Shape 보정이 없다.
                - **Pose-Dependent Blend Shape 재구성:** `/static/skin_template/posedirs` $P$와 행렬곱:
                  $$\delta^{\text{pose}} = P \cdot f^{\text{pose}} \in \mathbb{R}^{3V}$$
                  결과를 $(V, 3)$으로 reshape하면 vertex별 Pose-Dependent Blend Shape offset.
            - **`skel_joint_positions` (H5Dataset):** skel 모델의 각 joint 3D 위치값 `(J, 3)`, `dtype: f32`. (`J`: 관절 개수)
            - **`skel_joint_rotations` (H5Dataset):** skel 모델의 각 joint 3D 회전값. `(J, 3, 3)`의 회전 행렬 또는 `(J, 4)`의 쿼터니언(w, x, y, z order). `dtype: f32`
            - **`skel_bone_transforms` (H5Dataset):** Stage 2의 포즈 변형 행렬 $G_{\text{skel}}$ (global translation baked-in). `(J, 4, 4)`, `dtype: f32`.
                - **재구성:** `skel_template/bodies/00/tpose_verts`(T-pose 버텍스)와 `skel_template/lbs_weights`(soft)와 함께 smooth LBS 재구성:
                  $$v'_i = \sum_{j=0}^{J-1} W_{i,j} \cdot G_{\text{skel},j} \cdot \begin{bmatrix} v^{\text{tpose}}_i \\ 1 \end{bmatrix}$$
                  soft $W$가 관절 경계 버텍스를 인접 bone transform 간에 블렌딩하여 각 bone part들이 포즈 변화에 따라 부드럽게 연결되도록 한다. (특히 척추)
            - **`skin_v_marker_positions` (H5Dataset):** skin mesh의 특정 virtual marker vertex 3D 위치값. `(M, 3)`, `dtype: f32`. (`M`: 마커 개수)

        - **`/frames/00000/bodies/00/motion_analysis_data/` (H5Group):**
            - 특정 프레임에서 특정 바디에 대한 모션 분석 결과를 담는 그룹.
            - 분석이 수행되지 않은 경우 이 그룹은 생략될 수 있다. (Optional)
            - 분석 유형별로 하위 그룹이 구성된다.
            - **`/frames/00000/bodies/00/motion_analysis_data/grf/` (H5Group):**
                - 지면반력(GRF) 관련 데이터를 담는 그룹.
                - **`grf_total_body` (H5Dataset):** Total Body GRF 벡터 `(3,)`, `dtype: f32`.
                - **`grf_l_foot` (H5Dataset):** 왼발에 작용하는 GRF 벡터 `(3,)`, `dtype: f32`.
                - **`grf_r_foot` (H5Dataset):** 오른발에 작용하는 GRF 벡터 `(3,)`, `dtype: f32`.
                - **`accel_total_body_com` (H5Dataset):** Total Body CoM 가속도 벡터 `(3,)`, `dtype: f32`.
                - **`ground_l_contact_weight` (H5Dataset):** 왼발 지면 접촉 가중치, `dtype: f32`. (1.0 = grounded, 0.0 = in the air)
                - **`ground_r_contact_weight` (H5Dataset):** 오른발 지면 접촉 가중치, `dtype: f32`. (1.0 = grounded, 0.0 = in the air)

            - **`/frames/00000/bodies/00/motion_analysis_data/inverse_dynamics/` (H5Group):**
                - Inverse Dynamics 관련 관절 모멘트 데이터를 담는 그룹.
                - **`l_ankle_moment` (H5Dataset):** 왼쪽 발목 시상면(Sagittal Plane) 모멘트, `dtype: f32`.
                - **`r_ankle_moment` (H5Dataset):** 오른쪽 발목 시상면(Sagittal Plane) 모멘트, `dtype: f32`.
                - **`l_knee_moment` (H5Dataset):** 왼쪽 무릎 시상면(Sagittal Plane) 모멘트, `dtype: f32`.
                - **`r_knee_moment` (H5Dataset):** 오른쪽 무릎 시상면(Sagittal Plane) 모멘트, `dtype: f32`.
                - **`l_hip_moment` (H5Dataset):** 왼쪽 고관절 시상면(Sagittal Plane) 모멘트, `dtype: f32`.
                - **`r_hip_moment` (H5Dataset):** 오른쪽 고관절 시상면(Sagittal Plane) 모멘트, `dtype: f32`.

---

### Skin Mesh Reconstruction Info

> v1.3부터 skin mesh는 매 프레임 전체 vertex를 저장하는 대신, Skeletal Animation 방식으로 저장한다. (Pose-Dependent Blend Shape 지원)

**저장 구성:**
- Static: `/static/skin_template/lbs_weights` `(V, J)` + `/static/skin_template/bodies/XX/shaped_rest_verts` `(V, 3)` + `/static/skin_template/posedirs` `(V×3, D)`
- Per-frame: `skin_lbs_world_transforms` `(J, 4, 4)` + `skin_pose_features` `(D,)`

**재구성 공식:**

1. Pose-Dependent Blend Shape offset 계산:
$$\delta^{\text{pose}} = P \cdot f^{\text{pose}}, \quad P \in \mathbb{R}^{3V \times D},\quad f^{\text{pose}} \in \mathbb{R}^D$$

2. Pose-corrected rest vertex:
$$\tilde{v}^{\text{pd}}_i = v^{\text{rest}}_i + \delta^{\text{pose}}_i$$

3. LBS skinning:
$$v'_i = \sum_{j=0}^{J-1} W_{i,j} \cdot G^{\text{skin}}_j \cdot \begin{bmatrix} \tilde{v}^{\text{pd}}_i \\ 1 \end{bmatrix}$$

**다중 body별 shape 변화 대응:**
- 각 body의 rest-pose mesh는 `/static/skin_template/bodies/XX/shaped_rest_verts`에 body별로 독립 저장
- posedirs는 SMPL 모델 상수이므로 모든 바디가 공유
- 바디별 shape(betas)이 전체 시퀀스에서 일정하다고 가정함 (일반적 경우)
- shape이 프레임별로 변화하는 시나리오는 현재 포맷에서 지원하지 않음

---

### Skel Mesh Reconstruction Info

> skel mesh는 v1.4부터 단순 bone-part를 rigid하게 transform하는 형태로 저장하는 대신, soft LBS 방식으로 저장된다.
> 이를 위해 Forward pass 내부적으로 skel mesh를 생성하는 두 가지 단계를 각각 분리 저장하여, viewer에서 동일 공식으로 정확히 재현하도록 한다.

모델이 forward pass 내부적으로 skel mesh를 생성하는 과정은 크게 두 단계로 구성되는데,  
HDF5에는 이 두 단계의 결과물이 각각 따로 분리되어 저장된다.

> **두 단계를 분리해서 각각 따로 저장하는 이유**
> Stage 1은 rigid weights로 T-pose를 구성하기 때문에 betas가 일정한 한 포즈가 달라져도 값이 변하지 않는다.  
> Stage 2만 per-frame으로 기록하면 충분하므로, `tpose_verts`를 static으로 한 번만 저장하여 HDF5 크기를 최소화한다.

> **Stage 1: T-pose 정렬 (체형&스케일 반영, 포즈 무관):**
>
> origin-local template mesh를 체형(betas)과 bone 스케일에 맞게 T-pose 월드 좌표로 rigid하게 정렬한다.
>
> $$v^{\text{tpose}}_i = \sum_{j=0}^{J-1} W^{\text{rigid}}_{i,j} \cdot G_{k01s,j} \cdot \begin{bmatrix} v^{\text{template}}_i \\ 1 \end{bmatrix}$$
>
> - $v^{\text{template}}_i$ (`_skel_template_verts`) : origin-local skel template mesh. 모든 bone이 공통 원점을 공유하는 상태.
> - $W^{\text{rigid}}_{i,j}$ (`_skel_weights_rigid`) : binary rigid 가중치. 각 정점은 정확히 하나의 bone에만 종속(0 또는 1). 경계 버텍스 혼합 없이 각 bone의 template verts를 T-pose 위치로 정확히 이동.
> - $G_{k01s,j}$ (`Gk01s`) $= G_{k01,j}$ (`Gk01`) $\cdot\, S_j$ (`S`) : bone $j$를 T-pose 관절 위치로 이동·정렬하고(`Gk01`), bone 스케일을 적용(`S` = diagonal scale matrix)하는 복합 변환.
>
> 결과 $v^{\text{tpose}}$ (`skel_v_align`)는 포즈와 무관하고 체형(betas)에만 의존한다.
> **HDF5의 static section에 `tpose_verts`로 1회 저장.**
> 
> **Stage 2: 포즈 변형 (per-frame):**
> 
> Stage 1에서 얻은 T-pose world verts에 현재 포즈의 soft LBS를 적용하여 최종 posed world mesh를 생성한다.
> 
> $$v'_i = \sum_{j=0}^{J-1} W_{i,j} \cdot G_{\text{skel},j} \cdot \begin{bmatrix} v^{\text{tpose}}_i \\ 1 \end{bmatrix}$$
> 
> - $W_{i,j}$ (`_skel_weights`) : soft LBS 가중치. Stage 1과 달리 non-binary; 관절 경계 버텍스는 인접 bone에 걸친 분산 weight를 가짐. 이로 인해 포즈 변화 시 두 bone transform이 부드럽게 블렌딩됨.
> - $G_{\text{skel},j}$ (`G_skel_pose_transforms`) : per-joint 포즈 변환 행렬.
> - **HDF5의 per-frame section에 `skel_bone_transforms`로 저장.**

**저장 구성:**
- Static (체형별): `/static/skel_template/lbs_weights` `(V, J)` + `/static/skel_template/bodies/XX/tpose_verts` `(V, 3)`
- Per-frame: `skel_bone_transforms` `(J, 4, 4)`

**재구성 공식:**

$$v'_i = \sum_{j=0}^{J-1} W_{i,j} \cdot G_{\text{skel},j} \cdot \begin{bmatrix} v^{\text{tpose}}_i \\ 1 \end{bmatrix}$$

- $v^{\text{tpose}}_i$ : T-pose world 버텍스 (`tpose_verts`). 체형(betas)에 따라 달라지므로 body별로 정적 저장.
- $G_{\text{skel},j}$ : per-joint 포즈 변환 행렬 (`skel_bone_transforms`). Global translation이 baked-in되어 posed world 좌표로 직접 변환.
- $W_{i,j}$ : soft LBS 가중치 (`lbs_weights`). 관절 경계 버텍스는 인접 bone에 분산된 non-binary weight를 가지며, 포즈 변화 시 두 bone transform이 블렌딩되어 부드러운 연결을 보장.

**`skel_bone_transforms`($G_{\text{skel}}$) 산출 방법:**

$$G_{\text{skel},j} = G_{\text{global},j} \cdot \underbrace{\begin{bmatrix} I & -J^{\text{rest}}_j \\ 0 & 1 \end{bmatrix}}_{G_{\text{tpose\_to\_unposed},j}}, \qquad G_{\text{skel},j}[\text{:3,\,3}] \mathrel{+}= t_{\text{global}}$$

- $G_{\text{global},j}$ (`G_global`) : Kinematic Tree를 따라 루트부터 관절 $j$까지 누적된 전역 포즈 변환.
- $G_{\text{tpose\_to\_unposed},j}$ (`G_tpose_to_unposed`) : T-pose 관절을 회전 원점으로 되돌리는 역이동 행렬. Stage 1에서 이미 T-pose 위치로 이동된 $v^{\text{tpose}}$를 일단 원점으로 되돌린 뒤 $G_{\text{global}}$을 적용하기 위해 필요.
- $J^{\text{rest}}_j$ (`J`) : T-pose 상태에서의 관절 $j$ 위치. `G_tpose_to_unposed`의 역이동 벡터로 사용됨.
- $t_{\text{global}}$ (`trans`) : forward pass의 global translation 입력 파라미터.

**단순 per-bone을 rigid하게 transformation하는 구조로는 충분하지 않은 이유(soft LBS의 적용 필요성):**

Stage 1에서 생성된 `tpose_verts`는 각 bone의 mesh가 T-pose 월드 좌표에 연속적으로 이어진 상태다.  
포즈를 적용할 때 각 bone part를 해당 bone의 $G_{\text{skel},j}$ 하나로만 변환하면 (rigid 방식),  
관절 경계에 위치한 정점들이 인접한 두 bone 중 하나의 변환만 받게 된다.  
예를 들어 spine과 neck이 서로 다른 방향으로 회전하는 포즈의 경우를 생각해보자.  
spine에 종속된 정점은 spine의 변환만 받고 neck에 종속된 정점은 neck의 변환만 받게 된다.  
두 bone의 회전 방향이 달라지면 각 bone이 담당하는 정점 집합이 서로 다른 방향으로 이동하므로,  
경계에서 정점 간 위치 불연속이 발생하고 연결된 두 bone(spine, neck)이 자연스럽게 연결되지 않고 분리되어 보이는 문제가 생긴다.

soft LBS는 관절 경계에 위치한 정점일수록 인접한 두 bone에 걸쳐 weight를 분산시킨다.  
포즈 변환 시 해당 정점의 최종 위치는 두 bone의 $G_{\text{skel}}$을 weight 비율로 가중 합산한 변환  
$T = \sum_j W_{i,j} \cdot G_{\text{skel},j}$ 을 받으므로, 두 bone의 방향 차이가 완만하게 보간되어 연속적인 표면이 유지된다.

**다중 body별 shape 변화 대응:**
- 각 body의 T-pose mesh는 `/static/skel_template/bodies/XX/tpose_verts`에 body별로 독립 저장
- `lbs_weights`는 모델 상수이므로 모든 body가 공유
- 체형(betas)이 전체 시퀀스에서 일정하다고 가정함 (일반적 경우)

---

### Revision History

| Version | Date       | Description                                                                 |
|---------|------------|-----------------------------------------------------------------------------|
| 1.0     | 2025-06-13 | 초기 포맷 정의. 정적/동적 데이터 계층 구조 및 skel_model_output 그룹 정의.  |
| 1.1     | 2025-12-19 | 모션 분석 결과 저장을 위한 `motion_analysis_data` 그룹 추가 (GRF 등).       |
| 1.2     | 2026-01-05 | 파일 메타데이터 그룹 구조 변경, 근감소증 진단 지표 관련 포맷 추가.          |
| 1.3     | 2026-03-11 | mesh 저장 방식을 frame baking 방식에서 skeletal animation 방식으로 변경. (Pose-dependent blend shape 지원) |
| 1.4     | 2026-03-12 | Skel mesh 저장 방식을 per-bone rigid transformation 방식에서 soft LBS 방식으로 전환(버그 픽스). |
| 1.5     | 2026-03-13 | Inverse Dynamics 관절 모멘트 데이터 구조 추가. |