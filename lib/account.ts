import "server-only";
import { db } from "@/lib/db";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";

export type AccountUserRow = {
  id: string;
  name: string;
  email: string;
  user_profile: string;
  is_active: boolean;
  locked_until: string | null;
  failed_login_attempts: number;
  last_login_at: string | null;
  last_logout_at: string | null;
  created_at: string;
  updated_at: string;
  password_changed_at: string | null;
  must_change_password: boolean;
};

export type AccountPasswordCheckRow = AccountUserRow & {
  password_ok: boolean;
  new_password_same_as_current: boolean;
};

export function sanitizeAccountUser(row: AccountUserRow): AccountUserRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    user_profile: row.user_profile,
    is_active: row.is_active,
    locked_until: row.locked_until,
    failed_login_attempts: row.failed_login_attempts,
    last_login_at: row.last_login_at,
    last_logout_at: row.last_logout_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    password_changed_at: row.password_changed_at,
    must_change_password: row.must_change_password
  };
}

export function validatePasswordStrength(password: string) {
  if (password.length < 8) return false;
  if (!/[A-Za-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;

  return true;
}

export async function getAccountUserById(userId: string): Promise<AccountUserRow | null> {
  const result = await db.query<AccountUserRow>(
    `
    SELECT
      id,
      name,
      email,
      user_profile,
      is_active,
      locked_until,
      failed_login_attempts,
      last_login_at,
      last_logout_at,
      created_at,
      updated_at,
      password_changed_at,
      must_change_password
    FROM public.ai_agent_users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function getAccountUserWithPasswordCheck(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<AccountPasswordCheckRow | null> {
  const result = await db.query<AccountPasswordCheckRow>(
    `
    SELECT
      id,
      name,
      email,
      user_profile,
      is_active,
      locked_until,
      failed_login_attempts,
      last_login_at,
      last_logout_at,
      created_at,
      updated_at,
      password_changed_at,
      must_change_password,
      password_hash = crypt($2, password_hash) AS password_ok,
      password_hash = crypt($3, password_hash) AS new_password_same_as_current
    FROM public.ai_agent_users
    WHERE id = $1
    LIMIT 1
    `,
    [params.userId, params.currentPassword, params.newPassword]
  );

  return result.rows[0] ?? null;
}

export async function updateOwnPassword(userId: string, newPassword: string) {
  await db.query(
    `
    UPDATE public.ai_agent_users
    SET
      password_hash = crypt($1, gen_salt('bf')),
      password_changed_at = now(),
      must_change_password = false,
      failed_login_attempts = 0,
      locked_until = NULL,
      updated_at = now()
    WHERE id = $2
    `,
    [newPassword, userId]
  );
}

export async function revokeOtherAccountSessions(params: {
  userId: string;
  currentSessionId: string;
}) {
  const result = await db.query<{ revoked_count: string }>(
    `
    WITH updated AS (
      UPDATE public.ai_agent_sessions
      SET revoked_at = now()
      WHERE user_id = $1
        AND id <> $2
        AND revoked_at IS NULL
      RETURNING id
    )
    SELECT count(*)::text AS revoked_count FROM updated
    `,
    [params.userId, params.currentSessionId]
  );

  return Number(result.rows[0]?.revoked_count ?? 0);
}

export async function logAccountAuditEvent(params: {
  session: AgentSession;
  action: string;
  success: boolean;
  metadata: RequestMetadata;
  details?: Record<string, unknown>;
}) {
  await db.query(
    `
    INSERT INTO public.ai_agent_account_audit_events (
      user_id,
      user_email,
      user_profile,
      action,
      success,
      ip_address,
      user_agent,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      params.session.userId,
      params.session.email,
      params.session.userProfile,
      params.action,
      params.success,
      params.metadata.ipAddress,
      params.metadata.userAgent,
      JSON.stringify(params.details ?? {})
    ]
  );
}
