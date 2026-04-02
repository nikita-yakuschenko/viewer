import type { GizmoCubeRenderer, GizmoPickResult } from "./GizmoCubeRenderer";

export function pickGizmo(renderer: GizmoCubeRenderer, clientX: number, clientY: number): GizmoPickResult | null {
  return renderer.pick(clientX, clientY);
}
