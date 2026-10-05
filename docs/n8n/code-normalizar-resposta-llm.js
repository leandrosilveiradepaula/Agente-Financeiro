// n8n Code node: Code - Normalizar Resposta LLM
// Normaliza protocolos diferentes para um contrato interno unico.

const response = $json || {};

function getNodeJsonSafe(name) {
  try {
    return $(name).first().json || {};
  } catch {
    return {};
  }
}

const source = getNodeJsonSafe('Code - Resolver Adapter LLM');
const adapter = source.llm_adapter || {};
const adapterType = String(adapter.adapter_type || source.llm_adapter_type || '');

function token(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

let sqlText = '';
let promptTokens = null;
let completionTokens = null;
let totalTokens = null;

if (adapterType === 'gemini_generate_content') {
  sqlText = String(
    response.candidates?.[0]?.content?.parts?.[0]?.text || ''
  ).trim();

  const usage = response.usageMetadata || {};
  promptTokens = token(usage.promptTokenCount);
  completionTokens = token(usage.candidatesTokenCount);
  totalTokens = token(usage.totalTokenCount);
} else if (adapterType === 'openai_compatible_chat') {
  sqlText = String(
    response.choices?.[0]?.message?.content ||
    response.choices?.[0]?.text ||
    ''
  ).trim();

  const usage = response.usage || {};
  promptTokens = token(usage.prompt_tokens);
  completionTokens = token(usage.completion_tokens);
  totalTokens = token(usage.total_tokens);
} else {
  throw new Error('LLM_ADAPTER_NOT_SUPPORTED');
}

if (!sqlText) {
  throw new Error('LLM_RESPONSE_INVALID');
}

if (
  totalTokens === null &&
  promptTokens !== null &&
  completionTokens !== null
) {
  totalTokens = promptTokens + completionTokens;
}

return [{
  json: {
    ...source,
    llm_provider: source.llm_selection?.provider_key || null,
    llm_model: adapter.model_key || source.llm_selection?.model_key || null,
    llm_config_version:
      adapter.config_version || source.llm_selection?.config_version || null,
    llm_adapter_type: adapterType,
    candidates: [
      {
        content: {
          parts: [
            {
              text: sqlText
            }
          ]
        }
      }
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: completionTokens,
      totalTokenCount: totalTokens
    }
  }
}];
