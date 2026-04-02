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

const glassPanel =
  "rounded-2xl border border-white/25 bg-background/55 shadow-2xl backdrop-blur-xl supports-[backdrop-filter]:bg-background/45";

const structureLayerToolsDark =
  "structure-layer-tools w-full rounded-xl border border-white/18 bg-[#0D0033] px-2.5 py-2.5 shadow-inner";

interface ToolbarProps {
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Верхняя полоса: название приложения и открытие IFC. */
export function Toolbar({ onFileUpload }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        glassPanel,
        "flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5"
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={onFileUpload}
      />
      <div className="text-sm font-semibold tracking-tight">BIM Viewer</div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => fileInputRef.current?.click()}
        title="Открыть IFC-файл"
      >
        <IconFolderOpen className="mr-1.5 h-4 w-4" stroke={1.5} />
        <span className="text-xs">Открыть</span>
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
    <div className={structureLayerToolsDark}>
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

        <label className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-white/90">
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
    <div className={cn(glassPanel, "px-3 py-2.5")}>
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
          title="Удалить измерения"
          disabled={!modelLoaded}
        >
          <IconTrash className="h-4 w-4" stroke={1.5} />
          <span className="ml-1 text-xs">Сброс</span>
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
          <span className="ml-1 text-xs">Сброс</span>
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
        "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium",
        "transition-colors hover:bg-white/15 active:bg-white/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0033]",
        active && "bg-white/18 text-white"
      )}
    >
      {children}
    </button>
  );
}

function StructureDarkDivider() {
  return (
    <Separator orientation="vertical" className="mx-0.5 h-5 bg-white/30" />
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
      className="h-8 shrink-0 px-2"
    >
      {children}
    </Button>
  );
}

function Divider() {
  return (
    <Separator orientation="vertical" className="mx-0.5 h-5 bg-white/20" />
  );
}
