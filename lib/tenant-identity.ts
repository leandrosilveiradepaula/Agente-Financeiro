import "server-only";

import type { AgentSession } from "@/lib/auth/auth-types";

type Env = Record<string, string | undefined>;

// This is deliberately independent from the Shadow dispatch flag.  Enabling
// dispatch must never silently change where tenant identity comes from.
export function isTenantIdentityEnabled(env: Env = process.env): boolean {
  return env.AGENT_TENANT_IDENTITY_ENABLED?.trim().toLowerCase() === "true";
}

export type TenantIdentityStatus =
  | { status: "disabled" }
  | { status: "ready"; organizationId: string }
  | { status: "required" };

export function getSessionTenantIdentity(
  session: AgentSession,
  env: Env = process.env
): TenantIdentityStatus {
  if (!isTenantIdentityEnabled(env)) return { status: "disabled" };
  const organizationId = session.organizationId?.trim();
  return organizationId ? { status: "ready", organizationId } : { status: "required" };
}

// Safe for the diagnostics endpoint: it says nothing about identifiers,
// memberships, database contents, URLs, or credentials.
export function inspectTenantIdentityConfiguration(env: Env = process.env) {
  const enabled = isTenantIdentityEnabled(env);
  return {
    enabled,
    mode: enabled ? "persisted_membership_required" : "disabled",
    migration_required_before_activation: enabled
  };
}
