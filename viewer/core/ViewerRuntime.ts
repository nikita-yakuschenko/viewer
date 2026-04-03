import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import { FragmentsModel, RenderedFaces, SnappingClass } from "@thatopen/fragments";
import * as THREE from "three";
import * as WEBIFC from "web-ifc";
import type {
  LayerIndexResult,
  LayerMap,
  LayerVisibilityMap,
  ModelIdMap,
  ViewerInitOptions,
  ViewerTool,
  ViewerUiCallbacks,
} from "@/viewer/core/ViewerTypes";
import { loadPropertySetsForSelection } from "@/viewer/properties/IfcPropertiesReader";
import { buildLayerIndexFromIfcApi, getLayerNameForProductId } from "@/viewer/loading/LayerIndexService";
import { applyWebIfcModuleScriptHint, applyWebIfcSingleThreadPatch } from "@/viewer/loading/WebIfcEnvironment";
import { LAYER_HOVER_STYLE, SCENE_TONE_EXPOSURE } from "@/viewer/viewerConstants";
import { MeasurementController } from "@/viewer/interactions/MeasurementController";

/** Ограничение времени ожидания worker Fragments (мс). */
const FRAGMENTS_INIT_TIMEOUT_MS = 120_000;
/** Ограничение на setup + readIfcFile + load (мс), крупные IFC могут долго парситься. */
const IFC_PARSE_AND_LOAD_TIMEOUT_MS = 30 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`[IFC load] ${label}: превышено ${ms} ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export type SimpleViewerWorld = OBC.SimpleWorld<
  OBC.SimpleScene,
  OBC.SimpleCamera,
  OBCF.RendererWith2D
>;

/**
 * Изолированный runtime вьювера: Components, world, инструменты, подписки (один раз), загрузка IFC.
 */
export class ViewerRuntime {
  private readonly opts: ViewerInitOptions;
  private ui: ViewerUiCallbacks;

  private components: OBC.Components | null = null;
  private world: SimpleViewerWorld | null = null;
  private fragments: OBC.FragmentsManager | null = null;
  private fragmentsInitPromise: Promise<void> | null = null;
  private fragmentsReady = false;
  private ifcLoader: OBC.IfcLoader | null = null;
  private highlighter: OBCF.Highlighter | null = null;
  private clipper: OBC.Clipper | null = null;
  private measurer: OBCF.LengthMeasurement | null = null;
  private measurement: MeasurementController | null = null;
  private worldGrid: OBC.SimpleGrid | null = null;

  private selectStyleName = "select";
  private webIfcModelId: number | null = null;
  private lastModel: FragmentsModel | null = null;

  private layerMap: LayerMap = {};
  private activeTool: ViewerTool = "none";
  private disposed = false;

  private persistentHooksRegistered = false;
  private readonly persistentUnsubs: (() => void)[] = [];

  private activeToolRef: { current: ViewerTool } = { current: "none" };
  private layerMapRef: { current: LayerMap } = { current: {} };
  private lastPickedExpressIdRef: { current: number | null } = { current: null };
  private skipNextCanvasClickRef = false;
  private orbitPointerDownRef: { x: number; y: number } | null = null;
  private orbitDragActiveRef = false;
  private orbitWindowCleanup: (() => void) | null = null;
  private layerHoverSeq = 0;
  private onTabToLayerHandler: (name: string) => void = () => {};

  constructor(
    opts: ViewerInitOptions,
    ui: ViewerUiCallbacks
  ) {
    this.opts = opts;
    this.ui = ui;
  }

  /** React передаёт актуальный индекс слоёв (после setState). */
  syncLayerMap(map: LayerMap): void {
    this.layerMap = map;
    this.layerMapRef.current = map;
  }

  setTabToLayerHandler(fn: (layerName: string) => void): void {
    this.onTabToLayerHandler = fn;
  }

  getWorld(): SimpleViewerWorld | null {
    return this.world;
  }

  getFragments(): OBC.FragmentsManager | null {
    return this.fragments;
  }

  getHighlighter(): OBCF.Highlighter | null {
    return this.highlighter;
  }

  getClipper(): OBC.Clipper | null {
    return this.clipper;
  }

  getMeasurer(): OBCF.LengthMeasurement | null {
    return this.measurer;
  }

  getSelectStyleName(): string {
    return this.selectStyleName;
  }

  getLastModel(): FragmentsModel | null {
    return this.lastModel;
  }

  isFragmentsReady(): boolean {
    return this.fragmentsReady;
  }

  setActiveTool(tool: ViewerTool): void {
    this.activeTool = tool;
    this.activeToolRef.current = tool;
    if (this.measurer) this.measurer.enabled = tool === "measure";
    if (this.clipper) this.clipper.enabled = tool === "clip";
    if (tool !== "measure") {
      this.measurement?.clearQuickLabel();
      const ov = this.measurement?.getOverlay();
      if (ov) ov.root.visible = false;
    }
  }

  getActiveTool(): ViewerTool {
    return this.activeTool;
  }

  mount(container: HTMLElement): void {
    if (this.components) return;

    applyWebIfcSingleThreadPatch();
    applyWebIfcModuleScriptHint(
      `https://unpkg.com/web-ifc@${this.opts.webIfcVersion}/web-ifc-api.js`
    );

    const components = new OBC.Components();
    this.components = components;

    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBCF.RendererWith2D>();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBCF.RendererWith2D(components, container);
    world.camera = new OBC.SimpleCamera(components);
    this.world = world;

    components.init();
    world.camera.controls.setLookAt(12, 6, 8, 0, 0, -10);
    world.scene.setup({
      backgroundColor: new THREE.Color(0xffffff),
    });
    world.scene.deleteAllLights();

    const gl = world.renderer.three;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = SCENE_TONE_EXPOSURE;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const scene3 = world.scene.three;
    scene3.add(new THREE.AmbientLight(0xffffff, 0.28));
    const hemi = new THREE.HemisphereLight(0xeef3ff, 0xe5e0d8, 0.42);
    hemi.position.set(0, 1, 0);
    scene3.add(hemi);
    const key = new THREE.DirectionalLight(0xfff8f0, 1.18);
    key.position.set(18, 32, 14);
    scene3.add(key);
    const fill = new THREE.DirectionalLight(0xc8d4ea, 0.4);
    fill.position.set(-16, 12, -20);
    scene3.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.22);
    rim.position.set(-6, 8, 28);
    scene3.add(rim);

    const grids = components.get(OBC.Grids);
    const worldGrid = grids.create(world);
    worldGrid.fade = true;
    this.worldGrid = worldGrid;

    const fragments = components.get(OBC.FragmentsManager);
    this.fragments = fragments;
    this.fragmentsInitPromise = Promise.resolve(
      fragments.init(this.opts.fragmentsWorkerUrl) as unknown as Promise<void>
    )
      .then(() => {
        this.fragmentsReady = true;
      })
      .catch((e: unknown) => {
        console.error("FragmentsManager init failed:", e);
        this.fragmentsReady = false;
        throw e;
      });

    const ifcLoader = components.get(OBC.IfcLoader);
    this.ifcLoader = ifcLoader;

    components.get(OBC.Raycasters).get(world);

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
    highlighter.styles.set(LAYER_HOVER_STYLE, {
      color: new THREE.Color(0xf472b6),
      renderedFaces: RenderedFaces.TWO,
      opacity: 0.52,
      transparent: true,
      preserveOriginalMaterial: false,
      depthWrite: false,
    });
    this.selectStyleName = highlighter.config.selectName;
    this.highlighter = highlighter;

    const clipper = components.get(OBC.Clipper);
    clipper.enabled = false;
    this.clipper = clipper;

    const measurer = components.get(OBCF.LengthMeasurement);
    measurer.world = world;
    measurer.enabled = false;
    measurer.mode = "edge";
    measurer.snapDistance = 2;
    measurer.units = "mm";
    measurer.snappings = [SnappingClass.POINT, SnappingClass.LINE];
    measurer.rounding = 2;
    this.measurer = measurer;

    this.measurement = new MeasurementController(world, measurer, scene3);
    this.measurement.setCallbacks(
      () => this.activeToolRef.current,
      (text) => this.ui.onQuickMeasureMm(text)
    );

    this.registerPersistentSubscriptions(world, fragments);
    this.bindDom(container, world, fragments, highlighter, clipper, measurer, components);
  }

  private registerPersistentSubscriptions(
    world: SimpleViewerWorld,
    fragments: OBC.FragmentsManager
  ): void {
    if (this.persistentHooksRegistered) return;
    this.persistentHooksRegistered = true;

    const onCamUpdate = () => {
      if (!this.fragmentsReady) return;
      void fragments.core.update();
    };
    world.camera.controls.addEventListener("update", onCamUpdate);
    this.persistentUnsubs.push(() => {
      world.camera.controls.removeEventListener("update", onCamUpdate);
    });

    const onModel = async ({ value: model }: { value: FragmentsModel }) => {
      console.log("[IFC onModel] start");
      try {
        if (!this.world) {
          console.warn("[IFC onModel] abort: world missing");
          return;
        }
        model.useCamera(this.world.camera.three);
        this.world.scene.three.add(model.object);
        await fragments.core.update(true);
        model.object.updateMatrixWorld(true);

        const alignBbox = new THREE.Box3().setFromObject(model.object);
        if (!alignBbox.isEmpty()) {
          const yOffset = -alignBbox.min.y;
          if (Number.isFinite(yOffset) && Math.abs(yOffset) > 1e-6) {
            model.object.position.y += yOffset;
            model.object.updateMatrixWorld(true);
            await fragments.core.update(true);
          }
        }

        const bbox = new THREE.Box3().setFromObject(model.object);
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        await this.world.camera.controls.setLookAt(
          center.x + maxDim,
          center.y + maxDim * 0.8,
          center.z + maxDim,
          center.x,
          center.y,
          center.z,
          true
        );

        this.lastModel = model;
        this.ui.onModelLoaded(true);
        console.log("[IFC onModel] success (model in scene, camera fitted)");
      } catch (e) {
        console.error("[IFC onModel] failure", e);
        this.ui.onModelLoaded(false);
      }
      console.log("[IFC layers] indexing: scheduled (non-blocking)");
      void this.rebuildLayerIndex()
        .then(() => console.log("[IFC layers] indexing: done"))
        .catch((e) => console.error("[IFC layers] indexing: error", e));
    };
    fragments.list.onItemSet.add(onModel);
    this.persistentUnsubs.push(() => fragments.list.onItemSet.remove(onModel));

    const onMat = ({ value: material }: { value: THREE.Material & { isLodMaterial?: boolean; polygonOffset?: boolean } }) => {
      if (!("isLodMaterial" in material && material.isLodMaterial)) {
        material.polygonOffset = true;
        material.polygonOffsetUnits = 1;
        material.polygonOffsetFactor = Math.random();
      }
    };
    fragments.core.models.materials.list.onItemSet.add(onMat);
    this.persistentUnsubs.push(() =>
      fragments.core.models.materials.list.onItemSet.remove(onMat)
    );
  }

  private async rebuildLayerIndex(): Promise<void> {
    console.log("[IFC layers] indexing: start");
    const api = this.ifcLoader?.webIfc;
    const mid = this.webIfcModelId;
    if (api == null || mid == null) {
      this.ui.onLayerIndex({
        layerIdsByName: {},
        banner: {
          variant: "info",
          message: "Слои IFC недоступны: не удалось открыть модель в web-ifc",
        },
      });
      console.log("[IFC layers] indexing: end (skipped, no web-ifc model)");
      return;
    }
    try {
      const result = buildLayerIndexFromIfcApi(api as WEBIFC.IfcAPI, mid);
      this.applyLayerIndexToUi(result);
      console.log("[IFC layers] indexing: end");
    } catch (e) {
      console.error("[IFC layers] indexing: build failed", e);
      this.ui.onLayerIndex({
        layerIdsByName: {},
        banner: {
          variant: "info",
          message: "Не удалось построить дерево слоёв",
        },
      });
    }
  }

  private applyLayerIndexToUi(result: LayerIndexResult): void {
    this.ui.onLayerIndex(result);
  }

  private bindDom(
    container: HTMLElement,
    world: SimpleViewerWorld,
    fragments: OBC.FragmentsManager,
    highlighter: OBCF.Highlighter,
    clipper: OBC.Clipper,
    measurer: OBCF.LengthMeasurement,
    components: OBC.Components
  ): void {
    const ORBIT_DRAG_PX_SQ = 5 * 5;

    const onOrbitPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.orbitWindowCleanup?.();
      this.orbitPointerDownRef = { x: e.clientX, y: e.clientY };
      this.orbitDragActiveRef = false;

      const onWindowMove = (ev: PointerEvent) => {
        if ((ev.buttons & 1) === 0) return;
        const start = this.orbitPointerDownRef;
        if (!start) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (dx * dx + dy * dy > ORBIT_DRAG_PX_SQ) this.orbitDragActiveRef = true;
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (ev.button !== 0) return;
        window.removeEventListener("pointermove", onWindowMove, true);
        window.removeEventListener("pointerup", onWindowUp, true);
        window.removeEventListener("pointercancel", onWindowUp, true);
        this.orbitWindowCleanup = null;
        if (this.orbitDragActiveRef) this.skipNextCanvasClickRef = true;
        this.orbitDragActiveRef = false;
        this.orbitPointerDownRef = null;
      };

      window.addEventListener("pointermove", onWindowMove, true);
      window.addEventListener("pointerup", onWindowUp, true);
      window.addEventListener("pointercancel", onWindowUp, true);
      this.orbitWindowCleanup = () => {
        window.removeEventListener("pointermove", onWindowMove, true);
        window.removeEventListener("pointerup", onWindowUp, true);
        window.removeEventListener("pointercancel", onWindowUp, true);
      };
    };

    const handleClick = async (e: MouseEvent) => {
      if (this.skipNextCanvasClickRef) {
        this.skipNextCanvasClickRef = false;
        return;
      }
      if (!this.fragmentsReady) return;
      const tool = this.activeToolRef.current;
      if (tool === "clip") {
        clipper.create(world);
        return;
      }
      if (tool === "measure") return;

      try {
        await highlighter.clear(LAYER_HOVER_STYLE);
        const selectName = this.selectStyleName;
        const canvas = world.renderer?.three.domElement;
        const camera = world.camera?.three;
        if (!canvas || !camera) return;
        const hit = await fragments.raycast({
          camera,
          dom: canvas,
          mouse: new THREE.Vector2(e.clientX, e.clientY),
        });
        if (!hit?.localId) {
          await fragments.core.update(true);
          return;
        }

        const localId = hit.localId;
        this.lastPickedExpressIdRef.current = localId;
        const modelId = hit.fragments.modelId;
        const singleMap: ModelIdMap = { [modelId]: new Set([localId]) };
        const layers = this.layerMapRef.current;
        const layerName = getLayerNameForProductId(layers, localId);

        if (e.ctrlKey && e.shiftKey) {
          this.ui.onSelectedLayerNames([]);
          this.ui.onUiRequest({ showProperties: true });
          await highlighter.highlightByID(selectName, singleMap, false, false, null, false);
          await fragments.core.update(true);
          const sel = highlighter.selection[selectName];
          if (sel && Object.keys(sel).length > 0) {
            const sets = await loadPropertySetsForSelection(fragments, sel as Record<string, Set<number>>);
            this.ui.onPropertiesLoaded(sets);
          }
          this.ui.onSelectionSync();
          return;
        }

        if (e.ctrlKey) {
          this.ui.onSelectedLayerNames([]);
          this.ui.onUiRequest({ showProperties: true });
          await highlighter.highlightByID(selectName, singleMap, true, false, null, false);
          await fragments.core.update(true);
          const sets = await loadPropertySetsForSelection(fragments, singleMap);
          this.ui.onPropertiesLoaded(sets);
          this.ui.onSelectionSync();
          return;
        }

        if (layerName && (layers[layerName]?.length ?? 0) > 0) {
          const map: ModelIdMap = { [modelId]: new Set(layers[layerName]) };
          const additive = e.shiftKey;
          await highlighter.highlightByID(selectName, map, !additive, false, null, false);
          await fragments.core.update(true);
          if (additive) {
            const prev = this.ui.getSelectedLayerNames();
            this.ui.onSelectedLayerNames(
              prev.includes(layerName) ? prev : [...prev, layerName]
            );
          } else {
            this.ui.onSelectedLayerNames([layerName]);
          }
          this.ui.onPropertiesLoaded([]);
          this.ui.onUiRequest({ showProperties: false, showTree: true });
          this.ui.onSelectionSync();
          return;
        }

        this.ui.onSelectedLayerNames([]);
        this.ui.onUiRequest({ showProperties: true });
        await highlighter.highlightByID(selectName, singleMap, true, false, null, false);
        await fragments.core.update(true);
        const sets = await loadPropertySetsForSelection(fragments, singleMap);
        this.ui.onPropertiesLoaded(sets);
        this.ui.onSelectionSync();
      } catch (err) {
        console.warn("Selection interaction failed:", err);
        this.ui.onPropertiesLoaded([]);
        this.ui.onSelectionSync();
      }
    };

    const handleDblClick = () => {
      if (this.skipNextCanvasClickRef) {
        this.skipNextCanvasClickRef = false;
        return;
      }
      if (this.activeToolRef.current === "measure") void measurer.create();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Tab" && this.activeToolRef.current === "none") {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("input, textarea, [contenteditable=true]")) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const id = this.lastPickedExpressIdRef.current;
        if (id == null) return;
        const name = getLayerNameForProductId(this.layerMapRef.current, id);
        if (name == null) return;
        e.preventDefault();
        this.ui.onUiRequest({ showTree: true });
        this.onTabToLayerHandler(name);
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        const tool = this.activeToolRef.current;
        if (tool === "measure") measurer.delete();
        if (tool === "clip") clipper.delete(world);
      }
    };

    container.addEventListener("pointerdown", onOrbitPointerDown, true);
    container.addEventListener("click", handleClick);
    container.addEventListener("dblclick", handleDblClick);
    const measureMove = this.measurement!.onPointerMove.bind(this.measurement);
    container.addEventListener("pointermove", measureMove, true);
    window.addEventListener("keydown", handleKeyDown);

    this.persistentUnsubs.push(() => {
      container.removeEventListener("pointerdown", onOrbitPointerDown, true);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("dblclick", handleDblClick);
      container.removeEventListener("pointermove", measureMove, true);
      window.removeEventListener("keydown", handleKeyDown);
    });
  }

  /** Hover по слою: отдельный эффект из React вызывает startHoverBinding / stop через dispose из mount — упростим: метод attachHover */
  attachHover(
    container: HTMLElement,
    getActiveTool: () => ViewerTool,
    getModelLoaded: () => boolean
  ): () => void {
    const fragments = this.fragments!;
    const highlighter = this.highlighter!;
    const world = this.world!;

    let raf = 0;
    const clearHoverHighlight = async () => {
      if (!this.fragmentsReady) return;
      try {
        await highlighter.clear(LAYER_HOVER_STYLE);
        await fragments.core.update(true);
      } catch {
        /* ignore */
      }
    };

    const runHover = async (clientX: number, clientY: number, ctrlKey: boolean) => {
      if (getActiveTool() !== "none") {
        this.ui.onHoverLayerLabel(null);
        await clearHoverHighlight();
        return;
      }
      if (!this.fragmentsReady) return;

      const seq = ++this.layerHoverSeq;
      const canvas = world.renderer?.three.domElement;
      const camera = world.camera?.three;
      const model = this.lastModel;
      if (!canvas || !camera || !model) return;

      const hit = await fragments.raycast({
        camera,
        dom: canvas,
        mouse: new THREE.Vector2(clientX, clientY),
      });
      if (seq !== this.layerHoverSeq) return;

      if (
        !hit ||
        typeof hit !== "object" ||
        !("localId" in hit) ||
        typeof (hit as { localId: unknown }).localId !== "number"
      ) {
        this.ui.onHoverLayerLabel(null);
        await clearHoverHighlight();
        return;
      }

      const localId = (hit as { localId: number }).localId;
      const ifcLayerName = getLayerNameForProductId(this.layerMapRef.current, localId);
      this.ui.onHoverLayerLabel(ifcLayerName ?? "IFC-слой не назначен");

      if (ctrlKey) {
        const map: ModelIdMap = { [model.modelId]: new Set([localId]) };
        try {
          await highlighter.highlightByID(LAYER_HOVER_STYLE, map, true, false, null, false);
          if (seq !== this.layerHoverSeq) return;
          await fragments.core.update(true);
        } catch {
          /* ignore */
        }
        return;
      }

      const layerName = ifcLayerName;
      const layers = this.layerMapRef.current;
      if (!layerName || !layers[layerName]?.length) {
        await clearHoverHighlight();
        return;
      }

      const ids = layers[layerName];
      const map: ModelIdMap = { [model.modelId]: new Set(ids) };
      try {
        await highlighter.highlightByID(LAYER_HOVER_STYLE, map, true, false, null, false);
        if (seq !== this.layerHoverSeq) return;
        await fragments.core.update(true);
      } catch {
        /* ignore */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!getModelLoaded()) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void runHover(e.clientX, e.clientY, e.ctrlKey);
      });
    };

    const onLeave = () => {
      cancelAnimationFrame(raf);
      this.layerHoverSeq += 1;
      this.ui.onHoverLayerLabel(null);
      void clearHoverHighlight();
    };

    const onPointerDown = () => {
      this.layerHoverSeq += 1;
      this.ui.onHoverLayerLabel(null);
      void clearHoverHighlight();
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    container.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onPointerDown, true);
      this.ui.onHoverLayerLabel(null);
      void clearHoverHighlight();
    };
  }

  async loadIfc(file: File): Promise<void> {
    const log = (stage: string, detail?: Record<string, unknown>) => {
      console.log(`[IFC load] ${stage}`, detail ?? "");
    };

    if (!this.ifcLoader || !this.world || !this.fragments) {
      log("abort: runtime not ready (ifcLoader/world/fragments)");
      return;
    }

    log("start", { name: file.name, size: file.size });
    this.ui.onLoadingChange(true);
    this.ui.onModelName(file.name);

    try {
      log("fragmentsInitPromise: await start");
      await withTimeout(
        this.fragmentsInitPromise ?? Promise.reject(new Error("fragmentsInitPromise missing")),
        FRAGMENTS_INIT_TIMEOUT_MS,
        "FragmentsManager.init (worker)"
      );
      log("fragmentsInitPromise: await end", { fragmentsReady: this.fragmentsReady });

      if (!this.fragmentsReady) {
        log("failure: fragments not ready after init");
        this.ui.onModelLoaded(false);
        return;
      }

      await withTimeout(
        (async () => {
          log("ifcLoader.setup: start");
          await this.ifcLoader!.setup({
            autoSetWasm: false,
            wasm: {
              path: this.opts.webIfcWasmRoot,
              absolute: true,
            },
          });
          log("ifcLoader.setup: end");

          log("file.arrayBuffer: start");
          const buffer = await file.arrayBuffer();
          log("file.arrayBuffer: end", { bytes: buffer.byteLength });
          const typedArray = new Uint8Array(buffer);

          const prevMid = this.webIfcModelId;
          if (prevMid != null && this.ifcLoader!.webIfc) {
            try {
              this.ifcLoader!.webIfc.CloseModel(prevMid);
            } catch {
              /* ignore */
            }
            this.webIfcModelId = null;
          }

          log("readIfcFile: start");
          const webIfcModelId = await this.ifcLoader!.readIfcFile(typedArray);
          this.webIfcModelId = webIfcModelId;
          log("readIfcFile: end", { webIfcModelId });

          log("ifcLoader.load: start");
          await this.ifcLoader!.load(typedArray, true, file.name.replace(/\.ifc$/i, ""));
          log("ifcLoader.load: end");
        })(),
        IFC_PARSE_AND_LOAD_TIMEOUT_MS,
        "setup + readIfcFile + load"
      );

      log("final success: parse/load promises settled (модель появится через onItemSet)");
    } catch (err) {
      log("final failure", { message: err instanceof Error ? err.message : String(err) });
      console.error("[IFC load] error:", err);
      this.ui.onModelLoaded(false);
    } finally {
      this.ui.onLoadingChange(false);
      log("loading overlay cleared (finally)");
    }
  }

  async clearSelectionAndHover(): Promise<void> {
    const h = this.highlighter;
    const fr = this.fragments;
    if (!h || !fr) return;
    try {
      await h.clear(LAYER_HOVER_STYLE);
      await h.clear(this.selectStyleName);
      await fr.core.update(true);
    } catch {
      /* ignore */
    }
    this.ui.onSelectedLayerNames([]);
    this.ui.onPropertiesLoaded([]);
    this.ui.onUiRequest({ showProperties: false });
    this.lastPickedExpressIdRef.current = null;
    this.ui.onSelectionSync();
  }

  async setItemsVisibility(ids: number[], visible: boolean): Promise<void> {
    const model = this.lastModel;
    const fragments = this.fragments;
    if (!model || !fragments || ids.length === 0 || !this.fragmentsReady) return;
    await model.setVisible(ids, visible);
    await fragments.core.update(true);
    try {
      await this.highlighter?.clear(LAYER_HOVER_STYLE);
      await fragments.core.update(true);
    } catch {
      /* ignore */
    }
  }

  fitAll(): void {
    if (!this.world || !this.fragments) return;
    const models = Array.from(this.fragments.list.values());
    if (models.length === 0) return;
    const bbox = new THREE.Box3();
    for (const m of models) {
      bbox.expandByObject((m as { object: THREE.Object3D }).object);
    }
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    void this.world.camera.controls.setLookAt(
      center.x + maxDim,
      center.y + maxDim * 0.8,
      center.z + maxDim,
      center.x,
      center.y,
      center.z,
      true
    );
  }

  updateGridVisibility(layerIds: LayerMap, visibility: LayerVisibilityMap): void {
    const grid = this.worldGrid;
    if (!grid) return;
    const names = Object.keys(layerIds);
    if (names.length === 0) {
      grid.visible = true;
      return;
    }
    const anyHidden = names.some((name) => visibility[name] === false);
    grid.visible = !anyHidden;
  }

  async highlightLayerRow(
    layerName: string,
    layerIdsByName: LayerMap,
    additive: boolean
  ): Promise<void> {
    const model = this.lastModel;
    const highlighter = this.highlighter;
    const fragments = this.fragments;
    if (!model || !highlighter || !fragments) return;
    const ids = layerIdsByName[layerName];
    if (!ids?.length) return;
    this.ui.onPropertiesLoaded([]);
    this.ui.onUiRequest({ showProperties: false });
    const map: ModelIdMap = { [model.modelId]: new Set(ids) };
    try {
      await highlighter.highlightByID(this.selectStyleName, map, !additive, false, null, false);
      await fragments.core.update(true);
      if (additive) {
        const prev = this.ui.getSelectedLayerNames();
        this.ui.onSelectedLayerNames(
          prev.includes(layerName) ? prev : [...prev, layerName]
        );
      } else {
        this.ui.onSelectedLayerNames([layerName]);
      }
    } catch (e) {
      console.warn("Подсветка слоя не удалась:", e);
    } finally {
      this.ui.onSelectionSync();
    }
  }

  async highlightPanelRows(
    layerNames: string[],
    layerIdsByName: LayerMap,
    additive: boolean
  ): Promise<void> {
    const model = this.lastModel;
    const highlighter = this.highlighter;
    const fragments = this.fragments;
    if (!model || !highlighter || !fragments) return;
    const ids = Array.from(
      new Set(layerNames.flatMap((n) => layerIdsByName[n] || []))
    );
    if (ids.length === 0) return;
    this.ui.onPropertiesLoaded([]);
    this.ui.onUiRequest({ showProperties: false });
    const map: ModelIdMap = { [model.modelId]: new Set(ids) };
    try {
      await highlighter.highlightByID(this.selectStyleName, map, !additive, false, null, false);
      await fragments.core.update(true);
      if (additive) {
        const prev = this.ui.getSelectedLayerNames();
        const merged = new Set(prev);
        for (const n of layerNames) merged.add(n);
        this.ui.onSelectedLayerNames([...merged]);
      } else {
        this.ui.onSelectedLayerNames(layerNames);
      }
    } catch (e) {
      console.warn("Подсветка панели не удалась:", e);
    } finally {
      this.ui.onSelectionSync();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.orbitWindowCleanup?.();
    this.orbitWindowCleanup = null;

    for (const u of this.persistentUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.persistentUnsubs.length = 0;

    const world = this.world;
    const scene = world?.scene.three;
    if (this.measurement && scene) {
      this.measurement.dispose(scene);
    }

    const fragmentsWasReady = this.fragmentsReady;
    this.fragmentsReady = false;

    if (fragmentsWasReady && this.components) {
      try {
        this.components.dispose();
      } catch {
        /* ignore */
      }
    } else if (world) {
      world.renderer?.dispose();
      world.scene?.dispose();
      if (world.camera?.isDisposeable?.()) world.camera.dispose();
    }

    this.components = null;
    this.world = null;
    this.fragments = null;
    this.ifcLoader = null;
    this.highlighter = null;
    this.clipper = null;
    this.measurer = null;
    this.measurement = null;
    this.worldGrid = null;
    this.lastModel = null;
  }
}
