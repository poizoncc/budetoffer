import { describe, expect, it } from "vitest";
import { companionEwans } from "@/shared/api/ewans";
import { parseCompanionStatus } from "./companion-popup";

describe("Chrome message boundary", () => {
  it("accepts a catalog descriptor without copying unrelated runtime properties", () => {
    const ewans = companionEwans("connection_unavailable");
    expect(
      parseCompanionStatus({
        ok: false,
        ewans,
        accessToken: "synthetic-runtime-only",
      }),
    ).toEqual({ ok: false, ewans });
  });

  it("rejects a declared invalid or forged descriptor instead of using its message", () => {
    const ewans = companionEwans("connection_unavailable");
    for (const descriptor of [
      null,
      [],
      {},
      { ...ewans, code: "BO-COMP-999" },
      { ...ewans, group: "forged" },
      { ...ewans, message: "synthetic-secret" },
    ]) {
      expect(() =>
        parseCompanionStatus({ ok: false, ewans: descriptor }),
      ).toThrow("invalid_companion_status");
    }
  });

  it("preserves the login state without carrying worker credentials into the UI", () => {
    expect(
      parseCompanionStatus({
        ok: true,
        paired: false,
        accessToken: "synthetic-runtime-only",
        pendingLogin: {
          userCode: "ABC-234",
          verificationUri: "https://app.example.test/login",
          expiresAt: "2026-10-15T18:00:00Z",
          phoneReachable: true,
        },
      }),
    ).toEqual({
      ok: true,
      paired: false,
      pendingLogin: {
        userCode: "ABC-234",
        verificationUri: "https://app.example.test/login",
        expiresAt: "2026-10-15T18:00:00Z",
        phoneReachable: true,
      },
    });
  });

  it("rejects malformed connection and legal states", () => {
    for (const value of [
      null,
      [],
      {},
      { ok: "true" },
      { ok: true, paired: "false" },
      { ok: true, origin: {} },
      { ok: true, pendingLogin: { userCode: "ABC-234" } },
      { ok: true, legalLinks: { termsUrl: 42, privacyUrl: null } },
    ]) {
      expect(() => parseCompanionStatus(value)).toThrow(
        "invalid_companion_status",
      );
    }
  });
});
