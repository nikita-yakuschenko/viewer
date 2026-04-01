"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import { RenderedFaces } from "@thatopen/fragments";
import * as THREE from "three";
import * as WEBIFC from "web-ifc";
import { ModelTree } from "./ModelTree";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar, ViewportToolsPanel } from "./Toolbar";
import {
  ViewCube,
  type ViewCubeCorner,
  type ViewCubeDirection,
  type ViewCubeEdge,
  type ViewCubeStep,
  getEdgeViewDirectionUnit,
} from "./ViewCube";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { motion, type Transition } from "framer-motion";

const panelSlideTransition: Transition = {
  type: "spring",
  damping: 32,
  stiffness: 340,
  mass: 0.9,
};

const panelHeightTransition: Transition = {
  type: "spring",
  damping: 28,
  stiffness: 280,
  mass: 0.75,
};

const emptyStateGlass =
  "max-w-md rounded-2xl border border-white/25 bg-background/55 px-10 py-9 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl supports-[backdrop-filter]:bg-background/45";

/** ACES + чуть выше экспозиция — без тяжёлого постпроцесса */
const SCENE_TONE_EXPOSURE = 1.06;

/** Предпросмотр слоя под курсором (отдельный стиль Highlighter). */
const LAYER_HOVER_STYLE = "layerHover";

/** Видимая полоска при сворачивании: чуть шире плашки w-3.5 (минимальный зазор) */
/** Видимая ширина края: плашка w-3.5 + запас под вертикальный текст (~2.125rem) */
const PEEK_STRIP_SUM = "2.5rem";
/** Высота «края» в свёрнутом состоянии (до hover) — под длинные вертикальные подписи */
const PEEK_COLLAPSED_HEIGHT = "14rem";

function readIfcText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
    const nested = (raw as { value?: unknown }).value;
    return readIfcText(nested);
  }
  return null;
}

/** Скаляр из атрибутов Fragments / IFC для панели свойств. */
function fragmentsValueToDisplay(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return fragmentsValueToDisplay((value as { value?: unknown }).value);
  }
  if (Array.isArray(value)) return `Массив(${value.length})`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Полный граф свойств IFC через ThatOpen Fragments (как в IDS Property facet).
 * Без этого getItemsData отдаёт только встроенные поля (_category, _guid, …).
 */
const FRAGMENTS_ITEM_DATA_PSETS = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: { attributes: true, relations: true },
    IsTypedBy: { attributes: true, relations: false },
    HasPropertySets: { attributes: true, relations: true },
    DefinesOcurrence: { attributes: false, relations: false },
  },
  relationsDefault: { attributes: false, relations: false },
} as const;

function ifcPropertyValueKey(entity: Record<string, unknown>): string | undefined {
  return Object.keys(entity).find((k) => /Value/.test(k) || /Values/.test(k));
}

function ifcPropertyListName(definition: Record<string, unknown>): string | undefined {
  const cat = definition._category;
  if (!cat || typeof cat !== "object" || !("value" in cat)) return undefined;
  const v = (cat as { value: unknown }).value;
  if (v === "IFCPROPERTYSET") return "HasProperties";
  if (v === "IFCPROPERTYSETDEFINITIONSET") return "HasProperties";
  if (v === "IFCELEMENTQUANTITY") return "Quantities";
  return undefined;
}

function ifcExtractPropertyOrQuantityValue(entity: Record<string, unknown>): string | number | boolean | null {
  const vk = ifcPropertyValueKey(entity);
  if (!vk) return null;
  const attr = entity[vk];
  if (!attr || typeof attr !== "object" || !("value" in attr)) return null;
  return fragmentsValueToDisplay((attr as { value: unknown }).value);
}

function ifcGetTypePropertySetTemplates(item: Record<string, unknown>): unknown[] {
  const typedBy = item.IsTypedBy;
  if (!Array.isArray(typedBy) || typedBy.length === 0) return [];
  const t0 = typedBy[0] as Record<string, unknown>;
  const hps = t0.HasPropertySets;
  return Array.isArray(hps) ? hps : [];
}

/** Слияние свойств из шаблона типа (HasPropertySets) в экземпляр набора, как в @thatopen/components getPsets. */
function ifcMergeTypePropsIntoDefinitionList(
  definition: Record<string, unknown>,
  listName: string,
  typeTemplates: unknown[]
): Record<string, unknown>[] {
  const raw = definition[listName];
  const list = Array.isArray(raw) ? [...(raw as Record<string, unknown>[])] : [];
  const defName =
    definition.Name && typeof definition.Name === "object" && "value" in definition.Name
      ? String((definition.Name as { value: unknown }).value)
      : "";
  if (!defName) return list;
  const typeSet = typeTemplates.find((s) => {
    const set = s as Record<string, unknown>;
    return (
      set.Name &&
      typeof set.Name === "object" &&
      "value" in set.Name &&
      String((set.Name as { value: unknown }).value) === defName
    );
  }) as Record<string, unknown> | undefined;
  if (!typeSet || !Array.isArray(typeSet.HasProperties)) return list;
  for (const prop of typeSet.HasProperties as Record<string, unknown>[]) {
    const pn =
      prop.Name && typeof prop.Name === "object" && "value" in prop.Name
        ? String((prop.Name as { value: unknown }).value)
        : "";
    if (!pn) continue;
    const exists = list.some(
      (p) =>
        p.Name &&
        typeof p.Name === "object" &&
        "value" in p.Name &&
        String((p.Name as { value: unknown }).value) === pn
    );
    if (!exists) list.push(prop);
  }
  return list;
}

/** Плоские атрибуты элемента (без массивов связей). */
function ifcCollectFlatAttributes(item: Record<string, unknown>): PropertyItem[] {
  const out: PropertyItem[] = [];
  for (const [key, val] of Object.entries(item)) {
    if (key === "expressID" || key === "type") continue;
    if (Array.isArray(val)) continue;
    if (val == null || typeof val !== "object") continue;
    if (!("value" in val)) continue;
    out.push({ name: key, value: fragmentsValueToDisplay((val as { value: unknown }).value) });
  }
  out.sort((a, b) => {
    const au = a.name.startsWith("_") ? 1 : 0;
    const bu = b.name.startsWith("_") ? 1 : 0;
    if (au !== bu) return au - bu;
    return a.name.localeCompare(b.name, "ru");
  });
  return out;
}

/** Наборы Pset / Qto из IsDefinedBy. */
function ifcCollectDefinedPropertySets(item: Record<string, unknown>): PropertySet[] {
  const typeTemplates = ifcGetTypePropertySetTemplates(item);
  const isDefinedBy = item.IsDefinedBy;
  if (!Array.isArray(isDefinedBy)) return [];
  const out: PropertySet[] = [];
  for (const def of isDefinedBy) {
    const definition = def as Record<string, unknown>;
    if (!definition.Name || typeof definition.Name !== "object" || !("value" in definition.Name)) {
      continue;
    }
    const title = String((definition.Name as { value: unknown }).value);
    const listName = ifcPropertyListName(definition);
    if (!listName) continue;
    const merged = ifcMergeTypePropsIntoDefinitionList(definition, listName, typeTemplates);
    const properties: PropertyItem[] = [];
    for (const ent of merged) {
      const baseName =
        ent.Name && typeof ent.Name === "object" && "value" in ent.Name
          ? String((ent.Name as { value: unknown }).value)
          : "";
      if (!baseName) continue;
      properties.push({ name: baseName, value: ifcExtractPropertyOrQuantityValue(ent) });
    }
    if (properties.length > 0) out.push({ name: title, properties });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return out;
}

function webIfcVectorToIds(v: WEBIFC.Vector<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
}

function extractIfcRefId(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && value > 0) return value;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.expressID === "number" && o.expressID > 0) return o.expressID;
    if ("value" in o) return extractIfcRefId(o.value);
  }
  return null;
}

/** Карта геометрических представлений и форм → продукт (для IfcPresentationLayerAssignment). */
function buildPresentationLayerMaps(api: WEBIFC.IfcAPI, modelID: number) {
  const repToProduct = new Map<number, number>();
  const defShapeToProduct = new Map<number, number>();
  const productIds = new Set<number>();
  const products = api.GetLineIDsWithType(modelID, WEBIFC.IFCPRODUCT, true);
  for (let i = 0; i < products.size(); i++) {
    const pid = products.get(i);
    productIds.add(pid);
    const line = api.GetLine(modelID, pid, true, false) as {
      Representation?: unknown;
    };
    const defShapeId = extractIfcRefId(line.Representation);
    if (defShapeId == null) continue;
    defShapeToProduct.set(defShapeId, pid);
    const defShape = api.GetLine(modelID, defShapeId, true, false) as {
      Representations?: unknown[];
    };
    const reps = defShape.Representations;
    if (!Array.isArray(reps)) continue;
    for (const r of reps) {
      const rid = extractIfcRefId(r);
      if (rid != null) repToProduct.set(rid, pid);
    }
  }
  const itemToShapeRep = new Map<number, number>();
  const shapeReps = api.GetLineIDsWithType(modelID, WEBIFC.IFCSHAPEREPRESENTATION, true);
  for (let i = 0; i < shapeReps.size(); i++) {
    const sid = shapeReps.get(i);
    const line = api.GetLine(modelID, sid, true, false) as { Items?: unknown[] };
    const items = line.Items;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const iid = extractIfcRefId(it);
      if (iid != null) itemToShapeRep.set(iid, sid);
    }
  }
  return { repToProduct, defShapeToProduct, productIds, itemToShapeRep };
}

/** Базис «экранного» вида для шагов влево/вправо/вверх/вниз вокруг цели орбиты. */
function getViewBasisFromOrbit(pos: THREE.Vector3, target: THREE.Vector3) {
  const forward = target.clone().sub(pos).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
  if (right.lengthSq() < 1e-8) {
    right.set(1, 0, 0);
  }
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  return { forward, right, up };
}

function resolveAssignedToProductId(
  api: WEBIFC.IfcAPI,
  modelID: number,
  assignedId: number,
  maps: ReturnType<typeof buildPresentationLayerMaps>
): number | null {
  const { repToProduct, defShapeToProduct, productIds, itemToShapeRep } = maps;
  if (productIds.has(assignedId)) return assignedId;
  const fromRep = repToProduct.get(assignedId);
  if (fromRep != null) return fromRep;
  const fromDef = defShapeToProduct.get(assignedId);
  if (fromDef != null) return fromDef;
  const shapeRep = itemToShapeRep.get(assignedId);
  if (shapeRep != null) {
    const p = repToProduct.get(shapeRep);
    if (p != null) return p;
  }
  const line = api.GetLine(modelID, assignedId, true, false) as {
    type?: number;
    PartOfProductDefinitionShape?: unknown;
  };
  if (line.type === WEBIFC.IFCSHAPEASPECT) {
    const dsid = extractIfcRefId(line.PartOfProductDefinitionShape);
    if (dsid != null) {
      const p = defShapeToProduct.get(dsid);
      if (p != null) return p;
    }
  }
  return null;
}

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
}

type LayerIdsByName = Record<string, number[]>;
type LayerVisibilityByName = Record<string, boolean>;

/** Первый слой IFC, в котором встречается product id (для клика по модели → слой). */
function getLayerNameForProductId(
  layers: LayerIdsByName,
  productId: number
): string | null {
  for (const [name, ids] of Object.entries(layers)) {
    if (ids.includes(productId)) return name;
  }
  return null;
}

export default function BIMViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<OBC.SimpleWorld<
    OBC.SimpleScene,
    OBC.SimpleCamera,
    OBC.SimpleRenderer
  > | null>(null);
  const fragmentsRef = useRef<OBC.FragmentsManager | null>(null);
  const ifcLoaderRef = useRef<OBC.IfcLoader | null>(null);
  const clipperRef = useRef<OBC.Clipper | null>(null);
  const measurerRef = useRef<OBCF.LengthMeasurement | null>(null);
  const highlighterRef = useRef<OBCF.Highlighter | null>(null);
  const activeToolRef = useRef<"none" | "measure" | "clip">("none");
  const selectStyleNameRef = useRef<string>("select");
  const fragmentsInitializedRef = useRef(false);
  /** Разрешается после успешного fragments.init(); await перед load IFC и перед любым core.update. */
  const fragmentsInitPromiseRef = useRef<Promise<void> | null>(null);
  const webIfcModelIdRef = useRef<number | null>(null);
  const lastFragmentsModelRef = useRef<any>(null);
  const rebuildTreeRef = useRef<(() => Promise<void>) | null>(null);
  const layerIdsByNameRef = useRef<LayerIdsByName>({});
  const handleLayerRowSelectRef = useRef<
    (layerName: string, additive?: boolean) => Promise<void>
  >(async () => {});
  /** Последний выбранный express id (для Tab → выделить слой). */
  const lastPickedExpressIdRef = useRef<number | null>(null);
  const layerHoverSeqRef = useRef(0);
  const worldGridRef = useRef<OBC.SimpleGrid | null>(null);
  /** ЛКМ: старт координат; после drag (орбита камеры) click не обрабатываем как выбор. */
  const orbitPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const orbitDragActiveRef = useRef(false);
  const skipNextCanvasClickRef = useRef(false);
  /** Снять window-listeners орбиты при unmount / смене жеста. */
  const orbitWindowListenersCleanupRef = useRef<(() => void) | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [selectedProperties, setSelectedProperties] = useState<PropertySet[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [activeTool, setActiveTool] = useState<"none" | "measure" | "clip">("none");
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(false);
  const [modelName, setModelName] = useState<string>("");
  const [treePeekHover, setTreePeekHover] = useState(false);
  const [propertiesPeekHover, setPropertiesPeekHover] = useState(false);
  const [layerIdsByName, setLayerIdsByName] = useState<LayerIdsByName>({});
  const [layerVisibilityByName, setLayerVisibilityByName] = useState<LayerVisibilityByName>({});
  /** Выбранные слои IFC (множественный выбор: Shift+клик по слою). */
  const [selectedLayerNames, setSelectedLayerNames] = useState<string[]>([]);
  /** Подпись IFC-слоя под курсором (строка состояния). */
  const [hoverLayerLabel, setHoverLayerLabel] = useState<string | null>(null);
  /** Текст про текущее выделение (слои / счётчик элементов). */
  const [selectionCaption, setSelectionCaption] = useState("");
  /** Сброс пересчёта подписи выбора после highlight вне React state. */
  const [selectionSyncTick, setSelectionSyncTick] = useState(0);
  /** Скрытие всего кроме выделения (Highlighter); снимается той же кнопкой или сбросом выделения. */
  const [isolateSelectionActive, setIsolateSelectionActive] = useState(false);

  useEffect(() => {
    if (showTree) setTreePeekHover(false);
  }, [showTree]);

  useEffect(() => {
    if (showProperties) setPropertiesPeekHover(false);
  }, [showProperties]);

  // keep ref in sync for use inside event listeners
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    layerIdsByNameRef.current = layerIdsByName;
  }, [layerIdsByName]);

  useEffect(() => {
    const h = highlighterRef.current;
    const sn = selectStyleNameRef.current;
    if (!modelLoaded || !h) {
      setSelectionCaption("");
      return;
    }
    if (selectedLayerNames.length > 1) {
      setSelectionCaption(`Выбрано слоёв: ${selectedLayerNames.length}`);
      return;
    }
    if (selectedLayerNames.length === 1) {
      setSelectionCaption(`Слой: ${selectedLayerNames[0]}`);
      return;
    }
    const sel = sn ? h.selection[sn] : undefined;
    if (!sel) {
      setSelectionCaption("");
      return;
    }
    let n = 0;
    for (const s of Object.values(sel)) n += s.size;
    if (n > 1) setSelectionCaption(`Выбрано элементов: ${n}`);
    else if (n === 1) setSelectionCaption("1 элемент");
    else setSelectionCaption("");
  }, [selectedLayerNames, selectionSyncTick, modelLoaded]);

  const isolateSelectionCount = useMemo(() => {
    const h = highlighterRef.current;
    if (!h || !modelLoaded) return 0;
    const sn = selectStyleNameRef.current;
    const sel = sn ? (h.selection[sn] as Record<string, Set<number>> | undefined) : undefined;
    if (!sel) return 0;
    let n = 0;
    for (const s of Object.values(sel)) n += s.size;
    return n;
  }, [selectionSyncTick, modelLoaded]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Force single-thread web-ifc to avoid mt worker resolution issues in dev bundles.
    const ifcProto = WEBIFC.IfcAPI.prototype as {
      Init: WEBIFC.IfcAPI["Init"];
      __singleThreadPatched?: boolean;
    };
    if (!ifcProto.__singleThreadPatched) {
      const originalInit = ifcProto.Init;
      ifcProto.Init = function patchedInit(
        customLocateFileHandler?: WEBIFC.LocateFileHandlerFn,
        _forceSingleThread?: boolean
      ) {
        return originalInit.call(this, customLocateFileHandler, true);
      };
      ifcProto.__singleThreadPatched = true;
    }

    // Workaround for web-ifc pthread worker URL resolution in Next.js dev.
    (globalThis as { Module?: Record<string, unknown> }).Module = {
      ...(globalThis as { Module?: Record<string, unknown> }).Module,
      mainScriptUrlOrBlob: "https://unpkg.com/web-ifc@0.0.74/web-ifc-api.js",
    };

    const components = new OBC.Components();
    componentsRef.current = components;

    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<
      OBC.SimpleScene,
      OBC.SimpleCamera,
      OBC.SimpleRenderer
    >();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, containerRef.current);
    world.camera = new OBC.SimpleCamera(components);
    worldRef.current = world;

    components.init();
    world.camera.controls.setLookAt(12, 6, 8, 0, 0, -10);
    // Белый фон вьюпорта (дефолт SimpleScene — тёмно-серый 0x202022)
    world.scene.setup({
      backgroundColor: new THREE.Color(0xffffff),
    });
    // setup() добавляет свои ambient/directional — ниже ставим свои значения без дубля
    world.scene.deleteAllLights();

    const gl = world.renderer.three;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = SCENE_TONE_EXPOSURE;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const scene3 = world.scene.three;
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
    scene3.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xeef3ff, 0xe5e0d8, 0.42);
    hemiLight.position.set(0, 1, 0);
    scene3.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.18);
    keyLight.position.set(18, 32, 14);
    scene3.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xc8d4ea, 0.4);
    fillLight.position.set(-16, 12, -20);
    scene3.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.22);
    rimLight.position.set(-6, 8, 28);
    scene3.add(rimLight);

    const grids = components.get(OBC.Grids);
    const worldGrid = grids.create(world);
    worldGridRef.current = worldGrid;
    worldGrid.fade = true;

    const fragments = components.get(OBC.FragmentsManager);
    fragmentsRef.current = fragments;
    fragmentsInitializedRef.current = false;
    fragmentsInitPromiseRef.current = Promise.resolve(
      fragments.init("/thatopen-worker.mjs") as unknown as Promise<void>
    )
      .then(() => {
        fragmentsInitializedRef.current = true;
      })
      .catch((error: unknown) => {
        console.error("Failed to initialize fragments manager:", error);
        fragmentsInitializedRef.current = false;
        throw error;
      });

    const ifcLoader = components.get(OBC.IfcLoader);
    ifcLoaderRef.current = ifcLoader;

    // Raycaster (required for clipper + hover слоя)
    const casters = components.get(OBC.Raycasters);
    casters.get(world);

    // Highlighter
    const highlighter = components.get(OBCF.Highlighter);
    highlighter.setup({
      world,
      selectName: "select",
      autoHighlightOnClick: false,
      selectMaterialDefinition: {
        color: new THREE.Color(0xe11d48),
        renderedFaces: RenderedFaces.TWO,
        opacity: 1,
        transparent: false,
      },
    });
    // Предпросмотр слоя: заметный тинт, «розовый прикол» (бледно-розовый / rose).
    highlighter.styles.set(LAYER_HOVER_STYLE, {
      color: new THREE.Color(0xf472b6),
      renderedFaces: RenderedFaces.TWO,
      opacity: 0.52,
      transparent: true,
      preserveOriginalMaterial: false,
      depthWrite: false,
    });
    selectStyleNameRef.current = highlighter.config.selectName;
    highlighterRef.current = highlighter;

    // Clipper
    const clipper = components.get(OBC.Clipper);
    clipper.enabled = false;
    clipperRef.current = clipper;

    // Length measurement
    const measurer = components.get(OBCF.LengthMeasurement);
    measurer.world = world;
    measurer.enabled = false;
    measurer.snapDistance = 1;
    measurer.units = "m";
    measurer.rounding = 2;
    measurerRef.current = measurer;

    // Орбита: движение зажатой ЛКМ (не только down→up), иначе click после отпускания снова сбрасывает выбор.
    const ORBIT_DRAG_PX_SQ = 5 * 5;

    const onOrbitPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      orbitWindowListenersCleanupRef.current?.();
      orbitPointerDownRef.current = { x: e.clientX, y: e.clientY };
      orbitDragActiveRef.current = false;

      const onWindowMove = (ev: PointerEvent) => {
        if ((ev.buttons & 1) === 0) return;
        const start = orbitPointerDownRef.current;
        if (!start) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (dx * dx + dy * dy > ORBIT_DRAG_PX_SQ) {
          orbitDragActiveRef.current = true;
        }
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (ev.button !== 0) return;
        window.removeEventListener("pointermove", onWindowMove, true);
        window.removeEventListener("pointerup", onWindowUp, true);
        window.removeEventListener("pointercancel", onWindowUp, true);
        orbitWindowListenersCleanupRef.current = null;
        if (orbitDragActiveRef.current) {
          skipNextCanvasClickRef.current = true;
        }
        orbitDragActiveRef.current = false;
        orbitPointerDownRef.current = null;
      };

      window.addEventListener("pointermove", onWindowMove, true);
      window.addEventListener("pointerup", onWindowUp, true);
      window.addEventListener("pointercancel", onWindowUp, true);
      orbitWindowListenersCleanupRef.current = () => {
        window.removeEventListener("pointermove", onWindowMove, true);
        window.removeEventListener("pointerup", onWindowUp, true);
        window.removeEventListener("pointercancel", onWindowUp, true);
      };
    };

    const handleClick = async (e: MouseEvent) => {
      if (skipNextCanvasClickRef.current) {
        skipNextCanvasClickRef.current = false;
        return;
      }
      if (!fragmentsInitializedRef.current) return;
      const tool = activeToolRef.current;
      if (tool === "clip") {
        clipper.create(world);
        return;
      }
      if (tool === "measure") {
        return;
      }
      try {
        await highlighter.clear(LAYER_HOVER_STYLE);
        const selectName = selectStyleNameRef.current;
        const canvas = world.renderer?.three.domElement;
        const camera = world.camera?.three;
        if (!canvas || !camera) return;
        // Raycast с явными clientX/clientY: SimpleRaycaster.castRay для фрагментов берёт mouse из
        // внутреннего трекера (последнее событие на canvas) и может расходиться с переданным NDC — hover ломался.
        const hit = await fragments.raycast({
          camera,
          dom: canvas,
          mouse: new THREE.Vector2(e.clientX, e.clientY),
        });
        if (!hit?.localId) {
          // Клик в пустоту не снимает выделение — только кнопка «Сбросить выделение» или новый выбор.
          await fragments.core.update(true);
          return;
        }

        const localId = hit.localId;
        lastPickedExpressIdRef.current = localId;
        const modelId = hit.fragments.modelId;
        const singleMap: OBC.ModelIdMap = { [modelId]: new Set([localId]) };

        const layers = layerIdsByNameRef.current;
        const layerName = getLayerNameForProductId(layers, localId);

        // Ctrl — один элемент (замена). Ctrl+Shift — тот же один элемент, но добавить к уже выбранным.
        if (e.ctrlKey && e.shiftKey) {
          setSelectedLayerNames([]);
          setShowProperties(true);
          await highlighter.highlightByID(selectName, singleMap, false, false, null, false);
          await fragments.core.update(true);
          const sel = highlighter.selection[selectName];
          if (sel && Object.keys(sel).length > 0) {
            await loadProperties(components, sel as Record<string, Set<number>>);
          }
          return;
        }

        if (e.ctrlKey) {
          setSelectedLayerNames([]);
          setShowProperties(true);
          await highlighter.highlightByID(selectName, singleMap, true, false, null, false);
          await fragments.core.update(true);
          await loadProperties(components, singleMap);
          return;
        }

        if (layerName && (layers[layerName]?.length ?? 0) > 0) {
          const map: OBC.ModelIdMap = {
            [modelId]: new Set(layers[layerName]),
          };
          const additive = e.shiftKey;
          await highlighter.highlightByID(selectName, map, !additive, false, null, false);
          await fragments.core.update(true);
          if (additive) {
            setSelectedLayerNames((prev) =>
              prev.includes(layerName) ? prev : [...prev, layerName]
            );
          } else {
            setSelectedLayerNames([layerName]);
          }
          setSelectedProperties([]);
          setShowProperties(false);
          setShowTree(true);
          return;
        }

        setSelectedLayerNames([]);
        setShowProperties(true);
        await highlighter.highlightByID(selectName, singleMap, true, false, null, false);
        await fragments.core.update(true);
        await loadProperties(components, singleMap);
      } catch (error) {
        console.warn("Selection interaction failed:", error);
        setSelectedProperties([]);
      } finally {
        setSelectionSyncTick((t) => t + 1);
      }
    };

    const handleDblClick = () => {
      if (skipNextCanvasClickRef.current) {
        skipNextCanvasClickRef.current = false;
        return;
      }
      if (activeToolRef.current === "measure") {
        measurer.create();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Tab" && activeToolRef.current === "none") {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("input, textarea, [contenteditable=true]")) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const id = lastPickedExpressIdRef.current;
        if (id == null) return;
        const name = getLayerNameForProductId(layerIdsByNameRef.current, id);
        if (name == null) return;
        e.preventDefault();
        setShowTree(true);
        void handleLayerRowSelectRef.current(name, false);
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        const tool = activeToolRef.current;
        if (tool === "measure") measurer.delete();
        if (tool === "clip") clipper.delete(world);
      }
    };

    containerRef.current.addEventListener("pointerdown", onOrbitPointerDown, true);
    containerRef.current.addEventListener("click", handleClick);
    containerRef.current.addEventListener("dblclick", handleDblClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      const fragmentsWasReady = fragmentsInitializedRef.current;
      fragmentsInitializedRef.current = false;
      orbitWindowListenersCleanupRef.current?.();
      orbitWindowListenersCleanupRef.current = null;
      containerRef.current?.removeEventListener("pointerdown", onOrbitPointerDown, true);
      containerRef.current?.removeEventListener("click", handleClick);
      containerRef.current?.removeEventListener("dblclick", handleDblClick);
      window.removeEventListener("keydown", handleKeyDown);
      if (fragmentsWasReady) {
        components.dispose();
        return;
      }
      // If fragments were never initialized, full components.dispose() may throw.
      world.renderer?.dispose();
      world.scene?.dispose();
      if (world.camera?.isDisposeable?.()) {
        world.camera.dispose();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync tool state to components
  useEffect(() => {
    const measurer = measurerRef.current;
    const clipper = clipperRef.current;
    if (!measurer || !clipper) return;
    measurer.enabled = activeTool === "measure";
    clipper.enabled = activeTool === "clip";
  }, [activeTool]);

  const loadProperties = async (
    components: OBC.Components,
    selection: Record<string, Set<number>>
  ) => {
    const fragments = fragmentsRef.current;
    if (!fragments) return;

    const propertySets: PropertySet[] = [];

    for (const [modelID, ids] of Object.entries(selection)) {
      const model = fragments.list.get(modelID);
      if (!model) continue;

      for (const expressID of ids) {
        try {
          const items = (await model.getItemsData?.([expressID], FRAGMENTS_ITEM_DATA_PSETS)) as
            | Array<Record<string, unknown>>
            | undefined;
          const props = items?.[0];
          if (!props) continue;

          const flat = ifcCollectFlatAttributes(props);
          if (flat.length > 0) {
            propertySets.push({ name: "Атрибуты элемента", properties: flat });
          }
          const psets = ifcCollectDefinedPropertySets(props);
          propertySets.push(...psets);
        } catch (_) {
          // element may not have properties
        }
        break;
      }
      break;
    }

    setSelectedProperties(propertySets);
  };

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !ifcLoaderRef.current || !fragmentsRef.current || !worldRef.current)
        return;

      setIsLoading(true);
      setModelName(file.name);

      try {
        const initP = fragmentsInitPromiseRef.current;
        if (initP) await initP;
      } catch {
        console.error("FragmentsManager не инициализирован, загрузка IFC отменена.");
        setIsLoading(false);
        e.target.value = "";
        return;
      }

      try {
        await ifcLoaderRef.current.setup({
          autoSetWasm: false,
          wasm: {
            path: "https://unpkg.com/web-ifc@0.0.74/",
            absolute: true,
          },
        });

        worldRef.current.camera.controls.addEventListener("update", () => {
          if (!fragmentsInitializedRef.current) return;
          void fragmentsRef.current?.core.update();
        });

        fragmentsRef.current.list.onItemSet.add(async ({ value: model }: { value: any }) => {
          model.useCamera(worldRef.current!.camera.three);
          worldRef.current!.scene.three.add(model.object);

          // Геометрия фрагментов появляется после core.update — иначе bbox пустой/неверный и сдвиг не работает.
          await fragmentsRef.current!.core.update(true);
          model.object.updateMatrixWorld(true);

          const alignBbox = new THREE.Box3().setFromObject(model.object);
          if (!alignBbox.isEmpty()) {
            const yOffset = -alignBbox.min.y;
            if (Number.isFinite(yOffset) && Math.abs(yOffset) > 1e-6) {
              model.object.position.y += yOffset;
              model.object.updateMatrixWorld(true);
              await fragmentsRef.current!.core.update(true);
            }
          }

          // Fit camera to model
          const bbox = new THREE.Box3().setFromObject(model.object);
          const center = bbox.getCenter(new THREE.Vector3());
          const size = bbox.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          worldRef.current!.camera.controls.setLookAt(
            center.x + maxDim,
            center.y + maxDim * 0.8,
            center.z + maxDim,
            center.x,
            center.y,
            center.z,
            true
          );

          setModelLoaded(true);
          setIsLoading(false);
          lastFragmentsModelRef.current = model;
          await rebuildTreeRef.current?.();
        });

        fragmentsRef.current.core.models.materials.list.onItemSet.add(
          ({ value: material }: { value: any }) => {
            if (!("isLodMaterial" in material && material.isLodMaterial)) {
              material.polygonOffset = true;
              material.polygonOffsetUnits = 1;
              material.polygonOffsetFactor = Math.random();
            }
          }
        );

        const buffer = await file.arrayBuffer();
        const typedArray = new Uint8Array(buffer);

        const prevMid = webIfcModelIdRef.current;
        if (prevMid != null && ifcLoaderRef.current.webIfc) {
          try {
            ifcLoaderRef.current.webIfc.CloseModel(prevMid);
          } catch {
            /* ignore */
          }
          webIfcModelIdRef.current = null;
        }

        const webIfcModelId = await ifcLoaderRef.current.readIfcFile(typedArray);
        webIfcModelIdRef.current = webIfcModelId;

        await ifcLoaderRef.current.load(
          typedArray,
          true,
          file.name.replace(".ifc", "")
        );
      } catch (err) {
        console.error("Error loading IFC:", err);
        setIsLoading(false);
      }

      e.target.value = "";
    },
    []
  );

  const buildLayersTree = async (
    _model: any,
    api: WEBIFC.IfcAPI,
    modelID: number
  ) => {
    try {
      const maps = buildPresentationLayerMaps(api, modelID);
      const layerIds = webIfcVectorToIds(
        api.GetLineIDsWithType(modelID, WEBIFC.IFCPRESENTATIONLAYERASSIGNMENT, true)
      );
      const byLayerName = new Map<string, Set<number>>();
      for (const lid of layerIds) {
        const line = api.GetLine(modelID, lid, true, false) as {
          Name?: unknown;
          AssignedItems?: unknown[];
        };
        const layerName = readIfcText(line.Name) || `Слой #${lid}`;
        const items = line.AssignedItems;
        if (!Array.isArray(items)) continue;
        let pidSet = byLayerName.get(layerName);
        if (!pidSet) {
          pidSet = new Set<number>();
          byLayerName.set(layerName, pidSet);
        }
        for (const ref of items) {
          const aid = extractIfcRefId(ref);
          if (aid == null) continue;
          const pid = resolveAssignedToProductId(api, modelID, aid, maps);
          if (pid != null) pidSet.add(pid);
        }
      }
      let syntheticId = -1;
      const sortedLayers = [...byLayerName.entries()].sort((a, b) =>
        a[0].localeCompare(b[0], "ru")
      );
      const nextLayerIdsByName: LayerIdsByName = {};
      for (const [layerName, pids] of sortedLayers) {
        nextLayerIdsByName[layerName] = [...pids];
      }
      // Слои — плоский список (без элементов в дереве); id по-прежнему в layerIdsByName
      const roots: TreeNode[] = sortedLayers.map(([layerName]) => ({
        expressID: syntheticId--,
        name: layerName,
        type: "IfcPresentationLayerAssignment",
        children: [],
      }));
      if (roots.length === 0) {
        setLayerIdsByName({});
        setLayerVisibilityByName({});
        setSelectedLayerNames([]);
        setTreeData([
          {
            expressID: -1,
            name: "Нет слоёв (IfcPresentationLayerAssignment) в файле",
            type: "Info",
            children: [],
          },
        ]);
        return;
      }
      setLayerIdsByName(nextLayerIdsByName);
      setLayerVisibilityByName((prev) => {
        const next: LayerVisibilityByName = {};
        for (const layerName of Object.keys(nextLayerIdsByName)) {
          next[layerName] = prev[layerName] ?? true;
        }
        return next;
      });
      setSelectedLayerNames((prev) =>
        prev.filter((name) => name in nextLayerIdsByName)
      );
      setTreeData(roots);
    } catch (error) {
      console.warn("Failed to build layers tree from IFC:", error);
      setLayerIdsByName({});
      setLayerVisibilityByName({});
      setSelectedLayerNames([]);
      setTreeData([
        {
          expressID: -1,
          name: "Не удалось построить дерево слоёв",
          type: "Error",
          children: [],
        },
      ]);
    }
  };

  rebuildTreeRef.current = async () => {
    const model = lastFragmentsModelRef.current;
    if (!model) return;
    const api = ifcLoaderRef.current?.webIfc;
    const mid = webIfcModelIdRef.current;
    if (api != null && mid != null) {
      await buildLayersTree(model, api, mid);
    } else {
      setSelectedLayerNames([]);
      setTreeData([
        {
          expressID: -1,
          name: "Слои IFC недоступны: не удалось открыть модель в web-ifc",
          type: "Info",
          children: [],
        },
      ]);
    }
  };

  useEffect(() => {
    if (!modelLoaded) return;
    void rebuildTreeRef.current?.();
  }, [modelLoaded]);

  const setItemsVisibility = useCallback(async (ids: number[], visible: boolean) => {
    const model = lastFragmentsModelRef.current;
    const fragments = fragmentsRef.current;
    if (!model || !fragments || ids.length === 0 || !fragmentsInitializedRef.current) return;
    await model.setVisible(ids, visible);
    await fragments.core.update(true);
    try {
      await highlighterRef.current?.clear(LAYER_HOVER_STYLE);
      await fragments.core.update(true);
    } catch {
      /* ignore */
    }
  }, []);

  const handleToggleAllLayersVisibility = useCallback(async () => {
    const names = Object.keys(layerIdsByName);
    if (names.length === 0) return;
    const allVisible = names.every((name) => layerVisibilityByName[name] !== false);
    const nextVisible = !allVisible;
    const allIds = Array.from(new Set(names.flatMap((name) => layerIdsByName[name] || [])));
    await setItemsVisibility(allIds, nextVisible);
    setLayerVisibilityByName((prev) => {
      const next = { ...prev };
      for (const name of names) next[name] = nextVisible;
      return next;
    });
  }, [layerIdsByName, layerVisibilityByName, setItemsVisibility]);

  const handleToggleLayerVisibility = useCallback(
    async (layerName: string) => {
      const ids = layerIdsByName[layerName] || [];
      if (ids.length === 0) return;
      const currentVisible = layerVisibilityByName[layerName] !== false;
      const nextVisible = !currentVisible;
      await setItemsVisibility(ids, nextVisible);
      setLayerVisibilityByName((prev) => ({ ...prev, [layerName]: nextVisible }));
    },
    [layerIdsByName, layerVisibilityByName, setItemsVisibility]
  );

  const allLayersVisible =
    Object.keys(layerIdsByName).length > 0 &&
    Object.keys(layerIdsByName).every((name) => layerVisibilityByName[name] !== false);

  // Сетка основания (ground): при частично скрытых слоях убираем, чтобы не было «пола» на пустом фоне.
  useEffect(() => {
    const grid = worldGridRef.current;
    if (!grid) return;
    const names = Object.keys(layerIdsByName);
    if (names.length === 0) {
      grid.visible = true;
      return;
    }
    const anyHidden = names.some((name) => layerVisibilityByName[name] === false);
    grid.visible = !anyHidden;
  }, [layerIdsByName, layerVisibilityByName]);

  const handleLayerRowSelect = useCallback(
    async (layerName: string, additive = false) => {
      const model = lastFragmentsModelRef.current;
      const highlighter = highlighterRef.current;
      const fragments = fragmentsRef.current;
      if (!model || !highlighter || !fragments) return;
      const ids = layerIdsByName[layerName];
      if (!ids?.length) return;
      setSelectedProperties([]);
      setShowProperties(false);
      const selectName = selectStyleNameRef.current;
      const map: OBC.ModelIdMap = { [model.modelId]: new Set(ids) };
      try {
        await highlighter.highlightByID(selectName, map, !additive, false, null, false);
        await fragments.core.update(true);
        if (additive) {
          setSelectedLayerNames((prev) =>
            prev.includes(layerName) ? prev : [...prev, layerName]
          );
        } else {
          setSelectedLayerNames([layerName]);
        }
      } catch (e) {
        console.warn("Подсветка слоя не удалась:", e);
      } finally {
        setSelectionSyncTick((t) => t + 1);
      }
    },
    [layerIdsByName]
  );

  useEffect(() => {
    handleLayerRowSelectRef.current = handleLayerRowSelect;
  }, [handleLayerRowSelect]);

  // Предпросмотр под курсором: без Ctrl — весь слой IFC; с Ctrl — один элемент (как выбор с Ctrl).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !modelLoaded) return;

    const clearHoverHighlight = async () => {
      const h = highlighterRef.current;
      const fr = fragmentsRef.current;
      if (!h || !fr || !fragmentsInitializedRef.current) return;
      try {
        await h.clear(LAYER_HOVER_STYLE);
        await fr.core.update(true);
      } catch {
        /* ignore */
      }
    };

    let raf = 0;
    const runHover = async (clientX: number, clientY: number, ctrlKey: boolean) => {
      if (activeToolRef.current !== "none") {
        setHoverLayerLabel(null);
        await clearHoverHighlight();
        return;
      }
      if (!fragmentsInitializedRef.current) return;

      const seq = ++layerHoverSeqRef.current;
      const canvas = worldRef.current?.renderer?.three.domElement;
      const camera = worldRef.current?.camera?.three;
      const model = lastFragmentsModelRef.current;
      const h = highlighterRef.current;
      const fr = fragmentsRef.current;
      if (!canvas || !camera || !model || !h || !fr) return;

      const hit = await fr.raycast({
        camera,
        dom: canvas,
        mouse: new THREE.Vector2(clientX, clientY),
      });
      if (seq !== layerHoverSeqRef.current) return;

      if (
        !hit ||
        typeof hit !== "object" ||
        !("localId" in hit) ||
        typeof (hit as { localId: unknown }).localId !== "number"
      ) {
        setHoverLayerLabel(null);
        await clearHoverHighlight();
        return;
      }

      const localId = (hit as { localId: number }).localId;
      const layers = layerIdsByNameRef.current;
      const ifcLayerName = getLayerNameForProductId(layers, localId);
      setHoverLayerLabel(ifcLayerName ?? "IFC-слой не назначен");

      // Один элемент под курсором только в режиме Ctrl (в т.ч. с Shift — добавление к выбору).
      if (ctrlKey) {
        const map: OBC.ModelIdMap = { [model.modelId]: new Set([localId]) };
        try {
          await h.highlightByID(LAYER_HOVER_STYLE, map, true, false, null, false);
          if (seq !== layerHoverSeqRef.current) return;
          await fr.core.update(true);
        } catch {
          /* ignore */
        }
        return;
      }

      const layerName = ifcLayerName;
      if (!layerName || !(layers[layerName]?.length)) {
        await clearHoverHighlight();
        return;
      }

      const ids = layers[layerName];
      const map: OBC.ModelIdMap = { [model.modelId]: new Set(ids) };
      try {
        await h.highlightByID(LAYER_HOVER_STYLE, map, true, false, null, false);
        if (seq !== layerHoverSeqRef.current) return;
        await fr.core.update(true);
      } catch {
        /* ignore */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void runHover(e.clientX, e.clientY, e.ctrlKey);
      });
    };

    const onLeave = () => {
      cancelAnimationFrame(raf);
      layerHoverSeqRef.current += 1;
      setHoverLayerLabel(null);
      void clearHoverHighlight();
    };

    const onPointerDown = () => {
      layerHoverSeqRef.current += 1;
      setHoverLayerLabel(null);
      void clearHoverHighlight();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onPointerDown, true);
      setHoverLayerLabel(null);
      void clearHoverHighlight();
    };
  }, [modelLoaded, activeTool]);

  const handleFitAll = useCallback(() => {
    if (!worldRef.current || !fragmentsRef.current) return;
    const models = Array.from(fragmentsRef.current.list.values());
    if (models.length === 0) return;
    const bbox = new THREE.Box3();
    models.forEach((m: any) => bbox.expandByObject(m.object));
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    worldRef.current.camera.controls.setLookAt(
      center.x + maxDim,
      center.y + maxDim * 0.8,
      center.z + maxDim,
      center.x,
      center.y,
      center.z,
      true
    );
  }, []);

  const restoreVisibilityAfterIsolation = useCallback(async () => {
    const model = lastFragmentsModelRef.current;
    const fragments = fragmentsRef.current;
    if (!model || !fragments) return;
    try {
      if (typeof model.resetVisible === "function") {
        model.resetVisible();
      } else {
        const ids = typeof model.getLocalIds === "function" ? model.getLocalIds() : [];
        if (ids.length) await model.setVisible(ids, true);
      }
      await fragments.core.update(true);
      const names = Object.keys(layerIdsByName);
      for (const name of names) {
        const ids = layerIdsByName[name] ?? [];
        if (ids.length === 0) continue;
        const vis = layerVisibilityByName[name] !== false;
        await model.setVisible(ids, vis);
      }
      await fragments.core.update(true);
      await highlighterRef.current?.clear(LAYER_HOVER_STYLE);
      await fragments.core.update(true);
    } catch {
      /* ignore */
    }
  }, [layerIdsByName, layerVisibilityByName]);

  const handleToggleIsolateSelection = useCallback(async () => {
    const model = lastFragmentsModelRef.current;
    const fragments = fragmentsRef.current;
    const highlighter = highlighterRef.current;
    const world = worldRef.current;
    if (!model || !fragments || !highlighter || !world) return;

    if (isolateSelectionActive) {
      await restoreVisibilityAfterIsolation();
      setIsolateSelectionActive(false);
      handleFitAll();
      return;
    }

    const sn = selectStyleNameRef.current;
    const sel = highlighter.selection[sn] as Record<string, Set<number>> | undefined;
    if (!sel) return;
    let total = 0;
    for (const s of Object.values(sel)) total += s.size;
    if (total === 0) return;

    let allIds: number[] = [];
    try {
      const raw =
        typeof model.getLocalIds === "function" ? model.getLocalIds() : undefined;
      let resolved: unknown = raw;
      if (raw != null && typeof (raw as Promise<unknown>).then === "function") {
        resolved = await (raw as Promise<unknown>);
      }
      if (Array.isArray(resolved)) {
        allIds = resolved as number[];
      } else if (resolved != null && typeof (resolved as Iterable<number>)[Symbol.iterator] === "function") {
        allIds = Array.from(resolved as Iterable<number>);
      }
    } catch {
      /* ignore */
    }
    if (allIds.length === 0) {
      allIds = Array.from(new Set(Object.values(layerIdsByName).flat()));
    }
    const selectedSet = new Set<number>();
    for (const set of Object.values(sel)) {
      for (const id of set) selectedSet.add(id);
    }
    const toHide = allIds.filter((id) => !selectedSet.has(id));
    if (toHide.length) await model.setVisible(toHide, false);
    await model.setVisible([...selectedSet], true);
    await fragments.core.update(true);

    const modelIdMap: OBC.ModelIdMap = {};
    for (const [mid, ids] of Object.entries(sel)) {
      modelIdMap[mid] = new Set(ids);
    }
    try {
      const boxes = await fragments.getBBoxes(modelIdMap);
      const union = new THREE.Box3();
      for (const b of boxes) {
        if (b && !b.isEmpty()) union.union(b);
      }
      if (!union.isEmpty()) {
        const center = union.getCenter(new THREE.Vector3());
        const size = union.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
        await world.camera.controls.setLookAt(
          center.x + maxDim,
          center.y + maxDim * 0.8,
          center.z + maxDim,
          center.x,
          center.y,
          center.z,
          true
        );
      }
    } catch {
      /* ignore */
    }
    setIsolateSelectionActive(true);
  }, [
    isolateSelectionActive,
    restoreVisibilityAfterIsolation,
    layerIdsByName,
    handleFitAll,
  ]);

  /** Стандартные виды относительно текущей цели орбиты (Y вверх, «спереди» = +Z). */
  const handleViewCubeFace = useCallback(async (dir: ViewCubeDirection) => {
    const world = worldRef.current;
    const controls = world?.camera?.controls;
    if (!controls) return;
    const target = new THREE.Vector3();
    const pos = new THREE.Vector3();
    controls.getTarget(target, true);
    controls.getPosition(pos, true);
    const distance = Math.max(pos.distanceTo(target), 0.5);
    const eye = target.clone();
    switch (dir) {
      case "top":
        eye.add(new THREE.Vector3(0, distance, 0));
        break;
      case "bottom":
        eye.add(new THREE.Vector3(0, -distance, 0));
        break;
      case "front":
        eye.add(new THREE.Vector3(0, 0, distance));
        break;
      case "back":
        eye.add(new THREE.Vector3(0, 0, -distance));
        break;
      case "right":
        eye.add(new THREE.Vector3(distance, 0, 0));
        break;
      case "left":
        eye.add(new THREE.Vector3(-distance, 0, 0));
        break;
    }
    await controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true);
  }, []);

  /** Изометрические виды: камера в октанте вершины (sx,sy,sz), совпадает с геометрией гизмо. */
  const handleViewCubeCorner = useCallback(async (corner: ViewCubeCorner) => {
    const controls = worldRef.current?.camera?.controls;
    if (!controls) return;
    const [sx, sy, sz] = corner;
    const target = new THREE.Vector3();
    const pos = new THREE.Vector3();
    controls.getTarget(target, true);
    controls.getPosition(pos, true);
    const distance = Math.max(pos.distanceTo(target), 0.5);
    const dir = new THREE.Vector3(sx, sy, sz).normalize();
    const eye = target.clone().add(dir.multiplyScalar(distance));
    await controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true);
  }, []);

  /** Вид с ребра: биссектриса двух граней (как Top Front на схеме ViewCube). */
  const handleViewCubeEdge = useCallback(async (edge: ViewCubeEdge) => {
    const controls = worldRef.current?.camera?.controls;
    if (!controls) return;
    const target = new THREE.Vector3();
    const pos = new THREE.Vector3();
    controls.getTarget(target, true);
    controls.getPosition(pos, true);
    const distance = Math.max(pos.distanceTo(target), 0.5);
    const dir = getEdgeViewDirectionUnit(edge).multiplyScalar(distance);
    const eye = target.clone().add(dir);
    await controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true);
  }, []);

  /** Поворот на 90° вокруг «верха» и «вправо» текущего вида (относительно экрана). */
  const handleViewCubeStep = useCallback(async (step: ViewCubeStep) => {
    const controls = worldRef.current?.camera?.controls;
    if (!controls) return;
    const target = new THREE.Vector3();
    const pos = new THREE.Vector3();
    controls.getTarget(target, true);
    controls.getPosition(pos, true);
    const offset = pos.clone().sub(target);
    const { right, up } = getViewBasisFromOrbit(pos, target);
    const quarter = Math.PI / 2;
    switch (step) {
      case "right":
        offset.applyAxisAngle(up, quarter);
        break;
      case "left":
        offset.applyAxisAngle(up, -quarter);
        break;
      case "up":
        offset.applyAxisAngle(right, quarter);
        break;
      case "down":
        offset.applyAxisAngle(right, -quarter);
        break;
    }
    const newPos = target.clone().add(offset);
    await controls.setLookAt(newPos.x, newPos.y, newPos.z, target.x, target.y, target.z, true);
  }, []);

  const handleViewOrbitDrag = useCallback((dx: number, dy: number) => {
    const c = worldRef.current?.camera?.controls;
    if (!c) return;
    void c.rotate(-dx * 0.0035, -dy * 0.0035, false);
  }, []);

  const getViewCubeCamera = useCallback(() => worldRef.current?.camera?.three ?? null, []);

  const getViewCubeOrbitTarget = useCallback(() => {
    const c = worldRef.current?.camera?.controls;
    if (!c) return null;
    const t = new THREE.Vector3();
    c.getTarget(t, true);
    return t;
  }, []);

  const handleDeleteMeasurements = useCallback(() => {
    measurerRef.current?.delete();
  }, []);

  const handleDeleteClips = useCallback(() => {
    clipperRef.current?.deleteAll();
  }, []);

  const handleClearSelection = useCallback(async () => {
    const h = highlighterRef.current;
    const fr = fragmentsRef.current;
    const sn = selectStyleNameRef.current;
    if (!h || !fr || !sn) return;
    try {
      if (isolateSelectionActive) {
        await restoreVisibilityAfterIsolation();
        setIsolateSelectionActive(false);
      }
      await h.clear(LAYER_HOVER_STYLE);
      await h.clear(sn);
      await fr.core.update(true);
    } catch {
      /* ignore */
    }
    setSelectedLayerNames([]);
    setSelectedProperties([]);
    setShowProperties(false);
    lastPickedExpressIdRef.current = null;
    setSelectionSyncTick((t) => t + 1);
  }, [isolateSelectionActive, restoreVisibilityAfterIsolation]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* 3D: на весь экран под UI */}
      <div
        ref={containerRef}
        className="absolute inset-0 z-0"
        style={{
          cursor: activeTool !== "none" ? "crosshair" : "default",
        }}
      />

      {/* Шапка: Toolbar + подсказка «Управление» той же тёмной плашкой, горизонтально под ней */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
          <div className="pointer-events-auto">
            <Toolbar onFileUpload={handleFileUpload} />
          </div>
          {modelLoaded && activeTool === "none" && (
            <div className="hidden w-full md:block">
              <div className="rounded-xl border border-white/12 bg-[#0D0033]/95 px-3 py-1.5 text-[10px] leading-snug text-white/88 shadow-md backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="shrink-0 font-semibold uppercase tracking-wider text-white/45">
                    Управление
                  </span>
                  <span className="text-white/30">—</span>
                  <span>Клик — слой IFC</span>
                  <span className="text-white/35">·</span>
                  <span>Shift+клик — ещё слой</span>
                  <span className="text-white/35">·</span>
                  <span>Ctrl+клик — элемент</span>
                  <span className="text-white/35">·</span>
                  <span>Ctrl+Shift — +элемент</span>
                  <span className="text-white/35">·</span>
                  <span>Tab — слой по клику</span>
                  <span className="text-white/35">·</span>
                  <span>Наведение — слой / Ctrl — элемент</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Структура — слева (анимированное сворачивание с видимой кромкой) */}
      <motion.div
        className={cn(
          "pointer-events-none absolute bottom-4 left-3 top-32 z-30 w-[min(18rem,calc(100vw-1.5rem))] sm:left-4 sm:top-28",
          !showTree && "flex items-center"
        )}
        initial={false}
        animate={{
          x: showTree ? 0 : `calc(-100% + ${PEEK_STRIP_SUM})`,
        }}
        transition={panelSlideTransition}
      >
        <motion.div
          className="pointer-events-auto w-full min-h-0"
          initial={false}
          animate={{
            height: showTree || treePeekHover ? "100%" : PEEK_COLLAPSED_HEIGHT,
          }}
          transition={panelHeightTransition}
          onHoverStart={() => {
            if (!showTree) setTreePeekHover(true);
          }}
          onHoverEnd={() => setTreePeekHover(false)}
        >
          <ModelTree
            treeData={treeData}
            onClose={() => setShowTree((v) => !v)}
            modelLoaded={modelLoaded}
            isOpen={showTree}
            collapsed={!showTree}
            modelName={modelName}
            allLayersVisible={allLayersVisible}
            isLayerVisible={(layerName) => layerVisibilityByName[layerName] !== false}
            onToggleAllLayersVisibility={handleToggleAllLayersVisibility}
            onToggleLayerVisibility={handleToggleLayerVisibility}
            selectedLayerNames={selectedLayerNames}
            onLayerRowSelect={handleLayerRowSelect}
            onFitAll={handleFitAll}
            isolateSelectionActive={isolateSelectionActive}
            isolateSelectionEnabled={
              modelLoaded && (isolateSelectionActive || isolateSelectionCount > 0)
            }
            onToggleIsolateSelection={handleToggleIsolateSelection}
          />
        </motion.div>
      </motion.div>

      {/* Свойства — справа (анимированное сворачивание с видимой кромкой) */}
      <motion.div
        className={cn(
          "pointer-events-none absolute bottom-4 right-3 top-32 z-30 w-[min(18rem,calc(100vw-1.5rem))] sm:right-4 sm:top-28",
          !showProperties && "flex items-center"
        )}
        initial={false}
        animate={{
          x: showProperties ? 0 : `calc(100% - (${PEEK_STRIP_SUM}))`,
        }}
        transition={panelSlideTransition}
      >
        <motion.div
          className="pointer-events-auto w-full min-h-0"
          initial={false}
          animate={{
            height: showProperties || propertiesPeekHover ? "100%" : PEEK_COLLAPSED_HEIGHT,
          }}
          transition={panelHeightTransition}
          onHoverStart={() => {
            if (!showProperties) setPropertiesPeekHover(true);
          }}
          onHoverEnd={() => setPropertiesPeekHover(false)}
        >
          <PropertiesPanel
            properties={selectedProperties}
            onClose={() => setShowProperties((v) => !v)}
            collapsed={!showProperties}
            isOpen={showProperties}
          />
        </motion.div>
      </motion.div>

      {/* Куб видов — справа; при открытых свойствах сдвиг влево на ширину панели, без перекрытия */}
      {modelLoaded && activeTool === "none" && (
        <ViewCube
          className={cn(
            "absolute top-3 z-[39] hidden md:block",
            showProperties
              ? "right-[calc(0.75rem+min(18rem,100vw-1.5rem)+0.5rem)] sm:right-[calc(1rem+min(18rem,100vw-1.5rem)+0.5rem)]"
              : "right-3 sm:right-4"
          )}
          getCamera={getViewCubeCamera}
          getOrbitTarget={getViewCubeOrbitTarget}
          onFaceClick={handleViewCubeFace}
          onEdgeClick={handleViewCubeEdge}
          onCornerClick={handleViewCubeCorner}
          onViewStep={handleViewCubeStep}
          onOrbitDrag={handleViewOrbitDrag}
        />
      )}

      {/* Загрузка */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-background/60 px-8 py-6 shadow-2xl backdrop-blur-xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <span className="font-medium text-foreground">Загрузка IFC-модели...</span>
          </div>
        </div>
      )}

      {/* Пустое состояние */}
      {!modelLoaded && !isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
          <motion.div
            className={cn("text-center", emptyStateGlass)}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.55,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="mb-4 text-5xl leading-none drop-shadow-sm sm:text-6xl" aria-hidden>
              🏗️
            </div>
            <p className="text-lg font-medium leading-snug text-foreground">
              Загрузите IFC-файл, чтобы начать работу
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Нажмите «Открыть» в верхней панели
            </p>
          </motion.div>
        </div>
      )}

      {/* Строка состояния: по центру снизу, в просвете между левой панелью и правой (не над структурой). */}
      {modelLoaded && (hoverLayerLabel != null || selectionCaption !== "") && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[5.25rem] z-[34] flex justify-center px-3 sm:bottom-[5.5rem] sm:px-4">
          <div className="flex w-full max-w-xl flex-wrap items-end justify-between gap-2 rounded-xl border border-white/12 bg-[#0D0033]/95 px-3 py-2 text-[11px] leading-snug text-white/90 shadow-lg backdrop-blur-sm">
            <div className="min-w-0 flex-1">
              {hoverLayerLabel != null && (
                <div>
                  <span className="text-white/45">Наведение</span>
                  <span className="mx-1.5 text-white/35">·</span>
                  <span className="font-medium text-white">{hoverLayerLabel}</span>
                </div>
              )}
              {selectionCaption !== "" && (
                <div
                  className={cn(
                    hoverLayerLabel != null && "mt-1.5 border-t border-white/10 pt-1.5"
                  )}
                >
                  <span className="text-white/45">Выбор</span>
                  <span className="mx-1.5 text-white/35">·</span>
                  <span className="font-medium text-pink-100/95">{selectionCaption}</span>
                </div>
              )}
            </div>
            {selectionCaption !== "" && (
              <button
                type="button"
                aria-label="Сбросить выделение"
                onClick={() => void handleClearSelection()}
                className="pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-500/35 bg-red-950/40 px-2 py-1 text-[10px] font-medium text-red-200 transition-colors hover:border-red-400/50 hover:bg-red-950/70"
              >
                <IconX className="h-3.5 w-3.5 text-red-400" stroke={2.2} aria-hidden />
                Сбросить выделение
              </button>
            )}
          </div>
        </div>
      )}

      {/* Низ вьюпорта: измерения и сечения */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-3 sm:px-4">
        <div className="pointer-events-auto w-full max-w-xl">
          <ViewportToolsPanel
            modelLoaded={modelLoaded}
            activeTool={activeTool}
            onToggleMeasure={() =>
              setActiveTool((t) => (t === "measure" ? "none" : "measure"))
            }
            onToggleClip={() =>
              setActiveTool((t) => (t === "clip" ? "none" : "clip"))
            }
            onDeleteMeasurements={handleDeleteMeasurements}
            onDeleteClips={handleDeleteClips}
          />
        </div>
      </div>

      {/* Подсказка по активному инструменту — над нижней панелью */}
      {activeTool !== "none" && (
        <div className="pointer-events-none absolute bottom-30 left-1/2 z-40 -translate-x-1/2 px-4 sm:bottom-32">
          <div className="pointer-events-auto rounded-full border border-white/25 bg-background/55 px-4 py-2 text-sm text-foreground shadow-xl backdrop-blur-xl">
            {activeTool === "measure"
              ? "Двойной клик: создать измерение • Delete: удалить"
              : "Клик: добавить сечение • Delete: удалить"}
          </div>
        </div>
      )}

    </div>
  );
}

