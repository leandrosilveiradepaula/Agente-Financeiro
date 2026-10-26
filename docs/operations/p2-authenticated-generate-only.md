# P2 — authenticated Product → n8n candidate → LangGraph generation-only

**Status:** implementation candidate, **not activated or deployed**. P1 is already
proven by a separate, manually authorized n8n Shadow TEST attempt. P2 must
prove that the *same authenticated Product request* reaches n8n and LangGraph
without first executing any financial SQL through the old Demo webhook.

## Scope and protections

- Exact existing Next.js route: `POST /api/generate-sql`.
- P2 is selected only with the custom HTTP request header
  `X-Agent-P2-Generate-Only: true`. Normal requests use the unchanged
  official n8n path.
- P2 is **default-off**: `LANGGRAPH_P2_GENERATE_ONLY_ENABLED=false`.
  An explicit `true` affects only the P2 branch, **not** the global
  `LANGGRAPH_SHADOW_ENABLED` toggle.
- Requires valid Product session, admin profile, active `can_generate_sql`
  profile policy, subject-bound time-expiring Shadow canary and n8n transport.
- Uses the persisted session's selected organization, never a client-provided
  organization. Tenant-enabled deployments additionally require a matching
  `LANGGRAPH_P2_AUTHORIZED_ORGANIZATION_ID`. Unscoped use is restricted to
  the Demo interface.
- JSON body must contain **only** `pergunta`, with a nonempty string at most
  16,000 characters. SQL, LLM selection, execute flags, run IDs or organization
  identifiers are not accepted from the caller.
- Product persists a new `agent_run_id` and the n8n receipt. A successful
  `202` means only **accepted** by n8n; SQL generation still requires separate
  LangGraph evidence by the same `agent_run_id`.
- The route does **not** call the old official n8n webhook, an Execute Approved
  endpoint, a SQL repair endpoint or the financial execution database.
  LangGraph Shadow TEST must keep
  `LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false`.
- Credentials, raw SQL, data, question text and request headers are absent
  from the P2 HTTP response. The user question is persisted in the existing
  authenticated agent run log; do not use real sensitive financial content.

## Configuration — deployment is a separate operator decision

Only after authorization for the Product deployment and one new Gemini
generation, arrange the existing production n8n candidate URL and token
(`LANGGRAPH_SHADOW_N8N_WEBHOOK_URL`, `N8N_SHADOW_WEBHOOK_TOKEN`) and
explicit canary (`LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON`,
`LANGGRAPH_SHADOW_CANARY_EXPIRES_AT`) with a narrow authorized admin
subject and short expiry. Require `LANGGRAPH_SHADOW_TRANSPORT=n8n`.
Keep `LANGGRAPH_SHADOW_ENABLED=false` and
`LANGGRAPH_OFFICIAL_VIA_N8N=false`. Set
`LANGGRAPH_P2_GENERATE_ONLY_ENABLED=true` only for the approved test
window. For tenant-enabled operation, additionally require
`LANGGRAPH_P2_AUTHORIZED_ORGANIZATION_ID` to match the selected persisted
membership and ensure the LangGraph runtime is bound to that same
organization. For the Demo, `AGENT_INTERFACE_MODE=demo` is mandatory
when tenant identity is disabled.

No database migration or changes to n8n workflow topology are required.
No environment variables are changed by merging this PR.

## Acceptance runbook

1. Confirm deployment SHA, valid admin session and enabled profile policy,
   narrowed canary, original official workflow unaffected and
   `LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false` on Shadow TEST.
2. Using the authenticated Product session (same origin), submit exactly
   **one** authorized novel question with JSON `{"pergunta":"..."}`, the
   header `X-Agent-P2-Generate-Only: true` and the configured P2 flag.
3. Observe Product `202` with `agent_run_id`, `request_id`,
   `shadow_status=sent`, `sql_generation_status=pending`. Never count
   this alone as success; HTTP 202 is merely the n8n transport receipt.
4. Find the **same `agent_run_id`** in LangGraph persisted evidence
   (`run_id`, `shadow_record_id`, actual provider/model, context
   version/fingerprint, security/contract/preflight gates, SQL fingerprint,
   usage/timings). For P2 PASS require Gemini real, successful validated
   SQL generation, no financial SQL execution and Product receipt
   correlation. If any gate rejects, the proof is NOT passed.
5. Deactivate `LANGGRAPH_P2_GENERATE_ONLY_ENABLED` after testing,
   record exact deployed SHA, request and evidence IDs, without secrets.
   Preserve the official n8n response path. Roll back to the previous
   Product deployment if the new branch affects normal traffic.

**Never** activate on production or call a paid model as a side effect
of this PR. Numeric financial parity, public TEMPORARY remediation and
two-context portability remain later independently gated milestones.
