import { getAgentRunById, type SanitizedAgentRun } from "@/lib/agent-runs";
import type { AgentSession } from "@/lib/auth/auth-types";
import { getProfilePolicy, type SanitizedProfilePolicy } from "@/lib/profile-policy";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";

export type AdminRunReadAccessResult =
  | {
      allowed: true;
      run: SanitizedAgentRun;
      policy: SanitizedProfilePolicy;
      scope: "all_runs" | "own_runs";
    }
  | {
      allowed: false;
      status: 403 | 404;
      error: "profile_policy_not_found" | "forbidden" | "run_not_found" | "tenant_identity_required";
      canViewAllRuns?: boolean;
      canViewOwnRuns?: boolean;
    };

export async function authorizeAdminRunReadAccess(
  runId: string,
  session: AgentSession
): Promise<AdminRunReadAccessResult> {
  const tenant = getSessionTenantIdentity(session);
  if (tenant.status === "required") {
    return { allowed: false, status: 403, error: "tenant_identity_required" };
  }
  const policy = await getProfilePolicy(session.userProfile);

  if (!policy) {
    return {
      allowed: false,
      status: 403,
      error: "profile_policy_not_found"
    };
  }

  const canViewAllRuns = policy.can_view_all_runs;
  const canViewOwnRuns = policy.can_view_own_runs || canViewAllRuns;

  if (!canViewOwnRuns) {
    return {
      allowed: false,
      status: 403,
      error: "forbidden",
      canViewAllRuns,
      canViewOwnRuns
    };
  }

  // A tenant-enabled lookup is filtered in SQL. Historical NULL runs are not
  // assigned to a tenant and consequently cannot be read through this path.
  const run = tenant.status === "ready"
    ? await getAgentRunById(runId, tenant.organizationId)
    : await getAgentRunById(runId);

  if (!run) {
    return {
      allowed: false,
      status: 404,
      error: "run_not_found",
      canViewAllRuns,
      canViewOwnRuns
    };
  }

  const ownsRun =
    run.user_id === session.userId ||
    Boolean(run.user_email && run.user_email.toLowerCase() === session.email.toLowerCase());

  if (!canViewAllRuns && !ownsRun) {
    return {
      allowed: false,
      status: 403,
      error: "forbidden",
      canViewAllRuns,
      canViewOwnRuns
    };
  }

  return {
    allowed: true,
    run,
    policy,
    scope: canViewAllRuns ? "all_runs" : "own_runs"
  };
}
