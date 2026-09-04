import { describe, expect, it, vi } from "vitest";
import {
  buildWhatsAppBotEndpoint,
  buildWhatsAppDemoPath,
  getWhatsAppBotUrl,
  getWhatsAppSafetyMode,
  getWhatsAppSafetySummary
} from "@/lib/whatsapp-demo";

describe("whatsapp demo helpers", () => {
  it("uses localhost fallback and trims trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_BOT_URL", "");

    expect(getWhatsAppBotUrl()).toBe("http://localhost:3980");
    expect(getWhatsAppBotUrl("http://localhost:3980/")).toBe("http://localhost:3980");

    vi.unstubAllEnvs();
  });

  it("builds endpoints with optional question id", () => {
    expect(buildWhatsAppDemoPath("orcado_vs_realizado")).toBe("?questionId=orcado_vs_realizado");
    expect(buildWhatsAppBotEndpoint("http://localhost:3980", "/demo/link", "resultado_marcas")).toBe(
      "http://localhost:3980/demo/link?questionId=resultado_marcas"
    );
  });

  it("classifies WebJS safety modes", () => {
    expect(
      getWhatsAppSafetyMode({
        inboundEnabled: false,
        dryRun: true,
        requireTrigger: true,
        triggerPrefix: "AGENTE",
        allowedNumbersCount: 0,
        ignoreGroups: true
      })
    ).toBe("seguro");

    expect(
      getWhatsAppSafetyMode({
        inboundEnabled: true,
        dryRun: false,
        allowedNumbersCount: 2
      })
    ).toBe("demo_controlada");

    expect(
      getWhatsAppSafetyMode({
        inboundEnabled: true,
        dryRun: false,
        allowedNumbersCount: 0
      })
    ).toBe("risco");

    expect(getWhatsAppSafetySummary(null)).toBe("Status de segurança indisponível.");
  });
});
