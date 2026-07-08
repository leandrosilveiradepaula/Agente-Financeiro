import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getRequestMetadata,
  requireAdminSession
} from "@/lib/server-auth";
import {
  getAdminUserById,
  isAllowedAgentProfile,
  logAdminAuditEvent,
  sanitizeAdminUser,
  type AdminUserRow
} from "@/lib/admin-users";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: UnknownRecord, key: string) {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

export async function GET() {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const result = await db.query<AdminUserRow>(
    `
    SELECT
      id,
      name,
      email,
      user_profile,
      is_active,
      locked_until,
      failed_login_attempts,
      last_login_at,
      last_logout_at,
      created_at,
      updated_at,
      password_changed_at,
      must_change_password,
      disabled_at,
      disabled_by,
      last_admin_action_at
    FROM public.ai_agent_users
    ORDER BY name ASC, email ASC
    `
  );

  return NextResponse.json({
    success: true,
    users: result.rows.map(sanitizeAdminUser)
  });
}

export async function POST(request: Request) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
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
  const password = typeof record.password === "string" ? record.password : "";
  const userProfile = readString(record, "user_profile");
  const mustChangePassword =
    typeof record.must_change_password === "boolean"
      ? record.must_change_password
      : true;

  if (!name || !email || !password || !userProfile) {
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

  try {
    const result = await db.query<{ id: string }>(
      `
      INSERT INTO public.ai_agent_users (
        name,
        email,
        user_profile,
        password_hash,
        is_active,
        failed_login_attempts,
        locked_until,
        password_changed_at,
        must_change_password,
        created_at,
        updated_at,
        last_admin_action_at
      )
      VALUES (
        $1,
        $2,
        $3,
        crypt($4, gen_salt('bf')),
        true,
        0,
        NULL,
        now(),
        $5,
        now(),
        now(),
        now()
      )
      RETURNING id
      `,
      [name, email, userProfile, password, mustChangePassword]
    );

    const createdUser = await getAdminUserById(result.rows[0].id);
    const metadata = await getRequestMetadata();
    const sanitizedCreatedUser = createdUser ? sanitizeAdminUser(createdUser) : {};

    await logAdminAuditEvent({
      actor: session,
      targetUserId: result.rows[0].id,
      targetEmail: createdUser?.email ?? email,
      action: "create_user",
      metadata,
      beforeData: {},
      afterData: sanitizedCreatedUser,
      details: {
        user_profile: userProfile,
        must_change_password: mustChangePassword
      }
    });

    return NextResponse.json(
      {
        success: true,
        user: createdUser ? sanitizedCreatedUser : null
      },
      { status: 201 }
    );
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
