import { NextResponse } from "next/server";
import {
  getAccountUserById,
  logAccountAuditEvent,
  revokeOtherAccountSessions
} from "@/lib/account";
import { getRequestMetadata, requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST() {
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return response;
  }

  const user = await getAccountUserById(session.userId);

  if (!user || !user.is_active) {
    return NextResponse.json(
      { success: false, error: "user_not_found_or_inactive" },
      { status: 404 }
    );
  }

  const revokedSessionsCount = await revokeOtherAccountSessions({
    userId: session.userId,
    currentSessionId: session.sessionId
  });
  const metadata = await getRequestMetadata();

  await logAccountAuditEvent({
    session,
    action: "account.other_sessions_revoked",
    success: true,
    metadata,
    details: {
      revoked_sessions_count: revokedSessionsCount
    }
  });

  return NextResponse.json({
    success: true,
    revoked_sessions_count: revokedSessionsCount
  });
}
