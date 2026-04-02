/**
 * Группировка имён IFC-слоёв (IfcPresentationLayerAssignment) по «панели в сборе».
 *
 * Правило:
 * - Панель определяется по общему идентификатору в названии слоя.
 * - Идентификатор обычно находится в конце, например:
 *   - «... П(К)-01»
 *   - «... Ст-1-08»
 *   - «... Р-01»
 *
 * Если идентификатор не найден (или встречается только в одном слое) —
 * слой остаётся верхнеуровневым.
 */

// Пример: П(К)-01. Специально, потому что внутри скобок.
const PANEL_MARK_PATTERN_PAREN = /П\([^)]+\)-\d+/u;

// Примеры: Ст-1-08, Р-01.
// Буквы (1..3) + цифры с одним/несколькими "-числами".
const PANEL_MARK_PATTERN_GENERIC = /([A-Za-zА-ЯЁ]{1,3}-\d+(?:-\d+)*)/u;

export function extractPanelMarkFromLayerName(layerName: string): string | null {
  const mParen = layerName.match(PANEL_MARK_PATTERN_PAREN);
  if (mParen) return mParen[0].trim();

  const mGen = layerName.match(PANEL_MARK_PATTERN_GENERIC);
  if (mGen && mGen[1]) return mGen[1].trim();

  return null;
}

export function groupLayerNamesByPanel(layerNames: readonly string[]): {
  /** Маркер панели → список полных имён слоёв (отсортирован). */
  panelGroups: Map<string, string[]>;
  /** Слои без распознанного маркера панели. */
  ungrouped: string[];
} {
  const panelGroups = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const name of layerNames) {
    const mark = extractPanelMarkFromLayerName(name);
    if (!mark) {
      ungrouped.push(name);
      continue;
    }
    let list = panelGroups.get(mark);
    if (!list) {
      list = [];
      panelGroups.set(mark, list);
    }
    list.push(name);
  }

  // Создаём группу панели только если маркер встречается минимум в 2 слоях.
  // Если маркер уникален — считаем, что "нет общего идентификатора".
  for (const [mark, list] of [...panelGroups.entries()]) {
    if (list.length < 2) {
      panelGroups.delete(mark);
      ungrouped.push(...list);
      continue;
    }
    list.sort((a, b) => a.localeCompare(b, "ru"));
  }
  ungrouped.sort((a, b) => a.localeCompare(b, "ru"));
  return { panelGroups, ungrouped };
}

/** Все имена слоёв, входящих в одну панель по маркеру. */
export function getLayerNamesForPanelMark(
  layerNames: readonly string[],
  panelMark: string
): string[] {
  const { panelGroups } = groupLayerNamesByPanel(layerNames);
  return panelGroups.get(panelMark) ?? [];
}
