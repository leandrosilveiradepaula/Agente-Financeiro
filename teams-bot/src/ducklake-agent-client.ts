import type {
  DuckLakeAgentResult,
  ExecuteWatsonResponse,
  GenerateSqlResponse
} from "./types.js";
import { buildMarkdownReport } from "./text-formatting.js";

const DEFAULT_ENDPOINT =
  "https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate";

function endpoint() {
  return process.env.DUCKLAKE_AGENT_ENDPOINT || DEFAULT_ENDPOINT;
}

async function postWithTimeout<T>(body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : {}) as T & {
      error?: string;
      error_message?: string;
    };

    if (!response.ok) {
      throw new Error(data.error_message || data.error || `Endpoint retornou HTTP ${response.status}.`);
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Tempo limite excedido ao chamar o agente DuckLake.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateSql(question: string) {
  return postWithTimeout<GenerateSqlResponse>({ pergunta: question }, 60_000);
}

export async function executeSql(question: string, sql: string) {
  return postWithTimeout<ExecuteWatsonResponse>(
    {
      modo: "executar_sql",
      pergunta: question,
      limit: 100,
      sql
    },
    120_000
  );
}

export async function askDuckLakeAgent(question: string): Promise<DuckLakeAgentResult> {
  const totalController = new AbortController();
  const totalTimeout = setTimeout(() => totalController.abort(), 180_000);

  try {
    const generateResponse = await generateSql(question);
    const sql = generateResponse.sql || generateResponse.query_para_copiar || "";

    if (!generateResponse.success || !sql.trim()) {
      throw new Error(generateResponse.error || "O agente não retornou uma SQL válida.");
    }

    const executeResponse = await executeSql(question, sql);
    const summary = executeResponse.relatorio_executivo ?? executeResponse.executive_summary;

    if (!executeResponse.success || !summary) {
      throw new Error(
        executeResponse.error_message ||
          executeResponse.error ||
          "A execução não retornou relatório executivo."
      );
    }

    const columns = executeResponse.columns ?? [];
    const data = executeResponse.data ?? [];
    const markdown =
      executeResponse.relatorio_executivo_markdown ||
      buildMarkdownReport({
        question,
        summary,
        queryId: executeResponse.query_id,
        rowCount: executeResponse.row_count,
        executionTimeMs: executeResponse.execution_time_ms,
        columns,
        dataPreview: data
      });

    return {
      question,
      sql,
      generateResponse,
      executeResponse,
      summary,
      markdown,
      columns,
      data,
      queryId: executeResponse.query_id,
      rowCount: executeResponse.row_count,
      executionTimeMs: executeResponse.execution_time_ms,
      intent: summary.intent ?? generateResponse.detected_intent
    };
  } finally {
    clearTimeout(totalTimeout);
  }
}
