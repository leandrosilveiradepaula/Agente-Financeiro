import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ShadowDispatchReceiptPanel,
  parseShadowDispatchReceipts
} from "@/components/ShadowDispatchReceiptPanel";

describe("Shadow transport delivery receipts", () => {
  it("shows absence as unknown rather than proving a dispatch was not attempted", () => {
    const receipts = parseShadowDispatchReceipts(null);
    expect(receipts.map((x) => x.statusLabel)).toEqual([
      "Sem recibo registrado",
      "Sem recibo registrado"
    ]);
    const html = renderToStaticMarkup(<ShadowDispatchReceiptPanel metadata={null} />);
    expect(html).toContain("Ausência de recibo não comprova");
    expect(html).not.toContain("Falha de rede");
  });

  it("shows transport delivery and a separate execution event without claiming parity", () => {
    const metadata = {
      shadow_dispatch: {
        generate: {
          status: "sent",
          http_status: 202,
          recorded_at: "2026-10-23T13:00:00.000Z",
          request_id: "synthetic-g1"
        },
        execute_approved: {
          status: "timeout",
          http_status: null,
          recorded_at: "2026-10-23T13:01:00.000Z"
        }
      }
    };
    const receipts = parseShadowDispatchReceipts(metadata);
    expect(receipts[0]).toMatchObject({
      event: "generate", status: "sent", httpStatus: 202
    });
    expect(receipts[1]).toMatchObject({
      event: "execute_approved", status: "timeout", httpStatus: null
    });
    const html = renderToStaticMarkup(<ShadowDispatchReceiptPanel metadata={metadata} />);
    expect(html).toContain("HTTP 202");
    expect(html).toContain("Solicitação entregue");
    expect(html).toContain("Tempo esgotado");
    expect(html).toContain("não comprova geração de SQL");
    expect(html).not.toContain("synthetic-g1");
  });

  it("ignores arbitrary metadata, HTML, URLs, tokens and invalid HTTP statuses", () => {
    const metadata = {
      shadow_dispatch: {
        generate: {
          status: "<script>alert(document.cookie)</script>",
          http_status: 800,
          error_message: "Bearer top-secret-token",
          recorded_at: "malicious"
        },
        execute_approved: {
          status: "network_error",
          http_status: 401,
          request_id: "https://internal.example/path?token=secret"
        }
      }
    };
    const parsed = parseShadowDispatchReceipts(metadata);
    expect(parsed[0].status).toBeNull();
    expect(parsed[0].httpStatus).toBeNull();
    expect(parsed[1].status).toBe("network_error");
    const html = renderToStaticMarkup(<ShadowDispatchReceiptPanel metadata={metadata} />);
    for (const forbidden of ["<script>", "top-secret-token", "internal.example", "malicious"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});
