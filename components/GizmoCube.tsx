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
import { GizmoCubeRenderer } from "./gizmo/GizmoCubeRenderer";
import { pickGizmo } from "./gizmo/GizmoCubeInteraction";
import { semanticToViewDir } from "./gizmo/GizmoCubeTypes";
import type {
  ViewCubeCorner,
  ViewCubeDirection,
  ViewCubeEdge,
  ViewCubeStep,
} from "./gizmo/GizmoCubeTypes";
import type { GizmoSemanticFace } from "./gizmo/GizmoCubeTypes";
import { getEdgeViewDirectionUnit } from "./gizmo/GizmoCubePresets";

export type { ViewCubeCorner, ViewCubeDirection, ViewCubeEdge, ViewCubeStep };
export { getEdgeViewDirectionUnit };

const OUTER = 232;
const RING_VIS_R = OUTER / 2 - 10;
const RING_DRAG_R = 108;
const RING_DRAG_STROKE = 18;
const ARROW_INSET = 4;
const CENTER_INSET = 38;
/** Внутренний квадрат под куб: не оставляем крошечный canvas — иначе клиппинг и «лесенка». */
const INNER = OUTER - CENTER_INSET * 2;
const CUBE = Math.round(INNER * 0.92);

interface GizmoCubeProps {
  className?: string;
  disabled?: boolean;
  getCamera: () => THREE.Camera | null | undefined;
  getOrbitTarget?: () => THREE.Vector3 | null | undefined;
  onFaceClick: (dir: ViewCubeDirection) => void;
  onEdgeClick: (edge: ViewCubeEdge) => void;
  onCornerClick: (corner: ViewCubeCorner) => void;
  onViewStep: (step: ViewCubeStep) => void;
  onOrbitDrag: (deltaX: number, deltaY: number) => void;
}

/**
 * Ориентационный куб: real WebGL (three.js), семантика WYS — видимая грань = текущий вид сцены.
 * Overlay-контейнер — только CSS; сам куб не CSS 3D.
 */
export function GizmoCube({
  className,
  disabled,
  getCamera,
  getOrbitTarget,
  onFaceClick,
  onEdgeClick,
  onCornerClick,
  onViewStep,
  onOrbitDrag,
}: GizmoCubeProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GizmoCubeRenderer | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0 });

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const r = new GizmoCubeRenderer();
    rendererRef.current = r;
    host.appendChild(r.domElement);
    r.setSize(CUBE, CUBE);
    r.startLoop(() => getCamera() ?? null);

    return () => {
      r.dispose();
      rendererRef.current = null;
      if (r.domElement.parentElement === host) host.removeChild(r.domElement);
    };
  }, [getCamera]);

  const onCubePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ren = rendererRef.current;
      if (!ren || disabled) return;
      const hit = pickGizmo(ren, e.clientX, e.clientY);
      ren.setHover(hit);
    },
    [disabled]
  );

  const onCubePointerLeave = useCallback(() => {
    rendererRef.current?.setHover(null);
  }, []);

  const onCubeClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const ren = rendererRef.current;
      if (!ren) return;
      const hit = pickGizmo(ren, e.clientX, e.clientY);
      ren.setHover(null);
      if (!hit) return;
      if (hit.kind === "face") onFaceClick(semanticToViewDir(hit.face));
      else if (hit.kind === "edge") onEdgeClick(hit.edge);
      else onCornerClick(hit.corner);
    },
    [disabled, onFaceClick, onEdgeClick, onCornerClick]
  );

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

      <svg
        className="absolute left-0 top-0 z-12 cursor-grab text-transparent active:cursor-grabbing"
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

      <div
        className="pointer-events-auto absolute z-18 flex items-center justify-center"
        style={{
          left: CENTER_INSET,
          top: CENTER_INSET,
          width: OUTER - CENTER_INSET * 2,
          height: OUTER - CENTER_INSET * 2,
        }}
      >
        <div
          ref={canvasHostRef}
          className="relative overflow-visible rounded-xl shadow-inner shadow-slate-200/80 ring-1 ring-slate-200/90"
          style={{ width: CUBE, height: CUBE }}
          onPointerMove={onCubePointerMove}
          onPointerLeave={onCubePointerLeave}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onCubeClick}
        />
      </div>
    </div>
  );
}
