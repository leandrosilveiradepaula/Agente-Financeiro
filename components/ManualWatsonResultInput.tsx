import { Eraser, Upload } from "lucide-react";

type ManualWatsonResultInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  onLoadResult: () => void;
  onClearJson: () => void;
};

export function ManualWatsonResultInput({
  value,
  onValueChange,
  onLoadResult,
  onClearJson
}: ManualWatsonResultInputProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <textarea
        aria-label="Resultado técnico em JSON"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Cole aqui o JSON de resultado..."
        className="min-h-52 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-sm leading-6 text-ink placeholder:font-sans placeholder:text-slate-400"
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={onClearJson}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" />
          Limpar
        </button>
        <button
          type="button"
          onClick={onLoadResult}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-lake px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Carregar resultado
        </button>
      </div>
    </div>
  );
}
