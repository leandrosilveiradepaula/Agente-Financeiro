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
};

export type RequestMetadata = {
  ipAddress: string;
  userAgent: string;
};