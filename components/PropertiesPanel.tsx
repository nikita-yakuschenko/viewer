"use client";

import type { PropertySet } from "@/viewer/core/ViewerTypes";
import { IconChevronCompactLeft, IconChevronCompactRight } from "@tabler/icons-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hudGlassPanel } from "@/components/Toolbar";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface PropertiesPanelProps {
  properties: PropertySet[];
  onClose: () => void;
  collapsed: boolean;
  isOpen: boolean;
}

const verticalPanelTitleByButton =
  "pointer-events-none absolute left-[0.875rem] top-1/2 z-[9] flex max-h-[calc(100%-0.75rem)] min-h-0 w-6 -translate-y-1/2 items-center justify-center overflow-visible px-0.5 py-1 text-xs font-semibold uppercase leading-tight tracking-[0.14em] whitespace-nowrap text-zinc-900 [writing-mode:vertical-rl] rotate-180 [text-shadow:0_1px_0_rgba(255,255,255,0.75)] sm:text-sm dark:text-zinc-50 dark:[text-shadow:0_1px_1px_rgba(0,0,0,0.45)]";

export function PropertiesPanel({ properties, onClose, collapsed, isOpen }: PropertiesPanelProps) {
  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-col", hudGlassPanel)}>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl",
          collapsed && "min-h-12 bg-white/50 dark:bg-zinc-900/35"
        )}
      >
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
            <ScrollArea className="min-h-0 min-w-0 flex-1 p-2 pl-3.5 pr-2">
              {properties.length === 0 ? (
                <p className="mt-4 text-center text-xs text-zinc-700 dark:text-zinc-300">
                  Кликните по элементу, чтобы увидеть свойства
                </p>
              ) : (
                properties.map((pset, psetIdx) => (
                  <div key={`${pset.name}-${psetIdx}`} className="mb-4">
                    <div className="mb-1 px-1 text-xs font-semibold text-zinc-900 dark:text-zinc-100">{pset.name}</div>
                    <div className="overflow-hidden rounded-md border border-zinc-200/80 bg-zinc-50/90 dark:border-white/12 dark:bg-zinc-900/50">
                      {pset.properties.map((prop, i) => {
                        const display =
                          prop.value === null
                            ? "—"
                            : typeof prop.value === "boolean"
                              ? prop.value
                                ? "Да"
                                : "Нет"
                              : String(prop.value);
                        return (
                          <div
                            key={`${pset.name}-${prop.name}-${i}`}
                            className={cn(
                              "flex gap-1 text-xs",
                              i % 2 === 0 ? "bg-white/80 dark:bg-zinc-800/40" : "bg-transparent"
                            )}
                          >
                            <div
                              className="w-[38%] shrink-0 wrap-break-word border-r border-zinc-200/90 px-2 py-1 font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
                              title={prop.name}
                            >
                              {prop.name}
                            </div>
                            <div
                              className="min-w-0 flex-1 px-2 py-1 text-zinc-900 wrap-anywhere dark:text-zinc-100"
                              title={display}
                            >
                              {prop.value === null ? (
                                <span className="text-zinc-500">—</span>
                              ) : typeof prop.value === "boolean" ? (
                                <span className={prop.value ? "text-green-600" : "text-red-600"}>
                                  {prop.value ? "Да" : "Нет"}
                                </span>
                              ) : (
                                String(prop.value)
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        )}
        {collapsed && <div className="min-h-0 flex-1" aria-hidden />}
      </div>
      {collapsed && (
        <div className={verticalPanelTitleByButton} aria-hidden>
          СВОЙСТВА ЭЛЕМЕНТОВ
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute left-0 top-1/2 z-20 flex h-12 w-4 -translate-y-1/2 items-center justify-center rounded-l-none rounded-r-lg border border-l-0 border-zinc-200/90 bg-white/95 p-0 text-zinc-800 shadow-md shadow-zinc-900/10 backdrop-blur-md transition-colors hover:bg-white hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 dark:border-zinc-600 dark:bg-zinc-800/95 dark:text-zinc-100 dark:shadow-black/30 dark:hover:bg-zinc-700"
        aria-label="Свернуть"
      >
        <motion.span
          key={isOpen ? "open" : "closed"}
          initial={{ scale: 0.82, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 26, stiffness: 380 }}
          className="inline-flex"
        >
          {isOpen ? (
            <IconChevronCompactRight className="h-4 w-4" stroke={2} />
          ) : (
            <IconChevronCompactLeft className="h-4 w-4" stroke={2} />
          )}
        </motion.span>
      </button>
    </div>
  );
}

