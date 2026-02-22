/**
 * Anthropic client singleton.
 *
 * Initializes the Anthropic SDK client and caches it for reuse.
 * Requires the ANTHROPIC_API_KEY environment variable to be set.
 */

import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | undefined;
};

export const anthropic =
  globalForAnthropic.anthropic ??
  new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

if (process.env.NODE_ENV !== "production") {
  globalForAnthropic.anthropic = anthropic;
}
