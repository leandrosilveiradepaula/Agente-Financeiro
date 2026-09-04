import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getRequestMetadata,
  requireAdminSession
} from "@/lib/server-auth";
import {
  getAdminUserById,
  logAdminAuditEvent,
  pickAdminUserAuditFields,
  sanitizeAdminUser
} from "@/lib/admin-users";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
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

  await db.query(
    `
    UPDATE public.ai_agent_users
    SET
      is_active = true,
      disabled_at = NULL,
      disabled_by = NULL,
      failed_login_attempts = 0,
      locked_until = NULL,
      updated_at = now(),
      last_admin_action_at = now()
    WHERE id = $1
    `,
    [id]
  );

  const metadata = await getRequestMetadata();
  const updatedUser = await getAdminUserById(id);

  await logAdminAuditEvent({
    actor: session,
    targetUserId: id,
    targetEmail: user.email,
    action: "enable_user",
    metadata,
    beforeData: pickAdminUserAuditFields(user, [
      "is_active",
      "disabled_at",
      "disabled_by",
      "failed_login_attempts",
      "locked_until"
    ]),
    afterData: updatedUser
      ? pickAdminUserAuditFields(updatedUser, [
          "is_active",
          "disabled_at",
          "disabled_by",
          "failed_login_attempts",
          "locked_until"
        ])
      : {}
  });

  return NextResponse.json({
    success: true,
    user: updatedUser ? sanitizeAdminUser(updatedUser) : null
  });
}
