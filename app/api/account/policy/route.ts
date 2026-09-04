import { NextResponse } from "next/server";
import {
  getProfilePolicy,
  sanitizeProfilePolicyCapabilities
} from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const { session, response: unauthorizedResponse } = await requireAgentSession();

  if (unauthorizedResponse || !session) {
    return (
      unauthorizedResponse ??
      NextResponse.json(
        {
          success: false,
          error: "unauthorized"
        },
        { status: 401 }
      )
    );
  }

  const policy = await getProfilePolicy(session.userProfile);

  if (!policy) {
    return NextResponse.json(
      {
        success: false,
        error: "profile_policy_not_found"
      },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    policy: sanitizeProfilePolicyCapabilities(policy)
  });
}
