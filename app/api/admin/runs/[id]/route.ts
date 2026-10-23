import { NextResponse } from "next/server";
import { sanitizeAgentRunForViewer } from "@/lib/agent-runs";
import { authorizeAdminRunReadAccess } from "@/lib/admin-run-access";
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

  const { id } = await context.params;
  const access = await authorizeAdminRunReadAccess(id, session);
  if (!access.allowed) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  logger.info("admin_runs.detail_completed", {
    requestId,
    userId: session.userId,
    userEmail: session.email,
    userProfile: session.userProfile,
    table: "public.ai_agent_runs",
    runId: id,
    scope: access.scope
  });

  return NextResponse.json({
    success: true,
    run: sanitizeAgentRunForViewer(access.run, access.policy, { includeFullSql: true })
  });
}
