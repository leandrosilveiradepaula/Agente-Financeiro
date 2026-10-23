export type AgentUser = {
  id: string;
  name: string;
  email: string;
  user_profile: string;
  is_active: boolean;
  locked_until: string | null;
};

export type AgentUserWithPasswordCheck = AgentUser & {
  password_ok: boolean;
};

export type AgentSession = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  userProfile: string;
  // Populated only from the persisted, active membership selected for this
  // server-side session. It is never derived from request input or email.
  organizationId?: string;
};

export type RequestMetadata = {
  ipAddress: string;
  userAgent: string;
};
