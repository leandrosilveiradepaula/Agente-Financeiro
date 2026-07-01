import { ClipboardPaste, Database } from "lucide-react";

export type ResultMode = "auto" | "manual";

type ResultModeTabsProps = {
  mode: ResultMode;
  onModeChange: (mode: ResultMode) => void;
};

const modes = [
  { id: "auto", label: "Executar no Watson", icon: Database },
  { id: "manual", label: "Colar retorno Watson", icon: ClipboardPaste }
] as const;

export function ResultModeTabs({ mode, onModeChange }: ResultModeTabsProps) {
  return (
    <div className="inline-grid grid-cols-2 rounded-md border border-slate-200 bg-slate-100 p-1">
      {modes.map((item) => {
        const Icon = item.icon;
        const isActive = mode === item.id;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onModeChange(item.id)}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded px-3 text-sm font-semibold transition ${
              isActive
                ? "bg-white text-ink shadow-sm"
                : "text-steel hover:bg-white/70 hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
