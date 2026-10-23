import { NextResponse } from "next/server";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";
import { inspectTenantSchemaReadiness } from "@/lib/tenant-schema-readiness";

export const runtime = "nodejs";

// Explicit operator-only read of catalog metadata. Existing orchestration
// diagnostics remain network/DB-free and this endpoint cannot apply DDL.
export async function GET() {
  const { session, response } = await requireAgentSession();
  if (response || !session) {
    return response ?? NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const policy = await getProfilePolicy(session.userProfile);
  if (!policy || !policy.can_manage_users) {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
  }
  const readiness = await inspectTenantSchemaReadiness();
  return NextResponse.json(
    { success: true, tenant_schema: readiness },
    { headers: { "Cache-Control": "no-store" } }
  );
}
