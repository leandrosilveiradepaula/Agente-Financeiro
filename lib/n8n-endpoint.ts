function readRequiredWebhookEndpoint(envName: string) {
  const value = process.env[envName]?.trim();

  if (!value) {
    throw new Error(`${envName} nao configurada.`);
  }

  return value;
}

export function getN8nGenerateSqlWebhookEndpoint() {
  return readRequiredWebhookEndpoint("N8N_GENERATE_SQL_WEBHOOK_URL");
}

export function getN8nExecuteWatsonWebhookEndpoint() {
  return readRequiredWebhookEndpoint("N8N_EXECUTE_WATSON_WEBHOOK_URL");
}
