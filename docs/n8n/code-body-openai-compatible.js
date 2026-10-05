// n8n Code node: Code - Body OpenAI Compatible
// Compatível com OpenWebUI / OpenAI-compatible chat completions.

const input = $json || {};
const adapter = input.llm_adapter || {};
const prompt = String(
  input.prompt ||
  input.prompt_sql ||
  input.prompt_geracao_sql ||
  ''
).trim();

if (adapter.adapter_type !== 'openai_compatible_chat') {
  throw new Error('LLM_ADAPTER_MISMATCH');
}

if (!prompt) {
  throw new Error('LLM_PROMPT_REQUIRED');
}

const maxTokens =
  Number.isFinite(Number(adapter.max_tokens)) && Number(adapter.max_tokens) > 0
    ? Math.trunc(Number(adapter.max_tokens))
    : 8192;

const temperature =
  Number.isFinite(Number(adapter.temperature))
    ? Number(adapter.temperature)
    : 0;

return [{
  json: {
    ...input,
    body: {
      model: adapter.model_key,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false
    }
  }
}];
