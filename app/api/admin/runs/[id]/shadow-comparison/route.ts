import { NextResponse } from "next/server";
import { authorizeAdminRunReadAccess } from "@/lib/admin-run-access";
import {
  compareLangGraphShadowSql,
  isShadowSqlComparisonEnabled
} from "@/lib/langgraph-shadow-comparison-client";
import { requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// Never accept the official SQL or original user's identity from the browser.
// Both values are read from the already-authorized official run.
export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const { session, response } = await requireAgentSession();
  if (response || !session) return response;

  const { id } = await context.params;
  const access = await authorizeAdminRunReadAccess(id, session);
  if (!access.allowed) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status }
    );
  }
  if (!access.policy.can_view_sql) {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
  }
  if (!isShadowSqlComparisonEnabled()) {
    return NextResponse.json(
      { success: false, error: "shadow_comparison_disabled" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const ids = url.searchParams.getAll("shadow_record_id");
  const shadowRecordId = ids.length === 1 ? ids[0] : "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(shadowRecordId)) {
    return NextResponse.json(
      { success: false, error: "shadow_id_invalid" },
      { status: 400 }
    );
  }

  const { run } = access;
  if (!run.user_id || !run.pergunta ||
      (!run.sql_generated && !run.sql_executed)) {
    return NextResponse.json(
      { success: false, error: "official_sql_or_identity_missing" },
      { status: 409 }
    );
  }

  // Two independent, read-only comparisons against the SAME persisted
  // LangGraph generation, never two requests to generate or execute SQL.
  // The old n8n workflow can rewrite SQL between these two stored stages.
  async function compareStage(officialSql: string | null) {
    if (!officialSql?.trim()) return { status: "not_recorded" as const };
    const result = await compareLangGraphShadowSql({
      agentRunId: id,
      shadowRecordId,
      question: run.pergunta,
      officialSql,
      originalUserId: run.user_id!
    });
    if (result.status === "ok") {
      return { status: "ok" as const, data: result.data };
    }
    return { status: result.status === "rejected"
      ? "rejected" as const : "unavailable" as const };
  }

  const [generated, executed] = await Promise.all([
    compareStage(run.sql_generated),
    compareStage(run.sql_executed)
  ]);

  logger.info("admin_shadow_sql_comparison.read_completed", {
    requestId, agentRunId: id, shadowRecordId,
    generatedStatus: generated.status,
    executedStatus: executed.status,
    actorProfile: session.userProfile,
    scope: access.scope
  });

  if (generated.status !== "ok" && executed.status !== "ok") {
    return NextResponse.json(
      { success: false, error: "shadow_comparison_unavailable" },
      { status: 503 }
    );
  }

  // This flag compares stored SQL text, not accounting meaning; it may
  // include purely cosmetic changes.
  const officialSqlTextChanged = run.sql_generated && run.sql_executed
    ? run.sql_generated !== run.sql_executed
    : null;

  return NextResponse.json({
    success: true,
    comparison: {
      generated,
      executed,
      official_sql_text_changed: officialSqlTextChanged
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
