import type * as OBC from "@thatopen/components";
import type { Camera, Object3D } from "three";

/** Карта IFC-слой → product ids (express id продуктов). */
export type LayerMap = Record<string, number[]>;

export type LayerVisibilityMap = Record<string, boolean>;

export interface PropertyItem {
  name: string;
  value: string | number | boolean | null;
}

export interface PropertySet {
  name: string;
  properties: PropertyItem[];
}

export interface TreeNode {
  expressID: number;
  name: string;
  type: string;
  children: TreeNode[];
  panelKey?: string;
}

export type ViewerTool = "none" | "measure" | "clip";

export interface LayersTreeBannerState {
  variant: "info" | "error";
  message: string;
}

/** Результат индексации слоёв из web-ifc (без React). */
export interface LayerIndexResult {
  layerIdsByName: LayerMap;
  banner: LayersTreeBannerState | null;
}

/** Снимок выделения ThatOpen Highlighter: modelId → local ids. */
export type HighlighterSelectionMap = Record<string, Set<number>>;

/** Модель фрагментов ThatOpen: минимальный контракт для runtime. */
export interface FragmentsModelLike {
  modelId: string;
  object: Object3D;
  useCamera: (cam: Camera) => void;
  setVisible: (ids: number[], visible: boolean) => Promise<void> | void;
  resetVisible?: () => void;
  getLocalIds?: () => number[] | Promise<number[] | Iterable<number>>;
}

export interface ViewerInitOptions {
  /** Корневой URL для wasm web-ifc (как в IfcLoader.setup). */
  webIfcWasmRoot: string;
  webIfcVersion: string;
  /** Путь к worker фрагментов относительно public/. */
  fragmentsWorkerUrl: string;
}

export type ViewerCommandResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Публичное состояние, которое bridge может пробрасывать в UI (опционально). */
export interface ViewerPublicState {
  fragmentsReady: boolean;
  modelLoaded: boolean;
  activeTool: ViewerTool;
}

/** Колбэки в UI-слой (React). Только данные и команды — без Three/OBC в сигнатурах где возможно. */
export interface ViewerUiCallbacks {
  onLoadingChange: (loading: boolean) => void;
  onModelName: (name: string) => void;
  onModelLoaded: (loaded: boolean) => void;
  onLayerIndex: (result: LayerIndexResult) => void;
  onPropertiesLoaded: (sets: PropertySet[]) => void;
  onSelectionSync: () => void;
  onHoverLayerLabel: (label: string | null) => void;
  /** Быстрый предпросмотр длины (мм), без создания объекта LengthMeasurement. */
  onQuickMeasureMm: (text: string | null) => void;
  /** Запрос показать дерево / свойства (как раньше setShowTree/setShowProperties). */
  onUiRequest: (req: { showTree?: boolean; showProperties?: boolean }) => void;
  onSelectedLayerNames: (names: string[]) => void;
  /** Для Shift+клик по слою: мерж с текущим выбором в React state. */
  getSelectedLayerNames: () => string[];
}

export type ModelIdMap = OBC.ModelIdMap;
