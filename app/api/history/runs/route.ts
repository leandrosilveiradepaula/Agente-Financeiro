import { NextResponse } from "next/server";
import { listAgentRuns } from "@/lib/agent-runs";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";
import { AGENT_VERSION, type QueryHistoryItem } from "@/lib/types";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";

export const runtime = "nodejs";

function historyItemFromRun(
  run: Awaited<ReturnType<typeof listAgentRuns>>["runs"][number],
  options: { canViewSql: boolean }
): QueryHistoryItem {
  const sql = options.canViewSql ? run.sql_executed || run.sql_generated || "" : "";

  return {
    id: run.id,
    pergunta: run.pergunta,
    sql,
    agent_version: run.executor_version || AGENT_VERSION,
    detected_intent: run.detected_intent || "nao_informado",
    validation_status: run.validation_status || "nao_informado",
    created_at: run.created_at,
    executed_watson: run.execution_status === "executed",
    result_source: run.execution_status === "executed" ? "automatico" : undefined,
    query_id: run.run_id || run.request_id || undefined,
    cache_hit: run.sql_cache_hit ?? undefined
  };
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return (
      response ??
      NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 })
    );
  }
  const tenant = getSessionTenantIdentity(session);
  if (tenant.status === "required") {
    return NextResponse.json({ success: false, error: "tenant_identity_required" }, { status: 403 });
  }

  const policy = await getProfilePolicy(session.userProfile);

  if (!policy) {
    return NextResponse.json(
      { success: false, error: "profile_policy_not_found" },
      { status: 403 }
    );
  }

  const canViewOwnRuns = policy.can_view_own_runs || policy.can_view_all_runs;

  if (!canViewOwnRuns) {
    logger.warn("query_history.list_forbidden", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs"
    });

    return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await listAgentRuns({
      viewerUserId: session.userId,
      viewerEmail: session.email,
      organizationId: tenant.status === "ready" ? tenant.organizationId : undefined,
      limit: 10,
      offset: 0
    });

    logger.info("query_history.list_completed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs",
      returnedCount: result.runs.length,
      total: result.total,
      scope: "own_runs"
    });

    return NextResponse.json({
      success: true,
      items: result.runs.map((run) =>
        historyItemFromRun(run, { canViewSql: policy.can_view_sql })
      ),
      total: result.total
    });
  } catch (error) {
    logger.error("query_history.list_failed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      { success: false, error: "history_load_failed" },
      { status: 500 }
    );
  }
}
