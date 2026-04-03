"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as OBC from "@thatopen/components";
import * as THREE from "three";
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
import { extractPanelMarkFromLayerName, groupLayerNamesByPanel } from "@/lib/ifcPanelLayerGroups";
import { motion, type Transition } from "framer-motion";
import { ViewerRuntime } from "@/viewer/core/ViewerRuntime";
import type {
  LayerMap,
  LayerVisibilityMap,
  LayersTreeBannerState,
  PropertySet,
  TreeNode,
  ViewerUiCallbacks,
} from "@/viewer/core/ViewerTypes";
import { getViewBasisFromOrbit } from "@/components/gizmo/GizmoCubeMath";
import { LAYER_HOVER_STYLE } from "@/viewer/viewerConstants";

export type { PropertyItem, PropertySet, TreeNode } from "@/viewer/core/ViewerTypes";

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

const PEEK_STRIP_SUM = "2.5rem";
const PEEK_COLLAPSED_HEIGHT = "14rem";

const PANEL_GROUP_TYPE = "IfcPanelGroup";

function buildLayerTreeNodes(layerIdsByName: LayerMap, grouped: boolean): TreeNode[] {
  const sorted = Object.keys(layerIdsByName).sort((a, b) => a.localeCompare(b, "ru"));
  let sid = -1;
  if (!grouped) {
    return sorted.map((name) => ({
      expressID: sid--,
      name,
      type: "IfcPresentationLayerAssignment",
      children: [],
    }));
  }
  const { panelGroups, ungrouped } = groupLayerNamesByPanel(sorted);
  const roots: TreeNode[] = [];
  const panelKeys = [...panelGroups.keys()].sort((a, b) => a.localeCompare(b, "ru"));
  for (const key of panelKeys) {
    const names = panelGroups.get(key)!;
    const children: TreeNode[] = names.map((name) => ({
      expressID: sid--,
      name,
      type: "IfcPresentationLayerAssignment",
      children: [],
    }));
    roots.push({
      expressID: sid--,
      name: `Панель ${key}`,
      type: PANEL_GROUP_TYPE,
      panelKey: key,
      children,
    });
  }
  for (const name of ungrouped) {
    roots.push({
      expressID: sid--,
      name,
      type: "IfcPresentationLayerAssignment",
      children: [],
    });
  }
  return roots;
}

export default function BIMViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const selectedLayerNamesRef = useRef<string[]>([]);
  const activeToolRef = useRef<"none" | "measure" | "clip">("none");
  const modelLoadedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [selectedProperties, setSelectedProperties] = useState<PropertySet[]>([]);
  const [layersTreeBanner, setLayersTreeBanner] = useState<LayersTreeBannerState | null>(null);
  const [groupLayersByPanel, setGroupLayersByPanel] = useState(true);
  const [activeTool, setActiveTool] = useState<"none" | "measure" | "clip">("none");
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(false);
  const [structureCollapsed, setStructureCollapsed] = useState(false);
  const [modelName, setModelName] = useState("");
  const [treePeekHover, setTreePeekHover] = useState(false);
  const [propertiesPeekHover, setPropertiesPeekHover] = useState(false);
  const [layerIdsByName, setLayerIdsByName] = useState<LayerMap>({});
  const [layerVisibilityByName, setLayerVisibilityByName] = useState<LayerVisibilityMap>({});
  const [selectedLayerNames, setSelectedLayerNames] = useState<string[]>([]);
  const [hoverLayerLabel, setHoverLayerLabel] = useState<string | null>(null);
  const [selectionCaption, setSelectionCaption] = useState("");
  const [selectionSyncTick, setSelectionSyncTick] = useState(0);
  const [isolateSelectionActive, setIsolateSelectionActive] = useState(false);
  const [quickMeasureLabel, setQuickMeasureLabel] = useState<string | null>(null);

  const treeData = useMemo((): TreeNode[] => {
    if (layersTreeBanner) {
      return [
        {
          expressID: -1,
          name: layersTreeBanner.message,
          type: layersTreeBanner.variant === "error" ? "Error" : "Info",
          children: [],
        },
      ];
    }
    if (Object.keys(layerIdsByName).length === 0) return [];
    return buildLayerTreeNodes(layerIdsByName, groupLayersByPanel);
  }, [layerIdsByName, groupLayersByPanel, layersTreeBanner]);

  useEffect(() => {
    selectedLayerNamesRef.current = selectedLayerNames;
  }, [selectedLayerNames]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    modelLoadedRef.current = modelLoaded;
  }, [modelLoaded]);

  useEffect(() => {
    if (showTree) setTreePeekHover(false);
  }, [showTree]);

  useEffect(() => {
    if (showProperties) setPropertiesPeekHover(false);
  }, [showProperties]);

  useEffect(() => {
    const rt = runtimeRef.current;
    const sn = rt?.getSelectStyleName();
    if (!modelLoaded || !rt?.getHighlighter() || !sn) {
      setSelectionCaption("");
      return;
    }
    const h = rt.getHighlighter()!;
    if (selectedLayerNames.length > 1) {
      const m0 = extractPanelMarkFromLayerName(selectedLayerNames[0]);
      if (m0 && selectedLayerNames.every((n) => extractPanelMarkFromLayerName(n) === m0)) {
        setSelectionCaption(`Панель ${m0} · ${selectedLayerNames.length} слоёв`);
      } else {
        setSelectionCaption(`Выбрано слоёв: ${selectedLayerNames.length}`);
      }
      return;
    }
    if (selectedLayerNames.length === 1) {
      setSelectionCaption(`Слой: ${selectedLayerNames[0]}`);
      return;
    }
    const sel = h.selection[sn];
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
    const rt = runtimeRef.current;
    const h = rt?.getHighlighter();
    if (!h || !modelLoaded) return 0;
    const sn = rt?.getSelectStyleName();
    if (!sn) return 0;
    const sel = h.selection[sn] as Record<string, Set<number>> | undefined;
    if (!sel) return 0;
    let n = 0;
    for (const s of Object.values(sel)) n += s.size;
    return n;
  }, [selectionSyncTick, modelLoaded]);

  const handleLayerRowSelect = useCallback(
    async (layerName: string, additive = false) => {
      await runtimeRef.current?.highlightLayerRow(layerName, layerIdsByName, additive);
    },
    [layerIdsByName]
  );

  const handlePanelRowSelect = useCallback(
    async (layerNames: string[], additive = false) => {
      await runtimeRef.current?.highlightPanelRows(layerNames, layerIdsByName, additive);
    },
    [layerIdsByName]
  );

  const handleLayerRowSelectRef = useRef(handleLayerRowSelect);
  useEffect(() => {
    handleLayerRowSelectRef.current = handleLayerRowSelect;
  }, [handleLayerRowSelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const ui: ViewerUiCallbacks = {
      onLoadingChange: setIsLoading,
      onModelName: setModelName,
      onModelLoaded: setModelLoaded,
      onLayerIndex: (result) => {
        if (result.banner) {
          setLayersTreeBanner(result.banner);
          setLayerIdsByName({});
          setLayerVisibilityByName({});
          setSelectedLayerNames([]);
          return;
        }
        setLayersTreeBanner(null);
        setLayerIdsByName(result.layerIdsByName);
        setLayerVisibilityByName((prev) => {
          const next: LayerVisibilityMap = {};
          for (const name of Object.keys(result.layerIdsByName)) {
            next[name] = prev[name] ?? true;
          }
          return next;
        });
        setSelectedLayerNames((prev) => prev.filter((name) => name in result.layerIdsByName));
      },
      onPropertiesLoaded: setSelectedProperties,
      onSelectionSync: () => setSelectionSyncTick((t) => t + 1),
      onHoverLayerLabel: setHoverLayerLabel,
      onQuickMeasureMm: setQuickMeasureLabel,
      onUiRequest: (req) => {
        if (req.showTree != null) setShowTree(req.showTree);
        if (req.showProperties != null) setShowProperties(req.showProperties);
      },
      onSelectedLayerNames: setSelectedLayerNames,
      getSelectedLayerNames: () => selectedLayerNamesRef.current,
    };

    const rt = new ViewerRuntime(
      {
        webIfcWasmRoot: "https://unpkg.com/web-ifc@0.0.74/",
        webIfcVersion: "0.0.74",
        fragmentsWorkerUrl: "/thatopen-worker.mjs",
      },
      ui
    );
    rt.mount(containerRef.current);
    rt.setTabToLayerHandler((name) => {
      void handleLayerRowSelectRef.current(name, false);
    });
    runtimeRef.current = rt;

    const hoverDispose = rt.attachHover(
      containerRef.current,
      () => activeToolRef.current,
      () => modelLoadedRef.current
    );

    return () => {
      hoverDispose();
      rt.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.syncLayerMap(layerIdsByName);
  }, [layerIdsByName]);

  useEffect(() => {
    runtimeRef.current?.setActiveTool(activeTool);
    if (activeTool !== "measure") setQuickMeasureLabel(null);
  }, [activeTool]);

  useEffect(() => {
    runtimeRef.current?.updateGridVisibility(layerIdsByName, layerVisibilityByName);
  }, [layerIdsByName, layerVisibilityByName]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log("[IFC UI] file input: start", { name: file.name, size: file.size });
    try {
      await runtimeRef.current?.loadIfc(file);
    } finally {
      e.target.value = "";
      console.log("[IFC UI] file input: reset");
    }
  }, []);

  const setItemsVisibility = useCallback(async (ids: number[], visible: boolean) => {
    await runtimeRef.current?.setItemsVisibility(ids, visible);
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

  const handleTogglePanelVisibility = useCallback(
    async (layerNames: string[]) => {
      if (layerNames.length === 0) return;
      const allVisible = layerNames.every((n) => layerVisibilityByName[n] !== false);
      const nextVisible = !allVisible;
      const ids = Array.from(new Set(layerNames.flatMap((n) => layerIdsByName[n] || [])));
      if (ids.length === 0) return;
      await setItemsVisibility(ids, nextVisible);
      setLayerVisibilityByName((prev) => {
        const next = { ...prev };
        for (const n of layerNames) next[n] = nextVisible;
        return next;
      });
    },
    [layerIdsByName, layerVisibilityByName, setItemsVisibility]
  );

  const allLayersVisible =
    Object.keys(layerIdsByName).length > 0 &&
    Object.keys(layerIdsByName).every((name) => layerVisibilityByName[name] !== false);

  const handleFitAll = useCallback(() => {
    runtimeRef.current?.fitAll();
  }, []);

  const restoreVisibilityAfterIsolation = useCallback(async () => {
    const rt = runtimeRef.current;
    const model = rt?.getLastModel();
    const fragments = rt?.getFragments();
    if (!model || !fragments) return;
    try {
      if (typeof model.resetVisible === "function") {
        model.resetVisible();
      } else {
        const ids = typeof model.getLocalIds === "function" ? model.getLocalIds() : [];
        const resolved = ids != null && typeof (ids as Promise<unknown>).then === "function"
          ? await (ids as Promise<unknown>)
          : ids;
        const arr = Array.isArray(resolved)
          ? resolved
          : resolved != null && typeof (resolved as Iterable<number>)[Symbol.iterator] === "function"
            ? Array.from(resolved as Iterable<number>)
            : [];
        if (arr.length) await model.setVisible(arr as number[], true);
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
      await rt?.getHighlighter()?.clear(LAYER_HOVER_STYLE);
      await fragments.core.update(true);
    } catch {
      /* ignore */
    }
  }, [layerIdsByName, layerVisibilityByName]);

  const handleToggleIsolateSelection = useCallback(async () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const model = rt.getLastModel();
    const fragments = rt.getFragments();
    const highlighter = rt.getHighlighter();
    const world = rt.getWorld();
    if (!model || !fragments || !highlighter || !world) return;

    if (isolateSelectionActive) {
      await restoreVisibilityAfterIsolation();
      setIsolateSelectionActive(false);
      handleFitAll();
      return;
    }

    const sn = rt.getSelectStyleName();
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

  const handleViewCubeFace = useCallback(async (dir: ViewCubeDirection) => {
    const world = runtimeRef.current?.getWorld();
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

  const handleViewCubeCorner = useCallback(async (corner: ViewCubeCorner) => {
    const controls = runtimeRef.current?.getWorld()?.camera?.controls;
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

  const handleViewCubeEdge = useCallback(async (edge: ViewCubeEdge) => {
    const controls = runtimeRef.current?.getWorld()?.camera?.controls;
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

  const handleViewCubeStep = useCallback(async (step: ViewCubeStep) => {
    const controls = runtimeRef.current?.getWorld()?.camera?.controls;
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
    const c = runtimeRef.current?.getWorld()?.camera?.controls;
    if (!c) return;
    void c.rotate(-dx * 0.0035, -dy * 0.0035, false);
  }, []);

  const getViewCubeCamera = useCallback(
    () => runtimeRef.current?.getWorld()?.camera?.three ?? null,
    []
  );

  const getViewCubeOrbitTarget = useCallback(() => {
    const c = runtimeRef.current?.getWorld()?.camera?.controls;
    if (!c) return null;
    const t = new THREE.Vector3();
    c.getTarget(t, true);
    return t;
  }, []);

  const handleDeleteMeasurements = useCallback(() => {
    runtimeRef.current?.getMeasurer()?.delete();
  }, []);

  const handleDeleteClips = useCallback(() => {
    const w = runtimeRef.current?.getWorld();
    if (w) runtimeRef.current?.getClipper()?.deleteAll();
  }, []);

  const handleClearSelection = useCallback(async () => {
    if (isolateSelectionActive) {
      await restoreVisibilityAfterIsolation();
      setIsolateSelectionActive(false);
    }
    await runtimeRef.current?.clearSelectionAndHover();
  }, [isolateSelectionActive, restoreVisibilityAfterIsolation]);

  return (
    <div className="relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <div
        ref={containerRef}
        className="relative z-0 min-h-0 w-full flex-1"
        style={{
          cursor: activeTool !== "none" ? "crosshair" : "default",
        }}
      />

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
            groupLayersByPanel={groupLayersByPanel}
            onGroupLayersByPanelChange={setGroupLayersByPanel}
            structureCollapsed={structureCollapsed}
            onToggleStructureCollapsed={setStructureCollapsed}
            allLayersVisible={allLayersVisible}
            isLayerVisible={(layerName) => layerVisibilityByName[layerName] !== false}
            onToggleAllLayersVisibility={handleToggleAllLayersVisibility}
            onToggleLayerVisibility={handleToggleLayerVisibility}
            onTogglePanelVisibility={handleTogglePanelVisibility}
            selectedLayerNames={selectedLayerNames}
            onLayerRowSelect={handleLayerRowSelect}
            onPanelRowSelect={handlePanelRowSelect}
            onFitAll={handleFitAll}
            isolateSelectionActive={isolateSelectionActive}
            isolateSelectionEnabled={
              modelLoaded && (isolateSelectionActive || isolateSelectionCount > 0)
            }
            onToggleIsolateSelection={handleToggleIsolateSelection}
          />
        </motion.div>
      </motion.div>

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

      {modelLoaded && activeTool === "none" && (
        <ViewCube
          className={cn(
            "absolute top-3 z-39 hidden md:block",
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

      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-background/60 px-8 py-6 shadow-2xl backdrop-blur-xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <span className="font-medium text-foreground">Загрузка IFC-модели...</span>
          </div>
        </div>
      )}

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

      {modelLoaded && (hoverLayerLabel != null || selectionCaption !== "") && (
        <div className="pointer-events-none absolute inset-x-0 bottom-21 z-34 flex justify-center px-3 sm:bottom-22 sm:px-4">
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

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-3 sm:px-4">
        <div className="pointer-events-auto w-full max-w-xl">
          <ViewportToolsPanel
            modelLoaded={modelLoaded}
            activeTool={activeTool}
            onToggleMeasure={() =>
              setActiveTool((t) => (t === "measure" ? "none" : "measure"))
            }
            onToggleClip={() => setActiveTool((t) => (t === "clip" ? "none" : "clip"))}
            onDeleteMeasurements={handleDeleteMeasurements}
            onDeleteClips={handleDeleteClips}
          />
        </div>
      </div>

      {activeTool !== "none" && (
        <div className="pointer-events-none absolute bottom-30 left-1/2 z-40 -translate-x-1/2 px-4 sm:bottom-32">
          <div className="pointer-events-auto rounded-full border border-white/25 bg-background/55 px-4 py-2 text-sm text-foreground shadow-xl backdrop-blur-xl">
            {activeTool === "measure" ? (
              <span>
                {quickMeasureLabel ? (
                  <>
                    <span className="text-muted-foreground">Быстрый замер: </span>
                    <span className="font-medium tabular-nums">{quickMeasureLabel}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                  </>
                ) : null}
                Двойной клик — зафиксировать измерение · Delete — удалить
              </span>
            ) : (
              "Клик: добавить сечение • Delete: удалить"
            )}
          </div>
        </div>
      )}
    </div>
  );
}
