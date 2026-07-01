export type InterfaceSettings = {
  pdfMaxRows: number;
  pdfMaxColumns: number;
  pdfIncludeSql: boolean;
  pdfMaxSqlLines: number;
  markdownIncludeSql: boolean;
  showDiagnosticsPanel: boolean;
  showExecutiveReportHistory: boolean;
  defaultResultMode: "auto" | "manual";
};

const INTERFACE_SETTINGS_STORAGE_KEY = "ducklake-sql-agent-interface-settings";

const DEFAULT_INTERFACE_SETTINGS: InterfaceSettings = {
  pdfMaxRows: 10,
  pdfMaxColumns: 8,
  pdfIncludeSql: true,
  pdfMaxSqlLines: 120,
  markdownIncludeSql: true,
  showDiagnosticsPanel: true,
  showExecutiveReportHistory: true,
  defaultResultMode: "auto"
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSettings(value: unknown): InterfaceSettings {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    pdfMaxRows: clampNumber(record.pdfMaxRows, 5, 50, DEFAULT_INTERFACE_SETTINGS.pdfMaxRows),
    pdfMaxColumns: clampNumber(
      record.pdfMaxColumns,
      4,
      15,
      DEFAULT_INTERFACE_SETTINGS.pdfMaxColumns
    ),
    pdfIncludeSql: booleanValue(record.pdfIncludeSql, DEFAULT_INTERFACE_SETTINGS.pdfIncludeSql),
    pdfMaxSqlLines: clampNumber(
      record.pdfMaxSqlLines,
      30,
      300,
      DEFAULT_INTERFACE_SETTINGS.pdfMaxSqlLines
    ),
    markdownIncludeSql: booleanValue(
      record.markdownIncludeSql,
      DEFAULT_INTERFACE_SETTINGS.markdownIncludeSql
    ),
    showDiagnosticsPanel: booleanValue(
      record.showDiagnosticsPanel,
      DEFAULT_INTERFACE_SETTINGS.showDiagnosticsPanel
    ),
    showExecutiveReportHistory: booleanValue(
      record.showExecutiveReportHistory,
      DEFAULT_INTERFACE_SETTINGS.showExecutiveReportHistory
    ),
    defaultResultMode: record.defaultResultMode === "manual" ? "manual" : "auto"
  };
}

export function getDefaultInterfaceSettings(): InterfaceSettings {
  return { ...DEFAULT_INTERFACE_SETTINGS };
}

export function readInterfaceSettings(): InterfaceSettings {
  if (typeof window === "undefined") {
    return getDefaultInterfaceSettings();
  }

  try {
    const raw = window.localStorage.getItem(INTERFACE_SETTINGS_STORAGE_KEY);

    if (!raw) {
      return getDefaultInterfaceSettings();
    }

    return normalizeSettings(JSON.parse(raw));
  } catch {
    return getDefaultInterfaceSettings();
  }
}

export function writeInterfaceSettings(settings: InterfaceSettings): InterfaceSettings {
  const normalized = normalizeSettings(settings);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(INTERFACE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function resetInterfaceSettings(): InterfaceSettings {
  const defaults = getDefaultInterfaceSettings();

  if (typeof window !== "undefined") {
    window.localStorage.setItem(INTERFACE_SETTINGS_STORAGE_KEY, JSON.stringify(defaults));
  }

  return defaults;
}
