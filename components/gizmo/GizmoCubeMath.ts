import * as THREE from "three";

/** Единичное направление «в сцену» для ортогонального вида. */
export function orthoEyeOffsetForView(
  dir: "top" | "bottom" | "front" | "back" | "left" | "right",
  distance: number
): THREE.Vector3 {
  const d = Math.max(distance, 0.5);
  switch (dir) {
    case "top":
      return new THREE.Vector3(0, d, 0);
    case "bottom":
      return new THREE.Vector3(0, -d, 0);
    case "front":
      return new THREE.Vector3(0, 0, d);
    case "back":
      return new THREE.Vector3(0, 0, -d);
    case "right":
      return new THREE.Vector3(d, 0, 0);
    case "left":
      return new THREE.Vector3(-d, 0, 0);
    default:
      return new THREE.Vector3(0, 0, d);
  }
}

/** Построение кватерниона камеры: смотреть из eye на target, worldUp по умолчанию Y. */
export function lookAtQuaternion(eye: THREE.Vector3, target: THREE.Vector3, worldUp = new THREE.Vector3(0, 1, 0)): THREE.Quaternion {
  const m = new THREE.Matrix4();
  m.lookAt(eye, target, worldUp);
  const q = new THREE.Quaternion();
  q.setFromRotationMatrix(m);
  return q;
}

/** Базис экрана для шагов орбиты (как в BIMViewer). */
export function getViewBasisFromOrbit(pos: THREE.Vector3, target: THREE.Vector3) {
  const forward = target.clone().sub(pos).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
  if (right.lengthSq() < 1e-8) {
    right.set(1, 0, 0);
  }
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  return { forward, right, up };
}
