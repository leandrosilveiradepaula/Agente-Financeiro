export const AGENT_VERSION = "v2.0.6.2-benchmark-30-30-stable";

export type GenerateSqlResponse = {
  success: boolean;
  agent_version: string;
  detected_intent: string;
  validation_status: string;
  sql: string;
  raw: unknown;
  error?: string;
};

export type ResultRow = Record<string, string | number | boolean | null>;

export type ExecutiveSummaryResult = {
  title: string;
  paragraphs: string[];
  highlights: string[];
  warnings?: string[];
  intent?: string;
  generated_by?: string;
  version?: string;
};

export type ExecuteWatsonResponse = {
  success: boolean;
  query_id: string;
  execution_time_ms: number | null;
  row_count: number;
  columns: string[];
  data: ResultRow[];
  raw: unknown;
  truncated?: boolean;
  error_message?: string;
  relatorio_executivo?: ExecutiveSummaryResult;
  executive_summary?: ExecutiveSummaryResult;
  relatorio_executivo_markdown?: string;
  error?: string;
};

export type QueryHistoryItem = {
  id: string;
  pergunta: string;
  sql: string;
  agent_version: string;
  detected_intent: string;
  validation_status: string;
  created_at: string;
  executed_watson: boolean;
  result_source?: "automatico" | "manual";
  hasExecutiveSummary?: boolean;
  executiveSummaryGeneratedAt?: string;
  pdfExported?: boolean;
  pdfExportedAt?: string;
  query_id?: string;
};

export type ExecutiveReportHistoryItem = {
  id: string;
  question: string;
  sql: string;
  markdown: string;
  summary: ExecutiveSummaryResult;
  query_id?: string;
  detected_intent?: string;
  validation_status?: string;
  row_count?: number;
  execution_time_ms?: number | null;
  generated_at: string;
};
