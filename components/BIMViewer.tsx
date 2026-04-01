"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as THREE from "three";
import * as WEBIFC from "web-ifc";
import { ModelTree } from "./ModelTree";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar, ViewportToolsPanel } from "./Toolbar";
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
  const webIfcModelIdRef = useRef<number | null>(null);
  const lastFragmentsModelRef = useRef<any>(null);
  const rebuildTreeRef = useRef<(() => Promise<void>) | null>(null);

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
  /** Активный слой в дереве (подсветка в сцене через Highlighter). */
  const [selectedLayerName, setSelectedLayerName] = useState<string | null>(null);

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
    world.scene.setup();
    // Светлый фон сцены в тон светлому UI
    world.scene.three.background = new THREE.Color(0xf4f4f5);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    world.scene.three.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    world.scene.three.add(dirLight);

    const grids = components.get(OBC.Grids);
    grids.create(world);

    const fragments = components.get(OBC.FragmentsManager);
    fragmentsRef.current = fragments;
    fragmentsInitializedRef.current = false;
    void (async () => {
      try {
        await fragments.init("/thatopen-worker.mjs");
        fragmentsInitializedRef.current = true;
      } catch (error) {
        console.error("Failed to initialize fragments manager:", error);
      }
    })();

    const ifcLoader = components.get(OBC.IfcLoader);
    ifcLoaderRef.current = ifcLoader;

    // Raycaster (required for clipper)
    const casters = components.get(OBC.Raycasters);
    casters.get(world);

    // Highlighter
    const highlighter = components.get(OBCF.Highlighter);
    highlighter.setup({
      world,
      selectName: "select",
      autoHighlightOnClick: false,
      selectionColor: new THREE.Color(0x4f46e5),
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

    const handleClick = async () => {
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
        const selectName = selectStyleNameRef.current;
        await highlighter.highlight(selectName, true);
        const selection = highlighter.selection[selectName];
        if (!selection || Object.keys(selection).length === 0) {
          setSelectedProperties([]);
          setSelectedLayerName(null);
          return;
        }
        setSelectedLayerName(null);
        setShowProperties(true);
        await loadProperties(components, selection);
      } catch (error) {
        // Avoid unhandled promise rejections from picker/highlighter internals.
        console.warn("Selection interaction failed:", error);
        setSelectedProperties([]);
      }
    };

    const handleDblClick = () => {
      if (activeToolRef.current === "measure") {
        measurer.create();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Delete" || e.code === "Backspace") {
        const tool = activeToolRef.current;
        if (tool === "measure") measurer.delete();
        if (tool === "clip") clipper.delete(world);
      }
    };

    containerRef.current.addEventListener("click", handleClick);
    containerRef.current.addEventListener("dblclick", handleDblClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (fragmentsInitializedRef.current) {
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
          const items = (await model.getItemsData?.([expressID], {
            attributesDefault: true,
            relationsDefault: { attributes: false, relations: false },
          })) as Array<Record<string, unknown>> | undefined;
          const props = items?.[0];
          if (!props) continue;

          const toPrimitive = (
            value: unknown
          ): string | number | boolean | null => {
            if (value == null) return null;
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            ) {
              return value;
            }
            if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
              return toPrimitive((value as { value?: unknown }).value);
            }
            if (Array.isArray(value)) return `Array(${value.length})`;
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          };

          const generalProps: PropertyItem[] = [];
          for (const [key, val] of Object.entries(props)) {
            if (key === "expressID" || key === "type") continue;
            generalProps.push({
              name: key,
              value: toPrimitive(val),
            });
          }
          if (generalProps.length > 0) {
            propertySets.push({ name: "Свойства элемента", properties: generalProps });
          }
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
        await ifcLoaderRef.current.setup({
          autoSetWasm: false,
          wasm: {
            path: "https://unpkg.com/web-ifc@0.0.74/",
            absolute: true,
          },
        });

        worldRef.current.camera.controls.addEventListener("update", () =>
          fragmentsRef.current?.core.update()
        );

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
        setSelectedLayerName(null);
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
      setSelectedLayerName((prev) =>
        prev != null && prev in nextLayerIdsByName ? prev : null
      );
      setTreeData(roots);
    } catch (error) {
      console.warn("Failed to build layers tree from IFC:", error);
      setLayerIdsByName({});
      setLayerVisibilityByName({});
      setSelectedLayerName(null);
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
      setSelectedLayerName(null);
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
    if (!model || !fragments || ids.length === 0) return;
    await model.setVisible(ids, visible);
    await fragments.core.update(true);
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

  const handleLayerRowSelect = useCallback(
    async (layerName: string) => {
      const model = lastFragmentsModelRef.current;
      const highlighter = highlighterRef.current;
      const fragments = fragmentsRef.current;
      if (!model || !highlighter || !fragments) return;
      const ids = layerIdsByName[layerName];
      if (!ids?.length) return;
      setSelectedLayerName(layerName);
      setSelectedProperties([]);
      setShowProperties(false);
      const selectName = selectStyleNameRef.current;
      const map: OBC.ModelIdMap = { [model.modelId]: new Set(ids) };
      try {
        await highlighter.highlightByID(selectName, map, true, false, null, false);
        await fragments.core.update(true);
      } catch (e) {
        console.warn("Подсветка слоя не удалась:", e);
      }
    },
    [layerIdsByName]
  );

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

  const handleDeleteMeasurements = useCallback(() => {
    measurerRef.current?.delete();
  }, []);

  const handleDeleteClips = useCallback(() => {
    clipperRef.current?.deleteAll();
  }, []);

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

      {/* Парящая панель инструментов */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="pointer-events-auto mx-auto w-full max-w-6xl">
          <Toolbar onFileUpload={handleFileUpload} />
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
            selectedLayerName={selectedLayerName}
            onLayerRowSelect={handleLayerRowSelect}
            onFitAll={handleFitAll}
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

