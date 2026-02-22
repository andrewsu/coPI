/**
 * Tests for GET /api/settings and PUT /api/settings.
 *
 * Validates: authentication checks, successful settings fetch,
 * settings update with validation, partial updates, invalid field types,
 * email visibility enum validation, and the master notification switch behavior.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.user.findUnique);
const mockUpdate = jest.mocked(prisma.user.update);

const { GET, PUT } = require("../route");

/** Default user settings as returned by Prisma. */
const DEFAULT_SETTINGS = {
  emailVisibility: "mutual_matches",
  allowIncomingProposals: false,
  emailNotificationsEnabled: true,
  notifyMatches: true,
  notifyNewProposals: true,
  notifyProfileRefresh: true,
};

/** Builds a NextRequest-like object for PUT. */
function makePutRequest(body: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve(body) };
}

describe("GET /api/settings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when user does not exist", async () => {
    /** Handles edge case where session exists but user record is missing. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns user settings when authenticated", async () => {
    /** Fetches all six settings fields for the authenticated user. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(DEFAULT_SETTINGS as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual(DEFAULT_SETTINGS);
  });

  it("selects only settings fields from the user record", async () => {
    /** Ensures Prisma query only selects settings-related fields. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(DEFAULT_SETTINGS as never);

    await GET();

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        emailVisibility: true,
        allowIncomingProposals: true,
        emailNotificationsEnabled: true,
        notifyMatches: true,
        notifyNewProposals: true,
        notifyProfileRefresh: true,
      },
    });
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await PUT(makePutRequest({ allowIncomingProposals: true }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON body", async () => {
    /** Bad request body should return 400, not crash. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PUT({
      json: () => Promise.reject(new Error("Invalid JSON")),
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 when no setting fields are provided", async () => {
    /** An empty update payload is rejected — at least one field is required. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PUT(makePutRequest({}));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("At least one setting field"),
      ]),
    );
  });

  it("returns 422 for invalid emailVisibility value", async () => {
    /** emailVisibility must be one of the three valid enum values. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PUT(
      makePutRequest({ emailVisibility: "invalid_value" }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("emailVisibility"),
      ]),
    );
  });

  it("returns 422 when boolean field receives non-boolean", async () => {
    /** Boolean settings must receive actual boolean values, not strings. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PUT(
      makePutRequest({ allowIncomingProposals: "yes" }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("allowIncomingProposals must be a boolean"),
      ]),
    );
  });

  it("accepts and applies valid emailVisibility update", async () => {
    /** Updates emailVisibility to 'never' and returns the new settings. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = { ...DEFAULT_SETTINGS, emailVisibility: "never" };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(makePutRequest({ emailVisibility: "never" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.emailVisibility).toBe("never");

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { emailVisibility: "never" },
      }),
    );
  });

  it("accepts valid public_profile emailVisibility", async () => {
    /** Validates that 'public_profile' is an accepted enum value. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = {
      ...DEFAULT_SETTINGS,
      emailVisibility: "public_profile",
    };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(
      makePutRequest({ emailVisibility: "public_profile" }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts and applies boolean toggle update", async () => {
    /** Toggles allowIncomingProposals on and persists it. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = {
      ...DEFAULT_SETTINGS,
      allowIncomingProposals: true,
    };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(
      makePutRequest({ allowIncomingProposals: true }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.allowIncomingProposals).toBe(true);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { allowIncomingProposals: true },
      }),
    );
  });

  it("accepts partial update with multiple fields", async () => {
    /** Multiple settings can be updated in a single PUT request. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = {
      ...DEFAULT_SETTINGS,
      emailVisibility: "public_profile",
      notifyMatches: false,
      notifyNewProposals: false,
    };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(
      makePutRequest({
        emailVisibility: "public_profile",
        notifyMatches: false,
        notifyNewProposals: false,
      }),
    );
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          emailVisibility: "public_profile",
          notifyMatches: false,
          notifyNewProposals: false,
        },
      }),
    );
  });

  it("ignores unknown fields in the payload", async () => {
    /** Unknown fields are silently ignored — only known settings are applied. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = {
      ...DEFAULT_SETTINGS,
      allowIncomingProposals: true,
    };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(
      makePutRequest({
        allowIncomingProposals: true,
        someUnknownField: "should be ignored",
      }),
    );
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { allowIncomingProposals: true },
      }),
    );
  });

  it("updates emailNotificationsEnabled as master switch", async () => {
    /** Disabling the master switch persists to the database; UI enforces sub-toggle dimming. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = {
      ...DEFAULT_SETTINGS,
      emailNotificationsEnabled: false,
    };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(
      makePutRequest({ emailNotificationsEnabled: false }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.emailNotificationsEnabled).toBe(false);
  });

  it("returns updated settings with select projection", async () => {
    /** PUT response includes all six settings fields via select projection. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const updatedSettings = {
      emailVisibility: "never",
      allowIncomingProposals: true,
      emailNotificationsEnabled: false,
      notifyMatches: false,
      notifyNewProposals: true,
      notifyProfileRefresh: false,
    };
    mockUpdate.mockResolvedValue(updatedSettings as never);

    const res = await PUT(
      makePutRequest({
        emailVisibility: "never",
        allowIncomingProposals: true,
        emailNotificationsEnabled: false,
        notifyMatches: false,
        notifyProfileRefresh: false,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual(updatedSettings);
  });

  it("returns 422 with multiple errors for multiple invalid fields", async () => {
    /** All validation errors are reported at once when multiple fields are invalid. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PUT(
      makePutRequest({
        emailVisibility: "bad",
        allowIncomingProposals: "not-boolean",
        notifyMatches: 42,
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details.length).toBeGreaterThanOrEqual(3);
  });
});
