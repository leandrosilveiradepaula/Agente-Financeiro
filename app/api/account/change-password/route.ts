import { NextResponse } from "next/server";
import {
  getAccountUserById,
  getAccountUserWithPasswordCheck,
  logAccountAuditEvent,
  revokeOtherAccountSessions,
  sanitizeAccountUser,
  updateOwnPassword,
  validatePasswordStrength
} from "@/lib/account";
import { getRequestMetadata, requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: UnknownRecord, key: string) {
  return typeof record[key] === "string" ? record[key] : "";
}

async function failureResponse(params: {
  session: NonNullable<Awaited<ReturnType<typeof requireAgentSession>>["session"]>;
  status: number;
  error: string;
  metadata: Awaited<ReturnType<typeof getRequestMetadata>>;
}) {
  await logAccountAuditEvent({
    session: params.session,
    action: "account.password_change_failed",
    success: false,
    metadata: params.metadata,
    details: {
      reason: params.error
    }
  });

  return NextResponse.json(
    { success: false, error: params.error },
    { status: params.status }
  );
}

export async function POST(request: Request) {
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return response;
  }

  const metadata = await getRequestMetadata();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failureResponse({
      session,
      status: 400,
      error: "invalid_json",
      metadata
    });
  }

  const record = isRecord(body) ? body : {};
  const currentPassword = readString(record, "current_password");
  const newPassword = readString(record, "new_password");
  const confirmPassword = readString(record, "confirm_password");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return failureResponse({
      session,
      status: 400,
      error: "missing_required_fields",
      metadata
    });
  }

  if (newPassword !== confirmPassword) {
    return failureResponse({
      session,
      status: 400,
      error: "password_confirmation_mismatch",
      metadata
    });
  }

  if (!validatePasswordStrength(newPassword)) {
    return failureResponse({
      session,
      status: 400,
      error: "weak_password",
      metadata
    });
  }

  const user = await getAccountUserWithPasswordCheck({
    userId: session.userId,
    currentPassword,
    newPassword
  });

  if (!user || !user.is_active) {
    return failureResponse({
      session,
      status: 403,
      error: "inactive_or_missing_user",
      metadata
    });
  }

  if (!user.password_ok) {
    return failureResponse({
      session,
      status: 401,
      error: "invalid_current_password",
      metadata
    });
  }

  if (user.new_password_same_as_current) {
    return failureResponse({
      session,
      status: 400,
      error: "new_password_must_be_different",
      metadata
    });
  }

  await updateOwnPassword(session.userId, newPassword);
  const revokedSessionsCount = await revokeOtherAccountSessions({
    userId: session.userId,
    currentSessionId: session.sessionId
  });
  const updatedUser = await getAccountUserById(session.userId);

  await logAccountAuditEvent({
    session,
    action: "account.password_changed",
    success: true,
    metadata,
    details: {
      revoked_sessions_count: revokedSessionsCount
    }
  });

  return NextResponse.json({
    success: true,
    user: updatedUser ? sanitizeAccountUser(updatedUser) : null,
    revoked_sessions_count: revokedSessionsCount
  });
}
