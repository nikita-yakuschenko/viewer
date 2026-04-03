import * as OBCF from "@thatopen/components-front";
import { SnappingClass } from "@thatopen/fragments";
import * as THREE from "three";
import type * as OBC from "@thatopen/components";
import type { ViewerTool } from "@/viewer/core/ViewerTypes";

/** Минимальные «точки» привязки — радиус в мировых единицах (модель обычно в метрах). */
const SNAP_SPHERE_RADIUS = 0.004;

export interface MeasureSnapOverlay {
  root: THREE.Group;
  vertexSphereGeom: THREE.SphereGeometry;
  vertexSphereA: THREE.Mesh;
  vertexSphereB: THREE.Mesh;
  edgeLineGeom: THREE.BufferGeometry;
  edgeLine: THREE.LineSegments;
}

function isSnappingPointLike(sc: number | null): boolean {
  return sc === SnappingClass.POINT || sc === 0;
}

function isSnappingLineLike(sc: number | null): boolean {
  return sc === SnappingClass.LINE || sc === 1;
}

/** Длина ребра в мм (вход — координаты в метрах). */
export function edgeLengthMm(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number }
): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = p1.z - p2.z;
  return Math.hypot(dx, dy, dz) * 1000;
}

export function formatLengthMm(mm: number): string {
  if (!Number.isFinite(mm)) return "—";
  return `${mm.toFixed(2)} мм`;
}

/** Подправить единицы в DOM-лейблах LengthMeasurement: латиница → кириллица + компактный шрифт. */
export function patchMeasurerLabelsToCyrillic(measurer: OBCF.LengthMeasurement): void {
  const normalize = (s: string) => s.replace(/\u00A0/g, " ");
  const patch = (s: string) => {
    let t = normalize(s);
    // Важно: в RegExp литерале \s — это пробельные символы; не использовать \\s (иначе матчится буквальная "\s").
    t = t.replace(/(\s|^)mm\s*$/i, (_all, g1: string) => `${g1}мм`);
    t = t.replace(/(\s|^)m\s*$/i, (_all, g1: string) => `${g1}м`);
    return t;
  };

  const labelsUnknown = measurer.labels as unknown;
  if (labelsUnknown == null) return;

  const patchMark = (mark: unknown) => {
    if (typeof mark !== "object" || mark === null) return;
    const el = (mark as { three?: { element?: HTMLElement } }).three?.element;
    if (!el) return;
    el.style.fontSize = "10px";
    el.style.padding = "2px 6px";
    el.style.lineHeight = "1.2";
    const t = el.textContent;
    if (typeof t !== "string") return;
    const next = patch(t);
    if (next !== t) el.textContent = next;
  };

  try {
    const it = (labelsUnknown as { [Symbol.iterator]?: () => Iterator<unknown> })[Symbol.iterator];
    if (typeof it === "function") {
      for (const mark of labelsUnknown as Iterable<unknown>) patchMark(mark);
      return;
    }
  } catch {
    /* ignore */
  }

  const fe = (labelsUnknown as { forEach?: (cb: (m: unknown) => void) => void }).forEach;
  if (typeof fe === "function") fe.call(labelsUnknown, patchMark);
}

export function createMeasureSnapOverlay(scene: THREE.Scene): MeasureSnapOverlay {
  const root = new THREE.Group();
  root.name = "measureSnapOverlay";
  root.visible = false;

  const vertexSphereGeom = new THREE.SphereGeometry(SNAP_SPHERE_RADIUS, 10, 10);
  const matA = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
  });
  const matB = new THREE.MeshBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.35,
    depthTest: true,
    depthWrite: false,
  });
  const vertexSphereA = new THREE.Mesh(vertexSphereGeom, matA);
  const vertexSphereB = new THREE.Mesh(vertexSphereGeom, matB);
  vertexSphereA.renderOrder = 2000;
  vertexSphereB.renderOrder = 2000;

  const edgeLineGeom = new THREE.BufferGeometry();
  const edgePositions = new Float32Array(6);
  edgeLineGeom.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
  const edgeLine = new THREE.LineSegments(
    edgeLineGeom,
    new THREE.LineBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.2,
    })
  );
  edgeLine.renderOrder = 2000;

  root.add(vertexSphereA);
  root.add(vertexSphereB);
  root.add(edgeLine);
  scene.add(root);

  return {
    root,
    vertexSphereGeom,
    vertexSphereA,
    vertexSphereB,
    edgeLineGeom,
    edgeLine,
  };
}

export function disposeMeasureSnapOverlay(ov: MeasureSnapOverlay, scene: THREE.Scene): void {
  scene.remove(ov.root);
  ov.vertexSphereGeom.dispose();
  (ov.vertexSphereA.material as THREE.Material).dispose();
  (ov.vertexSphereB.material as THREE.Material).dispose();
  ov.edgeLineGeom.dispose();
  (ov.edgeLine.material as THREE.Material).dispose();
}

type VertexPickerResult = {
  snappingClass?: number;
  point?: { x: number; y: number; z: number };
  snappedEdgeP1?: { x: number; y: number; z: number };
  snappedEdgeP2?: { x: number; y: number; z: number };
};

export class MeasurementController {
  private readonly world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBCF.RendererWith2D>;
  private readonly vertexPicker: OBCF.GraphicVertexPicker;
  private readonly measurer: OBCF.LengthMeasurement;
  private readonly overlay: MeasureSnapOverlay;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  private seq = 0;
  private raf = 0;
  private lastUnitsPatchMs = 0;
  private onQuickMeasure: (text: string | null) => void = () => {};
  private getActiveTool: () => ViewerTool = () => "none";

  constructor(
    world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBCF.RendererWith2D>,
    measurer: OBCF.LengthMeasurement,
    scene: THREE.Scene
  ) {
    this.world = world;
    this.measurer = measurer;
    this.vertexPicker = new OBCF.GraphicVertexPicker(world.components);
    this.vertexPicker.pickerSize = 8;
    this.overlay = createMeasureSnapOverlay(scene);
  }

  setCallbacks(getActiveTool: () => ViewerTool, onQuickMeasure: (text: string | null) => void): void {
    this.getActiveTool = getActiveTool;
    this.onQuickMeasure = onQuickMeasure;
  }

  getOverlay(): MeasureSnapOverlay {
    return this.overlay;
  }

  getVertexPicker(): OBCF.GraphicVertexPicker {
    return this.vertexPicker;
  }

  private hideOverlay(): void {
    const ov = this.overlay;
    ov.root.visible = false;
    ov.vertexSphereA.visible = false;
    ov.vertexSphereB.visible = false;
    ov.edgeLine.visible = false;
  }

  private updateOverlay(res: VertexPickerResult | null): void {
    const ov = this.overlay;
    if (!res || typeof res !== "object") {
      this.hideOverlay();
      return;
    }
    const sc = typeof res.snappingClass === "number" ? res.snappingClass : null;

    if (isSnappingPointLike(sc)) {
      const p = res.point;
      if (!p || typeof p.x !== "number") {
        this.hideOverlay();
        return;
      }
      ov.root.visible = true;
      ov.vertexSphereA.visible = true;
      ov.vertexSphereA.position.set(p.x, p.y, p.z);
      ov.vertexSphereB.visible = false;
      ov.edgeLine.visible = false;
      return;
    }

    if (isSnappingLineLike(sc)) {
      const p1 = res.snappedEdgeP1;
      const p2 = res.snappedEdgeP2;
      ov.root.visible = true;
      if (p1 && p2 && typeof p1.x === "number" && typeof p2.x === "number") {
        this.tmpA.set(p1.x, p1.y, p1.z);
        this.tmpB.set(p2.x, p2.y, p2.z);
        ov.vertexSphereA.visible = true;
        ov.vertexSphereB.visible = true;
        ov.vertexSphereA.position.copy(this.tmpA);
        ov.vertexSphereB.position.copy(this.tmpB);
        const attr = ov.edgeLineGeom.getAttribute("position") as THREE.BufferAttribute;
        attr.setXYZ(0, this.tmpA.x, this.tmpA.y, this.tmpA.z);
        attr.setXYZ(1, this.tmpB.x, this.tmpB.y, this.tmpB.z);
        attr.needsUpdate = true;
        ov.edgeLine.visible = true;
        return;
      }
      const p = res.point;
      if (p && typeof p.x === "number") {
        ov.vertexSphereA.visible = true;
        ov.vertexSphereB.visible = false;
        ov.vertexSphereA.position.set(p.x, p.y, p.z);
        ov.edgeLine.visible = false;
        return;
      }
      this.hideOverlay();
      return;
    }
    this.hideOverlay();
  }

  private patchUnitsThrottled(): void {
    const now = performance.now();
    if (now - this.lastUnitsPatchMs < 70) return;
    this.lastUnitsPatchMs = now;
    patchMeasurerLabelsToCyrillic(this.measurer);
  }

  readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    const tool = this.getActiveTool();
    if (tool !== "measure") {
      this.hideOverlay();
      this.onQuickMeasure(null);
      if (this.measurer.isDragging) this.measurer.cancelCreation();
      return;
    }

    const seq = ++this.seq;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      void this.vertexPicker
        .get({
          world: this.world,
          snappingClasses: [SnappingClass.POINT, SnappingClass.LINE],
        })
        .then((res: unknown) => {
          if (seq !== this.seq) return;
          if (this.vertexPicker.marker) this.vertexPicker.marker.visible = false;

          const r = res as VertexPickerResult | null;
          const sc = typeof r?.snappingClass === "number" ? r.snappingClass : null;
          const hasSnap =
            sc === SnappingClass.POINT ||
            sc === SnappingClass.LINE ||
            sc === 0 ||
            sc === 1;

          if (!r || typeof r !== "object" || !hasSnap) {
            this.hideOverlay();
            this.onQuickMeasure(null);
            if (this.measurer.isDragging) this.measurer.cancelCreation();
            return;
          }

          this.updateOverlay(r);
          this.patchUnitsThrottled();

          // Быстрый режим: только подсказка длины по ребру, без create() и без накопления измерений.
          if (isSnappingLineLike(sc) && r.snappedEdgeP1 && r.snappedEdgeP2) {
            const mm = edgeLengthMm(r.snappedEdgeP1, r.snappedEdgeP2);
            this.onQuickMeasure(formatLengthMm(mm));
          } else if (isSnappingPointLike(sc)) {
            this.onQuickMeasure("точка");
          } else {
            this.onQuickMeasure(null);
          }
        })
        .catch(() => {
          if (seq !== this.seq) return;
          this.hideOverlay();
          this.onQuickMeasure(null);
        });
    });
  };

  clearQuickLabel(): void {
    this.onQuickMeasure(null);
  }

  dispose(scene: THREE.Scene): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    try {
      this.vertexPicker.dispose();
    } catch {
      /* ignore */
    }
    disposeMeasureSnapOverlay(this.overlay, scene);
  }
}
