// n8n Code node: Code - Resolver Adapter LLM
// Somente roteamento estrutural. Nenhuma regra de negocio.

const input = $json || {};
const runtime = input.llm_runtime || {};
const selection = input.llm_selection || {};

const adapterType = String(runtime.adapter_type || '').trim();
const modelKey = String(runtime.model_key || selection.model_key || '').trim();
const configVersion = String(
  runtime.config_version || selection.config_version || ''
).trim();

const supportedAdapters = new Set([
  'gemini_generate_content',
  'openai_compatible_chat'
]);

if (!supportedAdapters.has(adapterType)) {
  throw new Error('LLM_ADAPTER_NOT_SUPPORTED');
}

if (!modelKey || !configVersion) {
  throw new Error('LLM_RUNTIME_INVALID');
}

const prompt = String(
  input.prompt ||
  input.prompt_sql ||
  input.prompt_geracao_sql ||
  ''
).trim();

if (!prompt) {
  throw new Error('LLM_PROMPT_REQUIRED');
}

return [{
  json: {
    ...input,
    llm_adapter: {
      adapter_type: adapterType,
      model_key: modelKey,
      config_version: configVersion,
      timeout_ms: Number.isFinite(Number(runtime.timeout_ms))
        ? Number(runtime.timeout_ms)
        : null,
      max_tokens: Number.isFinite(Number(runtime.max_tokens))
        ? Number(runtime.max_tokens)
        : null,
      temperature: Number.isFinite(Number(runtime.temperature))
        ? Number(runtime.temperature)
        : null
    },
    llm_adapter_type: adapterType,
    llm_model: modelKey,
    llm_config_version: configVersion
  }
}];
