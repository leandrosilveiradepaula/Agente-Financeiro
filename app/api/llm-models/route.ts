import { NextResponse } from "next/server";
import {
  getDefaultLlmSelection,
  getLlmRegistryEnvironment,
  getLlmRegistryVersion,
  listAvailableLlmModels
} from "@/lib/llm-provider-registry";
import type { LlmExecutionTarget, LlmModelsResponse } from "@/lib/llm-provider-types";
import { buildPolicyDeniedResponse, enforceCanGenerateSql } from "@/lib/profile-policy";
import { isLangGraphShadowDispatchConfigured } from "@/lib/langgraph-shadow-client";
import { isShadowPhaseOneProviderMatch } from "@/lib/shadow-phase-gate";
import { requireAgentSession } from "@/lib/server-auth";

export const runtime = "nodejs";

function readTarget(request: Request): LlmExecutionTarget {
  const target = new URL(request.url).searchParams.get("target");
  return target === "shadow" ? "shadow" : "official";
}

export async function GET(request: Request) {
  const { session, response } = await requireAgentSession();

  if (response || !session) {
    return (
      response ??
      NextResponse.json(
        {
          success: false,
          error: "unauthorized"
        },
        { status: 401 }
      )
    );
  }

  const policy = await enforceCanGenerateSql(session.userProfile);

  if (!policy.allowed) {
    return NextResponse.json(
      {
        registry_version: getLlmRegistryVersion(),
        target: readTarget(request),
        models: [],
        default_selection: null,
        ...buildPolicyDeniedResponse(policy.reason)
      } satisfies LlmModelsResponse,
      { status: 403 }
    );
  }

  const target = readTarget(request);
  const environment = process.env.LLM_REGISTRY_ENVIRONMENT || getLlmRegistryEnvironment();
  const models = listAvailableLlmModels({
    environment,
    target,
    profile: session.userProfile
  });
  const defaultSelection = getDefaultLlmSelection({
    environment,
    target,
    profile: session.userProfile
  });
  const officialDefault = target === "shadow"
    ? getDefaultLlmSelection({
        environment,
        target: "official",
        profile: session.userProfile
      })
    : null;
  // Fase 1: keep other providers catalogued but unavailable for Shadow.
  // Future provider comparisons require a separately authorized phase.
  const phaseOneModels = target === "shadow"
    ? models.map((model) => ({
        ...model,
        available_for_target: model.available_for_target &&
          isShadowPhaseOneProviderMatch(officialDefault, model)
      }))
    : models;
  const phaseOneDefault = target === "shadow" &&
    !isShadowPhaseOneProviderMatch(officialDefault, defaultSelection)
    ? null
    : defaultSelection;

  return NextResponse.json(
    {
      success: true,
      registry_version: getLlmRegistryVersion(),
      target,
      models: phaseOneModels,
      default_selection: phaseOneDefault,
      ...(target === "shadow" ? {
        shadow_dispatch_configured: isLangGraphShadowDispatchConfigured()
      } : {})
    } satisfies LlmModelsResponse,
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
