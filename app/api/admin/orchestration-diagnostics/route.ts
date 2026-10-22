import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getProfilePolicy } from "@/lib/profile-policy";
import { inspectLangGraphShadowDispatchConfiguration } from "@/lib/langgraph-shadow-client";
import { isLangGraphShadowEvidenceReadConfigured } from "@/lib/langgraph-shadow-read-client";
import { requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

function sanitizeEndpoint(value: string | undefined) {
  const raw = value?.trim();

  if (!raw) {
    return {
      configured: false,
      path_suffix: null,
      fingerprint: null
    };
  }

  let pathSuffix: string | null = null;

  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    pathSuffix = segments.at(-1) ?? null;
  } catch {
    const segments = raw.split("/").filter(Boolean);
    pathSuffix = segments.at(-1) ?? null;
  }

  return {
    configured: true,
    path_suffix: pathSuffix,
    fingerprint: createHash("sha256").update(raw).digest("hex").slice(0, 12)
  };
}

export async function GET() {
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return response;
  }

  const policy = await getProfilePolicy(session.userProfile);

  if (!policy) {
    return NextResponse.json(
      { success: false, error: "profile_policy_not_found" },
      { status: 403 }
    );
  }

  if (!policy.can_manage_users && !policy.can_view_all_runs) {
    return NextResponse.json(
      { success: false, error: "forbidden" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    n8n_generate_sql: sanitizeEndpoint(
      process.env.N8N_GENERATE_SQL_WEBHOOK_URL
    ),
    langgraph_shadow_enabled:
      process.env.LANGGRAPH_SHADOW_ENABLED?.trim().toLowerCase() === "true",
    langgraph_shadow: {
      ...inspectLangGraphShadowDispatchConfiguration(),
      // URL and S2S credentials are never returned to the browser.
      evidence_read_configured: isLangGraphShadowEvidenceReadConfigured()
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
