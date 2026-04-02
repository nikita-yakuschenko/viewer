/**
 * Отладка семантики gizmo и согласованности с камерой.
 * В production выключено через флаг.
 */
import * as THREE from "three";
import { getVisibleSemanticFace } from "./CameraAdapter";
import { assertSemanticConsistency, visibleFaceFromViewDirection, viewDirectionIntoScene } from "./GizmoCubeSemantics";
import type { GizmoSemanticFace } from "./GizmoCubeTypes";

export const GIZMO_DEBUG = typeof process !== "undefined" && process.env.NEXT_PUBLIC_GIZMO_DEBUG === "1";

export function logGizmoFrame(camera: THREE.Camera, target: THREE.Vector3, label: string): void {
  if (!GIZMO_DEBUG) return;
  const q = new THREE.Quaternion();
  camera.getWorldQuaternion(q);
  const v = viewDirectionIntoScene(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), target);
  const face = visibleFaceFromViewDirection(v);
  // eslint-disable-next-line no-console
  console.log(`[Gizmo] ${label}`, {
    semanticFace: face,
    viewIntoScene: { x: v.x, y: v.y, z: v.z },
    camQuat: { x: q.x, y: q.y, z: q.z, w: q.w },
  });
}

export function assertSemanticConsistencyDebug(
  camera: THREE.Camera,
  target: THREE.Vector3,
  expected: GizmoSemanticFace
): boolean {
  const r = assertSemanticConsistency(
    new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld),
    target,
    expected
  );
  if (!r.ok && GIZMO_DEBUG) {
    // eslint-disable-next-line no-console
    console.warn("[Gizmo]", r.message);
  }
  return r.ok;
}

export function checkVisibleMatchesCamera(camera: THREE.Camera, target: THREE.Vector3): GizmoSemanticFace {
  return getVisibleSemanticFace(camera, target);
}
