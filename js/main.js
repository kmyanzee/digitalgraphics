/**
 * 원석 조각 개별 드래그, 제거(Removed), 텍스트 Cutout 및 2D 물리 시뮬레이션(Matter.js)
 * 성능 최적화: CTM 캐싱, window 기반 포인터 추적, 조기 정지(Premature Freeze) 원천 차단
 */

import Matter from 'matter-js';
import decomp from 'poly-decomp';

Matter.Common.setDecomp(decomp);

const { Engine, World, Bodies, Body } = Matter;

document.addEventListener('DOMContentLoaded', () => {
  const svg = document.querySelector('.gem-svg');
  const gemGroup = document.getElementById('gem-group');
  const removedGroup = document.getElementById('removed-group');
  const permanentClip = document.getElementById('permanent-clip');
  const hoverClipPolygon = document.getElementById('hover-clip-polygon');
  const sentenceLayer = document.getElementById('sentence-layer');
  const svgDefs = document.getElementById('svg-defs');
  const pieces = document.querySelectorAll('.gem-piece');

  if (!svg || !gemGroup || !removedGroup || !permanentClip || !hoverClipPolygon || !sentenceLayer || !svgDefs || pieces.length === 0) return;

  // 문장 5줄 데이터 정의
  const sentenceData = [
    { text: '누가', x: 523, y: 261 },
    { text: '날', x: 481, y: 309 },
    { text: '깎아내린다면', x: 518, y: 369 },
    { text: '그냥 날 조각한다고', x: 504, y: 426 },
    { text: '생각할게', x: 520, y: 472 },
  ];

  // 1. Matter.js 물리 엔진 생성
  const engine = Engine.create({
    enableSleeping: false,
    gravity: { x: 0, y: 0.95, scale: 0.001 },
  });
  const world = engine.world;

  // CTM 캐시 (드래그 중 강제 리플로우 방지)
  let cachedInverseCTM = null;
  function updateCTMCache() {
    const ctm = svg.getScreenCTM();
    if (ctm) {
      cachedInverseCTM = ctm.inverse();
    }
  }
  updateCTMCache();
  window.addEventListener('resize', updateCTMCache);
  window.addEventListener('scroll', updateCTMCache);

  /**
   * 화면 픽셀 좌표(clientX, clientY)를 SVG viewBox 좌표계로 고속 변환
   */
  function getFastSVGPoint(clientX, clientY) {
    if (cachedInverseCTM) {
      return {
        x: cachedInverseCTM.a * clientX + cachedInverseCTM.c * clientY + cachedInverseCTM.e,
        y: cachedInverseCTM.b * clientX + cachedInverseCTM.d * clientY + cachedInverseCTM.f,
      };
    }
    const rect = svg.getBoundingClientRect();
    const scaleX = 488 / (rect.width || 1);
    const scaleY = 441 / (rect.height || 1);
    return {
      x: 255 + (clientX - rect.left) * scaleX,
      y: 153 + (clientY - rect.top) * scaleY,
    };
  }

  // 2. 화면 가장자리 투명 충돌 벽 (Invisible Boundaries)
  let wallBodies = [];
  let floorTopY = 640;

  function updateWalls() {
    updateCTMCache();
    const topLeft = getFastSVGPoint(0, 0);
    const topRight = getFastSVGPoint(window.innerWidth, 0);
    const bottomLeft = getFastSVGPoint(0, window.innerHeight);
    const bottomRight = getFastSVGPoint(window.innerWidth, window.innerHeight);

    const minX = Math.min(topLeft.x, bottomLeft.x);
    const maxX = Math.max(topRight.x, bottomRight.x);
    const minY = Math.min(topLeft.y, topRight.y);
    const maxY = Math.max(bottomLeft.y, bottomRight.y);

    const thickness = 1000;
    const totalWidth = (maxX - minX) + thickness * 2;
    const totalHeight = (maxY - minY) + thickness * 2;

    // 조각이 화면 최하단 안쪽에 온전히 보이도록 바닥 벽 표면 설정
    floorTopY = maxY - 30;

    if (wallBodies.length > 0) {
      World.remove(world, wallBodies);
      wallBodies = [];
    }

    const wallOptions = {
      isStatic: true,
      restitution: 0.25, // 1~2회 가볍게 튕긴 후 안정
      friction: 0.85,    // 바닥 안착 및 미끄러짐 방지
      frictionStatic: 1.0,
    };

    // 바닥
    const floor = Bodies.rectangle(
      (minX + maxX) / 2,
      floorTopY + thickness / 2,
      totalWidth,
      thickness,
      wallOptions
    );

    // 천장
    const ceiling = Bodies.rectangle(
      (minX + maxX) / 2,
      minY - thickness / 2,
      totalWidth,
      thickness,
      wallOptions
    );

    // 좌측 벽
    const leftWall = Bodies.rectangle(
      minX - thickness / 2,
      (minY + maxY) / 2,
      thickness,
      totalHeight,
      wallOptions
    );

    // 우측 벽
    const rightWall = Bodies.rectangle(
      maxX + thickness / 2,
      (minY + maxY) / 2,
      thickness,
      totalHeight,
      wallOptions
    );

    wallBodies = [floor, ceiling, leftWall, rightWall];
    World.add(world, wallBodies);
  }

  setTimeout(updateWalls, 50);
  window.addEventListener('resize', updateWalls);

  // 3. 조각별 상태 및 물리 바디 초기화
  const pieceDataMap = new Map();

  pieces.forEach((piece) => {
    const pointsStr = piece.getAttribute('points').trim();
    const vertices = pointsStr.split(/\s+/).map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });

    let sumX = 0, sumY = 0;
    vertices.forEach((v) => { sumX += v.x; sumY += v.y; });
    const avgX = sumX / vertices.length;
    const avgY = sumY / vertices.length;

    // 동적 바디로 생성하여 질량/관성모멘트를 정상 계산한 후 정적 고정
    const body = Bodies.fromVertices(
      avgX,
      avgY,
      [vertices],
      {
        restitution: 0.22,
        friction: 0.7,
        frictionStatic: 0.9,
        frictionAir: 0.012,
        density: 0.002,
      },
      true
    );

    Body.setStatic(body, true);
    const initialCenter = { x: body.position.x, y: body.position.y };

    pieceDataMap.set(piece, {
      body,
      initialCenter,
      origPoints: pointsStr,
      pos: { x: 0, y: 0 },
      isRemoved: false,
      isDragging: false,
      releaseTime: 0,
      settleCount: 0,
      container: piece,
      lastStepX: 0,
      lastStepY: 0,
      kickback: { x: 0, y: 0, startTime: 0, duration: 45 },
    });
  });


  // 4. Hover Reveal 제어
  let activePiece = null;
  let activePointerId = null;
  let hoveredPiece = null;
  let startOffsetX = 0;
  let startOffsetY = 0;

  const pointerHistory = [];

  function activateHover(piece) {
    const item = pieceDataMap.get(piece);
    if (!piece || !item || item.isRemoved) return;
    hoveredPiece = piece;
    hoverClipPolygon.setAttribute('points', item.origPoints);
    const transform = piece.getAttribute('transform') || '';
    if (transform) {
      hoverClipPolygon.setAttribute('transform', transform);
    } else {
      hoverClipPolygon.removeAttribute('transform');
    }
    sentenceLayer.classList.add('is-visible');
  }

  function deactivateHover() {
    if (activePiece) {
      const activeItem = pieceDataMap.get(activePiece);
      if (activeItem && !activeItem.isRemoved) return;
    }
    hoveredPiece = null;
    sentenceLayer.classList.remove('is-visible');
    hoverClipPolygon.setAttribute('points', '');
    hoverClipPolygon.removeAttribute('transform');
  }

  // 5. 조각 제거(Removed) 상태 처리
  // 5. 조각 제거(Removed) 상태 처리: 원래 자리 검정 문장 노출 + 떼어낸 조각에 실제 투명 Cutout 마스크 적용
  function setPieceRemoved(piece) {
    const item = pieceDataMap.get(piece);
    if (!item || item.isRemoved) return;
    item.isRemoved = true;

    // (A) 원래 자리에 검정 문장 영구 노출용 clip 등록
    const permPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    permPoly.setAttribute('points', item.origPoints);
    permanentClip.appendChild(permPoly);

    // (B) 떼어낸 조각 전용 투명 Cutout Mask 생성 (글자 부분이 0% 투명 구멍으로 뚫림)
    const maskId = `cutout-mask-${piece.id}`;
    let mask = document.getElementById(maskId);
    if (!mask) {
      mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
      mask.setAttribute('id', maskId);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
      mask.setAttribute('x', '-5000');
      mask.setAttribute('y', '-5000');
      mask.setAttribute('width', '10000');
      mask.setAttribute('height', '10000');

      // 1. 조각 다각형 영역을 흰색(#ffffff)으로 채움 -> 조각 본체는 100% 불투명하게 보이게 함
      const maskPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      maskPoly.setAttribute('points', item.origPoints);
      maskPoly.setAttribute('fill', '#ffffff');
      maskPoly.setAttribute('stroke', '#ffffff');
      maskPoly.setAttribute('stroke-width', '1.5');
      maskPoly.setAttribute('stroke-linejoin', 'round');
      mask.appendChild(maskPoly);

      // 2. 문장 텍스트를 검정색(#000000)으로 채움 -> 조각에 텍스트 형태의 실제 투명 구멍 생성
      const maskTextGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      sentenceData.forEach((data) => {
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('class', 'cutout-mask-text');
        textEl.setAttribute('x', data.x);
        textEl.setAttribute('y', data.y);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('fill', '#000000');
        textEl.textContent = data.text;
        maskTextGroup.appendChild(textEl);
      });
      mask.appendChild(maskTextGroup);

      svgDefs.appendChild(mask);
    }

    // 조각에 마스크 연결 (텍스트 모양의 실제 구멍이 뚫림)
    piece.setAttribute('mask', `url(#${maskId})`);
    piece.classList.add('is-removed');

    // 최상단 레이어 5(removedGroup)에 추가
    removedGroup.appendChild(piece);
    item.container = piece;

    piece.setAttribute('transform', `translate(${item.pos.x}, ${item.pos.y})`);

    // 물리 월드에 바디 등록
    World.add(world, item.body);

    deactivateHover();
  }


  // 6. 전역 포인터 드래그 및 던지기 제어
  const BREAK_THRESHOLD = 8.5; // 시작 저항 임계 거리 (px)
  const STEP_SIZE = 5;         // 거친 표면 절삭 느낌의 Step 단위 (px)
  const KICK_DIST = 1.3;       // step 전환 시 반대 방향 미세 반동 크기 (px)
  const KICK_DURATION = 45;    // 반동 지속 시간 (ms)

  function onPointerMove(e) {
    if (!activePiece || e.pointerId !== activePointerId) return;

    const item = pieceDataMap.get(activePiece);
    if (!item) return;

    const currentPt = getFastSVGPoint(e.clientX, e.clientY);
    const now = performance.now();

    pointerHistory.push({ x: currentPt.x, y: currentPt.y, time: now });
    // 최근 80ms 이내의 데이터만 유지하여 손을 놓는 순간의 즉각적인 속도 포착
    while (pointerHistory.length > 2 && now - pointerHistory[0].time > 80) {
      pointerHistory.shift();
    }

    const rawX = currentPt.x - startOffsetX;
    const rawY = currentPt.y - startOffsetY;
    const rawDist = Math.hypot(rawX, rawY);

    // [1. 드래그 시작 저항: 처음 8.5px는 원석에 붙어 팽팽하게 버팀]
    if (!item.isRemoved) {
      if (rawDist < BREAK_THRESHOLD) {
        // 원래 위치에서 아주 조금만 늘어나며 버티는 압력감 (18%만 추종)
        const resistRatio = 0.18;
        item.pos.x = rawX * resistRatio;
        item.pos.y = rawY * resistRatio;

        activePiece.setAttribute('transform', `translate(${item.pos.x}, ${item.pos.y})`);
        hoverClipPolygon.setAttribute('transform', `translate(${item.pos.x}, ${item.pos.y})`);
        return;
      } else {
        // 임계점을 넘으면 원석에서 "툭" 분리
        setPieceRemoved(activePiece);
        item.lastStepX = Math.round(rawX / STEP_SIZE);
        item.lastStepY = Math.round(rawY / STEP_SIZE);
      }
    }

    // [2. 미세한 Step Drag: 5px 단위 quantize]
    const stepX = Math.round(rawX / STEP_SIZE);
    const stepY = Math.round(rawY / STEP_SIZE);
    const snappedX = stepX * STEP_SIZE;
    const snappedY = stepY * STEP_SIZE;

    // [3. 미세한 반동: Step이 바뀌는 순간 이동 반대 방향으로 1.3px 걸림]
    if (stepX !== item.lastStepX || stepY !== item.lastStepY) {
      const diffX = stepX - item.lastStepX;
      const diffY = stepY - item.lastStepY;
      const diffLen = Math.hypot(diffX, diffY) || 1;
      const dirX = diffX / diffLen;
      const dirY = diffY / diffLen;

      // 이동 방향의 정반대 방향으로 짧은 반동
      item.kickback.x = -dirX * KICK_DIST;
      item.kickback.y = -dirY * KICK_DIST;
      item.kickback.startTime = now;
      item.kickback.duration = KICK_DURATION;

      item.lastStepX = stepX;
      item.lastStepY = stepY;
    }

    // 반동 감쇠 계산 (45ms 동안 1 -> 0으로 부드럽게 해소)
    let kickX = 0;
    let kickY = 0;
    if (item.kickback && now - item.kickback.startTime < item.kickback.duration) {
      const progress = (now - item.kickback.startTime) / item.kickback.duration;
      const ease = 1 - progress;
      kickX = item.kickback.x * ease;
      kickY = item.kickback.y * ease;
    }

    item.pos.x = snappedX + kickX;
    item.pos.y = snappedY + kickY;

    // 조각 그룹 위치 갱신
    const targetEl = item.container || activePiece;
    targetEl.setAttribute('transform', `translate(${item.pos.x}, ${item.pos.y})`);
  }

  function onPointerUp(e) {
    if (!activePiece || e.pointerId !== activePointerId) return;

    const piece = activePiece;
    const item = pieceDataMap.get(piece);
    if (!item) return;

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    try {
      piece.releasePointerCapture(e.pointerId);
    } catch (err) {}

    piece.classList.remove('is-dragging');
    if (item.container) item.container.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');

    // 손을 놓는 최종 순간의 좌표 기록 추가
    const finalPt = getFastSVGPoint(e.clientX, e.clientY);
    const now = performance.now();
    pointerHistory.push({ x: finalPt.x, y: finalPt.y, time: now });

    // 던진 속도(vx, vy) 정밀 계산
    let vx = 0;
    let vy = 0;
    if (pointerHistory.length >= 2) {
      const first = pointerHistory[0];
      const last = pointerHistory[pointerHistory.length - 1];
      const dt = Math.max(last.time - first.time, 10);
      vx = ((last.x - first.x) / dt) * 16.67 * 1.35;
      vy = ((last.y - first.y) / dt) * 16.67 * 1.35;
    }

    const pointerSpeed = Math.hypot(vx, vy);
    const MAX_SPEED = 28;
    if (pointerSpeed > MAX_SPEED) {
      const ratio = MAX_SPEED / pointerSpeed;
      vx *= ratio;
      vy *= ratio;
    }

    // 시작 저항 임계값을 넘지 않고 제자리에서 놓은 경우 -> 원위치 복귀
    if (!item.isRemoved) {
      item.pos = { x: 0, y: 0 };
      piece.removeAttribute('transform');
      deactivateHover();
      item.isDragging = false;
      activePiece = null;
      activePointerId = null;
      return;
    }

    // 떼어낸 조각 물리 시뮬레이션 시작 (손을 놓은 이후에는 step snapping/반동 없이 순수 물리 낙하)
    if (item.isRemoved) {
      Body.setPosition(item.body, {
        x: item.initialCenter.x + item.pos.x,
        y: item.initialCenter.y + item.pos.y,
      });
      Body.setAngle(item.body, 0);

      // 정적 상태 해제 및 속도 적용
      Body.setStatic(item.body, false);

      // 사용자가 멈춘 상태에서 놓았더라도 중력 낙하를 확실히 시작하도록 최소 하향 속도 보장
      if (Math.abs(vy) < 0.5) {
        vy = 1.0;
      }

      Body.setVelocity(item.body, { x: vx, y: vy });

      // 자연스러운 회전 각속도 부여
      const angularVel = Math.max(-0.07, Math.min(0.07, vx * 0.004));
      Body.setAngularVelocity(item.body, angularVel);

      item.releaseTime = performance.now();
      item.settleCount = 0;
    }

    item.isDragging = false;
    activePiece = null;
    activePointerId = null;

    const elementUnderPointer = document.elementFromPoint(e.clientX, e.clientY);
    if (elementUnderPointer !== piece) {
      deactivateHover();
    }
  }

  // 조각별 pointerdown 리스너 등록
  pieces.forEach((piece) => {
    const item = pieceDataMap.get(piece);

    piece.addEventListener('pointerenter', () => {
      if (!activePiece && !item.isRemoved) {
        activateHover(piece);
      }
    });

    piece.addEventListener('pointerleave', () => {
      if (!activePiece && hoveredPiece === piece) {
        deactivateHover();
      }
    });

    piece.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      activePiece = piece;
      activePointerId = e.pointerId;
      item.isDragging = true;
      item.settleCount = 0;
      item.lastStepX = 0;
      item.lastStepY = 0;
      item.kickback.startTime = 0;

      updateCTMCache();


      // 드래그 중에는 물리 간섭 차단
      Body.setStatic(item.body, true);

      try {
        piece.setPointerCapture(e.pointerId);
      } catch (err) {}

      if (item.isRemoved) {
        removedGroup.appendChild(item.container);
      } else {
        gemGroup.appendChild(piece);
        activateHover(piece);
      }

      const currentPt = getFastSVGPoint(e.clientX, e.clientY);
      startOffsetX = currentPt.x - item.pos.x;
      startOffsetY = currentPt.y - item.pos.y;

      pointerHistory.length = 0;
      pointerHistory.push({ x: currentPt.x, y: currentPt.y, time: performance.now() });

      piece.classList.add('is-dragging');
      if (item.container) item.container.classList.add('is-dragging');
      document.body.classList.add('is-dragging');

      // window 전역에 move/up을 바인딩하여 커서 탈출 및 버벅거림 방지
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);

      e.preventDefault();
    });
  });

  // 7. 메인 물리 시뮬레이션 루프 (60fps)
  function physicsLoop() {
    Engine.update(engine, 1000 / 60);

    const now = performance.now();

    pieceDataMap.forEach((item) => {
      if (!item.isRemoved || item.isDragging) return;

      const body = item.body;
      const dx = body.position.x - item.initialCenter.x;
      const dy = body.position.y - item.initialCenter.y;
      const deg = body.angle * (180 / Math.PI);

      item.pos.x = dx;
      item.pos.y = dy;

      // 조각 본체와 텍스트 Cutout이 일체형으로 함께 이동 및 회전
      const targetEl = item.container;
      if (targetEl) {
        targetEl.setAttribute(
          'transform',
          `translate(${dx}, ${dy}) rotate(${deg}, ${item.initialCenter.x}, ${item.initialCenter.y})`
        );
      }

      // 안정화(Freeze) 조건:
      // 1. 방출된 지 최소 800ms 경과 (공중 조기 정지 원천 차단)
      // 2. 실제로 화면 바닥 접촉면 근처에 도달
      // 3. 속도가 0에 수렴하는 상태가 30프레임 이상 유지될 때만 정적 고정
      const timeSinceRelease = now - (item.releaseTime || 0);
      const isAtFloor = body.position.y >= (floorTopY - 45);

      if (timeSinceRelease > 800 && isAtFloor && body.speed < 0.12 && body.angularSpeed < 0.01) {
        item.settleCount = (item.settleCount || 0) + 1;
        if (item.settleCount > 30) {
          Body.setStatic(body, true);
        }
      } else {
        item.settleCount = 0;
      }
    });

    requestAnimationFrame(physicsLoop);
  }

  requestAnimationFrame(physicsLoop);
});
