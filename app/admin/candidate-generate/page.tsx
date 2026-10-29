"use client";

import Link from "next/link";
import { useState } from "react";

type Result = {
  success: boolean;
  sql?: string;
  run_id?: string;
  agent_run_id?: string;
  intent?: string | null;
  context_version?: string | null;
  error?: string;
};

export default function CandidateGeneratePage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setError("");
    setLoading(true);
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
      setLoading(false);
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
          Geração isolada via n8n + LangGraph. A SQL será exibida somente para
          revisão. Nenhuma consulta financeira será executada.
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
        <button type="submit" disabled={loading || !question.trim()}
          className="rounded-md bg-lake px-5 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? "Gerando SQL..." : "Gerar SQL candidata"}
        </button>
      </form>
      {error && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4">{error}</p>}
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
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            Sem aprovação persistida. A SQL não pode ser executada nesta tela.
            Qualquer reparo ou modificação exige nova validação e aprovação.
          </p>
        </section>
      )}
    </main>
  );
}
