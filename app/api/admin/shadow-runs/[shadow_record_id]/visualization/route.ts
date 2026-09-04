import { NextResponse } from "next/server";
import { authorizeAdminRunReadAccess } from "@/lib/admin-run-access";
import {
  getLangGraphShadowRun,
  getLangGraphShadowRunVisualization,
  sanitizeShadowRunVisualizationForBrowser
} from "@/lib/langgraph-shadow-read-client";
import { requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ shadow_record_id: string }>;
};

function shadowReadErrorResponse(status: string, httpStatus?: number) {
  if (status === "bad_request") {
    return NextResponse.json(
      { success: false, error: "shadow_request_invalid" },
      { status: 400 }
    );
  }

  if (status === "not_found") {
    return NextResponse.json(
      { success: false, error: "shadow_not_found" },
      { status: 404 }
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

export async function GET(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return response;
  }

  const { shadow_record_id: shadowRecordId } = await context.params;
  const shadowRun = await getLangGraphShadowRun(shadowRecordId);

  if (shadowRun.status !== "ok") {
    logger.info("admin_shadow_runs.visualization_metadata_completed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      shadowRecordId,
      operation: "get_shadow_run",
      status: shadowRun.status,
      durationMs: Date.now() - startedAt
    });

    return shadowReadErrorResponse(shadowRun.status, shadowRun.httpStatus);
  }

  const access = await authorizeAdminRunReadAccess(shadowRun.data.agent_run_id, session);

  if (!access.allowed) {
    logger.warn("admin_shadow_runs.visualization_forbidden", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      shadowRecordId,
      agentRunId: shadowRun.data.agent_run_id,
      status: access.status,
      error: access.error
    });

    return NextResponse.json(
      { success: false, error: access.error === "run_not_found" ? "shadow_not_found" : "forbidden" },
      { status: access.status === 404 ? 404 : 403 }
    );
  }

  const visualization = await getLangGraphShadowRunVisualization(shadowRecordId);

  logger.info("admin_shadow_runs.visualization_completed", {
    requestId,
    userId: session.userId,
    userEmail: session.email,
    userProfile: session.userProfile,
    shadowRecordId,
    agentRunId: shadowRun.data.agent_run_id,
    operation: "get_shadow_visualization",
    status: visualization.status,
    durationMs: Date.now() - startedAt
  });

  if (visualization.status !== "ok") {
    return shadowReadErrorResponse(visualization.status, visualization.httpStatus);
  }

  const safeVisualization = sanitizeShadowRunVisualizationForBrowser(visualization.data);

  if (!safeVisualization) {
    return shadowReadErrorResponse("unavailable");
  }

  if (
    safeVisualization.run.agent_run_id !== shadowRun.data.agent_run_id ||
    safeVisualization.run.shadow_record_id !== shadowRecordId
  ) {
    logger.warn("admin_shadow_runs.visualization_agent_run_mismatch", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      shadowRecordId,
      agentRunId: shadowRun.data.agent_run_id,
      visualizationAgentRunId: safeVisualization.run.agent_run_id,
      visualizationShadowRecordId: safeVisualization.run.shadow_record_id
    });

    return NextResponse.json(
      { success: false, error: "forbidden" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    visualization: safeVisualization
  });
}
