# AGENT.md — CoPI Development Guide

## Project Overview

CoPI (copi.science) is a web application that proposes scientific collaborations between academic researchers. It uses LLM-powered matching to generate specific, synergistic collaboration proposals based on researcher profiles built from publications, grants, and user-submitted content. Users evaluate proposals via a Tinder-style swipe interface and get notified on mutual interest.

## Tech Stack

- **Frontend:** Next.js + TypeScript + Tailwind CSS
- **Backend:** Next.js API routes + Prisma ORM
- **Database:** PostgreSQL (via Docker for local dev)
- **Job Queue:** AWS SQS (or in-process queue for local dev)
- **Auth:** ORCID OAuth 2.0
- **LLM:** Claude API (Opus) via Anthropic SDK
- **Email:** AWS SES

## Project Structure

```
copi/
├── specs/              # Application specifications (READ THESE FIRST)
├── prompts/            # LLM prompts for profile synthesis and matching engine
├── prisma/
│   └── schema.prisma   # Database schema
├── src/
│   ├── app/            # Next.js app router pages
│   │   ├── onboarding/ # Onboarding UI (client component with progress polling)
│   │   └── api/onboarding/  # Onboarding API (generate-profile, profile-status)
│   │   ├── api/profile/ # Profile API (GET/PUT profile, GET/PUT submitted-texts)
│   │   ├── api/match-pool/     # Match pool APIs (GET pool, DELETE entry, GET search, POST add, POST/DELETE affiliation, GET institutions, GET departments)
│   │   ├── profile/edit/ # Profile edit page (post-onboarding)
│   │   ├── profile/submitted-texts/ # User-submitted text management page
│   ├── components/     # React components (TagInput, SignOutButton, Providers)
│   ├── lib/            # Shared utilities, API clients, auth config
│   ├── services/       # Business logic (profile pipeline, matching engine, notifications)
│   └── worker/         # Background job processor
├── docker-compose.yml  # Local development environment
├── Dockerfile          # App container
├── .env.example        # Environment variable template
├── AGENT.md            # This file
├── PROMPT.md           # Ralph loop prompt
└── fix_plan.md         # Current task list
```

## How to Build and Run

### Prerequisites
- Node.js 20+
- Docker and Docker Compose
- ORCID OAuth credentials (for auth testing)
- Anthropic API key (for LLM features)
- NCBI API key (for PubMed and PMC ID Converter, optional but recommended)

### Local Development

```bash
# Start database
docker-compose up -d postgres

# Install dependencies
npm install

# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Start dev server
npm run dev

# Start worker (in separate terminal)
npm run worker
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- path/to/test.test.ts

# Run with coverage
npm run test:coverage
```

> **Note:** In non-interactive shells (scripts, tools that don't source your shell profile), `npm test` and `npx jest` will fail because nvm is not loaded. Source nvm first:
> ```bash
> source ~/.nvm/nvm.sh && npx jest src/lib/__tests__/orcid.test.ts
> ```

### Database Operations

```bash
# Create a migration after schema changes
npx prisma migrate dev --name description_of_change

# Reset database (destructive)
npx prisma migrate reset

# Open Prisma Studio (database browser)
npx prisma studio
```

### Linting

```bash
npm run lint
npm run type-check
```

## Environment Notes

1. **WSL2 (Ubuntu 24.04).** This project runs inside WSL2, not native Windows.
2. **Docker via Docker Desktop.** Use `docker.exe` (Docker Desktop on Windows with WSL integration), not `docker` directly.
3. **Node.js via nvm.** Node is installed through nvm, not the Windows Node. All npm/node commands must source nvm first:
   ```bash
   export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   ```
4. **Runtime versions:** Node v20.20.0, npm 10.8.2.
5. **ts-node is required** as a devDependency for Jest TypeScript config (`jest.config.ts`).
6. **next-auth v4** is used with the JWT session strategy. Session augmentation types are in `src/types/next-auth.d.ts`.
7. **fast-xml-parser** is used to parse PubMed E-utilities XML responses (efetch, db=pubmed). Configured with `isArray` for elements that can appear 0-N times (Author, AbstractText, etc.) and `ignoreAttributes: false` to access ArticleId IdType attributes. For PMC full-text XML (efetch, db=pmc), raw XML pattern matching with balanced tag extraction is used instead (`pmc.ts`) to preserve text ordering in mixed-content JATS XML elements. PMC uses a batch size of 10 (vs PubMed's 200) due to larger full-text response sizes.

## Key Design Decisions

1. **ORCID OAuth is the only auth method.** No email/password.
2. **User-submitted texts are NEVER shown to other users.** They inform profile synthesis and matching only.
3. **Direct profile editing is allowed.** Monthly refresh generates candidate profiles; user approves before overwrite.
4. **Match pool cap is 200 users per cycle.** Individual selections always prioritized.
5. **Matching engine uses Claude Opus.** Prompts are in `prompts/` directory.
6. **Proposals can be multiple per pair** but max 3 per LLM call.
7. **No bias signals in swipe UI.** Users don't see if the other party swiped.
8. **ORCID OAuth uses next-auth v4** with a custom provider. The config is in `src/lib/auth.ts`. ORCID's token endpoint returns `orcid` and `name` directly in the token response (non-standard). The custom token handler captures these fields and passes them to the userinfo handler which fetches full profile (email, institution) from the ORCID API.
9. **Member vs Public ORCID API**: When an access token is provided (from OAuth with /read-limited scope), the member API (api.orcid.org) is used. Without a token, the public API (pub.orcid.org) is used. Sandbox mode is toggled via `ORCID_SANDBOX=true` env var.
10. **Route protection** is handled by next-auth middleware (`src/middleware.ts`). All routes except `/login`, `/api/auth/*`, and static assets require authentication.

11. **LLM prompt architecture:** Each LLM prompt has two parts: (a) a markdown file in `prompts/` documenting the prompt design, validation rules, and implementation notes; (b) a TypeScript module in `src/lib/` (e.g., `profile-synthesis-prompt.ts`) providing functions to assemble the user message from input data, parse LLM output (handling code fences, trailing commas, deduplication), validate output against field requirements, and generate retry prompts when validation fails. The service layer in `src/services/` uses these modules to make the actual LLM API calls. The Anthropic SDK client is initialized as a singleton in `src/lib/anthropic.ts` (following the same pattern as Prisma in `src/lib/prisma.ts`) and injected into service functions for testability. Services handle the full LLM lifecycle: building messages, calling Claude, parsing/validating output, and retrying on validation failure per spec guidance.

12. **Profile pipeline orchestration** (`src/services/profile-pipeline.ts`): Coordinates the full ingestion pipeline. Takes `PrismaClient` and `Anthropic` client as injected dependencies for testability. Pipeline steps: (1) ORCID profile/grants/works fetched in parallel, (2) DOI-only works resolved to PMIDs via NCBI ID Converter, (3) PubMed abstracts batch-fetched, (4) PMC methods sections deep-mined with rate-limited batching, (5) Publication records stored (full refresh: delete-then-create), (6) SHA-256 abstracts hash computed for change detection, (7) LLM synthesis called, (8) ResearcherProfile created/updated with version bump. Inter-call NCBI rate limiting is enforced via delays (110ms with API key, 350ms without). PMC batching is done at the pipeline level (batch size 10 with delays) rather than relying on the client's internal batching. The pipeline exports helper functions (`extractLastName`, `computeAbstractsHash`, `parseUserSubmittedTexts`, `getNcbiDelayMs`) for unit testing.

13. **Testing with fake timers:** Pipeline tests use `jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync()` to avoid real delay waits. The pattern wraps `runProfilePipeline()` in a helper that advances timers by 10 seconds (enough to cover all NCBI delays). This makes the 30-test suite run in <0.3s instead of ~20s.

14. **Onboarding flow and pipeline progress tracking:** Pipeline progress is tracked via an in-memory status store (`src/lib/pipeline-status.ts`) keyed by userId, suitable for single-server pilot. The pipeline supports an `onProgress` callback in `PipelineOptions` that the API route uses to update status at each stage. API routes: `POST /api/onboarding/generate-profile` triggers the pipeline asynchronously (fire-and-forget), `GET /api/onboarding/profile-status` returns the current stage for UI polling. The home page (`src/app/page.tsx`) is a server component that checks for ResearcherProfile existence and redirects to `/onboarding` if none. The onboarding page (`src/app/onboarding/page.tsx`) is a client component that polls for status every 2 seconds and shows animated progress steps. On completion, the onboarding page redirects to `/onboarding/review` for profile review/editing.

15. **Profile API and review page:** `GET /api/profile` returns the authenticated user's researcher profile fields including `userSubmittedTexts`. `PUT /api/profile` validates and updates editable fields (researchSummary, techniques, experimentalModels, diseaseAreas, keyTargets, keywords) with the same constraints as LLM synthesis validation (150–250 word summary, ≥3 techniques, ≥1 disease area, ≥1 key target). PUT bumps `profileVersion` and updates `profileGeneratedAt`. The review page (`src/app/onboarding/review/page.tsx`) uses a TagInput component for array fields (add/remove chips) and a textarea for the research summary. Grant titles are displayed read-only. The "Looks Good" / "Save & Continue" button only calls PUT if the user made edits, avoiding unnecessary version bumps.

16. **Shared TagInput component:** `src/components/tag-input.tsx` is a reusable chip/tag list editor used by both the onboarding review page and the profile edit page. Supports add (Enter key or button), remove, case-insensitive duplicate prevention, and optional minimum item count validation.

17. **Profile edit page** (`src/app/profile/edit/page.tsx`): Standalone profile editing accessible from the main app home page after onboarding. Uses the same `PUT /api/profile` endpoint as onboarding review. Differences from onboarding: has back navigation to home, "Save Changes" / "Discard Changes" flow (instead of "Looks Good"), shows save success confirmation inline, and displays profile version metadata. Also includes a "Refresh Profile" button that triggers `POST /api/profile/refresh` to re-run the full pipeline (ORCID → PubMed → PMC → synthesis) and polls `GET /api/profile/refresh-status` for progress. The refresh button is disabled while the form has unsaved edits.

18. **React component testing:** Jest is configured with `jsx: "react-jsx"` override in `jest.config.ts` (overriding tsconfig's `jsx: "preserve"`) to support JSX transformation in tests. Component tests use `@jest-environment jsdom` directive, `@testing-library/react`, and `@testing-library/jest-dom`. Both packages plus `jest-environment-jsdom` are in devDependencies.

19. **User-submitted text management:** `GET/PUT /api/profile/submitted-texts` manages the JSONB array of user-submitted texts on ResearcherProfile. Validation: max 5 entries, each must have non-empty label and content, content max 2000 words. PUT replaces the entire array; timestamps are preserved for unchanged entries (matched by label+content). The management UI is at `/profile/submitted-texts` (add/edit/delete with inline forms, word counter, privacy notice). The profile edit page (`/profile/edit`) links to the submitted texts page with a "Manage" button showing the current count. Prisma JSONB fields require casting to `Prisma.InputJsonValue` when writing typed arrays. Re-synthesis trigger on text modification is deferred to the profile refresh task.

20. **Manual profile refresh:** `POST /api/profile/refresh` triggers a full pipeline re-run for users who already have a profile. Unlike the onboarding endpoint (which requires NO profile), this requires an existing profile. Uses the same `runProfilePipeline` and `pipeline-status` infrastructure as onboarding. `GET /api/profile/refresh-status` provides polling for refresh progress — unlike the onboarding status endpoint, it does NOT short-circuit when a profile exists in the database (since profile always exists during refresh), instead returning the actual in-memory pipeline status or `{ stage: "idle" }` when no refresh is running.

21. **React component testing with unstable router mock:** The `next/navigation` `useRouter()` mock returns a new object on every render, making the `router` reference unstable. If `router` is used as a `useCallback` dependency, the callback is recreated every render, potentially causing `useEffect` infinite loops. Keep `fetchProfile` inline in the useEffect (as the original pattern) rather than extracting it to a `useCallback` with `router` dependency. Use a separate `reloadProfile` callback (with no `router` dependency) for post-refresh profile reloading.

22. **Match pool management page:** `GET /api/match-pool` returns match pool entries with target user details (name, institution, department), affiliation selections, `totalCount`, and a cap of 200. `DELETE /api/match-pool/[entryId]` removes a single entry after ownership verification (returns 204). The management UI at `/match-pool/page.tsx` is a client component showing current pool entries with source badges, a stats bar with the 200-cap indicator, affiliation selection summary, entry removal with inline confirmation, and a contextual empty state. The page supports a `?onboarding=1` query parameter for the onboarding flow variant, which shows a different heading, requirement messaging, and a Continue button that is disabled until the pool is non-empty. The onboarding flow now routes: profile review → `/match-pool?onboarding=1` → home. The home page (`page.tsx`) enforces match pool setup by checking for both `MatchPoolEntry` and `AffiliationSelection` counts before allowing access. For Next.js 15 dynamic API routes with brackets (e.g., `[entryId]`), tests must live inside the bracketed directory's `__tests__/` folder since Jest can't resolve bracket paths from outside. The route handler receives `params` as a Promise (Next.js 15 convention).

23. **Match pool user search and individual selection:** `GET /api/match-pool/search?q=<query>` searches users by name or institution (case-insensitive, Prisma `contains` with `mode: "insensitive"`), excludes the current user, returns up to 20 results ordered by name, and includes profile preview data (researchSummary, techniques, diseaseAreas, keyTargets — never user-submitted texts per spec). Each result includes an `inMatchPool` boolean checked efficiently via a single batch query on the returned user IDs. `POST /api/match-pool/add` creates a MatchPoolEntry with `source: "individual_select"` after validating: auth, non-self, target exists, not duplicate (uses compound unique `userId_targetUserId`). The match pool page (`/match-pool`) integrates search with a debounced input (300ms), expandable profile previews, inline "Add"/"Added" state, and auto-refreshes the pool after additions.

24. **Affiliation selection and "all users" match pool selection:** `POST /api/match-pool/affiliation` creates an AffiliationSelection record and auto-generates MatchPoolEntry rows for all matching users. Supports two modes: (a) institution-based — requires `institution` (and optionally `department`), creates entries with `source: "affiliation_select"` using case-insensitive Prisma matching; (b) all-users — set `selectAll: true`, creates entries with `source: "all_users"` for every other user. Duplicate detection prevents creating the same selection twice (409). Uses `createMany` with `skipDuplicates: true` to handle users already individually selected. `DELETE /api/match-pool/affiliation/[affiliationId]` removes the selection and cascade-deletes all entries with the matching source, then re-creates entries for any remaining affiliation selections of the same type (handles overlapping selections). `GET /api/match-pool/institutions?q=<query>` and `GET /api/match-pool/departments?institution=<inst>&q=<query>` provide autocomplete suggestions (distinct values, max 20, case-insensitive contains). The match pool page UI (`/match-pool/page.tsx`) includes a collapsible affiliation form with institution/department autocomplete dropdowns, "add all users" checkbox, and inline remove buttons with confirmation on each active selection.

25. **Matching engine prompt:** `prompts/matching-engine.md` documents the prompt design. `src/lib/matching-engine-prompt.ts` provides the programmatic interface following the same pattern as profile synthesis: interfaces for input/output types (`ResearcherContext`, `MatchingInput`, `ProposalOutput`), `MATCHING_MODEL_CONFIG` (Claude Opus, 4096 max tokens, 0.5 temperature), `getMatchingSystemMessage()` returning the static system prompt (role, anti-genericity rules, output schema, 3 good + 3 bad few-shot examples — benefits from prompt caching across pairs), `buildMatchingUserMessage()` assembling per-pair context (both researcher profiles, all publication titles, up to 10 selected abstracts per researcher, existing proposals for de-duplication), `parseMatchingOutput()` parsing JSON array with code fence/trailing comma handling, `validateProposal()` checking all 13 required fields + valid confidence tier, and `filterValidProposals()` discarding invalid proposals while keeping valid ones. The LLM output uses PMIDs for anchoring publications; the service layer (not yet implemented) resolves these to internal Publication UUIDs. Abstract selection prioritizes last-author then first-author papers, sorted by recency, capped at 10 per researcher.

26. **Eligible pair computation:** `src/services/eligible-pairs.ts` implements `computeEligiblePairs(prisma, options?)` which determines which researcher pairs should receive collaboration proposals. Takes an injected PrismaClient for testability. Eligibility rules per spec: mutual selection → both `visible`; one-sided with `allow_incoming_proposals` → selector `visible`, other `pending_other_interest`; neither → skip. Filters out pairs already evaluated at the same profile versions via MatchingResult records. Both researchers must have a ResearcherProfile. Supports `forUserId` option to scope computation to pairs involving one user (for event-driven triggers). Uses `orderUserIds()` from `src/lib/utils.ts` to maintain the A < B UUID convention. Returns `EligiblePair[]` with ordered IDs, visibility states, and profile versions.

27. **Matching context assembly service:** `src/services/matching-context.ts` bridges eligible pair computation and the LLM prompt builder by fetching researcher data (User + ResearcherProfile + Publications) from the database and converting it to `MatchingInput` format. Provides `assembleContextForPair()` for single pairs and `assembleContextForPairs()` for batch processing with error reporting. Fetches existing CollaborationProposals for de-duplication context. Exports `parseUserSubmittedTexts()` (replicated from profile-pipeline.ts) to avoid circular dependencies between services. Uses injected PrismaClient for testability. Maps nullable `department` to optional field in `ResearcherContext`. Returns `BatchContextResult` containing both successful contexts and error details for failed pairs.

28. **Matching engine LLM call service:** `src/services/matching-engine.ts` provides two main functions: `generateProposalsForPair(client, pairContext, options?)` handles the full LLM call lifecycle for one researcher pair — builds messages via the prompt module, calls Claude with MATCHING_MODEL_CONFIG, parses JSON output, retries once on parse failure with stricter formatting, and validates/filters proposals using `filterValidProposals()`. Returns `ProposalGenerationResult` with validated proposals, discard count, attempt metadata. `storeProposalsAndResult(prisma, pairContext, generationResult)` stores validated proposals as `CollaborationProposal` records and creates a `MatchingResult` tracking record (with `proposals_generated` or `no_proposal` outcome). Resolves anchoring PMIDs to Publication UUIDs via batch lookup. Uses a database transaction for atomicity. Both functions take injected dependencies (Anthropic client, PrismaClient) for testability. The service follows the same pattern as `profile-synthesis.ts`. Error handling: `callClaudeWithRetry` wraps API calls with exponential backoff (base × 2^(attempt-1) + jitter) for transient errors (rate limits 429, server errors 5xx, timeouts, network errors). Non-retryable errors (auth 401, bad request 400) propagate immediately. `isRetryableError(error)` is exported for error classification. `GenerationOptions` supports `apiMaxRetries` (default 3) and `apiRetryBaseDelayMs` (default 1000, set to 0 in tests).

29. **Post-generation de-duplication:** `computeTextSimilarity(a, b)` in `src/lib/matching-engine-prompt.ts` computes Jaccard similarity on normalized word sets (lowercase, punctuation stripped), returning 0–1. `deduplicateProposals(proposals, existingProposals, threshold?)` filters out new proposals whose title OR scientific_question has Jaccard similarity >= threshold (default 0.5) with any existing proposal; when no existing proposals exist the function short-circuits as a no-op. De-duplication runs AFTER validation filtering on valid proposals only, and is integrated into `generateProposalsForPair()` in `src/services/matching-engine.ts`. The `ProposalGenerationResult` interface includes a `deduplicated` field tracking how many proposals were removed as duplicates.

30. **Job queue infrastructure:** `src/lib/job-queue.ts` provides the job queue abstraction. Defines 5 job payload types as a discriminated union (`generate_profile`, `run_matching`, `send_email`, `monthly_refresh`, `expand_match_pool`), a `JobQueue` interface, and an `InMemoryJobQueue` implementation for dev/pilot. The in-memory queue processes jobs sequentially (FIFO) in the same Node.js process, with configurable retry (default 3 attempts), exponential backoff between retries (`retryBaseDelayMs` default 1000ms, `retryMaxDelayMs` default 30000ms, formula: min(maxDelay, baseDelay × 2^(attempt-1)) + 0–25% jitter), and dead-lettering for exhausted jobs. Jobs have an optional `retryAfter` timestamp; `processNext` skips jobs whose backoff hasn't expired yet. Set `retryBaseDelayMs: 0` in tests to disable backoff delays. `getJobQueue()` returns a singleton (same global pattern as Prisma/Anthropic). The queue is created unstarted — call `start(handler)` to begin processing. `waitForIdle()` is available for tests. `createJobProcessor(deps)` in `src/worker/handlers.ts` is a factory that returns a `JobHandler` function dispatching by job type. Fully implemented handlers: `generate_profile` (calls `runProfilePipeline` with pipeline status tracking, try-catch with re-throw), `run_matching` (calls `computeEligiblePairs` → `assembleContextForPair` → `generateProposalsForPair` → `storeProposalsAndResult`; skips silently if pair is ineligible or already evaluated; wraps LLM/storage calls in try-catch that logs error with pair context and re-throws for queue retry). `send_email`, `monthly_refresh`, `expand_match_pool` log warnings and return (underlying services not yet built). `src/worker/index.ts` is the standalone worker entry point with graceful SIGTERM/SIGINT shutdown.

31. **Matching trigger functions:** `src/services/matching-triggers.ts` provides 4 centralized trigger functions that enqueue `run_matching` jobs on the in-memory queue: `triggerMatchingForNewPair` (single pair from individual add), `triggerMatchingForNewPairs` (batch from affiliation/all-users selection), `triggerMatchingForProfileUpdate` (all pairs involving a user after profile version bump), `triggerScheduledMatchingRun` (all globally eligible pairs for weekly scan). API routes call these as fire-and-forget with `.catch()` error handling so trigger failures never block the primary operation. Integrated into: `POST /api/match-pool/add`, `POST /api/match-pool/affiliation`, `PUT /api/profile`, `POST /api/profile/refresh` (in the pipeline completion callback). The existing `run_matching` handler in `src/worker/handlers.ts` checks eligibility before generating proposals. `triggerMatchingForProfileUpdate` deduplicates pairs from bidirectional match pool entries (A→B and B→A produce one job).

32. **Swipe queue API and page:** `GET /api/proposals` fetches the authenticated user's swipe queue — proposals where their visibility is `visible` and they haven't swiped yet, sorted by confidence tier (high → moderate → speculative) then recency. Each proposal is transformed to the user's perspective: `oneLineSummary` maps to `one_line_summary_a` or `_b`, and the collaborator is the OTHER researcher. `getUserSide()` in `src/lib/utils.ts` determines which side (A or B) the user is on. The `SwipeQueue` client component (`src/components/swipe-queue.tsx`) renders one card at a time with Interested (green) and Archive (gray) swipe action buttons and exports the `ProposalCard` and `ProposalDetailData` interfaces for reuse. The home page (`src/app/page.tsx`) is a server component that handles auth/profile/match-pool redirects, then renders `SwipeQueue` with a `hasMatchPool` prop for empty state differentiation.

33. **Proposal detail expansion:** `GET /api/proposals/[id]` returns the full detail view for a single proposal. Authorization requires the user to be researcher A or B on the proposal (403 otherwise). Returns all detail fields mapped to the user's perspective: `yourContributions`/`theirContributions` (from `labAContributions`/`labBContributions`), `yourBenefits`/`theirBenefits`, `scientificQuestion`, `detailedRationale`, `proposedFirstExperiment`. Resolves `anchoringPublicationIds` UUIDs to actual Publication records (pmid, title, journal, year, authorPosition). Includes the collaborator's public profile: researchSummary, techniques, experimentalModels, diseaseAreas, keyTargets, grantTitles, and publications (title/journal/year/pmid only — EXCLUDES userSubmittedTexts, keywords, and abstracts per spec). The `SwipeQueue` component integrates detail expansion via a "See details" / "Hide details" toggle on each summary card. Clicking "See details" renders the `ProposalDetailView` sub-component which fetches `/api/proposals/[id]` and displays all detail sections (scientific question callout, rationale, side-by-side contributions/benefits, first experiment, anchoring publications with PubMed links, and collaborator profile with tags). Detail view collapses automatically when navigating between cards. Tests live in `src/app/api/proposals/[id]/__tests__/route.test.ts` (per Next.js 15 bracket path convention).

34. **Swipe actions and match detection:** `POST /api/proposals/[id]/swipe` records swipe actions (interested or archive) with analytics (viewedDetail, timeSpentMs). Request body: `{ direction, viewedDetail, timeSpentMs? }`. The endpoint validates auth (401), proposal existence (404), user authorization as researcher A or B (403), duplicate swipe prevention (409), and body schema (400). For "interested" swipes: checks if the other party already swiped interested → creates `Match` record; checks if other user's visibility is `pending_other_interest` → flips to `visible`. For "archive" swipes: no visibility changes (per spec, `pending_other_interest` stays — the proposal is effectively dead). Returns `{ swipe, matched, matchId? }`. The `SwipeQueue` component tracks `viewedDetail` per card (marked when user expands detail view) and `timeSpentMs` (computed from when the card was first shown). After a swipe, the card is removed from the local queue, and a match banner appears briefly on mutual interest. Three distinct empty states: "Add colleagues" (no match pool), "Generating proposals" (match pool but no proposals on initial load), and "All caught up" (user swiped through all proposals in this session). Tests live in `src/app/api/proposals/[id]/swipe/__tests__/route.test.ts`.

35. **Archive tab and unarchive flow:** The home page (`src/app/page.tsx`) now uses `ProposalTabs` (`src/components/proposal-tabs.tsx`) — a client component with Queue/Archive tab navigation — instead of rendering `SwipeQueue` directly. `GET /api/proposals/archived` fetches the user's archived proposals by querying Swipe records with `direction: "archive"`, including embedded proposal data, sorted by most recently archived first. Returns the same user-perspective shape as the swipe queue (oneLineSummary mapped by side, collaborator info) plus an `archivedAt` timestamp. `POST /api/proposals/[id]/unarchive` moves an archived proposal back to "Interested": validates auth/authorization/existence, confirms the user has an archive swipe (400 if not), updates the swipe direction from "archive" to "interested", then runs the same match-check and visibility-flip logic as the initial swipe endpoint. The `ArchiveTab` component (`src/components/archive-tab.tsx`) displays archived proposals as a scrollable list, reuses `ProposalSummaryCard` and `ProposalDetailView` (both exported from `swipe-queue.tsx`), and provides a "Move to Interested" button per card. Empty state: "No archived proposals yet." Match banner appears on mutual interest from unarchive. Tests: `archived/__tests__/route.test.ts` (9 tests), `[id]/unarchive/__tests__/route.test.ts` (12 tests).

36. **Matches tab:** `GET /api/proposals/matches` fetches all mutual matches for the authenticated user by querying Match records whose associated proposal has the user as researcher A or B. Each match includes: full proposal detail mapped to user perspective (same fields as `GET /api/proposals/[id]`), both researchers' public profiles (researchSummary, techniques, experimentalModels, diseaseAreas, keyTargets, grantTitles, publications — EXCLUDES userSubmittedTexts and keywords per spec), and contact information governed by the collaborator's `emailVisibility` setting (`public_profile` or `mutual_matches` → show email; `never` → placeholder message). Anchoring publication IDs are resolved to Publication records. Matches are sorted by most recent first. Deleted accounts: profile is null but name/institution preserved. The `MatchesTab` component (`src/components/matches-tab.tsx`) renders matches as a scrollable list with inline detail expansion (no separate fetch — all data returned by the matches endpoint). Each match card shows: mutual match banner with date, contact info callout with "Reach out to [name]" prompt, proposal summary, and expandable full detail including both profiles. `ProposalTabs` (`src/components/proposal-tabs.tsx`) now has three tabs: Queue, Archive, Matches. Empty state: "No matches yet. Keep reviewing proposals!" Tests: `matches/__tests__/route.test.ts` (17 tests).

37. **Settings page and API:** `GET /api/settings` returns the authenticated user's six settings fields (emailVisibility, allowIncomingProposals, emailNotificationsEnabled, notifyMatches, notifyNewProposals, notifyProfileRefresh) via a `select` projection on the User table. `PUT /api/settings` accepts partial updates — any subset of the six fields can be sent, unknown fields are silently ignored. Validation: emailVisibility must be one of `public_profile`, `mutual_matches`, or `never`; boolean fields must be actual booleans (not strings); at least one valid field must be provided (422 otherwise). The settings page (`/app/settings/page.tsx`) is a client component with four sections: (1) Email Visibility — radio button group with descriptions for each option; (2) Allow Incoming Proposals — toggle switch with explanation; (3) Email Notifications — master switch that dims individual sub-toggles when off, plus three per-type toggles (match notifications, new proposals digest, profile refresh notifications); (4) Profile & Data — links to `/profile/submitted-texts` and `/profile/edit`. Per spec, turning off match notifications shows a confirmation modal: "Are you sure? You won't be notified when someone wants to collaborate with you." The home page header (`src/app/page.tsx`) includes a Settings link in the navigation bar. Tests: `settings/__tests__/route.test.ts` (17 tests), `settings/__tests__/page.test.tsx` (13 tests).

38. **Match pool cap enforcement:** `computeEligiblePairs()` in `src/services/eligible-pairs.ts` now enforces a per-user match pool cap (default 200, exported as `MATCH_POOL_CAP`). Before computing pairs, each user's entries are filtered by priority: (1) `individual_select` entries are always included regardless of cap, (2) `affiliation_select` and `all_users` entries are treated as "bulk" and randomly sampled to fill remaining slots up to the cap. Sampling uses a deterministic seeded PRNG (djb2 hash + xorshift32) keyed on `userId:cycleSeed`, where `cycleSeed` defaults to ISO year-week (e.g., `2026-W08`) for automatic weekly rotation per spec. Exported helpers: `capEntriesForUser()` (per-user cap logic), `seededSample()` (deterministic Fisher-Yates partial shuffle), `getWeekSeed()` (ISO week string). `EligiblePairOptions` now accepts `disableCap` (boolean), `cap` (override value), and `cycleSeed` (for deterministic testing). The API route `src/app/api/match-pool/route.ts` imports `MATCH_POOL_CAP` from the service module instead of defining its own constant. The cap operates on outgoing entries only — incoming pairs (where another user selected you) are subject to the originating user's cap, not yours.

39. **Monthly refresh job handler and candidate profile generation:** `monthly_refresh` jobs are now implemented in the worker (`src/worker/handlers.ts`) via `runMonthlyRefresh()` (`src/services/monthly-refresh.ts`). For each user: fetch ORCID works + grants, diff works against stored publications, fetch/augment only new publication metadata (PubMed + PMCID conversion + PMC methods), store new publications, run synthesis on the updated full publication set, compare candidate arrays (`techniques`, `experimental_models`, `disease_areas`, `key_targets`, `keywords`, `grant_titles`) against the current profile, and when changed store `pending_profile` + `pending_profile_created_at` and enqueue `send_email` with template `profile_refresh_candidate` (respecting `email_notifications_enabled` and `notify_profile_refresh`). Focused verification command: `source ~/.nvm/nvm.sh && npx jest src/services/__tests__/monthly-refresh.test.ts src/worker/__tests__/handlers.test.ts`.

40. **Match pool auto-expansion on new user join:** `src/services/match-pool-expansion.ts` exports `expandMatchPoolsForNewUser(prisma, newUserId)` which auto-adds a newly joined user to existing users' match pools. For each `AffiliationSelection` from other users: `selectAll=true` → entry with `source: "all_users"`; institution match (case-insensitive, optional department) → entry with `source: "affiliation_select"`. When a user has both selection types, `all_users` source takes precedence (one entry per user). Uses `createMany({ skipDuplicates: true })` to handle pre-existing individual selections. The `expand_match_pool` job is enqueued in `src/lib/auth.ts` during new user creation (fire-and-forget). The worker handler (`src/worker/handlers.ts`) calls the expansion service, then triggers `triggerMatchingForNewPairs` for each affected user so proposals are generated for the new pairs. Focused verification command: `source ~/.nvm/nvm.sh && npx jest src/services/__tests__/match-pool-expansion.test.ts src/worker/__tests__/handlers.test.ts`.

## Specifications

All specs are in the `specs/` directory. READ THEM before making changes:
- `specs/data-model.md` — Database entities and relationships
- `specs/auth-and-user-management.md` — Auth, signup, profile management, match pools
- `specs/profile-ingestion.md` — Publication fetching and profile synthesis pipeline
- `specs/matching-engine.md` — Collaboration proposal generation
- `specs/swipe-interface.md` — Swipe UI, matching flow, archive, surveys
- `specs/notifications.md` — Email notifications
- `specs/tech-stack.md` — Infrastructure and deployment
