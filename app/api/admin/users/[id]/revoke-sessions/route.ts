import { NextResponse } from "next/server";
import {
  getRequestMetadata,
  requireAdminSession
} from "@/lib/server-auth";
import {
  getAdminUserById,
  logAdminAuditEvent,
  revokeActiveUserSessions
} from "@/lib/admin-users";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { id } = await context.params;
  const user = await getAdminUserById(id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "user_not_found" },
      { status: 404 }
    );
  }

  const revokedSessions = await revokeActiveUserSessions(id);
  const metadata = await getRequestMetadata();

  await logAdminAuditEvent({
    actor: session,
    targetUserId: id,
    targetEmail: user.email,
    action: "revoke_sessions",
    metadata,
    details: {
      revoked_sessions_count: revokedSessions
    }
  });

  return NextResponse.json({
    success: true,
    revoked_sessions: revokedSessions
  });
}
