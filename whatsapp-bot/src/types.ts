export type ExecutiveSummaryResult = {
  title: string;
  paragraphs: string[];
  highlights: string[];
  warnings?: string[];
  intent?: string;
  generated_by?: string;
  version?: string;
};

export type ResultRow = Record<string, string | number | boolean | null>;

export type GenerateSqlResponse = {
  success: boolean;
  sql?: string;
  query_para_copiar?: string;
  detected_intent?: string;
  validation_status?: string;
  error?: string;
  raw?: unknown;
};

export type ExecuteWatsonResponse = {
  success: boolean;
  query_id?: string;
  execution_time_ms?: number | null;
  row_count?: number;
  columns?: string[];
  data?: ResultRow[];
  relatorio_executivo?: ExecutiveSummaryResult;
  executive_summary?: ExecutiveSummaryResult;
  relatorio_executivo_markdown?: string;
  error_message?: string;
  error?: string;
  raw?: unknown;
};

export type DuckLakeAgentResult = {
  question: string;
  sql: string;
  generateResponse: GenerateSqlResponse;
  executeResponse: ExecuteWatsonResponse;
  summary: ExecutiveSummaryResult;
  markdown: string;
  columns: string[];
  data: ResultRow[];
  queryId?: string;
  rowCount?: number;
  executionTimeMs?: number | null;
  intent?: string;
};

export type SavedWhatsAppReport = {
  id: string;
  whatsappUserId: string;
  whatsappName?: string;
  phoneNumber: string;
  queryId?: string;
  question: string;
  markdown: string;
  summary: ExecutiveSummaryResult;
  columns: string[];
  dataPreview: ResultRow[];
  rowCount?: number;
  executionTimeMs?: number | null;
  createdAt: string;
};

export type WhatsAppInboundMessage = {
  from: string;
  id?: string;
  name?: string;
  type: string;
  text?: string;
};
