/**
 * Health check endpoint for production monitoring and Docker health checks.
 *
 * Returns 200 with database connectivity status. Excluded from auth
 * middleware so it can be called without authentication (e.g., by
 * Docker HEALTHCHECK, load balancers, or uptime monitors).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "unreachable";
    healthy = false;
  }

  const body = {
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
