"use client";

import { TreeNode } from "./BIMViewer";
import {
  IconChevronCompactLeft,
  IconChevronCompactRight,
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
  allLayersVisible: boolean;
  isLayerVisible: (layerName: string) => boolean;
  onToggleAllLayersVisibility: () => void;
  onToggleLayerVisibility: (layerName: string) => void;
  selectedLayerName: string | null;
  onLayerRowSelect: (layerName: string) => void;
  onFitAll: () => void;
}

const glassPanel =
  "rounded-2xl border border-white/25 bg-background/55 shadow-2xl backdrop-blur-xl supports-[backdrop-filter]:bg-background/45";

const verticalPanelTitleByButton =
  "pointer-events-none absolute right-[0.875rem] top-1/2 z-[9] flex max-h-[calc(100%-0.75rem)] min-h-0 w-6 -translate-y-1/2 items-center justify-center overflow-visible px-0.5 py-1 text-xs font-semibold uppercase leading-tight tracking-[0.11em] whitespace-nowrap text-primary [writing-mode:vertical-rl] rotate-180 sm:text-sm";

export function ModelTree({
  treeData,
  onClose,
  modelLoaded,
  isOpen,
  collapsed,
  modelName,
  allLayersVisible,
  isLayerVisible,
  onToggleAllLayersVisibility,
  onToggleLayerVisibility,
  selectedLayerName,
  onLayerRowSelect,
  onFitAll,
}: ModelTreeProps) {
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
            <ScrollArea className="min-h-0 flex-1 px-1.5 pr-1 pt-2">
              {!modelLoaded ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">Модель не загружена</p>
              ) : treeData.length === 0 ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">Строю структуру модели...</p>
              ) : (
                treeData.map((node) => (
                  <TreeNodeItem
                    key={node.expressID}
                    node={node}
                    isLayerVisible={isLayerVisible}
                    onToggleLayerVisibility={onToggleLayerVisibility}
                    selectedLayerName={selectedLayerName}
                    onLayerRowSelect={onLayerRowSelect}
                  />
                ))
              )}
            </ScrollArea>
            <div className="shrink-0 border-t border-white/10 px-2 pb-2 pt-2">
              <StructureLayerToolsPanel
                modelLoaded={modelLoaded}
                allLayersVisible={allLayersVisible}
                onToggleAllLayersVisibility={onToggleAllLayersVisibility}
                onFitAll={onFitAll}
              />
            </div>
          </div>
        )}
        {collapsed && <div className="min-h-0 flex-1" aria-hidden />}
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

const LAYER_NODE_TYPE = "IfcPresentationLayerAssignment";

function TreeNodeItem({
  node,
  isLayerVisible,
  onToggleLayerVisibility,
  selectedLayerName,
  onLayerRowSelect,
}: {
  node: TreeNode;
  isLayerVisible: (layerName: string) => boolean;
  onToggleLayerVisibility: (layerName: string) => void;
  selectedLayerName: string | null;
  onLayerRowSelect: (layerName: string) => void;
}) {
  const isLayerNode = node.type === LAYER_NODE_TYPE;
  const layerVisible = isLayerNode ? isLayerVisible(node.name) : true;
  const isLayerActive = isLayerNode && selectedLayerName === node.name;

  if (!isLayerNode) {
    return (
      <div className="rounded-md px-1.5 py-1.5 text-xs text-muted-foreground">
        {node.name}
      </div>
    );
  }

  return (
    <div className="mb-0.5">
      <div
        className={cn(
          "inline-block max-w-full cursor-pointer rounded-md px-1.5 py-1 align-top",
          isLayerActive
            ? "bg-primary/15 ring-1 ring-inset ring-primary/35"
            : "hover:bg-white/10"
        )}
        onClick={() => onLayerRowSelect(node.name)}
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
