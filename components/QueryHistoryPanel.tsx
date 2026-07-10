import { CheckCircle2, Clock3, FileDown, History, RotateCcw, Trash2 } from "lucide-react";
import type { QueryHistoryItem } from "@/lib/types";

type QueryHistoryPanelProps = {
  items: QueryHistoryItem[];
  onSelectItem: (item: QueryHistoryItem) => void;
  onRemoveItem: (id: string) => void;
  onClearHistory: () => void;
};

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Data indisponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function historyStatusLabel(item: QueryHistoryItem) {
  if (item.result_source === "manual") {
    return "Resultado manual";
  }

  if (item.executed_watson) {
    return "Executada";
  }

  return "Gerada";
}

function cacheStatusLabel(item: QueryHistoryItem) {
  if (item.cache_enabled === undefined) {
    return "";
  }

  if (!item.cache_enabled) {
    return "cache off";
  }

  return item.cache_hit ? "cache hit" : "cache miss";
}

export function QueryHistoryPanel({
  items = [],
  onSelectItem = () => undefined,
  onRemoveItem = () => undefined,
  onClearHistory = () => undefined
}: Partial<QueryHistoryPanelProps>) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-lake" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Histórico</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-steel">
            {items.length}
          </span>
          {items.length ? (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-steel transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      {items.length ? (
        <div className="flex max-h-[360px] flex-col gap-2 overflow-auto pr-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  {formatDate(item.created_at)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                    item.executed_watson
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {item.executed_watson ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {historyStatusLabel(item)}
                </span>
              </div>
              <p className="line-clamp-3 text-sm font-semibold leading-5 text-ink">
                {item.pergunta}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-steel">
                <span className="rounded-md bg-white px-2 py-1">
                  {item.detected_intent || "sem_intencao"}
                </span>
                <span className="rounded-md bg-white px-2 py-1">
                  {item.validation_status || "sem_status"}
                </span>
                {item.query_id ? (
                  <span className="rounded-md bg-white px-2 py-1">ID {item.query_id}</span>
                ) : null}
                {cacheStatusLabel(item) ? (
                  <span className="rounded-md bg-white px-2 py-1">
                    {cacheStatusLabel(item)}
                  </span>
                ) : null}
                {item.pdfExported ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-blue-700">
                    <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                    PDF exportado
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-ink transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Recarregar
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-steel transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remover item
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-steel">
          Nenhuma pergunta no histórico ainda.
        </div>
      )}
    </section>
  );
}
