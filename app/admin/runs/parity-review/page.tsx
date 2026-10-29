"use client";

import Link from "next/link";
import { useState } from "react";

type Outcome =
  | "structural_match" | "structural_difference" | "provenance_missing"
  | "inconclusive" | "reapproval_required" | "official_sql_missing"
  | "official_identity_missing" | "cache_ineligible" | "shadow_missing"
  | "shadow_not_successful" | "shadow_ambiguous" | "shadow_read_unavailable"
  | "comparison_unavailable";

type ReviewRow = {
  agent_run_id: string;
  shadow_record_id: string | null;
  outcome: Outcome;
  generated: string;
  executed: string;
  provider_identity: string;
  tenant_identity_attested: boolean;
  intent_label_attested: boolean;
};
type ReviewReport = {
  success: true;
  sample_count: number;
  counts: Record<Outcome, number>;
  cases: ReviewRow[];
  total_official_runs: number;
  offset: number;
  limit: number;
  benchmark_frozen: false;
  financial_parity_proven: false;
  real_sql_executed: false;
};
const LABELS: Record<Outcome, string> = {
  structural_match: "SQL estruturalmente correspondente",
  structural_difference: "Divergência estrutural",
  provenance_missing: "Proveniência não comprovada",
  inconclusive: "Comparação inconclusiva",
  reapproval_required: "Reparo exige nova aprovação",
  official_sql_missing: "SQL oficial não registrada",
  official_identity_missing: "Identidade oficial incompleta",
  cache_ineligible: "Resposta de cache sem geração atestada",
  shadow_missing: "Sem execução Shadow correlacionada",
  shadow_not_successful: "Shadow não concluiu com sucesso",
  shadow_ambiguous: "Tentativas Shadow ambíguas",
  shadow_read_unavailable: "Evidências Shadow indisponíveis",
  comparison_unavailable: "Comparador indisponível"
};
const OUTCOME_ORDER = Object.keys(LABELS) as Outcome[];

export default function BatchParityReviewPage() {
  const [data, setData] = useState<ReviewReport | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load(nextOffset: number) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/admin/runs/parity-review?limit=10&offset=" + nextOffset,
        { cache: "no-store" }
      );
      if (!response.ok) throw Error("Não foi possível concluir a avaliação. Verifique as permissões e o serviço Shadow.");
      const received = await response.json() as ReviewReport;
      if (received.success !== true || !Array.isArray(received.cases)) {
        throw Error("Relatório de comparação inválido.");
      }
      setData(received);
      setOffset(nextOffset);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Avaliação indisponível.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-ink">
      <div>
        <Link className="text-sm font-semibold text-lake underline" href="/admin/runs">
          Voltar ao histórico
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">Avaliação em lote: n8n × LangGraph</h1>
        <p className="mt-2 text-sm text-steel">
          Compara SQL oficial e evidências Shadow já persistidas, com autorização
          administrativa. Não gera nem executa SQL e não chama modelos de IA.
        </p>
      </div>
      <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Não é homologação financeira.</strong> Correspondência estrutural não
        comprova igualdade de números. As execuções históricas não constituem
        benchmark cego congelado; casos sem proveniência não recebem aprovação.
      </section>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={loading}
          onClick={() => load(0)}
          className="rounded-md bg-lake px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? "Avaliando..." : "Avaliar primeiras 10 execuções"}
        </button>
        {data && (
          <>
            <button type="button" disabled={loading || offset === 0}
              onClick={() => load(Math.max(offset - 10, 0))}
              className="rounded-md border px-4 py-2 disabled:opacity-50">
              Anteriores
            </button>
            <button type="button"
              disabled={loading || offset + data.limit >= data.total_official_runs}
              onClick={() => load(offset + data.limit)}
              className="rounded-md border px-4 py-2 disabled:opacity-50">
              Próximas
            </button>
          </>
        )}
      </div>
      {error && <p role="alert" className="rounded-md border border-rose-200 p-3 text-rose-800">{error}</p>}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-4">
              <div className="text-sm text-steel">Execuções avaliadas nesta página</div>
              <div className="mt-1 text-3xl font-semibold">{data.sample_count}</div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-sm text-steel">Correspondências estruturais qualificadas</div>
              <div className="mt-1 text-3xl font-semibold">{data.counts.structural_match}</div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-sm text-steel">Divergências estruturais</div>
              <div className="mt-1 text-3xl font-semibold">{data.counts.structural_difference}</div>
            </div>
          </div>
          <section className="rounded-md border bg-white p-4">
            <h2 className="text-lg font-semibold">Motivos de conclusão e pendência</h2>
            <p className="mb-3 text-xs text-steel">Contagens apenas da página atual; não do histórico inteiro.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {OUTCOME_ORDER.map((outcome) => (
                <div key={outcome} className="flex justify-between gap-3 border-b py-1 text-sm">
                  <span>{LABELS[outcome]}</span>
                  <strong>{data.counts[outcome]}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="overflow-x-auto rounded-md border bg-white">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead><tr className="bg-slate-100">
                <th className="p-3">Run oficial</th>
                <th className="p-3">Resultado</th>
                <th className="p-3">SQL gerada</th>
                <th className="p-3">SQL executada</th>
                <th className="p-3">Modelo</th>
                <th className="p-3">Tenant</th>
              </tr></thead>
              <tbody>{data.cases.map((item) => (
                <tr key={item.agent_run_id} className="border-t">
                  <td className="p-3 font-mono text-xs">{item.agent_run_id}</td>
                  <td className="p-3">{LABELS[item.outcome]}</td>
                  <td className="p-3">{item.generated}</td>
                  <td className="p-3">{item.executed}</td>
                  <td className="p-3">{item.provider_identity}</td>
                  <td className="p-3">{item.tenant_identity_attested ? "Atestado" : "Não atestado"}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
          <p className="text-xs text-steel">Exibindo {offset + 1}–{offset + data.sample_count} de {data.total_official_runs} execuções oficiais. Nenhuma SQL ou pergunta é exposta neste relatório.</p>
        </>
      )}
    </main>
  );
}
