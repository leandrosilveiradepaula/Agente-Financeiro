import { ClipboardPaste, Database } from "lucide-react";

export type ResultMode = "auto" | "manual";

type ResultModeTabsProps = {
  mode: ResultMode;
  disabledModes?: ResultMode[];
  onModeChange: (mode: ResultMode) => void;
};

const modes = [
  { id: "auto", label: "Executar no Watson", icon: Database },
  { id: "manual", label: "Colar retorno Watson", icon: ClipboardPaste }
] as const;

export function ResultModeTabs({ mode, disabledModes = [], onModeChange }: ResultModeTabsProps) {
  return (
    <div className="inline-grid grid-cols-2 rounded-md border border-slate-200 bg-slate-100 p-1">
      {modes.map((item) => {
        const Icon = item.icon;
        const isActive = mode === item.id;
        const isDisabled = disabledModes.includes(item.id);

        return (
          <button
            key={item.id}
            type="button"
            disabled={isDisabled}
            onClick={() => {
              if (!isDisabled) onModeChange(item.id);
            }}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:text-slate-400 ${
              isActive
                ? "bg-white text-ink shadow-sm"
                : "text-steel hover:bg-white/70 hover:text-ink"
            } ${isDisabled ? "hover:bg-transparent hover:text-slate-400" : ""}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
