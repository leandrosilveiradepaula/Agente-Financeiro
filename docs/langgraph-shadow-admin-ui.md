# LangGraph Shadow Admin UI

## Scope

The Product Original admin UI exposes LangGraph Shadow observability inside the existing `/admin/runs` detail modal. It is read-only and does not replace the official n8n run history, official status, official result, or existing SQL visibility rules.

## Architecture

Browser requests always go through the Next.js BFF:

```text
Browser
-> Next.js admin BFF
-> LangGraph internal read API
```

The browser never receives `LANGGRAPH_INTERNAL_BASE_URL` and never calls the Python service directly.

## BFF Routes

- `GET /api/admin/runs/[id]/shadow-runs`
- `GET /api/admin/shadow-runs/[shadow_record_id]/visualization`

`[id]` is the Product Original `agent_run_id`. The visualization route first resolves the Shadow record metadata, validates the correlated official run, and then returns the visualization.

## Authorization

Shadow visibility inherits the official run authorization model:

- `can_view_all_runs`
- `can_view_own_runs`
- existing `admin` and `auditoria` all-runs behavior

No `can_view_shadow_runs` permission is introduced in this step.

## Dispatch Flag

`LANGGRAPH_SHADOW_ENABLED` controls only asynchronous dispatch. Administrative historical reads do not check that flag, so previously stored evidence can still be viewed when dispatch is disabled.

## Safe Contract

The UI renders only safe Shadow fields:

- Shadow run summaries
- event type
- status
- timestamps
- reapproval flag
- repair/error flags
- ordered timeline steps
- sanitized warnings and errors
- allowlisted step metadata

It does not render raw operational inputs or provider payloads in the Shadow section.

## UI States

The Shadow section has isolated states for loading, empty evidence, unavailable Shadow service, authorization errors, and visualization errors. These states do not block the official run detail modal.

## Out of Scope

Benchmarking remains outside the scope of Microstep 5.4. This UI does not implement an n8n versus LangGraph comparison.

LangSmith is not used or required for this admin UI. Current observability uses the project's own Shadow evidence; LangSmith may be a future complement, not a dependency.

## Production Note

Production exposure of the Python service still depends on service-to-service authentication or private ingress. This UI step does not introduce a temporary key, hardcoded secret, or browser-propagated session cookie.
