import * as THREE from "three";
import { buildEdgeAndCornerMeshes } from "./GizmoCubePickExtras";
import { buildLabeledFaceMeshes, disposeFaceResources } from "./GizmoCubeLabels";
import type { GizmoSemanticFace } from "./GizmoCubeTypes";
import type { ViewCubeCorner, ViewCubeEdge } from "./GizmoCubeTypes";

/** Единый масштаб геометрии — куб с лейблами помещается в квадратный viewport без обрезки углов. */
const GIZMO_CONTENT_SCALE = 0.64;

function cornersEqual(a: ViewCubeCorner, b: ViewCubeCorner): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export type GizmoPickResult =
  | { kind: "face"; face: GizmoSemanticFace }
  | { kind: "edge"; edge: ViewCubeEdge }
  | { kind: "corner"; corner: ViewCubeCorner };

export class GizmoCubeRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly cubeRig: THREE.Group;
  private readonly faceMeshes: Map<GizmoSemanticFace, THREE.Mesh>;
  private readonly edgeMeshes: THREE.Mesh[] = [];
  private readonly cornerMeshes: THREE.Mesh[] = [];
  private readonly pickMeshes: THREE.Mesh[] = [];
  private readonly disposePickExtras: () => void;
  private readonly textures: THREE.CanvasTexture[];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "default",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    this.camera.position.set(0, 0, 4.65);
    this.camera.lookAt(0, 0, 0);

    const amb = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(0.75, 1.1, 0.95);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xe8eef7, 0.22);
    fill.position.set(-0.85, -0.35, 0.4);
    this.scene.add(fill);

    const { group, faceMeshes, textures } = buildLabeledFaceMeshes();
    this.cubeRig = group;
    this.faceMeshes = faceMeshes;
    this.textures = textures;
    const extras = buildEdgeAndCornerMeshes();
    for (const m of extras.edgeMeshes) {
      this.cubeRig.add(m);
      this.edgeMeshes.push(m);
      this.pickMeshes.push(m);
    }
    for (const m of extras.cornerMeshes) {
      this.cubeRig.add(m);
      this.cornerMeshes.push(m);
      this.pickMeshes.push(m);
    }
    for (const m of this.faceMeshes.values()) this.pickMeshes.push(m);
    this.disposePickExtras = extras.dispose;
    this.cubeRig.scale.setScalar(GIZMO_CONTENT_SCALE);
    this.scene.add(this.cubeRig);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }

  /** Синхронизация с главной камерой: куб показывает ту же ориентацию мира, что и вид (WYS). */
  syncWithMainCamera(mainCamera: THREE.Camera): void {
    const q = new THREE.Quaternion();
    mainCamera.getWorldQuaternion(q);
    this.cubeRig.quaternion.copy(q).invert();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  startLoop(getMainCamera: () => THREE.Camera | null | undefined): void {
    const tick = () => {
      if (this.disposed) return;
      const cam = getMainCamera();
      if (cam) this.syncWithMainCamera(cam);
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopLoop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Подсветка грани / ребра / вершины под курсором (WYS + навигация). */
  setHover(hit: GizmoPickResult | null): void {
    const hoveredFace = hit?.kind === "face" ? hit.face : null;
    for (const [f, mesh] of this.faceMeshes) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(hoveredFace === null || hoveredFace === f ? 0xffffff : 0xc9d2dd);
    }

    const hoveredEdge = hit?.kind === "edge" ? hit.edge : null;
    for (const m of this.edgeMeshes) {
      const id = m.userData.edgeId as ViewCubeEdge;
      const mat = m.material as THREE.MeshBasicMaterial;
      const on = hoveredEdge !== null && hoveredEdge === id;
      mat.color.setHex(on ? 0x0ea5e9 : 0x94a3b8);
      mat.opacity = on ? 0.92 : 0.28;
    }

    const hoveredCorner = hit?.kind === "corner" ? hit.corner : null;
    for (const m of this.cornerMeshes) {
      const c = m.userData.corner as ViewCubeCorner;
      const mat = m.material as THREE.MeshBasicMaterial;
      const on = hoveredCorner !== null && cornersEqual(c, hoveredCorner);
      mat.color.setHex(on ? 0x38bdf8 : 0x64748b);
      mat.opacity = on ? 1 : 0.48;
      const s = on ? 1.22 : 1;
      m.scale.setScalar(s);
    }
  }

  pick(clientX: number, clientY: number): GizmoPickResult | null {
    const rect = this.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length === 0) return null;
    const o = hits[0].object;
    const ud = o.userData;
    if (ud.gizmoSemanticFace) return { kind: "face", face: ud.gizmoSemanticFace as GizmoSemanticFace };
    if (ud.pickKind === "edge" && ud.edgeId) return { kind: "edge", edge: ud.edgeId as ViewCubeEdge };
    if (ud.pickKind === "corner" && ud.corner) return { kind: "corner", corner: ud.corner as ViewCubeCorner };
    return null;
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.disposePickExtras();
    disposeFaceResources(this.textures);
    this.renderer.dispose();
    this.cubeRig.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material)?.dispose();
      }
    });
  }
}
