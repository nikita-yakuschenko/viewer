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
 * ViewCube: 6 центров граней + 12 рёбер + 8 углов. Оси: +Y вверх, +Z спереди, +X вправо (как BIMViewer).
 */
const LABELS: Record<ViewCubeDirection, string> = {
  top: "Верх",
  bottom: "Низ",
  front: "Спереди",
  back: "Сзади",
  left: "Слева",
  right: "Справа",
};

const CORNER_LABELS: Record<string, string> = {
  "1,1,1": "Сверху спереди справа",
  "-1,1,1": "Сверху слева спереди",
  "-1,1,-1": "Сверху сзади слева",
  "1,1,-1": "Сверху справа сзади",
  "1,-1,1": "Спереди справа снизу",
  "-1,-1,1": "Спереди слева снизу",
  "1,-1,-1": "Справа снизу сзади",
  "-1,-1,-1": "Слева снизу сзади",
};

function cornerTitle(sx: number, sy: number, sz: number): string {
  return CORNER_LABELS[`${sx},${sy},${sz}`] ?? `Угол ${sx},${sy},${sz}`;
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
/** Угол гизмо: стык трёх граней (как маленький куб на схеме). */
const MC = 20;
const MH = MC / 2;
/** Толщина полосы ребра (визуально сливается с гранями — тот же цвет). */
const EDGE_STRIP_H = 10;
/** Полная длина вдоль ребра куба — без «окна» между углом и гранью. */
const EDGE_STRIP_LEN = CUBE;
/** Вынос ребра к зрителю, чтобы кликабельность на стыке была стабильной. */
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

/**
 * Поворот гизмо = обратная ориентация камеры в мире (как в CAD): учитывается весь кватернион, не только луч к цели.
 * Иначе с «диагонального» вида куб ведёт себя неестественно, а ось Y + смесь с CSS давали перевёрнутые Верх/Низ и стороны.
 * После этого в tick по-прежнему applyCss3dViewMatrixConvention (стык WebGL Y-up и CSS).
 */
function viewHudRotationMatrix(camera: THREE.Camera, orbitTarget: THREE.Vector3 | null): THREE.Matrix4 {
  camera.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  if (orbitTarget) {
    const eye = new THREE.Vector3();
    camera.getWorldPosition(eye);
    if (eye.clone().sub(orbitTarget).lengthSq() > 1e-20) {
      const q = new THREE.Quaternion();
      camera.getWorldQuaternion(q);
      m.makeRotationFromQuaternion(q.clone().invert());
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

const EDGE_DEFS = [
  { id: "top-front" as const, title: "Сверху спереди", mid: [0, 1, 1] as const, along: [1, 0, 0] as const, out: [0, 1, 1] as const },
  { id: "top-back" as const, title: "Сверху сзади", mid: [0, 1, -1] as const, along: [1, 0, 0] as const, out: [0, 1, -1] as const },
  { id: "top-left" as const, title: "Сверху слева", mid: [-1, 1, 0] as const, along: [0, 0, 1] as const, out: [-1, 1, 0] as const },
  { id: "top-right" as const, title: "Сверху справа", mid: [1, 1, 0] as const, along: [0, 0, 1] as const, out: [1, 1, 0] as const },
  { id: "bottom-front" as const, title: "Спереди снизу", mid: [0, -1, 1] as const, along: [1, 0, 0] as const, out: [0, -1, 1] as const },
  { id: "bottom-back" as const, title: "Снизу сзади", mid: [0, -1, -1] as const, along: [1, 0, 0] as const, out: [0, -1, -1] as const },
  { id: "bottom-left" as const, title: "Слева снизу", mid: [-1, -1, 0] as const, along: [0, 0, 1] as const, out: [-1, -1, 0] as const },
  { id: "bottom-right" as const, title: "Справа снизу", mid: [1, -1, 0] as const, along: [0, 0, 1] as const, out: [1, -1, 0] as const },
  { id: "front-left" as const, title: "Спереди слева", mid: [-1, 0, 1] as const, along: [0, 1, 0] as const, out: [-1, 0, 1] as const },
  { id: "front-right" as const, title: "Спереди справа", mid: [1, 0, 1] as const, along: [0, 1, 0] as const, out: [1, 0, 1] as const },
  { id: "back-left" as const, title: "Сзади слева", mid: [-1, 0, -1] as const, along: [0, 1, 0] as const, out: [-1, 0, -1] as const },
  { id: "back-right" as const, title: "Справа сзади", mid: [1, 0, -1] as const, along: [0, 1, 0] as const, out: [1, 0, -1] as const },
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
  className,
}: {
  face: ViewCubeDirection;
  children: React.ReactNode;
  setLabelEl: (face: ViewCubeDirection, el: HTMLSpanElement | null) => void;
  /** По умолчанию подпись скрыта — см. group-hover на кнопке грани. */
  className?: string;
}) {
  return (
    <span
      ref={(el) => setLabelEl(face, el)}
      className={cn(
        "inline-flex h-full w-full items-center justify-center [transform-style:preserve-3d] [backface-visibility:hidden] [-webkit-backface-visibility:hidden]",
        className
      )}
      style={{ transformOrigin: "center center" }}
    >
      {children}
    </span>
  );
}

/** Мини-куб угла — те же цвета, что у большого куба (без прозрачных дыр). */
const miniFaceBase =
  "absolute left-0 top-0 rounded-[2px] border-0 bg-slate-200 [backface-visibility:hidden] transition-colors duration-150 group-hover:bg-slate-300";

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

  /** Текст грани только при наведении / фокусе — иначе виден один сплошной куб. */
  const labelRevealOnHover =
    "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100";
  /** Шесть одинаковых граней — без внутренних «рамок» и прозрачных зазоров. */
  const cubeFaceBase =
    "group pointer-events-auto absolute left-0 top-0 flex cursor-pointer select-none items-center justify-center rounded-sm border border-slate-400 bg-slate-200 text-[8px] font-bold leading-tight text-slate-800 [backface-visibility:hidden] [-webkit-backface-visibility:hidden] transition-colors duration-150 hover:border-slate-500 hover:bg-slate-300 active:scale-[0.99]";
  /** Рёбра того же цвета, что грани — визуально единое тело. */
  const cubeEdgeBase =
    "group pointer-events-auto absolute border-0 bg-slate-200 [backface-visibility:hidden] [-webkit-backface-visibility:hidden] transition-colors duration-150 hover:bg-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

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
            {/* Слой 1 — шесть полных граней, одна заливка; подпись только при hover/focus */}
            <button
              type="button"
              title={`Вид: ${LABELS.front}`}
              aria-label={`Вид: ${LABELS.front}`}
              className={cubeFaceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(0deg) translateZ(${H}px)`,
                transformStyle: "preserve-3d",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("front");
              }}
            >
              <FaceLabel face="front" setLabelEl={setLabelEl} className={labelRevealOnHover}>
                {LABELS.front}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={`Вид: ${LABELS.back}`}
              aria-label={`Вид: ${LABELS.back}`}
              className={cubeFaceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(180deg) translateZ(${H}px)`,
                transformStyle: "preserve-3d",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("back");
              }}
            >
              <FaceLabel face="back" setLabelEl={setLabelEl} className={labelRevealOnHover}>
                {LABELS.back}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={`Вид: ${LABELS.right}`}
              aria-label={`Вид: ${LABELS.right}`}
              className={cubeFaceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(90deg) translateZ(${H}px)`,
                transformStyle: "preserve-3d",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("right");
              }}
            >
              <FaceLabel face="right" setLabelEl={setLabelEl} className={labelRevealOnHover}>
                {LABELS.right}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={`Вид: ${LABELS.left}`}
              aria-label={`Вид: ${LABELS.left}`}
              className={cubeFaceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateY(-90deg) translateZ(${H}px)`,
                transformStyle: "preserve-3d",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("left");
              }}
            >
              <FaceLabel face="left" setLabelEl={setLabelEl} className={labelRevealOnHover}>
                {LABELS.left}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={`Вид: ${LABELS.top}`}
              aria-label={`Вид: ${LABELS.top}`}
              className={cubeFaceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateX(90deg) translateZ(${H}px)`,
                transformStyle: "preserve-3d",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("top");
              }}
            >
              <FaceLabel face="top" setLabelEl={setLabelEl} className={labelRevealOnHover}>
                {LABELS.top}
              </FaceLabel>
            </button>
            <button
              type="button"
              title={`Вид: ${LABELS.bottom}`}
              aria-label={`Вид: ${LABELS.bottom}`}
              className={cubeFaceBase}
              style={{
                width: CUBE,
                height: CUBE,
                transform: `rotateX(-90deg) translateZ(${H}px)`,
                transformStyle: "preserve-3d",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFaceClick("bottom");
              }}
            >
              <FaceLabel face="bottom" setLabelEl={setLabelEl} className={labelRevealOnHover}>
                {LABELS.bottom}
              </FaceLabel>
            </button>

            {/* Слой 2 — рёбра той же заливки, поверх стыков; без отдельных «пустых» зон */}
            {EDGE_DEFS.map((d) => (
              <button
                key={d.id}
                type="button"
                title={`Вид: ${d.title}`}
                aria-label={`Вид: ${d.title}`}
                className={cn(cubeEdgeBase, "[transform-style:preserve-3d]")}
                style={{
                  left: "50%",
                  top: "50%",
                  width: EDGE_STRIP_LEN,
                  height: EDGE_STRIP_H,
                  marginLeft: -EDGE_STRIP_LEN / 2,
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

            {/* Слой 3 — 8 углов (мини-куб на вершине) */}
            {CORNERS.map(([sx, sy, sz]) => (
              <VertexMiniCube
                key={`${sx},${sy},${sz}`}
                sx={sx}
                sy={sy}
                sz={sz}
                halfSize={H}
                title={`Вид: ${cornerTitle(sx, sy, sz)}`}
                onPick={() => onCornerClick([sx, sy, sz])}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
