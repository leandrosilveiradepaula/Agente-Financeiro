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
  const user = await getAdminUserById(id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "user_not_found" },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const password = isRecord(body) && typeof body.password === "string" ? body.password : "";

  if (!password) {
    return NextResponse.json(
      { success: false, error: "missing_password" },
      { status: 400 }
    );
  }

  await db.query(
    `
    UPDATE public.ai_agent_users
    SET
      password_hash = crypt($1, gen_salt('bf')),
      password_changed_at = now(),
      must_change_password = true,
      failed_login_attempts = 0,
      locked_until = NULL,
      updated_at = now(),
      last_admin_action_at = now()
    WHERE id = $2
    `,
    [password, id]
  );

  const revokedSessions = await revokeActiveUserSessions(id);
  const metadata = await getRequestMetadata();
  const updatedUser = await getAdminUserById(id);

  await logAdminAuditEvent({
    actor: session,
    targetUserId: id,
    targetEmail: user.email,
    action: "reset_password",
    metadata,
    beforeData: pickAdminUserAuditFields(user, [
      "password_changed_at",
      "must_change_password",
      "failed_login_attempts",
      "locked_until"
    ]),
    afterData: updatedUser
      ? pickAdminUserAuditFields(updatedUser, [
          "password_changed_at",
          "must_change_password",
          "failed_login_attempts",
          "locked_until"
        ])
      : {},
    details: {
      revoked_sessions_count: revokedSessions,
      must_change_password: true
    }
  });

  return NextResponse.json({
    success: true,
    user: updatedUser ? sanitizeAdminUser(updatedUser) : null,
    revoked_sessions: revokedSessions
  });
}
