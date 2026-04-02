/**
 * Рёбра и углы — отдельные меши для raycast (тот же мир, что и грани).
 */
import * as THREE from "three";
import type { ViewCubeCorner, ViewCubeEdge } from "./GizmoCubeTypes";

const HALF = 1;
const EDGE_BUMP = 0.04;
const EDGE_LEN = 1.82;
const EDGE_T = 0.14;

const EDGE_DEFS = [
  { id: "top-front" as const, mid: [0, 1, 1] as const, along: [1, 0, 0] as const, out: [0, 1, 1] as const },
  { id: "top-back" as const, mid: [0, 1, -1] as const, along: [1, 0, 0] as const, out: [0, 1, -1] as const },
  { id: "top-left" as const, mid: [-1, 1, 0] as const, along: [0, 0, 1] as const, out: [-1, 1, 0] as const },
  { id: "top-right" as const, mid: [1, 1, 0] as const, along: [0, 0, 1] as const, out: [1, 1, 0] as const },
  { id: "bottom-front" as const, mid: [0, -1, 1] as const, along: [1, 0, 0] as const, out: [0, -1, 1] as const },
  { id: "bottom-back" as const, mid: [0, -1, -1] as const, along: [1, 0, 0] as const, out: [0, -1, -1] as const },
  { id: "bottom-left" as const, mid: [-1, -1, 0] as const, along: [0, 0, 1] as const, out: [-1, -1, 0] as const },
  { id: "bottom-right" as const, mid: [1, -1, 0] as const, along: [0, 0, 1] as const, out: [1, -1, 0] as const },
  { id: "front-left" as const, mid: [-1, 0, 1] as const, along: [0, 1, 0] as const, out: [-1, 0, 1] as const },
  { id: "front-right" as const, mid: [1, 0, 1] as const, along: [0, 1, 0] as const, out: [1, 0, 1] as const },
  { id: "back-left" as const, mid: [-1, 0, -1] as const, along: [0, 1, 0] as const, out: [-1, 0, -1] as const },
  { id: "back-right" as const, mid: [1, 0, -1] as const, along: [0, 1, 0] as const, out: [1, 0, -1] as const },
] as const;

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

/** Ребро мини-куба на вершине: крупнее сферы — проще попасть и читается как «кубик». */
const CORNER_CUBE_EDGE = 0.28;
const CORNER_POS = 0.9;

function makeEdgeStripMatrix(
  mid: readonly [number, number, number],
  along: readonly [number, number, number],
  out: readonly [number, number, number]
): THREE.Matrix4 {
  const pos = new THREE.Vector3(mid[0] * HALF, mid[1] * HALF, mid[2] * HALF);
  const u = new THREE.Vector3(along[0], along[1], along[2]).normalize();
  const o = new THREE.Vector3(out[0], out[1], out[2]).normalize();
  const v = new THREE.Vector3().crossVectors(o, u).normalize();
  const mat = new THREE.Matrix4();
  mat.makeBasis(u, v, o);
  pos.add(o.clone().multiplyScalar(EDGE_BUMP));
  mat.setPosition(pos);
  return mat;
}

export function buildEdgeAndCornerMeshes(): {
  edgeMeshes: THREE.Mesh[];
  cornerMeshes: THREE.Mesh[];
  dispose: () => void;
} {
  const edgeMeshes: THREE.Mesh[] = [];
  for (const d of EDGE_DEFS) {
    const geom = new THREE.BoxGeometry(EDGE_LEN, EDGE_T, EDGE_T);
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, edgeMat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(makeEdgeStripMatrix(d.mid, d.along, d.out));
    mesh.userData.pickKind = "edge" as const;
    mesh.userData.edgeId = d.id;
    edgeMeshes.push(mesh);
  }

  const cornerMeshes: THREE.Mesh[] = [];
  for (const [sx, sy, sz] of CORNERS) {
    const cornerGeom = new THREE.BoxGeometry(CORNER_CUBE_EDGE, CORNER_CUBE_EDGE, CORNER_CUBE_EDGE);
    const cornerMat = new THREE.MeshBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(cornerGeom, cornerMat);
    mesh.position.set(sx * CORNER_POS * HALF, sy * CORNER_POS * HALF, sz * CORNER_POS * HALF);
    mesh.renderOrder = 4;
    mesh.userData.pickKind = "corner" as const;
    mesh.userData.corner = [sx, sy, sz] as ViewCubeCorner;
    cornerMeshes.push(mesh);
  }

  const dispose = () => {
    for (const m of edgeMeshes) (m.material as THREE.Material).dispose();
    for (const m of cornerMeshes) (m.material as THREE.Material).dispose();
  };

  return { edgeMeshes, cornerMeshes, dispose };
}

export type PickKind = "face" | "edge" | "corner";
