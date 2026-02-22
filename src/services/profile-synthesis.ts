/**
 * Profile synthesis service.
 *
 * Calls Claude to generate a structured researcher profile from assembled
 * input data (publications, grants, methods, user-submitted texts). Handles
 * parsing, validation, and one retry on validation failure.
 *
 * The prompt text and validation rules are managed by the prompt builder
 * module (src/lib/profile-synthesis-prompt.ts). This service is responsible
 * for the LLM API call lifecycle only.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  type SynthesisInput,
  type SynthesisOutput,
  type ValidationResult,
  buildUserMessage,
  getSystemMessage,
  parseSynthesisOutput,
  validateSynthesisOutput,
  buildRetryMessage,
  SYNTHESIS_MODEL_CONFIG,
} from "@/lib/profile-synthesis-prompt";

// --- Public types ---

/** Result of a profile synthesis attempt. */
export interface ProfileSynthesisResult {
  /** The validated profile output. Null only if both attempts failed and no output was salvageable. */
  output: SynthesisOutput | null;
  /** Whether the output passed validation. */
  valid: boolean;
  /** Validation details from the final attempt. */
  validation: ValidationResult | null;
  /** Number of LLM calls made (1 or 2). */
  attempts: number;
  /** The model used for synthesis. */
  model: string;
  /** Whether the output was produced on a retry attempt. */
  retried: boolean;
}

/** Options for the synthesis call. */
export interface SynthesisOptions {
  /** Maximum number of attempts (default: 2 — initial + one retry). */
  maxAttempts?: number;
}

// --- Service ---

/**
 * Synthesizes a researcher profile by calling Claude with the assembled input.
 *
 * Flow:
 * 1. Build system and user messages from the input data.
 * 2. Call Claude with the configured model parameters.
 * 3. Parse the JSON output and validate against profile requirements.
 * 4. If validation fails, send a retry prompt with specific error feedback.
 * 5. If retry also fails validation, return the best output with valid=false.
 *
 * Per spec (profile-ingestion.md Step 8): "If validation fails: re-run
 * synthesis once with stricter prompt. If it fails again, save what we have
 * and flag for review."
 *
 * @param client - Anthropic SDK client instance (injected for testability).
 * @param input - The assembled researcher data for synthesis.
 * @param options - Optional synthesis configuration.
 * @returns ProfileSynthesisResult with output, validation, and attempt metadata.
 * @throws If the LLM call itself fails (network error, auth error, etc.).
 */
export async function synthesizeProfile(
  client: Anthropic,
  input: SynthesisInput,
  options: SynthesisOptions = {},
): Promise<ProfileSynthesisResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  const systemMessage = getSystemMessage();
  const userMessage = buildUserMessage(input);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // --- First attempt ---
  const firstResponse = await callClaude(client, systemMessage, messages);
  const firstText = extractTextContent(firstResponse);

  let output: SynthesisOutput;
  try {
    output = parseSynthesisOutput(firstText);
  } catch (error) {
    // Parse failed completely on first attempt. If we can retry, do so.
    if (maxAttempts > 1) {
      const parseErrorMessage = buildParseErrorRetryMessage(error);
      messages.push({ role: "assistant", content: firstText });
      messages.push({ role: "user", content: parseErrorMessage });

      const retryResponse = await callClaude(client, systemMessage, messages);
      const retryText = extractTextContent(retryResponse);

      try {
        output = parseSynthesisOutput(retryText);
      } catch {
        // Both parse attempts failed — no salvageable output.
        return {
          output: null,
          valid: false,
          validation: null,
          attempts: 2,
          model: SYNTHESIS_MODEL_CONFIG.model,
          retried: true,
        };
      }

      const validation = validateSynthesisOutput(output);
      return {
        output,
        valid: validation.valid,
        validation,
        attempts: 2,
        model: SYNTHESIS_MODEL_CONFIG.model,
        retried: true,
      };
    }

    // Single attempt allowed and it failed parsing.
    return {
      output: null,
      valid: false,
      validation: null,
      attempts: 1,
      model: SYNTHESIS_MODEL_CONFIG.model,
      retried: false,
    };
  }

  const firstValidation = validateSynthesisOutput(output);

  if (firstValidation.valid || maxAttempts <= 1) {
    return {
      output,
      valid: firstValidation.valid,
      validation: firstValidation,
      attempts: 1,
      model: SYNTHESIS_MODEL_CONFIG.model,
      retried: false,
    };
  }

  // --- Retry attempt (validation failed) ---
  const retryPrompt = buildRetryMessage(firstValidation);
  messages.push({ role: "assistant", content: firstText });
  messages.push({ role: "user", content: retryPrompt });

  const retryResponse = await callClaude(client, systemMessage, messages);
  const retryText = extractTextContent(retryResponse);

  let retryOutput: SynthesisOutput;
  try {
    retryOutput = parseSynthesisOutput(retryText);
  } catch {
    // Retry produced unparseable output — fall back to the first attempt's output.
    return {
      output,
      valid: false,
      validation: firstValidation,
      attempts: 2,
      model: SYNTHESIS_MODEL_CONFIG.model,
      retried: true,
    };
  }

  const retryValidation = validateSynthesisOutput(retryOutput);

  if (retryValidation.valid) {
    return {
      output: retryOutput,
      valid: true,
      validation: retryValidation,
      attempts: 2,
      model: SYNTHESIS_MODEL_CONFIG.model,
      retried: true,
    };
  }

  // Both attempts produced parseable but invalid output. Return the better one.
  // "Better" = fewer validation errors; tie-break: use the retry (it had more guidance).
  const bestOutput =
    retryValidation.errors.length <= firstValidation.errors.length
      ? retryOutput
      : output;
  const bestValidation =
    retryValidation.errors.length <= firstValidation.errors.length
      ? retryValidation
      : firstValidation;

  return {
    output: bestOutput,
    valid: false,
    validation: bestValidation,
    attempts: 2,
    model: SYNTHESIS_MODEL_CONFIG.model,
    retried: true,
  };
}

// --- Internal helpers ---

/**
 * Calls the Claude API with the given messages and model configuration.
 */
async function callClaude(
  client: Anthropic,
  systemMessage: string,
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: SYNTHESIS_MODEL_CONFIG.model,
    max_tokens: SYNTHESIS_MODEL_CONFIG.maxTokens,
    temperature: SYNTHESIS_MODEL_CONFIG.temperature,
    system: systemMessage,
    messages,
  });
}

/**
 * Extracts the text content from a Claude API response.
 *
 * Claude can return multiple content blocks (text, tool_use, etc.).
 * We concatenate all text blocks since the synthesis prompt expects
 * a single JSON output.
 *
 * @throws If no text content is found in the response.
 */
export function extractTextContent(response: Anthropic.Message): string {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  if (textBlocks.length === 0) {
    throw new Error(
      "Claude response contained no text content blocks. " +
        `Stop reason: ${response.stop_reason}`,
    );
  }

  return textBlocks.map((block) => block.text).join("");
}

/**
 * Builds a retry message for when the initial output failed to parse as JSON.
 */
function buildParseErrorRetryMessage(error: unknown): string {
  const errorMessage =
    error instanceof Error ? error.message : "Unknown parse error";
  return (
    `Your previous response could not be parsed as valid JSON.\n\n` +
    `Error: ${errorMessage}\n\n` +
    `Please regenerate the profile. Return ONLY valid JSON matching the required schema — ` +
    `no markdown fencing, no commentary, no text outside the JSON object.`
  );
}
