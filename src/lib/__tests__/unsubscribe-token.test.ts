/**
 * Tests for HMAC-signed unsubscribe token generation, verification, and URL building.
 *
 * Validates that:
 *   - Tokens can be generated and verified round-trip for all notification types
 *   - Invalid/tampered/expired tokens are rejected
 *   - Constant-time comparison prevents timing attacks (structurally)
 *   - buildUnsubscribeUrl produces correct URLs with embedded tokens
 *   - getUnsubscribeUpdate maps notification types to correct User model fields
 *   - getNotificationTypeLabel returns human-readable labels
 */

const MOCK_SECRET = "test-unsubscribe-secret-key-abc123";

// Set env before importing the module
process.env.NEXTAUTH_SECRET = MOCK_SECRET;
process.env.NEXTAUTH_URL = "https://copi.sulab.org";

import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  getUnsubscribeUpdate,
  getNotificationTypeLabel,
  TOKEN_EXPIRY_SECONDS,
  type UnsubscribeNotificationType,
} from "../unsubscribe-token";

describe("generateUnsubscribeToken + verifyUnsubscribeToken", () => {
  /** Round-trip: generate a token and verify it returns the correct payload. */
  it("round-trips a valid token for type=matches", () => {
    const token = generateUnsubscribeToken("user-123", "matches");
    const payload = verifyUnsubscribeToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-123");
    expect(payload!.type).toBe("matches");
    expect(typeof payload!.iat).toBe("number");
  });

  /** All four notification types must work. */
  it.each<UnsubscribeNotificationType>([
    "all",
    "matches",
    "new_proposals",
    "profile_refresh",
  ])("round-trips token for type=%s", (type) => {
    const token = generateUnsubscribeToken("user-abc", type);
    const payload = verifyUnsubscribeToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe(type);
  });

  /** Tampered payload should fail verification. */
  it("rejects a token with tampered payload", () => {
    const token = generateUnsubscribeToken("user-123", "matches");
    const [payload, sig] = token.split(".");
    // Flip one character in the payload
    const tampered = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A");
    const result = verifyUnsubscribeToken(`${tampered}.${sig}`);
    expect(result).toBeNull();
  });

  /** Tampered signature should fail verification. */
  it("rejects a token with tampered signature", () => {
    const token = generateUnsubscribeToken("user-123", "matches");
    const [payload, sig] = token.split(".");
    const tampered = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
    const result = verifyUnsubscribeToken(`${payload}.${tampered}`);
    expect(result).toBeNull();
  });

  /** Completely invalid token format should return null. */
  it("rejects garbage input", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("a.b.c")).toBeNull();
  });

  /** Expired tokens should be rejected. */
  it("rejects an expired token", () => {
    // Generate a token, then advance time past expiry
    const realDateNow = Date.now;
    const token = generateUnsubscribeToken("user-123", "matches");

    // Advance time past expiry
    Date.now = () => realDateNow() + (TOKEN_EXPIRY_SECONDS + 1) * 1000;
    try {
      const result = verifyUnsubscribeToken(token);
      expect(result).toBeNull();
    } finally {
      Date.now = realDateNow;
    }
  });

  /** Token just before expiry should still be valid. */
  it("accepts a token within the expiry window", () => {
    const realDateNow = Date.now;
    const token = generateUnsubscribeToken("user-123", "all");

    // Advance time to just before expiry
    Date.now = () => realDateNow() + (TOKEN_EXPIRY_SECONDS - 10) * 1000;
    try {
      const result = verifyUnsubscribeToken(token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("user-123");
    } finally {
      Date.now = realDateNow;
    }
  });
});

describe("buildUnsubscribeUrl", () => {
  /** URL should contain the app base URL and the token as a query param. */
  it("builds a URL with the token embedded", () => {
    const url = buildUnsubscribeUrl("user-456", "new_proposals");
    expect(url).toMatch(/^https:\/\/copi\.sulab\.org\/api\/email\/unsubscribe\?token=/);

    // Extract and verify the token from the URL
    const tokenParam = new URL(url).searchParams.get("token");
    expect(tokenParam).toBeTruthy();
    const payload = verifyUnsubscribeToken(tokenParam!);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-456");
    expect(payload!.type).toBe("new_proposals");
  });
});

describe("getUnsubscribeUpdate", () => {
  /** Maps "all" to disabling the master switch. */
  it("returns emailNotificationsEnabled=false for type=all", () => {
    expect(getUnsubscribeUpdate("all")).toEqual({
      emailNotificationsEnabled: false,
    });
  });

  /** Maps "matches" to disabling match notifications. */
  it("returns notifyMatches=false for type=matches", () => {
    expect(getUnsubscribeUpdate("matches")).toEqual({
      notifyMatches: false,
    });
  });

  /** Maps "new_proposals" to disabling digest notifications. */
  it("returns notifyNewProposals=false for type=new_proposals", () => {
    expect(getUnsubscribeUpdate("new_proposals")).toEqual({
      notifyNewProposals: false,
    });
  });

  /** Maps "profile_refresh" to disabling profile refresh notifications. */
  it("returns notifyProfileRefresh=false for type=profile_refresh", () => {
    expect(getUnsubscribeUpdate("profile_refresh")).toEqual({
      notifyProfileRefresh: false,
    });
  });
});

describe("getNotificationTypeLabel", () => {
  /** Each type should have a human-readable label for the confirmation page. */
  it.each<[UnsubscribeNotificationType, string]>([
    ["all", "all email notifications"],
    ["matches", "match notifications"],
    ["new_proposals", "new proposals digest"],
    ["profile_refresh", "profile refresh notifications"],
  ])("returns label for type=%s", (type, expected) => {
    expect(getNotificationTypeLabel(type)).toBe(expected);
  });
});

describe("NEXTAUTH_SECRET requirement", () => {
  /** Token generation should throw when secret is not configured. */
  it("throws when NEXTAUTH_SECRET is not set", () => {
    const original = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() => generateUnsubscribeToken("user-1", "all")).toThrow(
        "NEXTAUTH_SECRET is required",
      );
    } finally {
      process.env.NEXTAUTH_SECRET = original;
    }
  });
});
