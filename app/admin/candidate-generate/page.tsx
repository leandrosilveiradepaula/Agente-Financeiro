"use client";

import Link from "next/link";
import { useState } from "react";
import { ShadowRunPanel } from "@/components/ShadowRunPanel";

type Result = {
  success: boolean;
  sql?: string;
  run_id?: string;
  agent_run_id?: string;
  intent?: string | null;
  context_version?: string | null;
  error?: string;
  review_id?: string;
  review_status?: "pending" | "approved" | "rejected";
  sql_sha256?: string;
};

type P2Receipt = {
  success?: boolean;
  accepted?: boolean;
  agent_run_id?: string;
  real_sql_execution?: boolean;
  error?: string;
};

const P2_ERROR_MESSAGES: Record<string, string> = {
  not_found: "O teste P2 está desabilitado neste ambiente.",
  forbidden: "Perfil não autorizado a executar o teste P2.",
  generation_policy_denied: "Sua política não permite gerar SQL.",
  p2_canary_forbidden: "Operador não autorizado pelo canário P2.",
  p2_tenant_scope_unavailable: "Tenant não habilitado para o teste P2.",
  p2_tenant_membership_required: "Associação ativa ao tenant exigida.",
  p2_transport_unavailable: "Transporte n8n do teste P2 indisponível.",
  p2_shadow_dispatch_unavailable: "Envio ao n8n não foi confirmado.",
  p2_run_persistence_unavailable: "Não foi possível registrar a execução P2."
};

export default function CandidateGeneratePage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loadingAction, setLoadingAction] = useState<"candidate" | "p2" | null>(null);
  const [p2RunId, setP2RunId] = useState<string | null>(null);
  const [uncertainRunId, setUncertainRunId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingAction) return;
    setResult(null);
    setP2RunId(null);
    setUncertainRunId(null);
    setError("");
    setLoadingAction("candidate");
    try {
      const response = await fetch("/api/admin/candidate-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ pergunta: question })
      });
      const data = await response.json() as Result;
      if (!response.ok || !data.success) {
        setError(data.error || "Não foi possível gerar SQL pelo candidato.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Serviço candidato indisponível.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function testP2() {
    if (loadingAction || !question.trim()) return;
    setResult(null);
    setP2RunId(null);
    setUncertainRunId(null);
    setError("");
    setLoadingAction("p2");

    try {
      // Explicit P2 opt-in: the existing API performs admin, tenant, canary
      // and policy checks. It never calls the official SQL-generation path.
      const response = await fetch("/api/generate-sql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-P2-Generate-Only": "true"
        },
        cache: "no-store",
        body: JSON.stringify({ pergunta: question.trim() })
      });
      const data = await response.json() as P2Receipt;
      if (response.status === 202 &&
          data.success === true &&
          data.accepted === true &&
          data.real_sql_execution === false &&
          typeof data.agent_run_id === "string" &&
          data.agent_run_id.length > 0) {
        setP2RunId(data.agent_run_id);
      } else if (typeof data.agent_run_id === "string" && data.agent_run_id.length > 0) {
        // The dispatch may already have reached n8n. Never retry silently.
        setUncertainRunId(data.agent_run_id);
        setError("A execução P2 foi registrada, mas seu envio não foi confirmado. Consulte o histórico antes de tentar novamente.");
      } else {
        setError(
          (data.error && P2_ERROR_MESSAGES[data.error]) ||
          "Teste P2 indisponível ou não autorizado neste ambiente."
        );
      }
    } catch {
      setError("Falha de comunicação com P2. Não reenvie automaticamente; verifique o histórico antes de repetir.");
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-5 py-8 text-ink">
      <Link className="text-sm font-semibold text-lake underline" href="/admin/runs">
        Voltar ao histórico
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Candidato LangGraph — gerar SQL</h1>
        <p className="mt-2 text-steel">
          Use a geração candidata para revisão humana, ou o teste isolado P2
          para acompanhar as evidências Shadow. Nenhuma consulta financeira
          será executada por estas ações.
        </p>
      </header>
      <form onSubmit={generate} className="space-y-3 rounded-lg border bg-white p-5">
        <label htmlFor="candidate-question" className="block font-semibold">
          Pergunta financeira
        </label>
        <textarea id="candidate-question" rows={4} maxLength={16000}
          required value={question} onChange={(event) => setQuestion(event.target.value)}
          className="w-full rounded-md border p-3" placeholder="Escreva uma pergunta inédita..."
        />
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={loadingAction !== null || !question.trim()}
            className="rounded-md bg-lake px-5 py-2 font-semibold text-white disabled:opacity-50">
            {loadingAction === "candidate" ? "Gerando SQL..." : "Gerar SQL candidata"}
          </button>
          <button type="button" disabled={loadingAction !== null || !question.trim()}
            onClick={testP2}
            className="rounded-md border border-lake px-5 py-2 font-semibold text-lake disabled:opacity-50">
            {loadingAction === "p2" ? "Enviando P2..." : "Testar Shadow P2 (sem executar SQL)"}
          </button>
        </div>
        <p className="text-xs text-steel">
          P2 envia apenas uma pergunta ao n8n → LangGraph e registra evidências.
          O aceite HTTP 202 não comprova geração SQL nem aprovação dos gates.
          O teste requer habilitação e autorização explícitas do operador.
        </p>
      </form>
      {error && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4">{error}</p>}
      {uncertainRunId && (
        <section role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold">Execução P2 com confirmação pendente</p>
          <p className="mt-1">Agent run: {uncertainRunId}</p>
          <Link className="mt-2 inline-block font-semibold text-lake underline" href="/admin/runs">
            Verificar no histórico antes de reenviar
          </Link>
        </section>
      )}
      {p2RunId && (
        <section className="space-y-3 rounded-lg border bg-white p-5">
          <h2 className="text-lg font-semibold">Teste P2 enviado — aguardando evidências</h2>
          <p className="text-sm text-steel">
            n8n recebeu a solicitação. Isso ainda não comprova que a SQL foi gerada
            ou aprovada. A consulta financeira permanece bloqueada.
          </p>
          <p className="text-xs text-steel">Agent run: {p2RunId}</p>
          <ShadowRunPanel agentRunId={p2RunId} pollForEvidence />
        </section>
      )}
      {result && (
        <section className="space-y-3 rounded-lg border bg-white p-5">
          <h2 className="text-lg font-semibold">SQL gerada para revisão</h2>
          <p className="text-sm text-steel">
            Contexto: {result.context_version || "Não informado"}.
            Intenção: {result.intent || "Não informada"}.
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm text-white">
            {result.sql}
          </pre>
          <p className="text-xs text-steel">
            Agent run: {result.agent_run_id} — LangGraph run: {result.run_id}
          </p>
          <p className="text-sm">Estado da proposta: {result.review_status || "não persistida"}.</p>
          {result.review_id && (
            <Link className="inline-flex rounded-md border px-4 py-2 font-semibold"
              href={"/admin/candidate-reviews/" + encodeURIComponent(result.review_id)}>
              Abrir revisão humana
            </Link>
          )}
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            A revisão exige outro administrador autorizado no mesmo tenant.
            Mesmo após aprovação, a execução financeira permanece bloqueada.
            Qualquer reparo exige uma nova geração e nova aprovação.
          </p>
        </section>
      )}
    </main>
  );
}
