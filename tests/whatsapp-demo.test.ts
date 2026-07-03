import { describe, expect, it, vi } from "vitest";
import {
  buildWhatsAppBotEndpoint,
  buildWhatsAppDemoPath,
  getWhatsAppBotUrl
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
});
