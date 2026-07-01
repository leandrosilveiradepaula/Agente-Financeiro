"use client";

import { Check, ClipboardCopy, Gauge, Play, RotateCcw, TriangleAlert, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { BENCHMARK_CASES, type BenchmarkCase } from "@/lib/benchmark-cases";
import {
  buildBenchmarkMarkdown,
  summarizeBenchmarkResults,
  validateBenchmarkResponse,
  type BenchmarkCaseResult,
  type BenchmarkStatus
} from "@/lib/benchmark-utils";
import type { ExecuteWatsonResponse, GenerateSqlResponse } from "@/lib/types";

type BenchmarkHomologationPanelProps = {
  baseline: string;
};

function statusClasses(status: BenchmarkStatus) {
  if (status === "aprovado") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "atencao") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "erro") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (status === "executando") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusLabel(status: BenchmarkStatus) {
  if (status === "atencao") {
    return "atenção";
  }

  return status;
}

function formatMs(value?: number | null) {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${Math.round(value)} ms`;
}

function emptyResult(benchmarkCase: BenchmarkCase): BenchmarkCaseResult {
  return {
    caseId: benchmarkCase.id,
    status: "pendente",
    question: benchmarkCase.question,
    expectedIntent: benchmarkCase.expectedIntent,
    validationMessages: ["Aguardando execução."]
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = (await response.json()) as T & { error?: string; error_message?: string };

  if (!response.ok) {
    throw new Error(data.error_message || data.error || `Falha HTTP ${response.status}.`);
  }

  return data;
}

export function BenchmarkHomologationPanel({ baseline }: BenchmarkHomologationPanelProps) {
  const [results, setResults] = useState<BenchmarkCaseResult[]>(
    BENCHMARK_CASES.map(emptyResult)
  );
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const summary = useMemo(() => summarizeBenchmarkResults(results), [results]);

  function updateResult(caseId: string, result: BenchmarkCaseResult) {
    setResults((current) =>
      current.map((item) => (item.caseId === caseId ? result : item))
    );
  }

  async function runCase(benchmarkCase: BenchmarkCase, index?: number) {
    const totalStart = performance.now();
    updateResult(benchmarkCase.id, {
      ...emptyResult(benchmarkCase),
      status: "executando",
      validationMessages: ["Executando geração SQL e Watson..."]
    });

    try {
      const generationStart = performance.now();
      const generateResponse = await postJson<GenerateSqlResponse>("/api/generate-sql", {
        pergunta: benchmarkCase.question
      });
      const generationTimeMs = performance.now() - generationStart;

      if (!generateResponse.success || !generateResponse.sql.trim()) {
        throw new Error(generateResponse.error || "Geração SQL falhou ou retornou SQL vazia.");
      }

      const executionStart = performance.now();
      const executeResponse = await postJson<ExecuteWatsonResponse>("/api/execute-watson", {
        pergunta: benchmarkCase.question,
        sql: generateResponse.sql
      });
      const executionTimeMs = performance.now() - executionStart;
      const totalTimeMs = performance.now() - totalStart;

      if (!executeResponse.success || !executeResponse.data.length) {
        const result: BenchmarkCaseResult = {
          ...emptyResult(benchmarkCase),
          status: "erro",
          actualIntent:
            executeResponse.relatorio_executivo?.intent ??
            executeResponse.executive_summary?.intent ??
            generateResponse.detected_intent,
          queryId: executeResponse.query_id || undefined,
          rowCount: executeResponse.row_count,
          generationTimeMs,
          executionTimeMs,
          totalTimeMs,
          validationMessages: ["Execução Watson falhou ou retornou sem dados."],
          errorMessage: executeResponse.error_message || executeResponse.error,
          executedAt: new Date().toISOString()
        };
        updateResult(benchmarkCase.id, result);
        return result;
      }

      const result = validateBenchmarkResponse({
        benchmarkCase,
        generateResponse,
        executeResponse,
        generationTimeMs,
        executionTimeMs,
        totalTimeMs
      });
      updateResult(benchmarkCase.id, result);
      return result;
    } catch (error) {
      const result: BenchmarkCaseResult = {
        ...emptyResult(benchmarkCase),
        status: "erro",
        totalTimeMs: performance.now() - totalStart,
        validationMessages: ["Erro durante o benchmark."],
        errorMessage: error instanceof Error ? error.message : "Erro inesperado.",
        executedAt: new Date().toISOString()
      };
      updateResult(benchmarkCase.id, result);
      return result;
    } finally {
      if (index !== undefined) {
        setProgress(`Rodando ${index + 1} de ${BENCHMARK_CASES.length}...`);
      }
    }
  }

  async function runOne(benchmarkCase: BenchmarkCase) {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setProgress(`Rodando ${benchmarkCase.title}...`);
    await runCase(benchmarkCase);
    setIsRunning(false);
    setProgress("");
  }

  async function runAll() {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setCopyError("");

    for (let index = 0; index < BENCHMARK_CASES.length; index += 1) {
      setProgress(`Rodando ${index + 1} de ${BENCHMARK_CASES.length}...`);
      await runCase(BENCHMARK_CASES[index], index);
    }

    setProgress("");
    setIsRunning(false);
  }

  function clearResults() {
    if (isRunning) {
      return;
    }

    setResults(BENCHMARK_CASES.map(emptyResult));
    setProgress("");
    setCopyError("");
  }

  async function copyResults() {
    try {
      setCopyError("");
      await navigator.clipboard.writeText(buildBenchmarkMarkdown({ baseline, results }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Não foi possível copiar o resultado do benchmark.");
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-lake" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Benchmark e homologação</h2>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-steel">
          {BENCHMARK_CASES.length} casos
        </span>
      </div>
      <p className="mb-3 text-sm leading-6 text-steel">
        Valida as 5 perguntas homologadas usando as rotas internas da interface e mede tempos
        básicos de geração SQL e execução Watson.
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Aprovados</p>
          <p className="text-lg font-semibold text-emerald-700">{summary.approved}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Atenção</p>
          <p className="text-lg font-semibold text-amber-700">{summary.attention}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Erros</p>
          <p className="text-lg font-semibold text-rose-700">{summary.errors}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Média total</p>
          <p className="text-sm font-semibold text-ink">{formatMs(summary.averageTotalMs)}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Média SQL</p>
          <p className="text-sm font-semibold text-ink">{formatMs(summary.averageGenerationMs)}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Média Watson</p>
          <p className="text-sm font-semibold text-ink">{formatMs(summary.averageExecutionMs)}</p>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          disabled={isRunning}
          onClick={runAll}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-lake px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Rodar todos
        </button>
        <button
          type="button"
          disabled={isRunning}
          onClick={clearResults}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Limpar resultados
        </button>
        <button
          type="button"
          disabled={isRunning}
          onClick={copyResults}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
          ) : (
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? "Copiado" : "Copiar resultado"}
        </button>
      </div>

      {progress ? (
        <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
          {progress}
        </div>
      ) : null}
      {copyError ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
          {copyError}
        </div>
      ) : null}

      <div className="flex max-h-[680px] flex-col gap-2 overflow-auto pr-1">
        {BENCHMARK_CASES.map((benchmarkCase) => {
          const result = results.find((item) => item.caseId === benchmarkCase.id) ?? emptyResult(benchmarkCase);

          return (
            <div key={benchmarkCase.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-ink">{benchmarkCase.title}</h3>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-steel">
                    {benchmarkCase.question}
                  </p>
                </div>
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses(result.status)}`}>
                  {statusLabel(result.status)}
                </span>
              </div>

              <div className="grid gap-1 text-xs text-steel">
                <span>Intenção esperada: {benchmarkCase.expectedIntent}</span>
                <span>Intenção retornada: {result.actualIntent ?? "—"}</span>
                <span>Query ID: {result.queryId ?? "—"}</span>
                <span>Linhas: {result.rowCount ?? "—"}</span>
                <span>Geração SQL: {formatMs(result.generationTimeMs)}</span>
                <span>Execução Watson: {formatMs(result.executionTimeMs)}</span>
                <span>Total: {formatMs(result.totalTimeMs)}</span>
              </div>

              {result.validationMessages.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-steel">
                  {result.validationMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
              {result.errorMessage ? (
                <div className="mt-2 flex items-start gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{result.errorMessage}</span>
                </div>
              ) : null}
              <button
                type="button"
                disabled={isRunning}
                onClick={() => runOne(benchmarkCase)}
                className="mt-3 inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-ink transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {result.status === "erro" ? (
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Rodar caso
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
