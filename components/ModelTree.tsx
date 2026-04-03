"use client";

import { useEffect, useState } from "react";
import type { TreeNode } from "@/viewer/core/ViewerTypes";
import {
  IconChevronCompactLeft,
  IconChevronCompactRight,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { StructureLayerToolsPanel } from "./Toolbar";

interface ModelTreeProps {
  treeData: TreeNode[];
  onClose: () => void;
  modelLoaded: boolean;
  isOpen: boolean;
  collapsed: boolean;
  /** Имя загруженного IFC (без пути) */
  modelName: string;
  /** Группировать слои по маркеру панели (П(К)-01 и т.п.). */
  groupLayersByPanel: boolean;
  onGroupLayersByPanelChange: (value: boolean) => void;
  /** Режим: сворачиваем внутреннюю структуру (детали) до списка панелей. */
  structureCollapsed: boolean;
  onToggleStructureCollapsed: (value: boolean) => void;
  allLayersVisible: boolean;
  isLayerVisible: (layerName: string) => boolean;
  onToggleAllLayersVisibility: () => void;
  onToggleLayerVisibility: (layerName: string) => void;
  /** Показать/скрыть все слои, входящие в панель. */
  onTogglePanelVisibility: (layerNames: string[]) => void;
  selectedLayerNames: string[];
  onLayerRowSelect: (layerName: string, additive: boolean) => void;
  /** Выделить всю панель в сборе (все связанные слои). */
  onPanelRowSelect: (layerNames: string[], additive: boolean) => void;
  onFitAll: () => void;
  isolateSelectionActive: boolean;
  isolateSelectionEnabled: boolean;
  onToggleIsolateSelection: () => void;
}

const glassPanel =
  "rounded-2xl border border-white/25 bg-background/55 shadow-2xl backdrop-blur-xl supports-[backdrop-filter]:bg-background/45";

const verticalPanelTitleByButton =
  "pointer-events-none absolute right-[0.875rem] top-1/2 z-[9] flex max-h-[calc(100%-0.75rem)] min-h-0 w-6 -translate-y-1/2 items-center justify-center overflow-visible px-0.5 py-1 text-xs font-semibold uppercase leading-tight tracking-[0.11em] whitespace-nowrap text-primary [writing-mode:vertical-rl] rotate-180 sm:text-sm";

const LAYER_NODE_TYPE = "IfcPresentationLayerAssignment";
const PANEL_GROUP_TYPE = "IfcPanelGroup";

export function ModelTree({
  treeData,
  onClose,
  modelLoaded,
  isOpen,
  collapsed,
  modelName,
  groupLayersByPanel,
  onGroupLayersByPanelChange,
  structureCollapsed,
  onToggleStructureCollapsed,
  allLayersVisible,
  isLayerVisible,
  onToggleAllLayersVisibility,
  onToggleLayerVisibility,
  onTogglePanelVisibility,
  selectedLayerNames,
  onLayerRowSelect,
  onPanelRowSelect,
  onFitAll,
  isolateSelectionActive,
  isolateSelectionEnabled,
  onToggleIsolateSelection,
}: ModelTreeProps) {
  useEffect(() => {
    const last = selectedLayerNames[selectedLayerNames.length - 1];
    if (!last) return;
    const safe =
      typeof CSS !== "undefined" && "escape" in CSS
        ? CSS.escape(last)
        : last.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const el = document.querySelector(`[data-layer-row="${safe}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedLayerNames]);

  const [expandedPanelKeys, setExpandedPanelKeys] = useState<Set<string>>(
    () => new Set()
  );

  // По умолчанию раскрываем все панели: это убирает UX-рывок и соответствует ожидаемому "иерархическому" виду.
  useEffect(() => {
    if (collapsed) return;
    const panelKeys = treeData
      .filter((n) => n.type === PANEL_GROUP_TYPE && n.children.length > 0)
      .map((n) => n.panelKey ?? n.name);

    setExpandedPanelKeys((prev) => {
      // Удаляем устаревшие ключи и добавляем новые.
      const next = new Set(prev);
      for (const k of next) {
        if (!panelKeys.includes(k)) next.delete(k);
      }
      for (const k of panelKeys) next.add(k);
      return next;
    });
  }, [treeData, collapsed]);

  const onTogglePanelExpanded = (panelKey: string) => {
    setExpandedPanelKeys((prev) => {
      const next = new Set(prev);
      if (next.has(panelKey)) next.delete(panelKey);
      else next.add(panelKey);
      return next;
    });
  };

  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-col", glassPanel)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-white/10 px-2.5 pb-2 pt-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Файл
              </div>
              <div
                className="mt-0.5 truncate text-xs font-medium leading-snug text-foreground"
                title={modelName || undefined}
              >
                {modelName || "—"}
              </div>
            </div>
            <div className="shrink-0 px-2.5 pb-2">
              <button
                type="button"
                disabled={!modelLoaded}
                onClick={() => onToggleStructureCollapsed(!structureCollapsed)}
                className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
                title={
                  structureCollapsed
                    ? "Развернуть структуру (панель + подслои)"
                    : "Свернуть до списка панелей"
                }
              >
                {structureCollapsed ? "Структура проекта" : "Список панелей"}
              </button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-1.5 pr-1 pt-0.5">
              {!modelLoaded ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Модель не загружена
                </p>
              ) : treeData.length === 0 ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Строю структуру модели...
                </p>
              ) : structureCollapsed ? (
                (() => {
                  const panelNodes = treeData.filter(
                    (n) => n.type === PANEL_GROUP_TYPE && n.children.length > 0
                  );
                  const nodesToRender =
                    panelNodes.length > 0
                      ? panelNodes
                      : treeData.filter((n) => n.type === LAYER_NODE_TYPE);

                  if (nodesToRender.length === 0) {
                    return (
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        Нет панелей
                      </p>
                    );
                  }

                  return nodesToRender.map((node) => {
                    if (node.type === PANEL_GROUP_TYPE) {
                      const layerNames = node.children.map((c) => c.name);
                      const panelVisible = layerNames.every((n) =>
                        isLayerVisible(n)
                      );
                      const panelActive =
                        layerNames.length > 0 &&
                        layerNames.every((n) => selectedLayerNames.includes(n));
                      const panelKey = node.panelKey ?? node.name;

                      return (
                        <div
                          key={node.expressID}
                          data-panel-row={panelKey}
                          className={cn(
                            "mb-1 inline-flex max-w-full cursor-pointer rounded-md px-1.5 py-1 align-top",
                            panelActive
                              ? "bg-primary/15 ring-1 ring-inset ring-primary/35"
                              : "hover:bg-white/10"
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            onPanelRowSelect(layerNames, e.shiftKey);
                          }}
                        >
                          <div className="flex min-w-0 max-w-full items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePanelVisibility(layerNames);
                              }}
                              className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none"
                              aria-label={
                                panelVisible
                                  ? `Скрыть панель ${node.name}`
                                  : `Показать панель ${node.name}`
                              }
                              title={
                                panelVisible
                                  ? "Скрыть все слои панели"
                                  : "Показать все слои панели"
                              }
                            >
                              {panelVisible ? (
                                <IconEye className="h-3.5 w-3.5" stroke={1.8} />
                              ) : (
                                <IconEyeOff className="h-3.5 w-3.5" stroke={1.8} />
                              )}
                            </button>
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                              {node.name}
                            </span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <TreeNodeItem
                        key={node.expressID}
                        node={node}
                        depth={0}
                        isLayerVisible={isLayerVisible}
                        onToggleLayerVisibility={onToggleLayerVisibility}
                        onTogglePanelVisibility={onTogglePanelVisibility}
                        selectedLayerNames={selectedLayerNames}
                        onLayerRowSelect={onLayerRowSelect}
                        onPanelRowSelect={onPanelRowSelect}
                        structureCollapsed={structureCollapsed}
                        expandedPanelKeys={expandedPanelKeys}
                        onTogglePanelExpanded={onTogglePanelExpanded}
                      />
                    );
                  });
                })()
              ) : (
                treeData.map((node) => (
                  <TreeNodeItem
                    key={node.expressID}
                    node={node}
                    depth={0}
                    isLayerVisible={isLayerVisible}
                    onToggleLayerVisibility={onToggleLayerVisibility}
                    onTogglePanelVisibility={onTogglePanelVisibility}
                    selectedLayerNames={selectedLayerNames}
                    onLayerRowSelect={onLayerRowSelect}
                    onPanelRowSelect={onPanelRowSelect}
                    structureCollapsed={structureCollapsed}
                    expandedPanelKeys={expandedPanelKeys}
                    onTogglePanelExpanded={onTogglePanelExpanded}
                  />
                ))
              )}
            </ScrollArea>
            <div className="shrink-0 border-t border-white/10 px-2 pb-2 pt-2">
              <StructureLayerToolsPanel
                modelLoaded={modelLoaded}
                allLayersVisible={allLayersVisible}
                onToggleAllLayersVisibility={onToggleAllLayersVisibility}
                groupLayersByPanel={groupLayersByPanel}
                onGroupLayersByPanelChange={onGroupLayersByPanelChange}
                isolateSelectionActive={isolateSelectionActive}
                isolateSelectionEnabled={isolateSelectionEnabled}
                onToggleIsolateSelection={onToggleIsolateSelection}
                onFitAll={onFitAll}
              />
            </div>
          </div>
        )}
      </div>
      {collapsed && (
        <div className={verticalPanelTitleByButton} aria-hidden>
          СТРУКТУРА ПРОЕКТА
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-0 top-1/2 z-20 flex h-12 w-3.5 -translate-y-1/2 items-center justify-center rounded-l-[8px] rounded-r-none border-0 bg-[#0D0033] p-0 text-white transition-colors hover:bg-[#130048] focus-visible:outline-none"
        aria-label={isOpen ? "Свернуть панель" : "Развернуть панель"}
      >
        <motion.span
          key={isOpen ? "open" : "closed"}
          initial={{ scale: 0.82, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 26, stiffness: 380 }}
          className="inline-flex"
        >
          {isOpen ? (
            <IconChevronCompactLeft className="h-4 w-4" stroke={2} />
          ) : (
            <IconChevronCompactRight className="h-4 w-4" stroke={2} />
          )}
        </motion.span>
      </button>
    </div>
  );
}

function TreeNodeItem({
  node,
  depth,
  isLayerVisible,
  onToggleLayerVisibility,
  onTogglePanelVisibility,
  selectedLayerNames,
  onLayerRowSelect,
  onPanelRowSelect,
  structureCollapsed,
  expandedPanelKeys,
  onTogglePanelExpanded,
}: {
  node: TreeNode;
  depth: number;
  isLayerVisible: (layerName: string) => boolean;
  onToggleLayerVisibility: (layerName: string) => void;
  onTogglePanelVisibility: (layerNames: string[]) => void;
  selectedLayerNames: string[];
  onLayerRowSelect: (layerName: string, additive: boolean) => void;
  onPanelRowSelect: (layerNames: string[], additive: boolean) => void;
  structureCollapsed: boolean;
  expandedPanelKeys: Set<string>;
  onTogglePanelExpanded: (panelKey: string) => void;
}) {
  const isLayerNode = node.type === LAYER_NODE_TYPE;
  const isPanel = node.type === PANEL_GROUP_TYPE;

  if (node.type === "Info" || node.type === "Error") {
    return (
      <div className="mb-1 rounded-md px-1.5 py-2 text-xs text-muted-foreground">
        {node.name}
      </div>
    );
  }

  if (isPanel && node.children.length > 0) {
    const layerNames = node.children.map((c) => c.name);
    const panelVisible = layerNames.every((n) => isLayerVisible(n));
    const panelActive =
      layerNames.length > 0 && layerNames.every((n) => selectedLayerNames.includes(n));
    const panelKey = node.panelKey ?? node.name;
    const expanded =
      !structureCollapsed &&
      (expandedPanelKeys.size === 0 || expandedPanelKeys.has(panelKey));

    return (
      <div className={cn("mb-1", depth > 0 && "ml-2 border-l border-white/10 pl-2")}>
        <div
          data-panel-row={panelKey}
          className={cn(
            "inline-flex max-w-full cursor-pointer rounded-md px-1.5 py-1 align-top",
            panelActive
              ? "bg-primary/15 ring-1 ring-inset ring-primary/35"
              : "hover:bg-white/10"
          )}
          onClick={(e) => onPanelRowSelect(layerNames, e.shiftKey)}
        >
          <div className="flex min-w-0 max-w-full items-center gap-1.5">
            {!structureCollapsed && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePanelExpanded(panelKey);
                }}
                className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none"
                aria-label={expanded ? `Свернуть панель ${node.name}` : `Развернуть панель ${node.name}`}
                title={expanded ? "Свернуть" : "Развернуть"}
              >
                {expanded ? (
                  <IconChevronDown className="h-3.5 w-3.5" stroke={1.8} />
                ) : (
                  <IconChevronRight className="h-3.5 w-3.5" stroke={1.8} />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePanelVisibility(layerNames);
              }}
              className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none"
              aria-label={
                panelVisible ? `Скрыть панель ${node.name}` : `Показать панель ${node.name}`
              }
              title={panelVisible ? "Скрыть все слои панели" : "Показать все слои панели"}
            >
              {panelVisible ? (
                <IconEye className="h-3.5 w-3.5" stroke={1.8} />
              ) : (
                <IconEyeOff className="h-3.5 w-3.5" stroke={1.8} />
              )}
            </button>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {node.name}
            </span>
          </div>
        </div>
        {expanded && (
          <div className="mt-0.5 pl-1">
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.expressID}
                node={child}
                depth={depth + 1}
                isLayerVisible={isLayerVisible}
                onToggleLayerVisibility={onToggleLayerVisibility}
                onTogglePanelVisibility={onTogglePanelVisibility}
                selectedLayerNames={selectedLayerNames}
                onLayerRowSelect={onLayerRowSelect}
                onPanelRowSelect={onPanelRowSelect}
                structureCollapsed={structureCollapsed}
                expandedPanelKeys={expandedPanelKeys}
                onTogglePanelExpanded={onTogglePanelExpanded}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!isLayerNode) {
    return (
      <div className="rounded-md px-1.5 py-1.5 text-xs text-muted-foreground">
        {node.name}
      </div>
    );
  }

  const layerVisible = isLayerVisible(node.name);
  const isLayerActive = selectedLayerNames.includes(node.name);

  return (
    <div className={cn("mb-0.5", depth > 0 && "ml-0")}>
      <div
        data-layer-row={node.name}
        className={cn(
          "inline-block max-w-full cursor-pointer rounded-md px-1.5 py-1 align-top",
          isLayerActive
            ? "bg-primary/15 ring-1 ring-inset ring-primary/35"
            : "hover:bg-white/10"
        )}
        onClick={(e) => onLayerRowSelect(node.name, e.shiftKey)}
      >
        <div className="flex min-w-0 max-w-full items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLayerVisibility(node.name);
            }}
            className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none"
            aria-label={layerVisible ? `Скрыть слой ${node.name}` : `Показать слой ${node.name}`}
            title={layerVisible ? "Скрыть слой" : "Показать слой"}
          >
            {layerVisible ? (
              <IconEye className="h-3.5 w-3.5" stroke={1.8} />
            ) : (
              <IconEyeOff className="h-3.5 w-3.5" stroke={1.8} />
            )}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{node.name}</span>
        </div>
      </div>
    </div>
  );
}
