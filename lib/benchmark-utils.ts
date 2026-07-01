import type { BenchmarkCase } from "@/lib/benchmark-cases";
import type { ExecuteWatsonResponse, GenerateSqlResponse } from "@/lib/types";

export type BenchmarkStatus = "pendente" | "executando" | "aprovado" | "atencao" | "erro";

export type BenchmarkCaseResult = {
  caseId: string;
  status: BenchmarkStatus;
  question: string;
  expectedIntent: string;
  actualIntent?: string;
  queryId?: string;
  rowCount?: number;
  generationTimeMs?: number;
  executionTimeMs?: number;
  totalTimeMs?: number;
  validationMessages: string[];
  errorMessage?: string;
  executedAt?: string;
};

export type BenchmarkSummary = {
  total: number;
  approved: number;
  attention: number;
  errors: number;
  averageTotalMs: number | null;
  averageGenerationMs: number | null;
  averageExecutionMs: number | null;
};

export function normalizeBenchmarkText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesNormalized(haystack: string, needle: string) {
  return normalizeBenchmarkText(haystack).includes(normalizeBenchmarkText(needle));
}

export function validateBenchmarkResponse({
  benchmarkCase,
  generateResponse,
  executeResponse,
  generationTimeMs,
  executionTimeMs,
  totalTimeMs
}: {
  benchmarkCase: BenchmarkCase;
  generateResponse: GenerateSqlResponse;
  executeResponse: ExecuteWatsonResponse;
  generationTimeMs: number;
  executionTimeMs: number;
  totalTimeMs: number;
}): BenchmarkCaseResult {
  const summary = executeResponse.relatorio_executivo ?? executeResponse.executive_summary;
  const actualIntent =
    summary?.intent ?? generateResponse.detected_intent ?? "nao_informado";
  const validationMessages: string[] = [];

  if (!generateResponse.success) {
    validationMessages.push("Geração SQL não retornou success true.");
  }

  if (!executeResponse.success) {
    validationMessages.push("Execução Watson não retornou success true.");
  }

  if (!executeResponse.columns.length) {
    validationMessages.push("Resposta sem columns.");
  }

  if (!executeResponse.data.length) {
    validationMessages.push("Resposta sem data.");
  }

  if (executeResponse.row_count <= 0) {
    validationMessages.push("row_count não é maior que zero.");
  }

  if (!summary) {
    validationMessages.push("Relatório executivo ausente.");
  }

  if (!executeResponse.relatorio_executivo_markdown) {
    validationMessages.push("Markdown executivo ausente.");
  }

  if (actualIntent !== benchmarkCase.expectedIntent) {
    validationMessages.push(
      `Intenção divergente: esperada ${benchmarkCase.expectedIntent}, retornada ${actualIntent}.`
    );
  }

  const summaryText = [
    ...(summary?.paragraphs ?? []),
    ...(summary?.highlights ?? []),
    ...(summary?.warnings ?? [])
  ].join(" ");
  const warningText = (summary?.warnings ?? []).join(" ");

  for (const expectedText of benchmarkCase.expectedTexts) {
    if (!includesNormalized(summaryText, expectedText)) {
      validationMessages.push(`Texto esperado ausente: "${expectedText}".`);
    }
  }

  for (const expectedWarning of benchmarkCase.expectedWarnings ?? []) {
    if (!includesNormalized(warningText, expectedWarning)) {
      validationMessages.push(`Warning esperado ausente: "${expectedWarning}".`);
    }
  }

  return {
    caseId: benchmarkCase.id,
    status: validationMessages.length ? "atencao" : "aprovado",
    question: benchmarkCase.question,
    expectedIntent: benchmarkCase.expectedIntent,
    actualIntent,
    queryId: executeResponse.query_id || undefined,
    rowCount: executeResponse.row_count,
    generationTimeMs,
    executionTimeMs,
    totalTimeMs,
    validationMessages: validationMessages.length ? validationMessages : ["Critérios aprovados."],
    executedAt: new Date().toISOString()
  };
}

function average(values: Array<number | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number");

  if (!numbers.length) {
    return null;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function summarizeBenchmarkResults(results: BenchmarkCaseResult[]): BenchmarkSummary {
  return {
    total: results.length,
    approved: results.filter((result) => result.status === "aprovado").length,
    attention: results.filter((result) => result.status === "atencao").length,
    errors: results.filter((result) => result.status === "erro").length,
    averageTotalMs: average(results.map((result) => result.totalTimeMs)),
    averageGenerationMs: average(results.map((result) => result.generationTimeMs)),
    averageExecutionMs: average(results.map((result) => result.executionTimeMs))
  };
}

function formatMs(value?: number | null) {
  if (value === null || value === undefined) {
    return "Não informado";
  }

  return `${Math.round(value)} ms`;
}

export function buildBenchmarkMarkdown({
  baseline,
  results
}: {
  baseline: string;
  results: BenchmarkCaseResult[];
}) {
  const summary = summarizeBenchmarkResults(results);

  return `# Benchmark e Homologação — Agente SQL Financeiro DuckLake

Data/hora: ${new Date().toLocaleString("pt-BR")}
Baseline: ${baseline}
Total de casos: ${summary.total}
Aprovados: ${summary.approved}
Atenção: ${summary.attention}
Erros: ${summary.errors}
Tempo médio total: ${formatMs(summary.averageTotalMs)}
Tempo médio geração SQL: ${formatMs(summary.averageGenerationMs)}
Tempo médio execução Watson: ${formatMs(summary.averageExecutionMs)}

## Casos

${results
  .map(
    (result, index) => `### ${index + 1}. ${result.caseId}

Status: ${result.status}
Pergunta: ${result.question}
Intenção esperada: ${result.expectedIntent}
Intenção retornada: ${result.actualIntent ?? "Não informada"}
Query ID: ${result.queryId ?? "Não informado"}
Linhas: ${result.rowCount ?? "Não informado"}
Tempo geração SQL: ${formatMs(result.generationTimeMs)}
Tempo execução Watson: ${formatMs(result.executionTimeMs)}
Tempo total: ${formatMs(result.totalTimeMs)}
Mensagens:
${result.validationMessages.map((message) => `- ${message}`).join("\n")}
${result.errorMessage ? `Erro: ${result.errorMessage}` : ""}`
  )
  .join("\n\n")}
`;
}
