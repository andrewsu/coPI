/**
 * AWS SES client singleton.
 *
 * Initializes the SES SDK client and caches it for reuse.
 * Uses the same global singleton pattern as Prisma and Anthropic clients.
 *
 * Required environment variables:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *
 * When AWS credentials are not configured (empty or missing),
 * the email service falls back to console logging instead of sending.
 */

import { SESClient } from "@aws-sdk/client-ses";

const globalForSes = globalThis as unknown as {
  sesClient: SESClient | undefined;
};

/**
 * Returns true if AWS SES credentials are configured in the environment.
 * Used by the email service to decide between real sending and dev-mode logging.
 */
export function isSesConfigured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );
}

export const sesClient =
  globalForSes.sesClient ??
  new SESClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForSes.sesClient = sesClient;
}
