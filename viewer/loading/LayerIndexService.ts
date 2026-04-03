import * as WEBIFC from "web-ifc";
import type { LayerIndexResult, LayerMap } from "@/viewer/core/ViewerTypes";

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

/**
 * Строит индекс слоёв IFC → product ids. Без React; может выполняться на main thread (web-ifc single-thread).
 */
export function buildLayerIndexFromIfcApi(
  api: WEBIFC.IfcAPI,
  modelID: number
): LayerIndexResult {
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
    const sortedLayers = [...byLayerName.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "ru")
    );
    const layerIdsByName: LayerMap = {};
    for (const [layerName, pids] of sortedLayers) {
      layerIdsByName[layerName] = [...pids];
    }
    if (Object.keys(layerIdsByName).length === 0) {
      return {
        layerIdsByName: {},
        banner: {
          variant: "info",
          message: "Нет слоёв (IfcPresentationLayerAssignment) в файле",
        },
      };
    }
    return { layerIdsByName, banner: null };
  } catch {
    return {
      layerIdsByName: {},
      banner: {
        variant: "error",
        message: "Не удалось построить дерево слоёв",
      },
    };
  }
}

/** Первый слой, в котором встречается product id. */
export function getLayerNameForProductId(
  layers: LayerMap,
  productId: number
): string | null {
  for (const [name, ids] of Object.entries(layers)) {
    if (ids.includes(productId)) return name;
  }
  return null;
}
