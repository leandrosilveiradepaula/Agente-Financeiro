import { NextResponse } from "next/server";
import { getProfilePolicy } from "@/lib/profile-policy";
import { getSecurityChecks } from "@/lib/security-checks";
import { requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
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

  if (!policy.can_manage_users) {
    return NextResponse.json(
      { success: false, error: "forbidden" },
      { status: 403 }
    );
  }

  const result = getSecurityChecks();

  return NextResponse.json({
    success: true,
    checks: result.checks,
    summary: result.summary
  });
}
