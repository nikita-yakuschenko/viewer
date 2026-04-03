"use client";

import { useEffect, useRef, useState } from "react";
import { IconInfoCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const helpRows: { keys: string; action: string }[] = [
  { keys: "Клик", action: "выбор слоя IFC" },
  { keys: "Shift + клик", action: "добавить слой к выбору" },
  { keys: "Ctrl + клик", action: "выбор элемента" },
  { keys: "Ctrl + Shift + клик", action: "добавить элемент к выбору" },
  { keys: "Tab", action: "перейти к слою по последнему клику" },
  { keys: "Наведение", action: "подсветка слоя; с Ctrl — элемента" },
];

const glassCard =
  "rounded-2xl border border-zinc-200/90 bg-white/95 text-zinc-950 shadow-xl backdrop-blur-xl dark:border-white/12 dark:bg-zinc-950/92 dark:text-zinc-50";

export function ViewerHelpPopover({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Сочетания клавиш и выбор"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-300/90 bg-white text-zinc-800 shadow-md backdrop-blur-xl transition-colors",
          "hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-950",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50",
          "dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700",
          open && "border-zinc-500 bg-zinc-100 text-zinc-950 dark:border-zinc-500 dark:bg-zinc-700 dark:text-white"
        )}
      >
        <IconInfoCircle className="h-5 w-5" stroke={1.5} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Управление выбором"
          className={cn(
            "absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(calc(100vw-2rem),22rem)] p-4 text-left",
            glassCard
          )}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Выбор в окне модели
          </p>
          <dl className="mt-3 space-y-2.5 text-sm">
            {helpRows.map((row) => (
              <div
                key={row.keys}
                className="flex gap-3 border-b border-zinc-200/90 pb-2 last:border-0 last:pb-0 dark:border-zinc-600/80"
              >
                <dt className="w-38 shrink-0 font-semibold text-zinc-900 dark:text-zinc-100">{row.keys}</dt>
                <dd className="text-zinc-700 leading-snug dark:text-zinc-300">{row.action}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
