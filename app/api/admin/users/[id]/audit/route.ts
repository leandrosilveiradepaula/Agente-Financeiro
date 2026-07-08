import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminSession } from "@/lib/server-auth";
import { getAdminUserById } from "@/lib/admin-users";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AdminAuditRow = {
  id: string;
  request_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_profile: string | null;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  success: boolean;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  reason: string | null;
  created_at: string;
};

export async function GET(_request: Request, context: RouteContext) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { id } = await context.params;
  const user = await getAdminUserById(id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "user_not_found" },
      { status: 404 }
    );
  }

  const result = await db.query<AdminAuditRow>(
    `
    SELECT
      id,
      request_id,
      actor_user_id,
      actor_email,
      actor_profile,
      target_user_id,
      target_email,
      action,
      success,
      before_data,
      after_data,
      metadata,
      ip_address,
      user_agent,
      reason,
      created_at
    FROM public.ai_agent_admin_audit_events
    WHERE target_user_id = $1
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [id]
  );

  return NextResponse.json({
    success: true,
    audit_events: result.rows
  });
}
