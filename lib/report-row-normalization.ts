import type { ResultRow } from "@/lib/types";

const REPORT_FIELD_ALIASES = {
  grupo_dre: ["grupo_dre", "grupo", "nivel_1_bi"],
  subgrupo: ["subgrupo", "nivel_2_bi"],
  conta_contabil: ["conta_contabil", "nk_conta_contabil", "conta"],
  realizado_rs: ["realizado_rs", "realizado", "valor_realizado", "opex_realizado_rs"],
  orcado_rs: ["orcado_rs", "orcado", "valor_orcado", "opex_orcado_rs"],
  variancia_rs: ["variancia_rs", "variacao_rs", "variacao", "variância_rs"],
  variancia_perc: ["variancia_perc", "variacao_perc", "percentual_variacao", "variância_perc"],
  tipo_variacao: ["tipo_variacao", "tipo_impacto", "classificacao", "classificação"]
} as const;

const PRESENTATION_REPORT_COLUMNS = [
  "tipo_variacao",
  "grupo_dre",
  "subgrupo",
  "conta_contabil",
  "realizado_rs",
  "orcado_rs",
  "variancia_rs",
  "variancia_perc"
] as const;

type CanonicalReportColumn = keyof typeof REPORT_FIELD_ALIASES;

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function valueIsPresent(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function findRowValue(row: ResultRow, aliases: readonly string[]) {
  const directAlias = aliases.find((alias) => Object.prototype.hasOwnProperty.call(row, alias));

  if (directAlias) {
    return row[directAlias];
  }

  const keyByNormalizedName = new Map(
    Object.keys(row).map((key) => [normalizeKey(key), key] as const)
  );
  const normalizedAlias = aliases
    .map((alias) => keyByNormalizedName.get(normalizeKey(alias)))
    .find((key): key is string => Boolean(key));

  return normalizedAlias ? row[normalizedAlias] : undefined;
}

export function parseReportNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let normalized = trimmed.replace(/\s+/g, "").replace(/R\$/gi, "");
  const negative = normalized.includes("-") || /^\(.*\)$/.test(normalized);
  normalized = normalized.replace(/[()-]/g, "").replace(/[^\d.,]/g, "");

  if (!normalized) {
    return null;
  }

  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = normalized.split(".");

    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      normalized = parts.join("");
    } else if (parts.length > 2) {
      const decimal = parts.at(-1) ?? "";
      const integer = parts.slice(0, -1).join("");
      normalized = decimal.length === 3 ? `${integer}${decimal}` : `${integer}.${decimal}`;
    }
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return negative ? -parsed : parsed;
}

function inferTipoVariacao(variancia: number | null) {
  if (variancia === null) {
    return null;
  }

  if (variancia < 0) {
    return "Impacto negativo versus orçamento";
  }

  if (variancia > 0) {
    return "Impacto positivo versus orçamento";
  }

  return "Sem variação";
}

export function normalizeReportRow(row: ResultRow): ResultRow {
  const normalizedRow: ResultRow = { ...row };
  const rawValues = Object.fromEntries(
    Object.entries(REPORT_FIELD_ALIASES).map(([canonical, aliases]) => [
      canonical,
      findRowValue(row, aliases)
    ])
  ) as Record<CanonicalReportColumn, ResultRow[string] | undefined>;

  for (const [canonical, rawValue] of Object.entries(rawValues) as Array<
    [CanonicalReportColumn, ResultRow[string] | undefined]
  >) {
    if (valueIsPresent(rawValue)) {
      normalizedRow[canonical] = rawValue as ResultRow[string];
    }
  }

  const realizado = parseReportNumber(rawValues.realizado_rs);
  const orcado = parseReportNumber(rawValues.orcado_rs);
  const explicitVariancia = parseReportNumber(rawValues.variancia_rs);
  const variancia =
    explicitVariancia ?? (realizado !== null && orcado !== null ? realizado - orcado : null);
  const explicitVarianciaPerc = parseReportNumber(rawValues.variancia_perc);
  const varianciaPerc =
    explicitVarianciaPerc ??
    (variancia !== null && orcado !== null && Math.abs(orcado) > 0
      ? (variancia / Math.abs(orcado)) * 100
      : null);
  const tipoVariacao = valueIsPresent(rawValues.tipo_variacao)
    ? String(rawValues.tipo_variacao)
    : inferTipoVariacao(variancia);

  if (realizado !== null) {
    normalizedRow.realizado_rs = realizado;
  }

  if (orcado !== null) {
    normalizedRow.orcado_rs = orcado;
  }

  if (variancia !== null) {
    normalizedRow.variancia_rs = Number(variancia.toFixed(2));
  }

  if (varianciaPerc !== null) {
    normalizedRow.variancia_perc = Number(varianciaPerc.toFixed(2));
  }

  if (tipoVariacao) {
    normalizedRow.tipo_variacao = tipoVariacao;
  }

  return normalizedRow;
}

export function normalizeReportRows(rows: ResultRow[]) {
  return rows.map(normalizeReportRow);
}

export function normalizeReportColumns(columns: string[], rows: ResultRow[]) {
  const existingColumns = new Set(columns);
  const normalizedColumns = [...columns];

  for (const column of PRESENTATION_REPORT_COLUMNS) {
    if (
      !existingColumns.has(column) &&
      rows.some((row) => valueIsPresent(row[column]))
    ) {
      normalizedColumns.push(column);
      existingColumns.add(column);
    }
  }

  return normalizedColumns;
}
