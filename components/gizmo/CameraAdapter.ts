import * as THREE from "three";
import { viewDirectionIntoScene, visibleFaceFromViewDirection } from "./GizmoCubeSemantics";
import type { GizmoSemanticFace } from "./GizmoCubeTypes";

export function getViewDirectionIntoScene(camera: THREE.Camera, target: THREE.Vector3): THREE.Vector3 {
  const eye = new THREE.Vector3();
  camera.getWorldPosition(eye);
  return viewDirectionIntoScene(eye, target);
}

/** Текущая семантическая грань (WYS) по главной камере. */
export function getVisibleSemanticFace(camera: THREE.Camera, orbitTarget: THREE.Vector3): GizmoSemanticFace {
  const v = getViewDirectionIntoScene(camera, orbitTarget);
  return visibleFaceFromViewDirection(v);
}
