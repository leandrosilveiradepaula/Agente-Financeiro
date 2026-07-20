export function getAgentDisplayVersion(..._ignoredTechnicalResponses: unknown[]) {
  return process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION?.trim() || "versão não informada";
}
