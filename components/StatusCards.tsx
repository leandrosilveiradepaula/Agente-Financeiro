import type { LucideIcon } from "lucide-react";

type StatusTone = "neutral" | "success" | "warning" | "error";

type StatusItem = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: StatusTone;
  badge?: string;
};

type StatusCardsProps = {
  items: readonly StatusItem[];
};

const toneClassName: Record<StatusTone, string> = {
  neutral: "border-slate-200 bg-white text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-rose-200 bg-rose-50 text-rose-800"
};

const badgeClassName: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-rose-100 text-rose-800"
};

export function StatusCards({ items }: StatusCardsProps) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div
            key={item.label}
            className={`rounded-md border p-4 shadow-sm ${toneClassName[item.tone]}`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-normal text-slate-500">
                {item.label}
              </span>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </div>
            <p className="break-words text-sm font-semibold leading-5">{item.value}</p>
            {item.badge ? (
              <span
                className={`mt-3 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${badgeClassName[item.tone]}`}
              >
                {item.badge}
              </span>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
