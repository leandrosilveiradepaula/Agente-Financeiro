import { NextResponse } from "next/server";
import { getAgentSession } from "@/lib/server-auth";
import { isTenantIdentityEnabled } from "@/lib/tenant-identity";

export const runtime = "nodejs";

export async function GET() {
  const session = await getAgentSession();

  if (!session) {
    return NextResponse.json({
      success: true,
      authenticated: false,
      user: null
    });
  }

  return NextResponse.json({
    success: true,
    authenticated: true,
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      profile: session.userProfile,
      // The session is validated against active persisted membership on
      // every request; this value must never come from a browser parameter.
      ...(isTenantIdentityEnabled()
        ? {
            tenantIdentityEnabled: true,
            organizationId: session.organizationId ?? null
          }
        : {})
    }
  }, { headers: { "Cache-Control": "no-store" } });
}