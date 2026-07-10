import { NextResponse } from "next/server";
import { listProfilePolicies } from "@/lib/profile-policy";
import { requireAdminSession } from "@/lib/server-auth";

export const runtime = "nodejs";

function moduleDisabledResponse() {
  return NextResponse.json(
    {
      success: false,
      error: "module_disabled"
    },
    { status: 404 }
  );
}

export async function GET() {
  if (process.env.PROFILE_POLICY_MANAGEMENT_ENABLED !== "true") {
    return moduleDisabledResponse();
  }

  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const policies = await listProfilePolicies();

  return NextResponse.json({
    success: true,
    policies
  });
}
