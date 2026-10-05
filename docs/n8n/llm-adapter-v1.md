# n8n DEMO — LLM Adapter v1

## Objetivo

Permitir que o fluxo oficial DEMO use provedores LLM selecionados pelo produto sem transformar o n8n em motor semântico.

O n8n continua responsável por roteamento operacional e integração. A seleção chega validada pelo backend em:

```json
{
  "llm_selection": {
    "provider_key": "...",
    "model_key": "...",
    "config_version": "..."
  },
  "llm_runtime": {
    "adapter_type": "...",
    "model_key": "...",
    "config_version": "...",
    "timeout_ms": 180000,
    "max_tokens": 8192,
    "temperature": 0
  }
}
```

Nenhum segredo, endpoint ou token é enviado pelo browser ou pelo registry público.

## Roteamento

Depois de `Code - Montar Prompt SQL DuckLake Offline`:

```text
Code - Resolver Adapter LLM
        |
        v
Switch - Adapter LLM
   |                     |
   | gemini              | openai compatible
   v                     v
Code - Body Gemini       Code - Body OpenAI Compatible
   |                     |
HTTP - Gemini            HTTP - Infodive Local
   |                     |
   +----------+----------+
              |
              v
Code - Normalizar Resposta LLM
              |
              v
Code - Limpar SQL DuckLake
```

O restante do fluxo permanece inalterado.

## Regras estruturais

Adapters permitidos nesta versão:

- `gemini_generate_content`
- `openai_compatible_chat`

A lista é estrutural: representa protocolos suportados, não modelos/clientes.

Não criar condições por pergunta, intenção, tabela, DRE, marca ou benchmark.

## Credenciais

Cada HTTP node usa uma credencial n8n própria.

- Gemini: credencial Google/Gemini já configurada no n8n.
- Infodive Local: credencial Header Auth com `Authorization: Bearer <token>`.

Não colocar API key em query string, Code node, JSON exportado ou expressão.

O endpoint local deve existir somente na configuração operacional do n8n (por exemplo, variável/credencial do ambiente), nunca no payload público.

## Falhas

- adapter não suportado: falhar explicitamente com `LLM_ADAPTER_NOT_SUPPORTED`;
- provider indisponível: retornar erro sanitizado e não trocar silenciosamente de modelo;
- resposta inválida: `LLM_RESPONSE_INVALID`;
- nunca executar fallback automático de Gemini para Infodive ou vice-versa.

## Telemetria

`Code - Normalizar Resposta LLM` deve produzir formato unificado:

```json
{
  "llm_provider": "provider_key",
  "llm_model": "model_key",
  "llm_config_version": "config_version",
  "llm_adapter_type": "adapter_type",
  "candidates": [
    {
      "content": {
        "parts": [
          { "text": "SELECT ..." }
        ]
      }
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 0,
    "candidatesTokenCount": 0,
    "totalTokenCount": 0
  }
}
```

Isso preserva compatibilidade com o cleaner atual enquanto permite remover gradualmente nomes Gemini-específicos.
