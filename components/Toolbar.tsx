"use client";

import { useRef } from "react";
import {
  IconBorderCorners,
  IconEye,
  IconEyeOff,
  IconFocusCentered,
  IconFolderOpen,
  IconRuler,
  IconScissors,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Общий glass для HUD: плотнее фон + явный тёмный текст (не muted на полупрозрачном слое). */
export const hudGlassPanel =
  "rounded-2xl border border-zinc-200/90 bg-white/92 text-zinc-950 shadow-lg shadow-zinc-900/10 backdrop-blur-xl dark:border-white/12 dark:bg-zinc-950/88 dark:text-zinc-50 dark:shadow-black/30";

const structureLayerToolsBar =
  "structure-layer-tools w-full rounded-2xl border border-white/15 bg-zinc-900/40 px-2.5 py-2 shadow-inner backdrop-blur-md dark:bg-zinc-950/50";

interface ToolbarProps {
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Верхняя полоса: название приложения и открытие IFC. */
export function Toolbar({ onFileUpload }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        hudGlassPanel,
        "flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 transition-shadow"
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={onFileUpload}
      />
      <div className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        BIM Viewer
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="shrink-0 border-zinc-300/80 bg-white text-zinc-950 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-700"
        onClick={() => fileInputRef.current?.click()}
        title="Открыть IFC-файл"
      >
        <IconFolderOpen className="mr-1.5 h-4 w-4" stroke={1.5} />
        <span className="text-xs font-medium">Открыть</span>
      </Button>
    </div>
  );
}

export interface StructureLayerToolsPanelProps {
  modelLoaded: boolean;
  allLayersVisible: boolean;
  onToggleAllLayersVisibility: () => void;
  /** Группировать слои по панелям (маркер в имени слоя). */
  groupLayersByPanel: boolean;
  onGroupLayersByPanelChange: (value: boolean) => void;
  /** Изоляция выделения: скрыть остальное и вписать в кадр; повтор — снять. */
  isolateSelectionActive: boolean;
  isolateSelectionEnabled: boolean;
  onToggleIsolateSelection: () => void;
  onFitAll: () => void;
}

/** Низ панели «Структура проекта»: слои, изоляция выделения, сброс вида. */
export function StructureLayerToolsPanel({
  modelLoaded,
  allLayersVisible,
  onToggleAllLayersVisibility,
  groupLayersByPanel,
  onGroupLayersByPanelChange,
  isolateSelectionActive,
  isolateSelectionEnabled,
  onToggleIsolateSelection,
  onFitAll,
}: StructureLayerToolsPanelProps) {
  return (
    <div className={structureLayerToolsBar}>
      <div className="flex w-full flex-wrap items-center justify-center gap-1">
        <StructureDarkToolButton
          onClick={onToggleAllLayersVisibility}
          title={allLayersVisible ? "Скрыть все слои" : "Показать все слои"}
          disabled={!modelLoaded}
        >
          {allLayersVisible ? (
            <IconEye className="h-4 w-4 shrink-0" stroke={2} />
          ) : (
            <IconEyeOff className="h-4 w-4 shrink-0" stroke={2} />
          )}
          <span className="ml-1 text-xs font-medium">Слои</span>
        </StructureDarkToolButton>

        <StructureDarkDivider />

        <StructureDarkToolButton
          onClick={onToggleIsolateSelection}
          title={
            isolateSelectionActive
              ? "Снять изоляцию — показать модель по слоям и сбросить камеру на всю модель"
              : "Изолировать выделение: скрыть остальное и вписать выбранное в кадр"
          }
          disabled={!isolateSelectionEnabled}
          active={isolateSelectionActive}
        >
          <IconFocusCentered className="h-4 w-4 shrink-0" stroke={2} />
          <span className="ml-1 text-xs font-medium">Изоляция</span>
        </StructureDarkToolButton>

        <StructureDarkDivider />

        <StructureDarkToolButton
          onClick={onFitAll}
          title="Сброс вида — показать всю модель в кадре"
          disabled={!modelLoaded}
        >
          <IconBorderCorners className="h-4 w-4 shrink-0" stroke={2} />
          <span className="ml-1 text-xs font-medium">Сброс</span>
        </StructureDarkToolButton>

        <StructureDarkDivider />

        <label className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-zinc-100/90">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 shrink-0 rounded border border-white/30 bg-background/40 accent-primary"
            checked={groupLayersByPanel}
            onChange={(e) => onGroupLayersByPanelChange(e.target.checked)}
            disabled={!modelLoaded}
          />
          <span className="whitespace-nowrap">Группировать панели</span>
        </label>
      </div>
    </div>
  );
}

export interface ViewportToolsPanelProps {
  modelLoaded: boolean;
  activeTool: "none" | "measure" | "clip";
  onToggleMeasure: () => void;
  onToggleClip: () => void;
  onDeleteMeasurements: () => void;
  onDeleteClips: () => void;
}

/** Низ основного вьюпорта: измерения и сечения. */
export function ViewportToolsPanel({
  modelLoaded,
  activeTool,
  onToggleMeasure,
  onToggleClip,
  onDeleteMeasurements,
  onDeleteClips,
}: ViewportToolsPanelProps) {
  return (
    <div className={cn(hudGlassPanel, "px-3 py-2.5")}>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <ToolButton
          onClick={onToggleMeasure}
          title="Измерение длины"
          active={activeTool === "measure"}
          disabled={!modelLoaded}
        >
          <IconRuler className="h-4 w-4" stroke={1.5} />
          <span className="ml-1 text-xs">Измерение</span>
        </ToolButton>
        <ToolButton
          onClick={onDeleteMeasurements}
          title="Удалить все измерения"
          disabled={!modelLoaded}
        >
          <IconTrash className="h-4 w-4" stroke={1.5} />
          <span className="ml-1 text-xs">Очистить замеры</span>
        </ToolButton>

        <Divider />

        <ToolButton
          onClick={onToggleClip}
          title="Секущая плоскость"
          active={activeTool === "clip"}
          disabled={!modelLoaded}
        >
          <IconScissors className="h-4 w-4" stroke={1.5} />
          <span className="ml-1 text-xs">Сечение</span>
        </ToolButton>
        <ToolButton
          onClick={onDeleteClips}
          title="Удалить все сечения"
          disabled={!modelLoaded}
        >
          <IconTrash className="h-4 w-4" stroke={1.5} />
          <span className="ml-1 text-xs">Очистить сечения</span>
        </ToolButton>
      </div>
    </div>
  );
}

function StructureDarkToolButton({
  children,
  onClick,
  title,
  disabled = false,
  active = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** Включённый режим (например изоляция активна). */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-100/95",
        "transition-colors hover:bg-white/15 active:bg-white/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900/50",
        active && "bg-white/20 text-white"
      )}
    >
      {children}
    </button>
  );
}

function StructureDarkDivider() {
  return (
    <Separator orientation="vertical" className="mx-0.5 h-5 bg-white/22" />
  );
}

function ToolButton({
  children,
  onClick,
  title,
  active = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      title={title}
      disabled={disabled}
      size="sm"
      variant={active ? "default" : "ghost"}
      className={cn(
        "h-8 shrink-0 px-2 font-medium",
        !active &&
          "text-zinc-900 hover:bg-zinc-900/6 hover:text-zinc-950 dark:text-zinc-100 dark:hover:bg-white/10 dark:hover:text-white"
      )}
    >
      {children}
    </Button>
  );
}

function Divider() {
  return (
    <Separator orientation="vertical" className="mx-0.5 h-5 bg-black/10 dark:bg-white/15" />
  );
}
