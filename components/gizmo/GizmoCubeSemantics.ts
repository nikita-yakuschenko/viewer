/**
 * WHAT-YOU-SEE: видимая грань gizmo = то, с какой стороны мира пользователь смотрит на сцену.
 * Направление «в сцену» v = normalize(target - eye). Грань с мировой нормалью n видна, если n · v < 0
 * (нормаль смотрит на камеру). Для ортогональных видов выбираем ось с максимальным |dot|.
 */
import * as THREE from "three";
import type { GizmoSemanticFace } from "./GizmoCubeTypes";

const EPS = 1e-4;

/** Единичные нормали граней куба в миру (центр куба в начале координат, грань смотрит наружу). */
export const FACE_WORLD_NORMAL: Record<GizmoSemanticFace, THREE.Vector3> = {
  FRONT: new THREE.Vector3(0, 0, 1),
  BACK: new THREE.Vector3(0, 0, -1),
  RIGHT: new THREE.Vector3(1, 0, 0),
  LEFT: new THREE.Vector3(-1, 0, 0),
  TOP: new THREE.Vector3(0, 1, 0),
  BOTTOM: new THREE.Vector3(0, -1, 0),
};

/**
 * Направление взгляда в сцену: от камеры к цели (куда смотрит камера).
 * Совпадает с THREE.Camera.getWorldDirection при lookAt на target.
 */
export function viewDirectionIntoScene(eye: THREE.Vector3, target: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(target).sub(eye).normalize();
}

/**
 * Какая грань куба наиболее «смотрит на камеру» при текущем виде.
 * v = направление в сцену. Видна грань с нормалью n, если n направлена к камере: dot(n, -v) > 0 → dot(n, v) < 0.
 * Берём грань с минимальным dot(n, v) (максимально противоположна направлению взгляда).
 */
export function visibleFaceFromViewDirection(v: THREE.Vector3): GizmoSemanticFace {
  const faces: GizmoSemanticFace[] = ["FRONT", "BACK", "RIGHT", "LEFT", "TOP", "BOTTOM"];
  let best: GizmoSemanticFace = "FRONT";
  let bestDot = Infinity;
  for (const f of faces) {
    const n = FACE_WORLD_NORMAL[f];
    const d = n.dot(v);
    if (d < bestDot - EPS) {
      bestDot = d;
      best = f;
    }
  }
  return best;
}

/** Проверка инварианта WYS: семантика совпадает с классификацией направления. */
export function assertSemanticConsistency(
  eye: THREE.Vector3,
  target: THREE.Vector3,
  expectedFace: GizmoSemanticFace
): { ok: boolean; message: string } {
  const v = viewDirectionIntoScene(eye, target);
  const got = visibleFaceFromViewDirection(v);
  if (got !== expectedFace) {
    return {
      ok: false,
      message: `WYS mismatch: view dir suggests ${got}, expected ${expectedFace} (v=${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`,
    };
  }
  return { ok: true, message: "ok" };
}
