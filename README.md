# 원석 다면체 조각 분할 프로젝트

원본 PNG 이미지의 흰색 경계선을 수학적으로 분석하여 원석을 구성하는 21개의 개별 다각형(polygon) 조각으로 분리하고 화면 중앙에 재구성한 프로젝트입니다.

## 폴더 구조

- `assets/`: 폰트 및 정적 에셋
- `css/`: 스타일시트 (`style.css`)
- `js/`: 스크립트 (`main.js`)
- `img/`: 원본 레퍼런스 이미지 (`gem.png`)
- `index.html`: 메인 웹 페이지 및 SVG 조각 구조
- `README.md`: 프로젝트 문서

## 구현 사양

1. **배경**: 순수 흰색 (`#ffffff`) 적용
2. **배치**: Flexbox를 활용한 뷰포트 정중앙 정렬
3. **조각 분할**:
   - 총 21개의 독립 다각형 조각 (`piece-01` ~ `piece-21`)
   - 각 조각은 공통 꼭짓점 풀(Shared Vertex Pool)을 공유하여 조각 간 빈틈(gap) 및 겹침(overlap) 0% 유지
   - 내부 변 26개, 외곽 변 25개의 닫힌 매니폴드 메쉬(Closed Manifold Mesh) 위상 준수
4. **스타일**:
   - 면 채우기: 검정색 (`fill: #000000`)
   - 경계선: 얇은 흰색 선 (`stroke: #ffffff`, `stroke-width: 1.5px`)
5. **인터랙션 사양**:
   - Pointer Events(마우스, 터치 통합) 기반 개별 조각 독립 드래그 지원
   - `getScreenCTM().inverse()`를 활용한 뷰포트 대비 SVG 좌표계 1:1 정밀 추종
   - 클릭/터치 시 오프셋을 계산하여 튐 현상 없이 부드러운 드래그 구현
   - 선택된 조각 최상단 레이어 자동 정렬 (`appendChild`)
   - `setPointerCapture`를 통한 빠른 마우스 이동 시 추종 유지
   - 호버 시 `cursor: grab`, 드래그 시 `cursor: grabbing` 적용
   - 드래그 종료 시 이동 위치 그대로 유지 (자동 복귀 없음, 물리/충돌 배제)

6. **문장 배치 및 Reveal / Cutout 사양**:
   - 문구: "누가 날 깎아내린다면 그냥 날 조각한다고 생각할게" (레퍼런스 이미지 기반 5줄 배치)
   - 서체: Adobe Fonts (`smo1exa`)의 NOH Optique Display Bold (`font-family: "optique-display", "noh-optique-display", serif;`, `font-weight: 700;`) 적용
   - 기본 상태: 문장 완전 은폐 (`visibility: hidden`)
   - **Hover 상태 (미제거 조각)**: 호버 중인 조각 polygon 마스킹을 통해 해당 영역 문장만 흰색 preview 노출
   - **Removed 상태 (거리 30px 이상 떼어낼 시)**:
     1. [원래 자리]: 해당 조각의 원본 polygon이 `permanent-clip`에 등록되어 흰 배경 위에 검정 문장이 고정되어 영구 노출됨
     2. [떼어낸 조각]: SVG Luminance Mask(`mask`)를 통해 조각 내부 문장 부분이 흰색 텍스트 모양의 구멍(Cutout / Knockout)으로 뚫려 조각과 일체형으로 함께 이동

7. **2D 물리 시뮬레이션 (Matter.js & poly-decomp)**:
   - **드래그 중**: 물리 영향 없이 포인터에 1:1 종속 추종
   - **던지기 관성**: 손을 놓는 순간 직전 포인터의 이동 속도 및 방향(`vx, vy`)을 계산하여 초기 속도로 부여 (최대 속도 20px/frame 제한)
   - **자연스러운 회전**: 던진 횡방향 속도에 비례하여 적정 각속도(`angularVelocity`) 부여
   - **경계 충돌**: 화면 상/하/좌/우의 투명 충돌 벽에서 1~2회 가볍게 튕기도록 낮은 반발력(`restitution: 0.22`) 설정
   - **중력 및 바닥 안착**: `gravity: y = 0.85`가 적용되어 바닥에 낙하
   - **조각 간 충돌 및 다각형 스태킹**: 실제 polygon 형태를 반영한 물리 충돌체끼리 상호 충돌하여 서로 겹치거나 관통하지 않고 바닥에 자연스럽게 얹혀 쌓임
   - **안정화 (Sleeping)**: 속도 및 각속도가 기준치 이하로 떨어지면 수면(Sleep) 상태로 전환하여 미세 떨림 없이 완전 정지
   - **재드래그 지원**: 바닥에 떨어진 조각도 언제든지 다시 집어 던질 수 있음
