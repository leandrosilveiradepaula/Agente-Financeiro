import { NextResponse } from "next/server";
import { logAdminAuditEvent } from "@/lib/admin-users";
import {
  diffPolicyFields,
  getProfilePolicyForAdmin,
  updateProfilePolicy,
  validateProfilePolicyUpdatePayload
} from "@/lib/profile-policy";
import { getRequestMetadata } from "@/lib/server-auth";
import { requireAdminSession } from "@/lib/server-auth";

export const runtime = "nodejs";

function moduleDisabledResponse() {
  return NextResponse.json(
    {
      success: false,
      error: "module_disabled"
    },
    { status: 404 }
  );
}

type RouteContext = {
  params: Promise<{ profile: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  if (process.env.PROFILE_POLICY_MANAGEMENT_ENABLED !== "true") {
    return moduleDisabledResponse();
  }

  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { profile } = await context.params;
  const policy = await getProfilePolicyForAdmin(decodeURIComponent(profile));

  if (!policy) {
    return NextResponse.json(
      {
        success: false,
        error: "policy_not_found"
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    policy
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (process.env.PROFILE_POLICY_MANAGEMENT_ENABLED !== "true") {
    return moduleDisabledResponse();
  }

  const requestId = crypto.randomUUID();
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { profile: profileParam } = await context.params;
  const profile = decodeURIComponent(profileParam);
  const beforePolicy = await getProfilePolicyForAdmin(profile);

  if (!beforePolicy) {
    return NextResponse.json(
      {
        success: false,
        error: "policy_not_found"
      },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_payload"
      },
      { status: 400 }
    );
  }

  const parsed = validateProfilePolicyUpdatePayload(profile, body);

  if (!parsed.ok) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error
      },
      { status: 400 }
    );
  }

  const afterPolicy = await updateProfilePolicy(profile, parsed.value);

  if (!afterPolicy) {
    return NextResponse.json(
      {
        success: false,
        error: "policy_not_found"
      },
      { status: 404 }
    );
  }

  const metadata = await getRequestMetadata();
  const changedFields = diffPolicyFields(beforePolicy, afterPolicy);

  await logAdminAuditEvent({
    actor: session,
    targetUserId: null,
    targetEmail: profile,
    action: "profile_policy_update",
    requestId,
    success: true,
    metadata,
    beforeData: beforePolicy,
    afterData: afterPolicy,
    details: {
      profile,
      changed_fields: changedFields
    }
  });

  return NextResponse.json({
    success: true,
    policy: afterPolicy
  });
}
