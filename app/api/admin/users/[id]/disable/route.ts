import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getRequestMetadata,
  requireAdminSession
} from "@/lib/server-auth";
import {
  countActiveAdmins,
  getAdminUserById,
  logAdminAuditEvent,
  pickAdminUserAuditFields,
  revokeActiveUserSessions,
  sanitizeAdminUser
} from "@/lib/admin-users";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { id } = await context.params;

  if (id === session.userId) {
    return NextResponse.json(
      { success: false, error: "cannot_disable_self" },
      { status: 400 }
    );
  }

  const user = await getAdminUserById(id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "user_not_found" },
      { status: 404 }
    );
  }

  if (
    user.is_active &&
    user.user_profile === "admin" &&
    (await countActiveAdmins(id)) === 0
  ) {
    return NextResponse.json(
      { success: false, error: "cannot_disable_last_active_admin" },
      { status: 400 }
    );
  }

  let body: unknown = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const reason =
    isRecord(body) && typeof body.reason === "string"
      ? body.reason.trim() || null
      : null;

  await db.query(
    `
    UPDATE public.ai_agent_users
    SET
      is_active = false,
      disabled_at = now(),
      disabled_by = $1,
      updated_at = now(),
      last_admin_action_at = now()
    WHERE id = $2
    `,
    [session.userId, id]
  );

  const revokedSessions = await revokeActiveUserSessions(id);
  const metadata = await getRequestMetadata();
  const updatedUser = await getAdminUserById(id);

  await logAdminAuditEvent({
    actor: session,
    targetUserId: id,
    targetEmail: user.email,
    action: "disable_user",
    metadata,
    beforeData: pickAdminUserAuditFields(user, [
      "is_active",
      "disabled_at",
      "disabled_by"
    ]),
    afterData: updatedUser
      ? pickAdminUserAuditFields(updatedUser, [
          "is_active",
          "disabled_at",
          "disabled_by"
        ])
      : {},
    reason,
    details: {
      revoked_sessions_count: revokedSessions
    }
  });

  return NextResponse.json({
    success: true,
    user: updatedUser ? sanitizeAdminUser(updatedUser) : null,
    revoked_sessions: revokedSessions
  });
}
