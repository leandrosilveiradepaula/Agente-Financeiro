import { NextResponse } from "next/server";
import { getAgentRunById, sanitizeAgentRunForViewer } from "@/lib/agent-runs";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return response;
  }

  const policy = await getProfilePolicy(session.userProfile);

  if (!policy) {
    return NextResponse.json(
      { success: false, error: "profile_policy_not_found" },
      { status: 403 }
    );
  }

  const canViewAllRuns =
    policy.can_view_all_runs || ["admin", "auditoria"].includes(session.userProfile);
  const canViewOwnRuns = policy.can_view_own_runs || canViewAllRuns;

  if (!canViewOwnRuns) {
    logger.warn("admin_runs.detail_forbidden", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs",
      canViewAllRuns,
      canViewOwnRuns
    });

    return NextResponse.json(
      { success: false, error: "forbidden" },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const run = await getAgentRunById(id);

  if (!run) {
    return NextResponse.json(
      { success: false, error: "run_not_found" },
      { status: 404 }
    );
  }

  const ownsRun =
    run.user_id === session.userId ||
    Boolean(run.user_email && run.user_email.toLowerCase() === session.email.toLowerCase());

  if (!canViewAllRuns && !ownsRun) {
    logger.warn("admin_runs.detail_out_of_scope", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs",
      runId: id
    });

    return NextResponse.json(
      { success: false, error: "forbidden" },
      { status: 403 }
    );
  }

  logger.info("admin_runs.detail_completed", {
    requestId,
    userId: session.userId,
    userEmail: session.email,
    userProfile: session.userProfile,
    table: "public.ai_agent_runs",
    runId: id,
    scope: canViewAllRuns ? "all_runs" : "own_runs"
  });

  return NextResponse.json({
    success: true,
    run: sanitizeAgentRunForViewer(run, policy, { includeFullSql: true })
  });
}
