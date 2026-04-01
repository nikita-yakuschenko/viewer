"use client";

import { PropertySet } from "./BIMViewer";
import { IconChevronCompactLeft, IconChevronCompactRight } from "@tabler/icons-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface PropertiesPanelProps {
  properties: PropertySet[];
  onClose: () => void;
  collapsed: boolean;
  isOpen: boolean;
}

const glassPanel =
  "rounded-2xl border border-white/25 bg-background/55 shadow-2xl backdrop-blur-xl supports-[backdrop-filter]:bg-background/45";

const verticalPanelTitleByButton =
  "pointer-events-none absolute left-[0.875rem] top-1/2 z-[9] flex max-h-[calc(100%-0.75rem)] min-h-0 w-6 -translate-y-1/2 items-center justify-center overflow-visible px-0.5 py-1 text-xs font-semibold uppercase leading-tight tracking-[0.11em] whitespace-nowrap text-primary [writing-mode:vertical-rl] rotate-180 sm:text-sm";

export function PropertiesPanel({ properties, onClose, collapsed, isOpen }: PropertiesPanelProps) {
  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-col", glassPanel)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
            <ScrollArea className="min-h-0 min-w-0 flex-1 p-2 pl-3.5 pr-2">
              {properties.length === 0 ? (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Кликните по элементу, чтобы увидеть свойства
                </p>
              ) : (
                properties.map((pset, psetIdx) => (
                  <div key={`${pset.name}-${psetIdx}`} className="mb-4">
                    <div className="mb-1 px-1 text-xs font-semibold text-primary">{pset.name}</div>
                    <div className="overflow-hidden rounded-md border border-white/15 bg-background/40">
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
                              i % 2 === 0 ? "bg-white/5" : "bg-transparent"
                            )}
                          >
                            <div
                              className="w-[38%] shrink-0 break-words border-r border-white/10 px-2 py-1 font-medium text-muted-foreground"
                              title={prop.name}
                            >
                              {prop.name}
                            </div>
                            <div
                              className="min-w-0 flex-1 break-words px-2 py-1 text-foreground [overflow-wrap:anywhere]"
                              title={display}
                            >
                              {prop.value === null ? (
                                <span className="text-muted-foreground">—</span>
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
        className="absolute left-0 top-1/2 z-20 flex h-12 w-3.5 -translate-y-1/2 items-center justify-center rounded-l-none rounded-r-[8px] border-0 bg-[#0D0033] p-0 text-white transition-colors hover:bg-[#130048] focus-visible:outline-none"
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

