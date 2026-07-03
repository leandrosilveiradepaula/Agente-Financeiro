export type WhatsAppSafetyReason =
  | "inbound_disabled"
  | "dry_run"
  | "group_ignored"
  | "not_allowed_number"
  | "missing_trigger_prefix"
  | "empty_message"
  | "from_me_ignored";

export type SafetyDecision = {
  allowed: boolean;
  reason?: WhatsAppSafetyReason;
  sanitizedText?: string;
  matchedCandidate?: string;
  normalizedCandidates?: string[];
};

export type WhatsAppSafetyConfig = {
  inboundEnabled: boolean;
  dryRun: boolean;
  requireTrigger: boolean;
  triggerPrefix: string;
  allowedNumbersCount: number;
  ignoreGroups: boolean;
};

function envFlag(name: string, enabledValue = "true") {
  return (process.env[name] || "").trim().toLowerCase() === enabledValue;
}

function envNotFalse(name: string) {
  return (process.env[name] || "true").trim().toLowerCase() !== "false";
}

function triggerPrefix() {
  return (process.env.WHATSAPP_TRIGGER_PREFIX || "AGENTE").trim() || "AGENTE";
}

export function normalizePhoneCandidate(value: string) {
  return String(value)
    .replace(/@c\.us$/i, "")
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@lid$/i, "")
    .replace(/\D/g, "");
}

export function normalizePhoneCandidates(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => (value ? normalizePhoneCandidate(value) : ""))
        .filter(Boolean)
    )
  );
}

export function getAllowedWebJsNumbers() {
  return (process.env.WHATSAPP_ALLOWED_NUMBERS || "")
    .split(",")
    .map((item) => normalizePhoneCandidate(item))
    .filter(Boolean);
}

export function getWhatsAppSafetyConfig(): WhatsAppSafetyConfig {
  return {
    inboundEnabled: envFlag("WHATSAPP_WEBJS_ENABLE_INBOUND"),
    dryRun: envNotFalse("WHATSAPP_WEBJS_DRY_RUN"),
    requireTrigger: envNotFalse("WHATSAPP_REQUIRE_TRIGGER"),
    triggerPrefix: triggerPrefix(),
    allowedNumbersCount: getAllowedWebJsNumbers().length,
    ignoreGroups: envNotFalse("WHATSAPP_IGNORE_GROUPS")
  };
}

export function applyWhatsAppTriggerPrefix(text: string) {
  const config = getWhatsAppSafetyConfig();
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (!config.requireTrigger || !config.triggerPrefix) {
    return normalizedText;
  }

  const lowerText = normalizedText.toLowerCase();
  const lowerPrefix = config.triggerPrefix.toLowerCase();

  if (lowerText === lowerPrefix || lowerText.startsWith(`${lowerPrefix} `)) {
    return normalizedText;
  }

  return `${config.triggerPrefix} ${normalizedText}`.trim();
}

function stripTriggerPrefix(text: string, prefix: string) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const lowerText = normalizedText.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();

  if (lowerText === lowerPrefix) {
    return "";
  }

  if (!lowerText.startsWith(`${lowerPrefix} `)) {
    return "";
  }

  return normalizedText.slice(prefix.length).trim();
}

export function evaluateWhatsAppSafety(input: {
  source: "webjs" | "debug" | "meta";
  from: string;
  senderCandidates?: Array<string | undefined | null>;
  text: string;
  isGroup?: boolean;
}): SafetyDecision {
  const text = input.text.replace(/\s+/g, " ").trim();

  if (input.source === "debug" || input.source === "meta") {
    return text
      ? { allowed: true, sanitizedText: text }
      : { allowed: false, reason: "empty_message" };
  }

  const config = getWhatsAppSafetyConfig();

  if (!config.inboundEnabled) {
    return { allowed: false, reason: "inbound_disabled" };
  }

  if (config.ignoreGroups && input.isGroup) {
    return { allowed: false, reason: "group_ignored" };
  }

  if (!text) {
    return { allowed: false, reason: "empty_message" };
  }

  const normalizedCandidates = normalizePhoneCandidates([input.from, ...(input.senderCandidates ?? [])]);
  const allowedNumbers = getAllowedWebJsNumbers();
  const matchedCandidate = normalizedCandidates.find((candidate) => allowedNumbers.includes(candidate));

  if (!allowedNumbers.length || !matchedCandidate) {
    return { allowed: false, reason: "not_allowed_number", normalizedCandidates };
  }

  if (config.requireTrigger) {
    const sanitizedText = stripTriggerPrefix(text, config.triggerPrefix);

    if (!sanitizedText) {
      return { allowed: false, reason: "missing_trigger_prefix", normalizedCandidates, matchedCandidate };
    }

    return { allowed: true, sanitizedText, normalizedCandidates, matchedCandidate };
  }

  return { allowed: true, sanitizedText: text, normalizedCandidates, matchedCandidate };
}
