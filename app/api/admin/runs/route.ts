import { NextResponse } from "next/server";
import { listAgentRuns, sanitizeAgentRunForViewer } from "@/lib/agent-runs";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";
import { logger } from "@/lib/server-logger";

export const runtime = "nodejs";

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 50);

  if (!Number.isFinite(parsed) || parsed <= 0) return 50;

  return Math.min(Math.trunc(parsed), 200);
}

function parseOffset(value: string | null) {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.trunc(parsed);
}

export async function GET(request: Request) {
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
    logger.warn("admin_runs.list_forbidden", {
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

  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() || undefined;
  const userEmail = url.searchParams.get("user_email")?.trim() || undefined;
  const intent = url.searchParams.get("intent")?.trim() || undefined;
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = parseOffset(url.searchParams.get("offset"));

  logger.info("admin_runs.list_started", {
    requestId,
    userId: session.userId,
    userEmail: session.email,
    userProfile: session.userProfile,
    table: "public.ai_agent_runs",
    filterStatus: status ?? null,
    filterUserEmail: userEmail ?? null,
    filterIntent: intent ?? null,
    filterLimit: limit,
    filterOffset: offset,
    filterScope: canViewAllRuns ? "all_runs" : "own_runs"
  });

  try {
    const result = await listAgentRuns({
      status,
      userEmail,
      intent,
      viewerUserId: canViewAllRuns ? undefined : session.userId,
      viewerEmail: canViewAllRuns ? undefined : session.email,
      limit,
      offset
    });

    logger.info("admin_runs.list_completed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs",
      returnedCount: result.runs.length,
      total: result.total
    });

    return NextResponse.json({
      success: true,
      runs: result.runs.map((run) =>
        sanitizeAgentRunForViewer(run, policy, { includeFullSql: false })
      ),
      total: result.total
    });
  } catch (error) {
    logger.error("admin_runs.list_failed", {
      requestId,
      userId: session.userId,
      userEmail: session.email,
      userProfile: session.userProfile,
      table: "public.ai_agent_runs",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      { success: false, error: "runs_load_failed" },
      { status: 500 }
    );
  }
}
