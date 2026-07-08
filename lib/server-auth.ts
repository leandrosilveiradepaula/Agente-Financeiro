import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  AGENT_SESSION_MAX_AGE_SECONDS,
  getSessionByToken,
  revokeSessionByToken
} from "@/lib/auth/session-service";
import type { AgentSession, RequestMetadata } from "@/lib/auth/auth-types";

export const AGENT_SESSION_COOKIE = "ducklake_agent_session";

type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function getAgentSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AGENT_SESSION_MAX_AGE_SECONDS
  };
}

export async function getRequestMetadata(): Promise<RequestMetadata> {
  const h = await headers();

  const forwardedFor = h.get("x-forwarded-for") || "";
  const ipAddress =
    forwardedFor.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";

  const userAgent = h.get("user-agent") || "unknown";

  return { ipAddress, userAgent };
}

export async function getAgentSession(): Promise<AgentSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AGENT_SESSION_COOKIE)?.value;

  return getSessionByToken(token);
}

export async function requireAgentSession() {
  const session = await getAgentSession();

  if (session) {
    return { session, response: null };
  }

  return {
    session: null,
    response: NextResponse.json(
      {
        success: false,
        error: "unauthorized"
      },
      { status: 401 }
    )
  };
}

export async function requireAdminSession() {
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return { session: null, response };
  }

  if (session.userProfile !== "admin") {
    return {
      session: null,
      response: NextResponse.json(
        {
          success: false,
          error: "forbidden"
        },
        { status: 403 }
      )
    };
  }

  return { session, response: null };
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AGENT_SESSION_COOKIE)?.value;

  await revokeSessionByToken(token);
}

export async function validateAgentSession() {
  return Boolean(await getAgentSession());
}
