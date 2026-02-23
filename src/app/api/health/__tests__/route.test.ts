/**
 * Tests for GET /api/health.
 *
 * Validates: successful health check with database connectivity,
 * degraded status when database is unreachable, and response format
 * (status, timestamp, checks). This endpoint is unauthenticated
 * (excluded from middleware) for use by Docker HEALTHCHECK and
 * load balancers.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import { prisma } from "@/lib/prisma";

const mockQueryRaw = jest.mocked(prisma.$queryRaw);

const { GET } = require("../route");

describe("GET /api/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Verifies that when the database is reachable, the endpoint returns
  // 200 with status "ok" and database check "ok".
  it("returns 200 with ok status when database is reachable", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  // Verifies that when the database connection fails, the endpoint returns
  // 503 with status "degraded" and database check "unreachable".
  it("returns 503 with degraded status when database is unreachable", async () => {
    mockQueryRaw.mockRejectedValue(new Error("Connection refused"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("unreachable");
    expect(body.timestamp).toBeDefined();
  });

  // Verifies the response includes a valid ISO 8601 timestamp.
  it("includes a valid ISO timestamp", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();
    const body = await response.json();

    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });
});
