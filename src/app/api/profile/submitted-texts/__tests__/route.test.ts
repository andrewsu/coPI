/**
 * Tests for GET /api/profile/submitted-texts and PUT /api/profile/submitted-texts.
 *
 * Validates: authentication checks, 404 when no profile exists,
 * successful text retrieval, text update with validation (max 5 entries,
 * max 2000 words per entry, required label/content), input sanitization,
 * and timestamp preservation for unchanged entries.
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
    researcherProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.researcherProfile.findUnique);
const mockUpdate = jest.mocked(prisma.researcherProfile.update);

const { GET, PUT } = require("../route");

/** Helper: generates a word string of exact length. */
function wordsOf(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

/** Builds a NextRequest-like object for PUT. */
function makePutRequest(body: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve(body) };
}

/** Sample existing texts in the JSONB field. */
const EXISTING_TEXTS = [
  {
    label: "R01 specific aims",
    content: "Our lab studies the role of p53 in tumor suppression.",
    submitted_at: "2025-01-01T00:00:00.000Z",
  },
  {
    label: "Current interests",
    content: "We are interested in CRISPR screening approaches.",
    submitted_at: "2025-02-01T00:00:00.000Z",
  },
];

describe("GET /api/profile/submitted-texts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when profile does not exist", async () => {
    /** Users without a profile get a 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns empty array when no submitted texts exist", async () => {
    /** Profiles with null userSubmittedTexts return an empty array. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({ userSubmittedTexts: null } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.texts).toEqual([]);
  });

  it("returns existing submitted texts", async () => {
    /** Retrieves all stored submitted texts with their timestamps. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      userSubmittedTexts: EXISTING_TEXTS,
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.texts).toHaveLength(2);
    expect(data.texts[0].label).toBe("R01 specific aims");
    expect(data.texts[1].label).toBe("Current interests");
  });
});

describe("PUT /api/profile/submitted-texts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await PUT(makePutRequest({ texts: [] }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when profile does not exist", async () => {
    /** Cannot update texts without a profile. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(makePutRequest({ texts: [] }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed JSON body", async () => {
    /** Invalid JSON should return 400. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    const res = await PUT({
      json: () => Promise.reject(new Error("Invalid JSON")),
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 when body lacks texts array", async () => {
    /** Request must contain a 'texts' array. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    const res = await PUT(makePutRequest({ notTexts: true }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("texts")]),
    );
  });

  it("returns 422 when more than 5 entries", async () => {
    /** Spec limits to 5 submitted texts maximum. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    const texts = Array.from({ length: 6 }, (_, i) => ({
      label: `Text ${i + 1}`,
      content: "Some content here.",
    }));
    const res = await PUT(makePutRequest({ texts }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("Maximum 5")]),
    );
  });

  it("returns 422 when entry has empty label", async () => {
    /** Each submitted text must have a non-empty label. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    const res = await PUT(
      makePutRequest({
        texts: [{ label: "", content: "Some content." }],
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("label is required")]),
    );
  });

  it("returns 422 when entry has empty content", async () => {
    /** Each submitted text must have non-empty content. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    const res = await PUT(
      makePutRequest({
        texts: [{ label: "My aims", content: "   " }],
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("content is required")]),
    );
  });

  it("returns 422 when content exceeds 2000 word limit", async () => {
    /** Each entry is limited to 2000 words per spec. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    const res = await PUT(
      makePutRequest({
        texts: [{ label: "Long text", content: wordsOf(2001) }],
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("2000 word limit")]),
    );
  });

  it("saves valid texts and returns entries with timestamps", async () => {
    /** Valid submission stores entries and assigns submitted_at timestamps. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    const texts = [
      { label: "R01 aims", content: "We study tumor suppression." },
    ];
    const res = await PUT(makePutRequest({ texts }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.texts).toHaveLength(1);
    expect(data.texts[0].label).toBe("R01 aims");
    expect(data.texts[0].content).toBe("We study tumor suppression.");
    expect(data.texts[0].submitted_at).toBeDefined();
  });

  it("preserves timestamps for unchanged entries", async () => {
    /** Entries with identical label+content keep their original submitted_at. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: EXISTING_TEXTS,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    // Resubmit the same entries unchanged
    const texts = EXISTING_TEXTS.map((t) => ({
      label: t.label,
      content: t.content,
    }));
    const res = await PUT(makePutRequest({ texts }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Timestamps should be preserved from the original entries
    expect(data.texts[0].submitted_at).toBe("2025-01-01T00:00:00.000Z");
    expect(data.texts[1].submitted_at).toBe("2025-02-01T00:00:00.000Z");
  });

  it("assigns new timestamp to modified entries", async () => {
    /** Modified content gets a fresh submitted_at timestamp. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: EXISTING_TEXTS,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    const texts = [
      { label: "R01 specific aims", content: "Updated aims text." },
    ];
    const res = await PUT(makePutRequest({ texts }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Should have a new timestamp since content changed
    expect(data.texts[0].submitted_at).not.toBe("2025-01-01T00:00:00.000Z");
  });

  it("trims whitespace from label and content", async () => {
    /** Input is sanitized: leading/trailing whitespace is trimmed. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await PUT(
      makePutRequest({
        texts: [{ label: "  My aims  ", content: "  Some content.  " }],
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.texts[0].label).toBe("My aims");
    expect(data.texts[0].content).toBe("Some content.");
  });

  it("allows saving an empty array (clearing all texts)", async () => {
    /** Users can remove all submitted texts by saving an empty array. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: EXISTING_TEXTS,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await PUT(makePutRequest({ texts: [] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.texts).toEqual([]);
  });

  it("reports multiple validation errors at once", async () => {
    /** All validation errors are collected and returned together. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);

    const res = await PUT(
      makePutRequest({
        texts: [
          { label: "", content: "" },
          { label: "OK", content: wordsOf(2500) },
        ],
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    // Entry 1: label + content errors, Entry 2: word limit error
    expect(data.details.length).toBeGreaterThanOrEqual(3);
  });

  it("calls prisma update with correct data shape", async () => {
    /** Verifies the Prisma update call stores the JSONB array correctly. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      userSubmittedTexts: null,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    await PUT(
      makePutRequest({
        texts: [{ label: "Test", content: "Content here." }],
      }),
    );

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        data: expect.objectContaining({
          userSubmittedTexts: expect.arrayContaining([
            expect.objectContaining({
              label: "Test",
              content: "Content here.",
              submitted_at: expect.any(String),
            }),
          ]),
        }),
      }),
    );
  });
});
