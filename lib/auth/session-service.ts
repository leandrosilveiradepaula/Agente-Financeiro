import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";
import { isTenantIdentityEnabled } from "@/lib/tenant-identity";

export const AGENT_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export function createRawSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, metadata: RequestMetadata) {
  const rawToken = createRawSessionToken();
  const tokenHash = hashSessionToken(rawToken);

  const result = await db.query(
    `
    INSERT INTO public.ai_agent_sessions (
      user_id,
      session_token_hash,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES (
      $1,
      $2,
      now() + ($3 || ' seconds')::interval,
      $4,
      $5
    )
    RETURNING id
    `,
    [
      userId,
      tokenHash,
      AGENT_SESSION_MAX_AGE_SECONDS,
      metadata.ipAddress,
      metadata.userAgent
    ]
  );

  return {
    rawToken,
    sessionId: result.rows[0].id as string
  };
}

export async function getSessionByToken(token?: string): Promise<AgentSession | null> {
  if (!token) return null;

  const tokenHash = hashSessionToken(token);

  const tenantIdentityEnabled = isTenantIdentityEnabled();
  const result = await db.query(
    `
    SELECT
      s.id AS session_id,
      u.id AS user_id,
      u.name,
      u.email,
      u.user_profile
      ${tenantIdentityEnabled ? `,
      COALESCE(
        membership.selected_organization_id,
        CASE WHEN membership.organization_count = 1 THEN membership.single_organization_id END
      ) AS organization_id` : ""}
    FROM public.ai_agent_sessions s
    JOIN public.ai_agent_users u ON u.id = s.user_id
    ${tenantIdentityEnabled ? `LEFT JOIN LATERAL (
      SELECT count(*)::integer AS organization_count,
        min(m.organization_id::text) AS single_organization_id,
        min(m.organization_id::text) FILTER (WHERE m.organization_id = s.organization_id)
          AS selected_organization_id
      FROM public.ai_agent_user_organizations m
      JOIN public.ai_agent_organizations o ON o.id = m.organization_id
      WHERE m.user_id = s.user_id AND m.is_active = true AND o.is_active = true
    ) membership ON true` : ""}
    WHERE s.session_token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active = true
    LIMIT 1
    `,
    [tokenHash]
  );

  const row = result.rows[0];

  if (!row) return null;

  const organizationId = tenantIdentityEnabled && typeof row.organization_id === "string"
    ? row.organization_id
    : undefined;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    userProfile: row.user_profile,
    ...(organizationId ? { organizationId } : {})
  };
}

export async function revokeSessionByToken(token?: string) {
  if (!token) return;

  await db.query(
    `
    UPDATE public.ai_agent_sessions
    SET revoked_at = now()
    WHERE session_token_hash = $1
      AND revoked_at IS NULL
    `,
    [hashSessionToken(token)]
  );
}

// The caller may supply an organization identifier, but it never establishes
// membership. The UPDATE succeeds only for the current active session and an
// active persisted association. This is intentionally unavailable while the
// opt-in tenant source is disabled, so pre-migration deployments keep using
// their legacy schema untouched.
export async function selectSessionOrganizationByToken(
  token: string | undefined,
  organizationId: string
): Promise<boolean> {
  if (!token || !isTenantIdentityEnabled()) return false;
  const result = await db.query(
    `
    UPDATE public.ai_agent_sessions s
    SET organization_id = membership.organization_id
    FROM public.ai_agent_user_organizations membership
    JOIN public.ai_agent_organizations organization
      ON organization.id = membership.organization_id
    WHERE s.session_token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND membership.user_id = s.user_id
      AND membership.organization_id = $2::uuid
      AND membership.is_active = true
      AND organization.is_active = true
    RETURNING s.id
    `,
    [hashSessionToken(token), organizationId]
  );
  return result.rows.length === 1;
}
