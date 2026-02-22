import { getUserSide, orderUserIds } from "../utils";

describe("getUserSide", () => {
  // Validates that getUserSide correctly identifies which side of a proposal a user is on.
  // This is critical because all proposal fields (summary, contributions, benefits, visibility)
  // are split into A/B sides, and showing the wrong side breaks the entire swipe experience.

  const proposal = {
    researcherAId: "aaaa-1111",
    researcherBId: "bbbb-2222",
  };

  it("returns 'a' when user is researcher A", () => {
    expect(getUserSide("aaaa-1111", proposal)).toBe("a");
  });

  it("returns 'b' when user is researcher B", () => {
    expect(getUserSide("bbbb-2222", proposal)).toBe("b");
  });

  it("throws when user is not part of the proposal", () => {
    expect(() => getUserSide("cccc-3333", proposal)).toThrow(
      "User cccc-3333 is not part of proposal"
    );
  });
});

describe("orderUserIds", () => {
  // Validates the UUID ordering convention for proposals.
  // Convention: researcher_a_id < researcher_b_id by UUID sort.
  // This ensures a deterministic pairing — the same two users always produce
  // the same (A, B) ordering, preventing duplicate proposals.

  it("preserves order when first < second", () => {
    const result = orderUserIds("aaaa", "bbbb");
    expect(result.researcherAId).toBe("aaaa");
    expect(result.researcherBId).toBe("bbbb");
  });

  it("swaps order when first > second", () => {
    const result = orderUserIds("bbbb", "aaaa");
    expect(result.researcherAId).toBe("aaaa");
    expect(result.researcherBId).toBe("bbbb");
  });

  it("handles equal IDs", () => {
    const result = orderUserIds("aaaa", "aaaa");
    expect(result.researcherAId).toBe("aaaa");
    expect(result.researcherBId).toBe("aaaa");
  });
});
