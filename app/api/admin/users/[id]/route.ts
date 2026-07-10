import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getRequestMetadata,
  requireAdminSession
} from "@/lib/server-auth";
import {
  countActiveAdmins,
  getAdminUserById,
  isAllowedAgentProfile,
  logAdminAuditEvent,
  pickAdminUserAuditFields,
  sanitizeAdminUser
} from "@/lib/admin-users";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: UnknownRecord, key: string) {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

export async function PATCH(request: Request, context: RouteContext) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { id } = await context.params;
  const currentUser = await getAdminUserById(id);

  if (!currentUser) {
    return NextResponse.json(
      { success: false, error: "user_not_found" },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const record = isRecord(body) ? body : {};
  const name = readString(record, "name");
  const email = readString(record, "email").toLowerCase();
  const userProfile = readString(record, "user_profile");

  if (!name || !email || !userProfile) {
    return NextResponse.json(
      { success: false, error: "missing_required_fields" },
      { status: 400 }
    );
  }

  if (!isAllowedAgentProfile(userProfile)) {
    return NextResponse.json(
      { success: false, error: "invalid_user_profile" },
      { status: 400 }
    );
  }

  if (id === session.userId && userProfile !== "admin") {
    return NextResponse.json(
      { success: false, error: "cannot_remove_own_admin_profile" },
      { status: 400 }
    );
  }

  if (
    currentUser.user_profile === "admin" &&
    userProfile !== "admin" &&
    (await countActiveAdmins(id)) === 0
  ) {
    return NextResponse.json(
      { success: false, error: "cannot_remove_last_active_admin" },
      { status: 400 }
    );
  }

  try {
    await db.query(
      `
      UPDATE public.ai_agent_users
      SET
        name = $1,
        email = $2,
        user_profile = $3,
        updated_at = now(),
        last_admin_action_at = now()
      WHERE id = $4
      `,
      [name, email, userProfile, id]
    );

    const updatedUser = await getAdminUserById(id);
    const metadata = await getRequestMetadata();
    const sanitizedCurrentUser = sanitizeAdminUser(currentUser);
    const sanitizedUpdatedUser = updatedUser ? sanitizeAdminUser(updatedUser) : {};

    await logAdminAuditEvent({
      actor: session,
      targetUserId: id,
      targetEmail: updatedUser?.email ?? currentUser.email,
      action: "update_user",
      metadata,
      beforeData: sanitizedCurrentUser,
      afterData: sanitizedUpdatedUser,
      details: {
        changed_fields: pickAdminUserAuditFields(
          {
            ...currentUser,
            name,
            email,
            user_profile: userProfile
          },
          ["name", "email", "user_profile"]
        )
      }
    });

    return NextResponse.json({
      success: true,
      user: updatedUser ? sanitizedUpdatedUser : null
    });
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;

    if (code === "23505") {
      return NextResponse.json(
        { success: false, error: "email_already_exists" },
        { status: 409 }
      );
    }

    throw error;
  }
}
