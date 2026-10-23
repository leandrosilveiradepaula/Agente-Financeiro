/**
 * Client-side storage scope derived exclusively from the authenticated
 * /api/auth/session or /api/auth/access response.
 *
 * This is a UI/history partition, NOT an authorization check. Server routes
 * must continue validating membership and filtering SQL rows by organization.
 * Never recover a legacy (user-only) history when tenant mode is on.
 */
export type AuthenticatedHistoryUser = {
  id: string;
  tenantIdentityEnabled?: boolean;
  organizationId?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAuthenticatedHistoryScope(
  user: AuthenticatedHistoryUser | null | undefined
): string | null {
  const userId = user?.id?.trim();
  if (!userId) return null;

  if (user?.tenantIdentityEnabled !== true) {
    // Maintain the pre-migration behavior exactly when tenant mode is off.
    return userId;
  }

  const organizationId = user.organizationId?.trim();
  if (!organizationId || !UUID.test(organizationId)) {
    // No organization => no browser SQL/report history.
    // In particular, do not fall back to legacy, user-scoped localStorage.
    return null;
  }
  return `tenant:${organizationId.toLowerCase()}:user:${userId}`;
}

export function sessionHistoryIdentityChanged(
  original: AuthenticatedHistoryUser | null | undefined,
  current: AuthenticatedHistoryUser | null | undefined
): boolean {
  if (!original || !current) return original !== current;
  return original.id !== current.id ||
    original.tenantIdentityEnabled === true !== (current.tenantIdentityEnabled === true) ||
    getAuthenticatedHistoryScope(original) !== getAuthenticatedHistoryScope(current);
}
