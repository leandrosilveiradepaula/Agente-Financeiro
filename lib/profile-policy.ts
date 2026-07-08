import "server-only";
import { db } from "@/lib/db";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const SENSITIVE_KEYS = new Set([
  "authorization",
  "bearer",
  "cookie",
  "password",
  "password_hash",
  "secret",
  "session_token_hash",
  "token",
  "x-agent-internal-token"
]);

export type ProfilePolicyRow = {
  id: string;
  created_at: string;
  updated_at: string;
  profile: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  can_generate_sql: boolean;
  can_execute_sql: boolean;
  can_view_sql: boolean;
  can_view_own_runs: boolean;
  can_view_all_runs: boolean;
  can_manage_users: boolean;
  can_view_admin_area: boolean;
  allowed_intents: unknown;
  denied_intents: unknown;
  allowed_tables: unknown;
  denied_tables: unknown;
  allowed_columns: unknown;
  denied_columns: unknown;
  required_filters: unknown;
  max_rows: number | null;
  max_execution_time_ms: number | null;
  metadata: unknown;
};

export type SanitizedProfilePolicy = Omit<
  ProfilePolicyRow,
  | "allowed_intents"
  | "denied_intents"
  | "allowed_tables"
  | "denied_tables"
  | "allowed_columns"
  | "denied_columns"
  | "required_filters"
  | "metadata"
> & {
  allowed_intents: string[];
  denied_intents: string[];
  allowed_tables: string[];
  denied_tables: string[];
  allowed_columns: JsonValue;
  denied_columns: JsonValue;
  required_filters: JsonValue;
  metadata: JsonValue;
};

function sanitizeJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }

  if (typeof value === "object") {
    const sanitized: { [key: string]: JsonValue } = {};

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      sanitized[key] = sanitizeJsonValue(nestedValue);
    }

    return sanitized;
  }

  return String(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

export function sanitizeProfilePolicy(policy: ProfilePolicyRow): SanitizedProfilePolicy {
  return {
    id: policy.id,
    created_at: policy.created_at,
    updated_at: policy.updated_at,
    profile: policy.profile,
    display_name: policy.display_name,
    description: policy.description,
    is_active: policy.is_active,
    can_generate_sql: policy.can_generate_sql,
    can_execute_sql: policy.can_execute_sql,
    can_view_sql: policy.can_view_sql,
    can_view_own_runs: policy.can_view_own_runs,
    can_view_all_runs: policy.can_view_all_runs,
    can_manage_users: policy.can_manage_users,
    can_view_admin_area: policy.can_view_admin_area,
    allowed_intents: toStringArray(policy.allowed_intents),
    denied_intents: toStringArray(policy.denied_intents),
    allowed_tables: toStringArray(policy.allowed_tables),
    denied_tables: toStringArray(policy.denied_tables),
    allowed_columns: sanitizeJsonValue(policy.allowed_columns),
    denied_columns: sanitizeJsonValue(policy.denied_columns),
    required_filters: sanitizeJsonValue(policy.required_filters),
    max_rows: policy.max_rows,
    max_execution_time_ms: policy.max_execution_time_ms,
    metadata: sanitizeJsonValue(policy.metadata)
  };
}

export async function getProfilePolicy(profile: string) {
  const result = await db.query<ProfilePolicyRow>(
    `
    SELECT *
    FROM public.ai_agent_profile_policies
    WHERE profile = $1
      AND is_active = true
    LIMIT 1
    `,
    [profile]
  );

  const policy = result.rows[0];
  return policy ? sanitizeProfilePolicy(policy) : null;
}

export async function listProfilePolicies() {
  const result = await db.query<ProfilePolicyRow>(
    `
    SELECT *
    FROM public.ai_agent_profile_policies
    ORDER BY profile ASC
    `
  );

  return result.rows.map(sanitizeProfilePolicy);
}

export function profileHasWildcard(list: string[]) {
  return list.includes("*");
}

export function isIntentAllowedByPolicy(
  policy: SanitizedProfilePolicy | null,
  intent: string
) {
  if (!policy?.is_active) return false;
  if (profileHasWildcard(policy.denied_intents) || policy.denied_intents.includes(intent)) {
    return false;
  }
  if (profileHasWildcard(policy.allowed_intents)) return true;
  return policy.allowed_intents.includes(intent);
}

export function isTableAllowedByPolicy(
  policy: SanitizedProfilePolicy | null,
  tableName: string
) {
  if (!policy?.is_active) return false;
  if (profileHasWildcard(policy.denied_tables) || policy.denied_tables.includes(tableName)) {
    return false;
  }
  if (profileHasWildcard(policy.allowed_tables)) return true;
  return policy.allowed_tables.includes(tableName);
}

export async function canProfileGenerateSql(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_generate_sql);
}

export async function canProfileExecuteSql(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_execute_sql);
}

export async function canProfileViewSql(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_view_sql);
}

export async function canProfileViewAllRuns(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_view_all_runs);
}
