/**
 * Текст на плоскостях: явные нормали наружу, без billboard — устраняет зеркальность и «изнутри».
 */
import * as THREE from "three";
import type { GizmoSemanticFace } from "./GizmoCubeTypes";

/** Подписи капсом — читаемость в миниатюре. */
const LABEL_RU: Record<GizmoSemanticFace, string> = {
  FRONT: "СПЕРЕДИ",
  BACK: "СЗАДИ",
  LEFT: "СЛЕВА",
  RIGHT: "СПРАВА",
  TOP: "ВЕРХ",
  BOTTOM: "НИЗ",
};

const FACE_ORDER: GizmoSemanticFace[] = ["FRONT", "BACK", "RIGHT", "LEFT", "TOP", "BOTTOM"];

const TEX_SIZE = 512;

function makeTextTexture(text: string, size = TEX_SIZE): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Непрозрачная подложка — без «стекла» и артефактов глубины
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, size, size);
  const pad = Math.round(size * 0.04);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(226,232,240,0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);
  ctx.strokeStyle = "rgba(71,85,105,0.88)";
  ctx.lineWidth = Math.max(4, Math.round(size * 0.014));
  ctx.strokeRect(pad + 2, pad + 2, size - (pad + 2) * 2, size - (pad + 2) * 2);
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(size * 0.11)}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const HALF = 1;

/** Плоскость грани: центр на поверхности куба [−1,1]³, нормаль наружу. */
function facePlaneTransform(face: GizmoSemanticFace): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const eps = 0.02;
  switch (face) {
    case "FRONT":
      pos.set(0, 0, HALF + eps);
      q.setFromEuler(new THREE.Euler(0, 0, 0));
      break;
    case "BACK":
      pos.set(0, 0, -HALF - eps);
      q.setFromEuler(new THREE.Euler(0, Math.PI, 0));
      break;
    // PlaneGeometry: нормаль +local Z. Для правой грани (мир +X) — RY(+π/2); для левой (−X) — RY(−π/2). Не путать: иначе нормаль внутрь куба и FrontSide не рисует текст.
    case "RIGHT":
      pos.set(HALF + eps, 0, 0);
      q.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
      break;
    case "LEFT":
      pos.set(-HALF - eps, 0, 0);
      q.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
      break;
    case "TOP":
      pos.set(0, HALF + eps, 0);
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      break;
    case "BOTTOM":
      pos.set(0, -HALF - eps, 0);
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      break;
    default:
      pos.set(0, 0, HALF + eps);
  }
  return { pos, quat: q };
}

export function buildLabeledFaceMeshes(): {
  group: THREE.Group;
  faceMeshes: Map<GizmoSemanticFace, THREE.Mesh>;
  textures: THREE.CanvasTexture[];
} {
  const group = new THREE.Group();
  const faceMeshes = new Map<GizmoSemanticFace, THREE.Mesh>();
  const textures: THREE.CanvasTexture[] = [];

  const boxGeo = new THREE.BoxGeometry(2, 2, 2);
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xe8ecf2,
    metalness: 0.06,
    roughness: 0.9,
  });
  const solidBox = new THREE.Mesh(boxGeo, boxMat);
  solidBox.renderOrder = 0;
  group.add(solidBox);

  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x64748b,
    depthTest: true,
    depthWrite: false,
    transparent: false,
  });
  const wire = new THREE.LineSegments(edgeGeo, edgeMat);
  wire.renderOrder = 1;
  group.add(wire);

  const planeSize = 1.58;
  for (const face of FACE_ORDER) {
    const geom = new THREE.PlaneGeometry(planeSize, planeSize);
    const tex = makeTextTexture(LABEL_RU[face]);
    textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5,
    });
    const mesh = new THREE.Mesh(geom, mat);
    const { pos, quat } = facePlaneTransform(face);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.renderOrder = 2;
    mesh.userData.gizmoSemanticFace = face;
    group.add(mesh);
    faceMeshes.set(face, mesh);
  }

  return { group, faceMeshes, textures };
}

export function disposeFaceResources(textures: THREE.CanvasTexture[]): void {
  for (const t of textures) t.dispose();
}
