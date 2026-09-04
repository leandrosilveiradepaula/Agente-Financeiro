import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";

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

  const result = await db.query(
    `
    SELECT
      s.id AS session_id,
      u.id AS user_id,
      u.name,
      u.email,
      u.user_profile
    FROM public.ai_agent_sessions s
    JOIN public.ai_agent_users u ON u.id = s.user_id
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

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    userProfile: row.user_profile
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