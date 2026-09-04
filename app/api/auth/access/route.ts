import { NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth/auth-service";
import { createSession } from "@/lib/auth/session-service";
import {
  AGENT_SESSION_COOKIE,
  getAgentSessionCookieOptions,
  getRequestMetadata
} from "@/lib/server-auth";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const email =
    isRecord(body) && typeof body.email === "string"
      ? body.email.trim()
      : "";

  const password =
    isRecord(body) && typeof body.password === "string"
      ? body.password
      : "";

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: "missing_credentials" },
      { status: 400 }
    );
  }

  const metadata = await getRequestMetadata();
  const authResult = await authenticateUser(email, password, metadata);

  if (!authResult.ok) {
    return NextResponse.json(
      { success: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const session = await createSession(authResult.user.id, metadata);

  const response = NextResponse.json({
    success: true,
    user: {
      id: authResult.user.id,
      name: authResult.user.name,
      email: authResult.user.email,
      profile: authResult.user.user_profile
    }
  });

  response.cookies.set(
    AGENT_SESSION_COOKIE,
    session.rawToken,
    getAgentSessionCookieOptions()
  );

  return response;
}