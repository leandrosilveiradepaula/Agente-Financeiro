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
  if (!run.user_id || !run.pergunta || !run.sql_generated) {
    return NextResponse.json(
      { success: false, error: "official_sql_or_identity_missing" },
      { status: 409 }
    );
  }
  const result = await compareLangGraphShadowSql({
    agentRunId: id,
    shadowRecordId,
    question: run.pergunta,
    officialSql: run.sql_generated,
    originalUserId: run.user_id
  });

  logger.info("admin_shadow_sql_comparison.read_completed", {
    requestId, agentRunId: id, shadowRecordId,
    status: result.status, actorProfile: session.userProfile,
    scope: access.scope
  });

  if (result.status === "ok") {
    return NextResponse.json(
      { success: true, comparison: result.data },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { success: false, error: result.status === "rejected" ?
      "shadow_comparison_not_possible" : "shadow_comparison_unavailable" },
    { status: result.status === "rejected" ? 409 : 503 }
  );
}
