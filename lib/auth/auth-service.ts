import "server-only";
import { db } from "@/lib/db";
import { validateUserPassword } from "@/lib/auth/password-service";
import type { RequestMetadata } from "@/lib/auth/auth-types";

export async function authenticateUser(
  email: string,
  password: string,
  metadata: RequestMetadata
) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await validateUserPassword(normalizedEmail, password);

  if (!user) {
    await logAuthEvent({
      userId: null,
      email: normalizedEmail,
      eventType: "login",
      success: false,
      metadata,
      reason: "invalid_credentials"
    });

    return { ok: false as const, reason: "invalid_credentials" };
  }

  if (!user.is_active) {
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      eventType: "login",
      success: false,
      metadata,
      reason: "inactive_user"
    });

    return { ok: false as const, reason: "inactive_user" };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      eventType: "login",
      success: false,
      metadata,
      reason: "user_locked"
    });

    return { ok: false as const, reason: "user_locked" };
  }

  if (!user.password_ok) {
    await db.query(
      `
      UPDATE public.ai_agent_users
      SET
        failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE
          WHEN failed_login_attempts + 1 >= 5
          THEN now() + interval '15 minutes'
          ELSE locked_until
        END,
        updated_at = now()
      WHERE id = $1
      `,
      [user.id]
    );

    await logAuthEvent({
      userId: user.id,
      email: user.email,
      eventType: "login",
      success: false,
      metadata,
      reason: "invalid_credentials"
    });

    return { ok: false as const, reason: "invalid_credentials" };
  }

  await db.query(
    `
    UPDATE public.ai_agent_users
    SET
      failed_login_attempts = 0,
      locked_until = NULL,
      last_login_at = now(),
      updated_at = now()
    WHERE id = $1
    `,
    [user.id]
  );

  await logAuthEvent({
    userId: user.id,
    email: user.email,
    eventType: "login",
    success: true,
    metadata,
    reason: null
  });

  return { ok: true as const, user };
}

export async function logAuthEvent(params: {
  userId: string | null;
  email: string;
  eventType: string;
  success: boolean;
  metadata: RequestMetadata;
  reason: string | null;
}) {
  await db.query(
    `
    INSERT INTO public.ai_agent_auth_events (
      user_id,
      email,
      event_type,
      success,
      ip_address,
      user_agent,
      reason
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      params.userId,
      params.email,
      params.eventType,
      params.success,
      params.metadata.ipAddress,
      params.metadata.userAgent,
      params.reason
    ]
  );
}