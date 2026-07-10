type LlmUsageSummaryProps = {
  llmProvider?: string | null;
  llmModel?: string | null;
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
  llmTotalTokens?: number | null;
  llmUsageSource?: string | null;
  sqlCacheHit?: boolean | null;
  sqlCacheSavedTotalTokens?: number | null;
  estimatedCostUsd?: number | string | null;
  estimatedSavingsUsd?: number | string | null;
  compact?: boolean;
};

function hasNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value: number | null | undefined) {
  return hasNumber(value) ? new Intl.NumberFormat("pt-BR").format(value) : "-";
}

function formatMoney(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numericValue)) return null;

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4
  }).format(numericValue);
}

export function LlmUsageSummary({
  llmProvider,
  llmModel,
  llmPromptTokens,
  llmCompletionTokens,
  llmTotalTokens,
  llmUsageSource,
  sqlCacheHit,
  sqlCacheSavedTotalTokens,
  estimatedCostUsd,
  estimatedSavingsUsd,
  compact = false
}: LlmUsageSummaryProps) {
  const hasUsage =
    sqlCacheHit === true ||
    hasNumber(llmTotalTokens) ||
    hasNumber(llmPromptTokens) ||
    hasNumber(llmCompletionTokens);
  const cost = formatMoney(estimatedCostUsd);
  const savings = formatMoney(estimatedSavingsUsd);

  if (!hasUsage) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
        <h3 className="text-base font-semibold text-ink">Consumo de IA</h3>
        <p className="mt-2 text-sm text-steel">
          Consumo de IA não disponível para esta execução.
        </p>
      </section>
    );
  }

  if (sqlCacheHit) {
    return (
      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 shadow-soft">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-emerald-950">
            Consulta recuperada do cache
          </h3>
          <span className="w-fit rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-bold text-emerald-800">
            Cache utilizado
          </span>
        </div>
        <div className={`mt-3 grid gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-4"}`}>
          <Metric label="Tokens usados agora" value="0" />
          <Metric
            label="Tokens economizados"
            value={
              hasNumber(sqlCacheSavedTotalTokens)
                ? formatNumber(sqlCacheSavedTotalTokens)
                : "Indisponível"
            }
          />
          <Metric label="Cache" value="utilizado" />
          <Metric label="Modelo original" value={llmModel || "-"} />
          {savings ? <Metric label="Economia estimada" value={savings} /> : null}
        </div>
        {!hasNumber(sqlCacheSavedTotalTokens) ? (
          <p className="mt-3 text-xs font-medium text-emerald-900">
            Economia calculada: indisponível para esta execução
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-md border border-blue-200 bg-blue-50 p-4 shadow-soft">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-blue-950">Consulta gerada pela IA</h3>
        <span className="w-fit rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-bold text-blue-800">
          Cache não utilizado
        </span>
      </div>
      <div className={`mt-3 grid gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-4"}`}>
        <Metric label="Modelo" value={llmModel || "-"} />
        <Metric label="Tokens usados" value={formatNumber(llmTotalTokens)} />
        <Metric label="Prompt" value={formatNumber(llmPromptTokens)} />
        <Metric label="Resposta" value={formatNumber(llmCompletionTokens)} />
        {llmProvider ? <Metric label="Provedor" value={llmProvider} /> : null}
        {llmUsageSource ? <Metric label="Fonte" value={llmUsageSource} /> : null}
        {cost ? <Metric label="Custo estimado" value={cost} /> : null}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/70 bg-white/80 px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-steel">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
