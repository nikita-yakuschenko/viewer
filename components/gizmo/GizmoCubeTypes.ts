/** Семантические грани мира (Y-up, +Z — «спереди», как в BIMViewer). */
export type GizmoSemanticFace = "TOP" | "BOTTOM" | "FRONT" | "BACK" | "LEFT" | "RIGHT";

/** Совместимость с прежним ViewCubeDirection. */
export type ViewCubeDirection = "top" | "bottom" | "front" | "back" | "left" | "right";

export type ViewCubeEdge =
  | "top-front"
  | "top-back"
  | "top-left"
  | "top-right"
  | "bottom-front"
  | "bottom-back"
  | "bottom-left"
  | "bottom-right"
  | "front-left"
  | "front-right"
  | "back-left"
  | "back-right";

export type ViewCubeCorner = readonly [sign: 1 | -1, sign: 1 | -1, sign: 1 | -1];

export type ViewCubeStep = "left" | "right" | "up" | "down";

export function semanticToViewDir(f: GizmoSemanticFace): ViewCubeDirection {
  const m: Record<GizmoSemanticFace, ViewCubeDirection> = {
    TOP: "top",
    BOTTOM: "bottom",
    FRONT: "front",
    BACK: "back",
    LEFT: "left",
    RIGHT: "right",
  };
  return m[f];
}

export function viewDirToSemantic(d: ViewCubeDirection): GizmoSemanticFace {
  const m: Record<ViewCubeDirection, GizmoSemanticFace> = {
    top: "TOP",
    bottom: "BOTTOM",
    front: "FRONT",
    back: "BACK",
    left: "LEFT",
    right: "RIGHT",
  };
  return m[d];
}
