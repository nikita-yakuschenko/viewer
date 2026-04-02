/**
 * Рёбра и углы — те же направления, что и в прежнем ViewCube (IFC / +Y up, +Z front).
 */
import * as THREE from "three";
import type { ViewCubeEdge } from "./GizmoCubeTypes";

const EDGE_DEFS = [
  { id: "top-front" as const, out: [0, 1, 1] as const },
  { id: "top-back" as const, out: [0, 1, -1] as const },
  { id: "top-left" as const, out: [-1, 1, 0] as const },
  { id: "top-right" as const, out: [1, 1, 0] as const },
  { id: "bottom-front" as const, out: [0, -1, 1] as const },
  { id: "bottom-back" as const, out: [0, -1, -1] as const },
  { id: "bottom-left" as const, out: [-1, -1, 0] as const },
  { id: "bottom-right" as const, out: [1, -1, 0] as const },
  { id: "front-left" as const, out: [-1, 0, 1] as const },
  { id: "front-right" as const, out: [1, 0, 1] as const },
  { id: "back-left" as const, out: [-1, 0, -1] as const },
  { id: "back-right" as const, out: [1, 0, -1] as const },
] as const;

/** Единичный вектор направления камеры от цели для вида с ребра. */
export function getEdgeViewDirectionUnit(edge: ViewCubeEdge): THREE.Vector3 {
  for (const d of EDGE_DEFS) {
    if (d.id === edge) {
      return new THREE.Vector3(d.out[0], d.out[1], d.out[2]).normalize();
    }
  }
  return new THREE.Vector3(0, 0, 1);
}
