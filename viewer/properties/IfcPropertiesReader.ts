import type * as OBC from "@thatopen/components";
import type { PropertyItem, PropertySet } from "@/viewer/core/ViewerTypes";

/**
 * Полный граф свойств IFC через ThatOpen Fragments (как в IDS Property facet).
 */
export const FRAGMENTS_ITEM_DATA_PSETS = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: { attributes: true, relations: true },
    IsTypedBy: { attributes: true, relations: false },
    HasPropertySets: { attributes: true, relations: true },
    DefinesOcurrence: { attributes: false, relations: false },
  },
  relationsDefault: { attributes: false, relations: false },
} as const;

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

export async function loadPropertySetsForSelection(
  fragments: OBC.FragmentsManager,
  selection: Record<string, Set<number>>
): Promise<PropertySet[]> {
  console.log("[IFC properties] read: start (выбор элемента, не загрузка файла)");
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
      } catch {
        /* element may not have properties */
      }
      break;
    }
    break;
  }

  console.log("[IFC properties] read: end", { propertySetCount: propertySets.length });
  return propertySets;
}
