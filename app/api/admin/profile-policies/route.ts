import { NextResponse } from "next/server";
import { listProfilePolicies } from "@/lib/profile-policy";
import { requireAdminSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
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
