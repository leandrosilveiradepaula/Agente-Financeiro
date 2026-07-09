import { NextResponse } from "next/server";
import { getAgentRunById, sanitizeAgentRunForViewer } from "@/lib/agent-runs";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
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

  if (!policy.can_view_all_runs) {
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

  return NextResponse.json({
    success: true,
    run: sanitizeAgentRunForViewer(run, policy, { includeFullSql: true })
  });
}
