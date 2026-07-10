import "server-only";
import { db } from "@/lib/db";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";

export const ALLOWED_AGENT_PROFILES = [
  "admin",
  "diretoria",
  "financeiro",
  "auditoria",
  "comercial"
] as const;

export type AgentUserProfile = (typeof ALLOWED_AGENT_PROFILES)[number];

export type AdminUserRow = {
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
  disabled_at: string | null;
  disabled_by: string | null;
  last_admin_action_at: string | null;
};

export type SanitizedAdminUser = AdminUserRow;

type JsonSafeValue =
  | string
  | number
  | boolean
  | null
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

type JsonSafeRecord = { [key: string]: JsonSafeValue };

const SENSITIVE_AUDIT_KEYS = new Set([
  "password",
  "password_hash",
  "session_token_hash",
  "token",
  "tokens",
  "cookie",
  "cookies",
  "authorization"
]);

export function isAllowedAgentProfile(value: unknown): value is AgentUserProfile {
  return (
    typeof value === "string" &&
    ALLOWED_AGENT_PROFILES.includes(value as AgentUserProfile)
  );
}

export function sanitizeAdminUser(row: AdminUserRow): SanitizedAdminUser {
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
    must_change_password: row.must_change_password,
    disabled_at: row.disabled_at,
    disabled_by: row.disabled_by,
    last_admin_action_at: row.last_admin_action_at
  };
}

function sanitizeAuditValue(value: unknown): JsonSafeValue {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sanitized: JsonSafeRecord = {};

    for (const [key, nestedValue] of Object.entries(record)) {
      if (SENSITIVE_AUDIT_KEYS.has(key.toLowerCase())) continue;
      sanitized[key] = sanitizeAuditValue(nestedValue);
    }

    return sanitized;
  }

  return String(value);
}

export function sanitizeAuditData(value?: Record<string, unknown>): JsonSafeRecord {
  const sanitized = sanitizeAuditValue(value ?? {});
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

export function pickAdminUserAuditFields(
  user: AdminUserRow,
  fields: Array<keyof SanitizedAdminUser>
): JsonSafeRecord {
  const sanitizedUser = sanitizeAdminUser(user);
  const picked: Record<string, unknown> = {};

  for (const field of fields) {
    picked[field] = sanitizedUser[field];
  }

  return sanitizeAuditData(picked);
}

export async function getAdminUserById(id: string): Promise<AdminUserRow | null> {
  const result = await db.query<AdminUserRow>(
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
      disabled_at,
      disabled_by,
      last_admin_action_at
    FROM public.ai_agent_users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function countActiveAdmins(exceptUserId?: string) {
  const result = await db.query<{ count: string }>(
    `
    SELECT count(*)::text AS count
    FROM public.ai_agent_users
    WHERE is_active = true
      AND user_profile = 'admin'
      AND ($1::uuid IS NULL OR id <> $1::uuid)
    `,
    [exceptUserId ?? null]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function revokeActiveUserSessions(userId: string) {
  const result = await db.query<{ revoked_count: string }>(
    `
    WITH updated AS (
      UPDATE public.ai_agent_sessions
      SET revoked_at = now()
      WHERE user_id = $1
        AND revoked_at IS NULL
      RETURNING id
    )
    SELECT count(*)::text AS revoked_count FROM updated
    `,
    [userId]
  );

  return Number(result.rows[0]?.revoked_count ?? 0);
}

export async function logAdminAuditEvent(params: {
  actor: AgentSession;
  targetUserId: string | null;
  targetEmail?: string | null;
  action: string;
  success?: boolean;
  metadata: RequestMetadata;
  requestId?: string | null;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  reason?: string | null;
  details?: Record<string, unknown>;
}) {
  let targetEmail = params.targetEmail ?? null;

  if (!targetEmail && params.targetUserId) {
    const targetUser = await getAdminUserById(params.targetUserId);
    targetEmail = targetUser?.email ?? null;
  }

  await db.query(
    `
    INSERT INTO public.ai_agent_admin_audit_events (
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
      reason
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9::jsonb,
      $10::jsonb,
      $11::jsonb,
      $12,
      $13,
      $14
    )
    `,
    [
      params.requestId ?? null,
      params.actor.userId,
      params.actor.email,
      params.actor.userProfile,
      params.targetUserId,
      targetEmail,
      params.action,
      params.success ?? true,
      JSON.stringify(sanitizeAuditData(params.beforeData)),
      JSON.stringify(sanitizeAuditData(params.afterData)),
      JSON.stringify(sanitizeAuditData(params.details)),
      params.metadata.ipAddress,
      params.metadata.userAgent,
      params.reason ?? null
    ]
  );

  if (params.targetUserId) {
    await db.query(
      `
      UPDATE public.ai_agent_users
      SET last_admin_action_at = now(),
          updated_at = now()
      WHERE id = $1
      `,
      [params.targetUserId]
    );
  }
}
