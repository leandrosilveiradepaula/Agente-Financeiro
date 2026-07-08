import { NextResponse } from "next/server";
import { getAccountUserById, sanitizeAccountUser } from "@/lib/account";
import { requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
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

  return NextResponse.json({
    success: true,
    user: sanitizeAccountUser(user)
  });
}
