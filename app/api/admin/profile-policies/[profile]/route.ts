import { NextResponse } from "next/server";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAdminSession } from "@/lib/server-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ profile: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { profile } = await context.params;
  const policy = await getProfilePolicy(decodeURIComponent(profile));

  if (!policy) {
    return NextResponse.json(
      {
        success: false,
        error: "policy_not_found"
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    policy
  });
}
