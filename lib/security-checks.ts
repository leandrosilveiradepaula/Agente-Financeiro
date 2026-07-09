import "server-only";

export type SecurityCheckStatus = "ok" | "warning" | "error";

export type SecurityCheck = {
  id: string;
  label: string;
  status: SecurityCheckStatus;
  message: string;
  sensitive: false;
};

export type SecurityChecksResult = {
  checks: SecurityCheck[];
  summary: Record<SecurityCheckStatus, number>;
};

function hasValue(value: string | undefined) {
  return Boolean(value && value.trim());
}

function makeCheck(
  id: string,
  label: string,
  status: SecurityCheckStatus,
  message: string
): SecurityCheck {
  return {
    id,
    label,
    status,
    message,
    sensitive: false
  };
}

export function getSecurityChecks(): SecurityChecksResult {
  const databaseUrlPresent = hasValue(process.env.DATABASE_URL);
  const postgresSsl = process.env.POSTGRES_SSL;
  const generateWebhookPresent = hasValue(process.env.N8N_GENERATE_SQL_WEBHOOK_URL);
  const executeWebhookPresent = hasValue(process.env.N8N_EXECUTE_WATSON_WEBHOOK_URL);
  const internalToken = process.env.N8N_INTERNAL_WEBHOOK_TOKEN || "";
  const nodeEnv = process.env.NODE_ENV || "development";
  const profilePolicyManagementEnabled =
    process.env.PROFILE_POLICY_MANAGEMENT_ENABLED === "true";

  const checks: SecurityCheck[] = [
    makeCheck(
      "database_url_present",
      "DATABASE_URL configurada",
      databaseUrlPresent ? "ok" : "error",
      databaseUrlPresent ? "Configurada" : "Ausente"
    ),
    makeCheck(
      "postgres_ssl_configured",
      "POSTGRES_SSL configurado",
      postgresSsl === "true" ? "ok" : "warning",
      postgresSsl === "true" ? "Configurado como true" : "Ausente ou diferente de true"
    ),
    makeCheck(
      "generate_sql_webhook_present",
      "Webhook de geração configurado",
      generateWebhookPresent ? "ok" : "error",
      generateWebhookPresent ? "Configurado" : "Ausente"
    ),
    makeCheck(
      "execute_watson_webhook_present",
      "Webhook de execução configurado",
      executeWebhookPresent ? "ok" : "warning",
      executeWebhookPresent ? "Configurado" : "Ausente"
    ),
    makeCheck(
      "internal_webhook_token_present",
      "Token interno configurado",
      internalToken.length >= 24 ? "ok" : internalToken ? "warning" : "error",
      internalToken.length >= 24
        ? "Configurado com tamanho adequado"
        : internalToken
          ? "Configurado, mas curto para produção"
          : "Ausente"
    ),
    makeCheck(
      "node_env",
      "NODE_ENV",
      nodeEnv === "production" ? "ok" : "warning",
      nodeEnv === "production" ? "production" : `${nodeEnv} - ambiente não produtivo`
    ),
    makeCheck(
      "profile_policy_management_enabled",
      "Gestão visual de políticas",
      profilePolicyManagementEnabled ? "warning" : "ok",
      profilePolicyManagementEnabled
        ? "Gestão visual de políticas habilitada neste ambiente."
        : "Gestão visual de políticas desabilitada."
    ),
    makeCheck(
      "git_hygiene_env",
      "Checklist Git: .env.local",
      "warning",
      ".env.local não deve ser commitado"
    ),
    makeCheck(
      "git_hygiene_cookies",
      "Checklist Git: cookies",
      "warning",
      "cookies*.txt não devem ser commitados"
    ),
    makeCheck(
      "deploy_token_rotation",
      "Checklist deploy: rotação de tokens",
      "warning",
      "tokens devem ser rotacionados antes de deploy"
    )
  ];

  return {
    checks,
    summary: checks.reduce<Record<SecurityCheckStatus, number>>(
      (summary, check) => {
        summary[check.status] += 1;
        return summary;
      },
      { ok: 0, warning: 0, error: 0 }
    )
  };
}
