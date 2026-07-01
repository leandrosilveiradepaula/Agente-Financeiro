import { SendHorizontal } from "lucide-react";

type QuestionInputProps = {
  question: string;
  canSubmit: boolean;
  isLoading: boolean;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
};

export function QuestionInput({
  question,
  canSubmit,
  isLoading,
  onQuestionChange,
  onSubmit
}: QuestionInputProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-ink">Pergunta em linguagem natural</h2>
      </div>

      <textarea
        aria-label="Pergunta em linguagem natural"
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSubmit) {
            onSubmit();
          }
        }}
        placeholder="Digite sua pergunta financeira para gerar SQL DuckLake..."
        className="min-h-40 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-base leading-6 text-ink placeholder:text-slate-400"
      />

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-steel">
          A pergunta será enviada ao n8n por uma rota interna segura.
        </p>
        <button
          type="button"
          disabled={!canSubmit || isLoading}
          onClick={onSubmit}
          className="inline-flex h-11 min-w-36 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ledger px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          {isLoading ? "Gerando..." : "Gerar SQL"}
        </button>
      </div>
    </section>
  );
}
