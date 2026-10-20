import { NextResponse } from "next/server";
import { authorizeAdminRunReadAccess } from "@/lib/admin-run-access";
import { listLangGraphShadowRuns } from "@/lib/langgraph-shadow-read-client";
import { isLangGraphShadowEnabled } from "@/lib/langgraph-shadow-client";
import { isShadowSqlComparisonEnabled } from "@/lib/langgraph-shadow-comparison-client";
import { requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 10);

  if (!Number.isFinite(parsed) || parsed <= 0) return 10;

  return Math.min(Math.trunc(parsed), 50);
}

function shadowReadErrorResponse(status: string, httpStatus?: number) {
  if (status === "bad_request") {
    return NextResponse.json(
      { success: false, error: "shadow_request_invalid" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: "shadow_unavailable",
      shadow_status: status,
      ...(httpStatus ? { shadow_http_status: httpStatus } : {})
    },
    { status: 503 }
  );
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return response;
  }

  const { id } = await context.params;
  const access = await authorizeAdminRunReadAccess(id, session);

  if (!access.allowed) {
    logger.warn("admin_shadow_runs.list_forbidden", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      agentRunId: id,
      status: access.status,
      error: access.error
    });

    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status }
    );
  }

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const result = await listLangGraphShadowRuns(id, { limit });

  logger.info("admin_shadow_runs.list_completed", {
    requestId,
    userId: session.userId,
    userEmail: session.email,
    userProfile: session.userProfile,
    agentRunId: id,
    operation: "list_shadow_runs",
    status: result.status,
    durationMs: Date.now() - startedAt
  });

  if (result.status === "ok") {
    return NextResponse.json({
      success: true,
      shadow_runs: result.data,
      comparison_enabled: isShadowSqlComparisonEnabled(),
      shadow_enabled: isLangGraphShadowEnabled()
    });
  }

  if (result.status === "not_found") {
    return NextResponse.json({
      success: true,
      shadow_runs: [],
      comparison_enabled: isShadowSqlComparisonEnabled(),
      shadow_enabled: isLangGraphShadowEnabled()
    });
  }

  return shadowReadErrorResponse(result.status, result.httpStatus);
}
