import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAuthEvent } from "@/lib/auth/auth-service";
import {
  AGENT_SESSION_COOKIE,
  getAgentSession,
  getRequestMetadata,
  revokeCurrentSession
} from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST() {
  const session = await getAgentSession();
  const metadata = await getRequestMetadata();

  await revokeCurrentSession();

  if (session) {
    await db.query(
      `
      UPDATE public.ai_agent_users
      SET
        last_logout_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [session.userId]
    );

    await logAuthEvent({
      userId: session.userId,
      email: session.email,
      eventType: "logout",
      success: true,
      metadata,
      reason: null
    });
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(AGENT_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}