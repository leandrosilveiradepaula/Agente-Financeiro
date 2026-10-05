export const AGENT_VERSION = "v2.0.6.2-benchmark-30-30-stable";

export type GenerateSqlResponse = {
  success: boolean;
  agent_version: string;
  detected_intent: string;
  validation_status: string;
  sql: string;
  raw: unknown;
  execution_result?: ExecuteWatsonResponse;
  run_id?: string;
  agent_run_id?: string;
  can_view_sql?: boolean;
  sql_hidden?: boolean;
  message?: string;
  cache?: SqlGenerationCacheMetadata;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_config_version?: string | null;
  llm_prompt_tokens?: number | null;
  llm_completion_tokens?: number | null;
  llm_total_tokens?: number | null;
  llm_usage_source?: string | null;
  sql_cache_hit?: boolean | null;
  sql_cache_source_run_id?: string | null;
  sql_cache_saved_prompt_tokens?: number | null;
  sql_cache_saved_completion_tokens?: number | null;
  sql_cache_saved_total_tokens?: number | null;
  estimated_cost_usd?: number | null;
  estimated_savings_usd?: number | null;
  error?: string;
};

export type SqlGenerationCacheMetadata = {
  enabled: boolean;
  hit: boolean;
  source: string;
  cache_key?: string;
  cache_id?: string;
  status?: string;
  hit_count?: number;
  created_at?: string;
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
  run_id?: string;
  agent_run_id?: string;
  error?: string;
};

export type AgentRun = {
  id: string;
  created_at: string;
  updated_at: string;
  request_id: string | null;
  run_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  user_profile: string | null;
  auth_source: string | null;
  pergunta: string;
  pergunta_normalizada: string | null;
  detected_intent: string | null;
  intent_confidence: string | number | null;
  sql_generated: string | null;
  sql_executed: string | null;
  validation_status: string | null;
  validation_errors: unknown;
  validation_warnings: unknown;
  execution_status: string;
  execution_error: string | null;
  row_count: number | null;
  columns: unknown;
  data_preview: unknown;
  execution_time_ms: number | null;
  total_time_ms: number | null;
  source: string | null;
  executor_mode: string | null;
  executor_version: string | null;
  n8n_status_code: number | null;
  watson_status_code: number | null;
  metadata: unknown;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_prompt_tokens?: number | null;
  llm_completion_tokens?: number | null;
  llm_total_tokens?: number | null;
  llm_usage_source?: string | null;
  sql_cache_hit?: boolean | null;
  sql_cache_source_run_id?: string | null;
  sql_cache_saved_prompt_tokens?: number | null;
  sql_cache_saved_completion_tokens?: number | null;
  sql_cache_saved_total_tokens?: number | null;
  estimated_cost_usd?: number | string | null;
  estimated_savings_usd?: number | string | null;
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
  cache_enabled?: boolean;
  cache_hit?: boolean;
  cache_source?: string;
  cache_status?: string;
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

export type ShadowRunSummary = {
  shadow_record_id: string;
  agent_run_id: string;
  event_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  requires_reapproval: boolean;
  has_repair?: boolean;
  has_error?: boolean;
  warnings?: string[];
  errors?: string[];
};

export type ShadowStepMetadata = Partial<{
  attempt: number;
  attempts: number;
  cycle: number;
  cycles: number;
  duration_ms: number;
  failure_category: string;
  gate: string;
  kind: string;
  phase: string;
  preflight_status: string;
  reason_code: string;
  repair_attempt: number;
  repair_iteration: number;
  requires_reapproval: boolean;
  result: string;
}>;

export type ShadowRunVisualizationStep = {
  id: string;
  order: number;
  label: string;
  status: string;
  metadata?: ShadowStepMetadata;
  warnings?: string[];
  errors?: string[];
};

export type ShadowRunVisualizationEdge = {
  source: string;
  target: string;
  label?: string | null;
};

export type ShadowRunVisualizationFlags = {
  requires_reapproval?: boolean;
  has_repair?: boolean;
  has_error?: boolean;
  warnings?: string[];
  errors?: string[];
};

export type ShadowRunVisualization = {
  contract_version: string;
  run: ShadowRunSummary;
  steps: ShadowRunVisualizationStep[];
  edges: ShadowRunVisualizationEdge[];
  flags: ShadowRunVisualizationFlags;
};
