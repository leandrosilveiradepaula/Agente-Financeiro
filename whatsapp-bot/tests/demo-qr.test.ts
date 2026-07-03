import { afterEach, describe, expect, it } from "vitest";
import {
  buildWhatsAppDemoLink,
  generateQrPngBuffer,
  getDemoMessageText,
  getDemoQuestion,
  normalizeDemoPhoneNumber,
  renderDemoHtml
} from "../src/demo-qr.js";

afterEach(() => {
  delete process.env.WHATSAPP_REQUIRE_TRIGGER;
  delete process.env.WHATSAPP_TRIGGER_PREFIX;
});

describe("demo QR", () => {
  it("normalizes phone numbers and builds a wa.me link without trigger when disabled", () => {
    process.env.WHATSAPP_REQUIRE_TRIGGER = "false";

    const link = buildWhatsAppDemoLink({
      phoneNumber: "+55 (51) 99999-9999",
      text: "Quais os estouros de orçamento?"
    });

    expect(normalizeDemoPhoneNumber("+55 (51) 99999-9999")).toBe("5551999999999");
    expect(link).toBe(
      "https://wa.me/5551999999999?text=Quais%20os%20estouros%20de%20or%C3%A7amento%3F"
    );
  });

  it("prefixes demo links when WebJS trigger is required", () => {
    process.env.WHATSAPP_REQUIRE_TRIGGER = "true";
    process.env.WHATSAPP_TRIGGER_PREFIX = "AGENTE";

    const link = buildWhatsAppDemoLink({
      phoneNumber: "5551999999999",
      text: "Quais os estouros de orçamento?"
    });

    expect(link).toBe(
      "https://wa.me/5551999999999?text=AGENTE%20Quais%20os%20estouros%20de%20or%C3%A7amento%3F"
    );
    expect(getDemoMessageText("AGENTE Pergunta")).toBe("AGENTE Pergunta");
  });

  it("selects suggested or custom questions", () => {
    expect(getDemoQuestion("orcado_vs_realizado")).toContain("orçado e realizado");
    expect(getDemoQuestion(undefined, ` ${"x".repeat(400)} `)).toHaveLength(300);
  });

  it("generates a PNG QR buffer", async () => {
    const buffer = await generateQrPngBuffer("https://wa.me/5551999999999?text=teste");

    expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("renders a demo HTML page without exposing secrets", () => {
    const html = renderDemoHtml({
      title: "Agente SQL Financeiro DuckLake",
      subtitle: "Teste pelo WhatsApp",
      phoneNumber: "5551999999999",
      question: "Pergunta",
      url: "https://wa.me/5551999999999?text=Pergunta"
    });

    expect(html).toContain("Agente SQL Financeiro DuckLake");
    expect(html).toContain("Mensagem enviada");
    expect(html).toContain("Abrir no WhatsApp");
    expect(html).not.toContain("WHATSAPP_ACCESS_TOKEN");
  });
});
