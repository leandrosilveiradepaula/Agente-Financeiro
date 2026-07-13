const STABLE_N8N_WATSON_ORCHESTRATE_ENDPOINT =
  "https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate";

export const N8N_WATSON_ORCHESTRATE_ENDPOINT =
  process.env.N8N_GENERATE_SQL_WEBHOOK_URL?.trim() ||
  process.env.N8N_EXECUTE_WATSON_WEBHOOK_URL?.trim() ||
  STABLE_N8N_WATSON_ORCHESTRATE_ENDPOINT;
