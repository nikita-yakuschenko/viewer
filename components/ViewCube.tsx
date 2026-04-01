"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type ViewCubeDirection = "top" | "bottom" | "front" | "back" | "left" | "right";

/** Ребро куба (два смежных направления) — как «Top Front View» на стандартной схеме ViewCube. */
export type ViewCubeEdge =
  | "top-front"
  | "top-back"
  | "top-left"
  | "top-right"
  | "bottom-front"
  | "bottom-back"
  | "bottom-left"
  | "bottom-right"
  | "front-left"
  | "front-right"
  | "back-left"
  | "back-right";

export type ViewCubeCorner = readonly [sign: 1 | -1, sign: 1 | -1, sign: 1 | -1];

export type ViewCubeStep = "left" | "right" | "up" | "down";

/**
 * Соответствие классической схеме ViewCube (AutoCAD/Revit):
 * — 6 граней (центр): ортогональные виды.
 * — 12 рёбер: биссектриса двух граней (промежуточный ракурс).
 * — 8 углов: изометрия по октанту.
 * Оси в мире сцены: +Y вверх, +Z спереди, +X вправо (как в BIMViewer / handleViewCubeFace).
 */
const LABELS: Record<ViewCubeDirection, string> = {
  top: "Сверху",
  bottom: "Снизу",
  front: "Спереди",
  back: "Сзади",
  left: "Слева",
  right: "Справа",
};

/** Угол в стиле схемы «Top Left Front» → «Сверху слева спереди». */
function cornerTitle(sx: number, sy: number, sz: number): string {
  const ay = sy > 0 ? "Сверху" : "Снизу";
  const ax = sx > 0 ? "справа" : "слева";
  const az = sz > 0 ? "спереди" : "сзади";
  return `${ay} ${ax} ${az}`;
}

const OUTER = 232;
const RING_VIS_R = OUTER / 2 - 10;
/** Внутренний край зоны перетаскивания — дальше от центра, чем половина диагонали куба (~76px) */
const RING_DRAG_R = 108;
const RING_DRAG_STROKE = 18;
const ARROW_INSET = 4;
const CENTER_INSET = 38;
const CUBE = 108;
const H = CUBE / 2;
/** Мини-куб на вершине: полноценный 6-гранник */
const MC = 16;
const MH = MC / 2;
/** Высота полосы ребра (px), клик по «скосу» между гранями. */
const EDGE_STRIP_H = 12;
/** Слегка выносим ребро вдоль биссектрисы, чтобы зона не терялась под гранями в preserve-3d. */
const EDGE_OUTWARD_BUMP = 2.5;

function matrix3dFromThree(m: THREE.Matrix4): string {
  const e = m.elements;
  return `matrix3d(${e[0]},${e[1]},${e[2]},${e[3]},${e[4]},${e[5]},${e[6]},${e[7]},${e[8]},${e[9]},${e[10]},${e[11]},${e[12]},${e[13]},${e[14]},${e[15]})`;
}

/**
 * Как в Three.js CSS3DRenderer.getCameraCSSMatrix: вторая колонка идёт в CSS с противоположным знаком,
 * иначе ось Y экрана расходится с WebGL — гизмо «смотрит не той гранью» относительно сцены.
 */
function applyCss3dViewMatrixConvention(m: THREE.Matrix4): void {
  const e = m.elements;
  e[1] = -e[1];
  e[5] = -e[5];
  e[9] = -e[9];
  e[13] = -e[13];
}

/** Направление «на зрителя» в системе куба при нулевом повороте: грань «Спереди» (+Z мира) смотрит в +Z родителя (к экрану). */
const HUD_TOWARD_VIEWER = new THREE.Vector3(0, 0, 1);

/**
 * Поворот HUD-куба: на фронтальной грани — подпись той стороны модели, которую вы видите.
 * toCam = normalize(eye − target) в мире Three (Y вверх) — нормаль видимой стороны.
 * Грани куба заданы CSS rotateX/Y (ось Y экрана вниз): без стыковки осей «верх» DOM даёт −Y в том же базисе, что toCam.
 * Поэтому для кватерниона используем dirHud = (toCam.x, -toCam.y, toCam.z), иначе верх/низ меняются местами.
 * R * dirHud = (0,0,1) — эта грань смотрит на зрителя (+Z в perspective).
 */
function viewHudRotationMatrix(camera: THREE.Camera, orbitTarget: THREE.Vector3 | null): THREE.Matrix4 {
  camera.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  camera.getWorldPosition(eye);

  if (orbitTarget) {
    const toCam = eye.clone().sub(orbitTarget);
    const lenSq = toCam.lengthSq();
    if (lenSq > 1e-20) {
      toCam.multiplyScalar(1 / Math.sqrt(lenSq));
      const dirHud = new THREE.Vector3(toCam.x, -toCam.y, toCam.z).normalize();
      const d = dirHud.dot(HUD_TOWARD_VIEWER);
      if (d > 1 - 1e-10) {
        m.identity();
      } else if (d < -1 + 1e-10) {
        m.makeRotationY(Math.PI);
      } else {
        const q = new THREE.Quaternion().setFromUnitVectors(dirHud, HUD_TOWARD_VIEWER);
        m.makeRotationFromQuaternion(q);
      }
      return m;
    }
  }

  m.extractRotation(camera.matrixWorldInverse);
  return m;
}

const CORNERS: ViewCubeCorner[] = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
];

/** Только поворот грани (как у CSS rotateY/rotateX до translateZ), без переноса — для inv(qCube·qFace) на подписи. */
const FACE_ROT_QUAT: Record<ViewCubeDirection, THREE.Quaternion> = {
  front: new THREE.Quaternion(0, 0, 0, 1),
  back: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  right: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  left: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  top: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  bottom: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
};

const FACE_DIRS_LIST: ViewCubeDirection[] = ["front", "back", "right", "left", "top", "bottom"];

/** Данные рёбер: середина в единицах H, вектор вдоль ребра, сумма нормалей двух граней (биссектриса вида). */
const EDGE_DEFS = [
  { id: "top-front" as const, title: "Сверху спереди", mid: [0, 1, 1] as const, along: [1, 0, 0] as const, out: [0, 1, 1] as const },
  { id: "top-back" as const, title: "Сверху сзади", mid: [0, 1, -1] as const, along: [1, 0, 0] as const, out: [0, 1, -1] as const },
  { id: "top-left" as const, title: "Сверху слева", mid: [-1, 1, 0] as const, along: [0, 0, 1] as const, out: [-1, 1, 0] as const },
  { id: "top-right" as const, title: "Сверху справа", mid: [1, 1, 0] as const, along: [0, 0, 1] as const, out: [1, 1, 0] as const },
  { id: "bottom-front" as const, title: "Снизу спереди", mid: [0, -1, 1] as const, along: [1, 0, 0] as const, out: [0, -1, 1] as const },
  { id: "bottom-back" as const, title: "Снизу сзади", mid: [0, -1, -1] as const, along: [1, 0, 0] as const, out: [0, -1, -1] as const },
  { id: "bottom-left" as const, title: "Снизу слева", mid: [-1, -1, 0] as const, along: [0, 0, 1] as const, out: [-1, -1, 0] as const },
  { id: "bottom-right" as const, title: "Снизу справа", mid: [1, -1, 0] as const, along: [0, 0, 1] as const, out: [1, -1, 0] as const },
  { id: "front-left" as const, title: "Спереди слева", mid: [-1, 0, 1] as const, along: [0, 1, 0] as const, out: [-1, 0, 1] as const },
  { id: "front-right" as const, title: "Спереди справа", mid: [1, 0, 1] as const, along: [0, 1, 0] as const, out: [1, 0, 1] as const },
  { id: "back-left" as const, title: "Сзади слева", mid: [-1, 0, -1] as const, along: [0, 1, 0] as const, out: [-1, 0, -1] as const },
  { id: "back-right" as const, title: "Сзади справа", mid: [1, 0, -1] as const, along: [0, 1, 0] as const, out: [1, 0, -1] as const },
] as const;

function makeEdgeStripMatrix(
  mid: readonly [number, number, number],
  along: readonly [number, number, number],
  out: readonly [number, number, number],
): THREE.Matrix4 {
  const pos = new THREE.Vector3(mid[0] * H, mid[1] * H, mid[2] * H);
  const u = new THREE.Vector3(along[0], along[1], along[2]).normalize();
  const o = new THREE.Vector3(out[0], out[1], out[2]).normalize();
  const v = new THREE.Vector3().crossVectors(o, u).normalize();
  const mat = new THREE.Matrix4();
  mat.makeBasis(u, v, o);
  pos.add(o.clone().multiplyScalar(EDGE_OUTWARD_BUMP));
  mat.setPosition(pos);
  return mat;
}

const EDGE_TRANSFORM_CSS: Record<ViewCubeEdge, string> = (() => {
  const acc = {} as Record<ViewCubeEdge, string>;
  for (const d of EDGE_DEFS) {
    acc[d.id] = matrix3dFromThree(makeEdgeStripMatrix(d.mid, d.along, d.out));
  }
  return acc;
})();

/** Единичный вектор направления камеры от цели (мир Three: +Y вверх, +Z спереди) для вида с ребра. */
export function getEdgeViewDirectionUnit(edge: ViewCubeEdge): THREE.Vector3 {
  for (const d of EDGE_DEFS) {
    if (d.id === edge) return new THREE.Vector3(d.out[0], d.out[1], d.out[2]).normalize();
  }
  return new THREE.Vector3(0, 0, 1);
}

function FaceLabel({
  face,
  children,
  setLabelEl,
}: {
  face: ViewCubeDirection;
  children: React.ReactNode;
  setLabelEl: (face: ViewCubeDirection, el: HTMLSpanElement | null) => void;
}) {
  return (
    <span
      ref={(el) => setLabelEl(face, el)}
      className="inline-flex h-full w-full items-center justify-center [transform-style:preserve-3d]"
      style={{ transformOrigin: "center center" }}
    >
      {children}
    </span>
  );
}

/** Грани мини-куба: без filter на кнопке — иначе браузер сглаживает preserve-3d. Подсветка — group-hover на гранях. */
const miniFaceBase =
  "absolute left-0 top-0 rounded-[2px] border border-slate-400/95 bg-gradient-to-br from-slate-50 to-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] [backface-visibility:hidden] transition-[background-color,border-color,box-shadow] duration-150 group-hover:border-sky-400 group-hover:from-sky-100 group-hover:to-sky-200/95 group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98)]";

/** Мини-куб на вершине большого куба — 6 граней, виден с любого ракурса */
function VertexMiniCube({
  sx,
  sy,
  sz,
  halfSize,
  title,
  onPick,
}: {
  sx: number;
  sy: number;
  sz: number;
  halfSize: number;
  title: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="group pointer-events-auto absolute cursor-pointer border-0 bg-transparent p-0 outline-none [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-sky-400/80 focus-visible:ring-offset-1"
      style={{
        left: "50%",
        top: "50%",
        width: MC,
        height: MC,
        marginLeft: -MH,
        marginTop: -MH,
        transform: `translate3d(${sx * halfSize}px, ${sy * halfSize}px, ${sz * halfSize}px)`,
        transformStyle: "preserve-3d",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      <div className="relative" style={{ width: MC, height: MC, transformStyle: "preserve-3d" }}>
        <span className={miniFaceBase} style={{ width: MC, height: MC, transform: `rotateY(0deg) translateZ(${MH}px)` }} aria-hidden />
        <span className={miniFaceBase} style={{ width: MC, height: MC, transform: `rotateY(180deg) translateZ(${MH}px)` }} aria-hidden />
        <span className={miniFaceBase} style={{ width: MC, height: MC, transform: `rotateY(90deg) translateZ(${MH}px)` }} aria-hidden />
        <span className={miniFaceBase} style={{ width: MC, height: MC, transform: `rotateY(-90deg) translateZ(${MH}px)` }} aria-hidden />
        <span className={miniFaceBase} style={{ width: MC, height: MC, transform: `rotateX(90deg) translateZ(${MH}px)` }} aria-hidden />
        <span className={miniFaceBase} style={{ width: MC, height: MC, transform: `rotateX(-90deg) translateZ(${MH}px)` }} aria-hidden />
      </div>
    </button>
  );
}

interface ViewCubeProps {
  className?: string;
  disabled?: boolean;
  getCamera: () => THREE.Camera | null | undefined;
  /** Цель орбиты (мир): без неё остаётся fallback по matrixWorldInverse. */
  getOrbitTarget?: () => THREE.Vector3 | null | undefined;
  onFaceClick: (dir: ViewCubeDirection) => void;
  onEdgeClick: (edge: ViewCubeEdge) => void;
  onCornerClick: (corner: ViewCubeCorner) => void;
  onViewStep: (step: ViewCubeStep) => void;
  onOrbitDrag: (deltaX: number, deltaY: number) => void;
}

/**
 * Ориентационный куб (BIM/CAD): грани подписаны сторонами модели в мире (+Y вверх, +Z спереди).
 * Вращение: вектор eye−target (какая сторона мира смотрит на вас) выводится на грань к зрителю.
 * Клики: грани / рёбра / углы → onFaceClick / onEdgeClick / onCornerClick.
 */
export function ViewCube({
  className,
  disabled,
  getCamera,
  getOrbitTarget,
  onFaceClick,
  onEdgeClick,
  onCornerClick,
  onViewStep,
  onOrbitDrag,
}: ViewCubeProps) {
  const cubeRotRef = useRef<HTMLDivElement>(null);
  const labelElsRef = useRef<Partial<Record<ViewCubeDirection, HTMLSpanElement | null>>>({});
  const dragRef = useRef({ active: false, x: 0, y: 0 });

  const setLabelEl = useCallback((face: ViewCubeDirection, el: HTMLSpanElement | null) => {
    labelElsRef.current[face] = el;
  }, []);

  useEffect(() => {
    let raf = 0;
    const mat = new THREE.Matrix4();
    const matDisp = new THREE.Matrix4();
    const mLabel = new THREE.Matrix4();
    const qCube = new THREE.Quaternion();
    const qTotal = new THREE.Quaternion();
    const qInv = new THREE.Quaternion();
    const vPos = new THREE.Vector3();
    const vScale = new THREE.Vector3();

    const tick = () => {
      const cam = getCamera();
      const el = cubeRotRef.current;
      if (cam && el) {
        const target = getOrbitTarget?.() ?? null;
        mat.copy(viewHudRotationMatrix(cam, target));
        applyCss3dViewMatrixConvention(mat);
        mat.decompose(vPos, qCube, vScale);

        matDisp.copy(mat);
        const s = 0.92;
        const e = matDisp.elements;
        e[0] *= s;
        e[1] *= s;
        e[2] *= s;
        e[4] *= s;
        e[5] *= s;
        e[6] *= s;
        e[8] *= s;
        e[9] *= s;
        e[10] *= s;
        el.style.transform = matrix3dFromThree(matDisp);

        // Подписи: обратный поворот к (qCube·qFace), чтобы текст оставался читаемым, не «клеясь» к вращению грани.
        for (const dir of FACE_DIRS_LIST) {
          const span = labelElsRef.current[dir];
          if (!span) continue;
          qTotal.copy(qCube).multiply(FACE_ROT_QUAT[dir]);
          qInv.copy(qTotal).invert();
          mLabel.makeRotationFromQuaternion(qInv);
          span.style.transform = matrix3dFromThree(mLabel);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getCamera, getOrbitTarget]);

  const onRingPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { active: true, x: e.clientX, y: e.clientY };
    },
    [disabled]
  );

  const onRingPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current.active || disabled) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
      onOrbitDrag(dx, dy);
    },
    [disabled, onOrbitDrag]
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (dragRef.current.active) {
      dragRef.current.active = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const faceBase =
    "pointer-events-auto absolute left-0 top-0 flex cursor-pointer select-none items-center justify-center rounded-sm border border-slate-300/90 bg-gradient-to-br from-white to-slate-100 text-[9px] font-bold uppercase leading-tight text-slate-600 shadow-sm [backface-visibility:hidden] transition-[border-color,box-shadow,background-color] hover:border-sky-400 hover:bg-sky-50/90 hover:text-slate-800 hover:shadow-md active:scale-[0.97]";

  const stepBtn =
    "pointer-events-auto absolute z-[25] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 active:scale-95";

  return (
    <div
      className={cn(
        "pointer-events-auto select-none rounded-full border border-slate-200/95 bg-white/95 p-2 shadow-lg shadow-slate-200/60 backdrop-blur-sm",
        disabled && "pointer-events-none opacity-40",
        className
      )}
      style={{ width: OUTER, height: OUTER }}
      aria-label="Куб видов и орбита"
    >
      {/* Декоративное кольцо */}
      <svg
        className="pointer-events-none absolute left-0 top-0 z-0 text-slate-300"
        width={OUTER}
        height={OUTER}
      >
        <circle
          cx={OUTER / 2}
          cy={OUTER / 2}
          r={RING_VIS_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={10}
          strokeOpacity={0.35}
        />
      </svg>

      {/* Перетаскивание по кольцу — только внешняя полоса, не перекрывает куб */}
      <svg
        className="absolute left-0 top-0 z-[12] cursor-grab text-transparent active:cursor-grabbing"
        width={OUTER}
        height={OUTER}
        style={{ touchAction: "none" }}
      >
        <circle
          cx={OUTER / 2}
          cy={OUTER / 2}
          r={RING_DRAG_R}
          fill="none"
          stroke="rgba(0,0,0,0.001)"
          strokeWidth={RING_DRAG_STROKE}
          onPointerDown={onRingPointerDown}
          onPointerMove={onRingPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </svg>

      {/* Шаг вида относительно текущего ракурса */}
      <button
        type="button"
        className={cn(stepBtn, "left-1/2 top-1 -translate-x-1/2")}
        style={{ marginTop: ARROW_INSET }}
        title="Повернуть вид вверх (относительно экрана)"
        aria-label="Вид вверх"
        onClick={(e) => {
          e.stopPropagation();
          onViewStep("up");
        }}
      >
        <IconChevronUp size={22} stroke={2} />
      </button>
      <button
        type="button"
        className={cn(stepBtn, "bottom-1 left-1/2 -translate-x-1/2")}
        style={{ marginBottom: ARROW_INSET }}
        title="Повернуть вид вниз"
        aria-label="Вид вниз"
        onClick={(e) => {
          e.stopPropagation();
          onViewStep("down");
        }}
      >
        <IconChevronDown size={22} stroke={2} />
      </button>
      <button
        type="button"
        className={cn(stepBtn, "left-1 top-1/2 -translate-y-1/2")}
        style={{ marginLeft: ARROW_INSET }}
        title="Повернуть вид влево"
        aria-label="Вид влево"
        onClick={(e) => {
          e.stopPropagation();
          onViewStep("left");
        }}
      >
        <IconChevronLeft size={22} stroke={2} />
      </button>
      <button
        type="button"
        className={cn(stepBtn, "right-1 top-1/2 -translate-y-1/2")}
        style={{ marginRight: ARROW_INSET }}
        title="Повернуть вид вправо"
        aria-label="Вид вправо"
        onClick={(e) => {
          e.stopPropagation();
          onViewStep("right");
        }}
      >
        <IconChevronRight size={22} stroke={2} />
      </button>

      {/* Центр: куб мира + углы */}
      <div
        className="pointer-events-none absolute z-[18] flex items-center justify-center"
        style={{
          left: CENTER_INSET,
          top: CENTER_INSET,
          width: OUTER - CENTER_INSET * 2,
          height: OUTER - CENTER_INSET * 2,
          perspective: 520,
        }}
      >
        <div
          className="relative"
          style={{
            width: CUBE,
            height: CUBE,
            transformStyle: "preserve-3d",
          }}
        >
          <div
            ref={cubeRotRef}
            className="relative h-full w-full"
            style={{
              transformStyle: "preserve-3d",
              transformOrigin: "center center",
            }}
          >
            {/* +Z «спереди» */}
            <button
              type="button"
              title={LABELS.front}
              className={faceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(0deg) translateZ(${H}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("front");
              }}
            >
              <FaceLabel face="front" setLabelEl={setLabelEl}>
                {LABELS.front}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={LABELS.back}
              className={faceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(180deg) translateZ(${H}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("back");
              }}
            >
              <FaceLabel face="back" setLabelEl={setLabelEl}>
                {LABELS.back}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={LABELS.right}
              className={faceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(90deg) translateZ(${H}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("right");
              }}
            >
              <FaceLabel face="right" setLabelEl={setLabelEl}>
                {LABELS.right}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={LABELS.left}
              className={faceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(-90deg) translateZ(${H}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("left");
              }}
            >
              <FaceLabel face="left" setLabelEl={setLabelEl}>
                {LABELS.left}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={LABELS.top}
              className={faceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateX(90deg) translateZ(${H}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("top");
              }}
            >
              <FaceLabel face="top" setLabelEl={setLabelEl}>
                {LABELS.top}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={LABELS.bottom}
              className={faceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateX(-90deg) translateZ(${H}px)`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("bottom");
              }}
            >
              <FaceLabel face="bottom" setLabelEl={setLabelEl}>
                {LABELS.bottom}
              </FaceLabel>
            </button>

            {/* 12 рёбер — как на схеме ViewCube (Top Front, Front Left, …) */}
            {EDGE_DEFS.map((d) => (
              <button
                key={d.id}
                type="button"
                title={d.title}
                aria-label={d.title}
                className="pointer-events-auto absolute cursor-pointer border-0 bg-transparent p-0 outline-none transition-[background-color] hover:bg-sky-400/20 [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-sky-400/80 focus-visible:ring-offset-1"
                style={{
                  left: "50%",
                  top: "50%",
                  width: CUBE,
                  height: EDGE_STRIP_H,
                  marginLeft: -CUBE / 2,
                  marginTop: -EDGE_STRIP_H / 2,
                  transform: EDGE_TRANSFORM_CSS[d.id],
                  transformStyle: "preserve-3d",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdgeClick(d.id);
                }}
              />
            ))}

            {/* Вершины — объёмные мини-кубы (6 граней) */}
            {CORNERS.map(([sx, sy, sz]) => (
              <VertexMiniCube
                key={`${sx},${sy},${sz}`}
                sx={sx}
                sy={sy}
                sz={sz}
                halfSize={H}
                title={cornerTitle(sx, sy, sz)}
                onPick={() => onCornerClick([sx, sy, sz])}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
