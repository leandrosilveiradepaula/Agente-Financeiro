import "server-only";
import { db } from "@/lib/db";
import type { AgentUserWithPasswordCheck } from "@/lib/auth/auth-types";

export async function validateUserPassword(
  email: string,
  password: string
): Promise<AgentUserWithPasswordCheck | null> {
  const result = await db.query(
    `
    SELECT
      id,
      name,
      email,
      user_profile,
      is_active,
      locked_until,
      password_hash = crypt($2, password_hash) AS password_ok
    FROM public.ai_agent_users
    WHERE lower(email) = lower($1)
    LIMIT 1
    `,
    [email, password]
  );

  return result.rows[0] ?? null;
}