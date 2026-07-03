"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type AccordionSectionProps = {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function AccordionSection({
  title,
  summary,
  defaultOpen = false,
  children
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {summary ? (
            <span className="mt-0.5 block truncate text-xs font-medium text-steel">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-none text-slate-500 transition ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? <div className="border-t border-slate-200 bg-slate-50 p-3">{children}</div> : null}
    </section>
  );
}
