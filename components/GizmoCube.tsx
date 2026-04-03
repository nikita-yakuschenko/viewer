"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  IconArrowBigDown,
  IconArrowBigLeft,
  IconArrowBigRight,
  IconArrowBigUp,
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
/** Кольцо ближе к центру (меньше радиус), линия толще — см. strokeWidth у SVG */
const RING_VIS_R = OUTER / 2 - 16;
const RING_DRAG_R = 100;
const RING_DRAG_STROKE = 22;
const ARROW_INSET = 2;
const CENTER_INSET = 32;
/** Внутренний квадрат под куб: не оставляем крошечный canvas — иначе клиппинг и «лесенка». */
const INNER = OUTER - CENTER_INSET * 2;
const CUBE = Math.round(INNER * 0.96);
/** Подложка под кубом; чуть запас под blur, чтобы не резать мягкий край */
const CUBE_GLOW = Math.round(CUBE * 1.2);

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
    "pointer-events-auto absolute z-[25] flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-zinc-300/80 bg-white text-zinc-800 shadow-sm transition-all hover:border-zinc-400 hover:bg-zinc-50 active:scale-[0.96] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700";

  return (
    <div
      className={cn(
        "pointer-events-auto relative inline-block select-none drop-shadow-md",
        disabled && "pointer-events-none opacity-40",
        className
      )}
      style={{ width: OUTER, height: OUTER }}
      aria-label="Куб видов и орбита"
    >
      <svg
        className="pointer-events-none absolute left-0 top-0 z-0 text-zinc-400 dark:text-zinc-500"
        width={OUTER}
        height={OUTER}
      >
        <circle
          cx={OUTER / 2}
          cy={OUTER / 2}
          r={RING_VIS_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={10.5}
          strokeOpacity={0.42}
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
        <IconArrowBigUp size={18} stroke={1.75} />
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
        <IconArrowBigDown size={18} stroke={1.75} />
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
        <IconArrowBigLeft size={18} stroke={1.75} />
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
        <IconArrowBigRight size={18} stroke={1.75} />
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
        {/* Мягкое свечение: градиент → transparent + blur снимает видимый «ободок» круга */}
        <div
          aria-hidden
          style={{ width: CUBE_GLOW, height: CUBE_GLOW }}
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[7px]",
            "bg-[radial-gradient(circle_at_50%_44%,rgba(255,255,255,0.42)_0%,rgba(244,244,245,0.14)_28%,rgba(228,228,231,0.04)_46%,transparent_62%)]",
            "dark:bg-[radial-gradient(circle_at_50%_44%,rgba(63,63,70,0.42)_0%,rgba(39,39,42,0.14)_30%,rgba(24,24,27,0.05)_48%,transparent_62%)]"
          )}
        />
        <div
          ref={canvasHostRef}
          className="relative z-10 overflow-visible"
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
