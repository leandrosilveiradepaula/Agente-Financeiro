# LangGraph Shadow Dispatch Contract

This product keeps n8n as the official orchestration path. LangGraph shadow dispatch is an internal, asynchronous, best-effort side path used only for offline validation and shadow persistence.

## Configuration

Shadow dispatch is off by default:

- `LANGGRAPH_SHADOW_ENABLED=false`
- `LANGGRAPH_INTERNAL_BASE_URL=http://127.0.0.1:8000`
- `LANGGRAPH_SHADOW_TIMEOUT_MS=1500`
- `LANGGRAPH_S2S_TOKEN=`

If `LANGGRAPH_SHADOW_ENABLED` is not exactly `true`, the BFF does not call LangGraph.

`LANGGRAPH_S2S_TOKEN` is a server-only secret. The BFF sends it as
`Authorization: Bearer <test-s2s-secret>` to LangGraph internal POST and read
endpoints. It is not a browser/session credential and must not use a
`NEXT_PUBLIC_` prefix.

## Internal Endpoints

`POST /v1/internal/sql-agent/generate`

```json
{
  "contract_version": "1",
  "agent_run_id": "product-agent-run-id",
  "question": "user question",
  "principal": {
    "id": "user-id",
    "email": "user@example.com",
    "profile": "admin"
  },
  "correlation_metadata": {
    "source": "nextjs_bff",
    "event": "generate",
    "route": "/api/generate-sql",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "request_id": "request-id",
    "agent_version": "optional-product-version"
  }
}
```

`POST /v1/internal/sql-agent/execute-approved-shadow`

```json
{
  "contract_version": "1",
  "agent_run_id": "product-agent-run-id",
  "approved_sql": "SELECT ...",
  "principal": {
    "id": "user-id",
    "email": "user@example.com",
    "profile": "admin"
  },
  "correlation_metadata": {
    "source": "nextjs_bff",
    "event": "execute_approved",
    "route": "/api/execute-watson",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "request_id": "request-id"
  }
}
```

## Isolation Rules

- Browser/UI request and response contracts do not change.
- n8n remains the official path for SQL generation and Watson execution.
- LangGraph shadow failures never alter the official HTTP status or body.
- LangGraph shadow dispatch does not send cookies, user authorization headers, session tokens, credentials, raw request headers, or policy objects.
- LangGraph shadow dispatch and read use only the server-to-server Bearer credential configured in `LANGGRAPH_S2S_TOKEN`.
- LangGraph shadow does not execute real SQL, call real Watson, or replace the approved SQL.
- A repaired SQL observed by LangGraph shadow is only evidence or a proposal; it is not approved for execution by the original approval event.
- Shadow HTTP has an explicit timeout and no automatic retry in this microstep.
