function roundedToZero(value: number, fractionDigits: number) {
  return Math.abs(value) < 1 / 10 ** fractionDigits / 2 ? 0 : value;
}

export function formatBRL(value: number): string {
  const normalizedValue = roundedToZero(value, 2);
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
    .format(Math.abs(normalizedValue))
    .replace(/\u00a0/g, " ");

  return normalizedValue < 0 ? `-${formatted}` : formatted;
}

export function formatPercent(value: number): string {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalized)}%`;
}

export function formatPercentLiteral(value: number, maximumFractionDigits = 1): string {
  const normalizedValue = roundedToZero(value, maximumFractionDigits);

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits
  }).format(normalizedValue)}%`;
}

export function formatNumber(value: number): string {
  const normalizedValue = roundedToZero(value, 2);

  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2
  }).format(normalizedValue);
}

export function formatCellValue(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }

  const normalizedColumn = column.toLowerCase();

  if (normalizedColumn.endsWith("_rs")) {
    return formatBRL(value);
  }

  if (normalizedColumn.includes("perc") || normalizedColumn.includes("%")) {
    return formatPercent(value);
  }

  if (normalizedColumn.includes("ranking")) {
    return formatNumber(Math.round(value));
  }

  return formatNumber(value);
}

export function isNumericDisplayColumn(column: string): boolean {
  const normalizedColumn = column.toLowerCase();
  return (
    normalizedColumn.endsWith("_rs") ||
    normalizedColumn.includes("perc") ||
    normalizedColumn.includes("%") ||
    normalizedColumn.includes("ranking")
  );
}
