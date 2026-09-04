import { SendHorizontal } from "lucide-react";

type QuestionInputProps = {
  question: string;
  canSubmit: boolean;
  disabled?: boolean;
  disabledMessage?: string;
  isLoading: boolean;
  useSqlCache: boolean;
  onQuestionChange: (value: string) => void;
  onUseSqlCacheChange: (value: boolean) => void;
  onSubmit: () => void;
};

export function QuestionInput({
  question,
  canSubmit,
  disabled = false,
  disabledMessage,
  isLoading,
  useSqlCache,
  onQuestionChange,
  onUseSqlCacheChange,
  onSubmit
}: QuestionInputProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-ink">O que você gostaria de analisar?</h2>
      </div>

      <textarea
        aria-label="Pergunta em linguagem natural"
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        disabled={disabled}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSubmit) {
            onSubmit();
          }
        }}
        placeholder="Ex.: Quais marcas tiveram maior receita no último mês?"
        className="min-h-40 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-base leading-6 text-ink placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      />

      {disabledMessage ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {disabledMessage}
        </div>
      ) : null}

      <label className="mt-3 flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            Reaproveitar análises já processadas
          </span>
          <span className="mt-1 block text-xs leading-5 text-steel">
            Usa resultados previamente processados quando houver correspondência válida,
            reduzindo tempo e consumo de recursos.
          </span>
        </span>
        <input
          type="checkbox"
          checked={useSqlCache}
          disabled={disabled}
          onChange={(event) => onUseSqlCacheChange(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-teal-700 disabled:cursor-not-allowed"
        />
      </label>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-steel">
          Faça perguntas sobre o desempenho financeiro do Grupo Horizonte.
        </p>
        <button
          type="button"
          disabled={!canSubmit || isLoading || disabled}
          onClick={onSubmit}
          className="inline-flex h-11 min-w-36 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ledger px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          {isLoading ? "Analisando..." : "Analisar"}
        </button>
      </div>
    </section>
  );
}
