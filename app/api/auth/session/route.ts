import { NextResponse } from "next/server";
import { getAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getAgentSession();

  if (!session) {
    return NextResponse.json({
      success: true,
      authenticated: false,
      user: null
    });
  }

  return NextResponse.json({
    success: true,
    authenticated: true,
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      profile: session.userProfile
    }
  });
}