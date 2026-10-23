type JsonRecord = Record<string, unknown>;

type DeliveryStatus =
  | "sent" | "http_error" | "network_error" | "timeout"
  | "invalid_response" | "configuration_error" | "disabled" | "unexpected_error";

const LABELS: Record<DeliveryStatus, string> = {
  sent: "Solicitação entregue",
  http_error: "Erro HTTP",
  network_error: "Falha de rede",
  timeout: "Tempo esgotado",
  invalid_response: "Resposta de transporte inválida",
  configuration_error: "Transporte não configurado",
  disabled: "Shadow desabilitado",
  unexpected_error: "Falha inesperada"
};

const EVENTS = [
  { key: "generate", label: "Generate" },
  { key: "execute_approved", label: "Execute Approved" }
] as const;

function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ShadowDispatchReceiptSummary = {
  event: "generate" | "execute_approved";
  label: string;
  status: DeliveryStatus | null;
  statusLabel: string;
  httpStatus: number | null;
  recordedAt: string | null;
};

export function parseShadowDispatchReceipts(metadata: unknown): ShadowDispatchReceiptSummary[] {
  const dispatch: JsonRecord = isObject(metadata) && isObject(metadata.shadow_dispatch)
    ? metadata.shadow_dispatch
    : {};

  return EVENTS.map(({ key, label }) => {
    const receipt: JsonRecord = isObject(dispatch[key]) ? dispatch[key] : {};
    const status = typeof receipt.status === "string" &&
      Object.prototype.hasOwnProperty.call(LABELS, receipt.status)
      ? receipt.status as DeliveryStatus
      : null;
    const httpStatus = typeof receipt.http_status === "number" &&
      Number.isInteger(receipt.http_status) &&
      receipt.http_status >= 100 && receipt.http_status <= 599
      ? receipt.http_status
      : null;
    const date = typeof receipt.recorded_at === "string" &&
      receipt.recorded_at.length <= 40 &&
      !Number.isNaN(Date.parse(receipt.recorded_at))
      ? receipt.recorded_at
      : null;
    return {
      event: key,
      label,
      status,
      statusLabel: status ? LABELS[status] : "Sem recibo registrado",
      httpStatus: status ? httpStatus : null,
      recordedAt: status ? date : null
    };
  });
}

export function ShadowDispatchReceiptPanel({ metadata }: { metadata: unknown }) {
  const receipts = parseShadowDispatchReceipts(metadata);
  return (
    <section className="rounded-md border border-slate-200 p-4" aria-label="Recibos do transporte Shadow">
      <h3 className="mb-2 text-base font-semibold text-ink">Transporte Shadow — Produto → n8n/LangGraph</h3>
      <p className="mb-3 text-xs text-steel">
        Recibos de envio registrados após a resposta oficial. HTTP 202 confirma apenas
        aceite do n8n; não comprova geração de SQL, aprovação dos gates nem paridade financeira.
        Ausência de recibo não comprova que o evento não ocorreu.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {receipts.map((receipt) => (
          <div key={receipt.event} className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-steel">{receipt.label}</div>
            <div className="mt-1 text-sm font-semibold text-ink">{receipt.statusLabel}</div>
            {receipt.httpStatus !== null ? (
              <div className="mt-1 text-xs text-steel">HTTP {receipt.httpStatus}</div>
            ) : null}
            {receipt.recordedAt ? (
              <div className="mt-1 text-xs text-steel">
                {new Date(receipt.recordedAt).toLocaleString("pt-BR")}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
