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
    migration_required_before_activation: enabled,
    // This is local config readiness, NOT proof of n8n datasource isolation.
    official_execution_scope_configured: enabled &&
      Boolean(env.AGENT_TENANT_OFFICIAL_ORGANIZATION_ID?.trim() &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          env.AGENT_TENANT_OFFICIAL_ORGANIZATION_ID.trim()
        ))
  };
}

/**
 * Persisted tenant membership alone does not isolate the financial data
 * source used by the *official* n8n route. Until an authorized per-tenant
 * connector exists, a deployment must be explicitly bound to one UUID.
 * This identifier is server-only configuration, never request-controlled.
 */
const ORGANIZATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantOfficialExecutionScope =
  | { status: "legacy" }
  | { status: "ready"; organizationId: string }
  | { status: "tenant_identity_required" }
  | { status: "official_scope_unconfigured" }
  | { status: "official_scope_mismatch" };

export function getTenantOfficialExecutionScope(
  session: AgentSession,
  env: Env = process.env
): TenantOfficialExecutionScope {
  const tenant = getSessionTenantIdentity(session, env);
  if (tenant.status === "disabled") return { status: "legacy" };
  if (tenant.status === "required") return { status: "tenant_identity_required" };

  const boundOrganization = env.AGENT_TENANT_OFFICIAL_ORGANIZATION_ID?.trim();
  if (!boundOrganization || !ORGANIZATION_UUID.test(boundOrganization)) {
    return { status: "official_scope_unconfigured" };
  }
  if (boundOrganization.toLowerCase() !== tenant.organizationId.toLowerCase()) {
    return { status: "official_scope_mismatch" };
  }
  return { status: "ready", organizationId: tenant.organizationId };
}
