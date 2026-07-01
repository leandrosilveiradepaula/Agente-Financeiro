const DESTRUCTIVE_COMMANDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "CALL",
  "EXECUTE",
  "MERGE",
  "ATTACH",
  "DETACH"
];

export function validateWatsonSql(sql: string): string | null {
  const normalized = sql.trim();
  const upperSql = normalized.toUpperCase();

  if (!normalized) {
    return "SQL nao pode estar vazia.";
  }

  const destructiveCommand = DESTRUCTIVE_COMMANDS.find((command) =>
    new RegExp(`\\b${command}\\b`, "i").test(normalized)
  );

  if (destructiveCommand) {
    return `SQL nao pode conter comando destrutivo: ${destructiveCommand}.`;
  }

  if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("WITH")) {
    return "SQL deve comecar com SELECT ou WITH.";
  }

  if (!normalized.toLowerCase().includes("dev_lakehouse.main_gold")) {
    return "SQL deve conter dev_lakehouse.main_gold.";
  }

  if (!/\bLIMIT\b/i.test(normalized)) {
    return "SQL deve conter LIMIT.";
  }

  return null;
}
