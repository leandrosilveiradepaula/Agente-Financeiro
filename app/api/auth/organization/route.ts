import { NextResponse } from "next/server";
import {
  requireAgentSession,
  selectCurrentSessionOrganization
} from "@/lib/server-auth";
import { isTenantIdentityEnabled } from "@/lib/tenant-identity";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(request: Request) {
  const { session, response } = await requireAgentSession();
  if (response || !session) return response;
  if (!isTenantIdentityEnabled()) {
    return NextResponse.json({ success: false, error: "tenant_identity_disabled" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_organization_selection" }, { status: 400 });
  }
  const organizationId = typeof (body as { organization_id?: unknown })?.organization_id === "string"
    ? (body as { organization_id: string }).organization_id.trim()
    : "";
  if (!UUID.test(organizationId)) {
    return NextResponse.json({ success: false, error: "invalid_organization_selection" }, { status: 400 });
  }
  const selected = await selectCurrentSessionOrganization(organizationId);
  if (!selected) {
    return NextResponse.json({ success: false, error: "organization_selection_forbidden" }, { status: 403 });
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
