# Fix Plan — CoPI Development

## Phase 1: Foundation

- [x] Initialize Next.js project with TypeScript and Tailwind CSS
- [x] Set up Docker Compose with PostgreSQL
- [x] Define Prisma schema matching specs/data-model.md
- [x] Run initial migration
- [x] Set up ESLint and TypeScript strict mode
- [x] Create .env.example with all required environment variables
- [x] Set up basic project structure (app/, components/, lib/, services/, worker/)

## Phase 2: Authentication

- [x] Configure ORCID OAuth 2.0 (using next-auth or custom)
- [x] Implement login page with "Sign in with ORCID" button
- [x] Handle first-time login (create User record from ORCID data)
- [x] Handle returning login (match existing User by ORCID ID)
- [x] Handle seeded profile claiming (match seeded User record)
- [x] Implement session management with secure cookies
- [x] Protect all routes except login

## Phase 3: Profile Pipeline

- [x] Implement ORCID API client (fetch profile, grants, works)
- [ ] Implement PubMed API client (fetch abstracts by PMID, batch)
- [ ] Implement PMC client for deep mining (methods section extraction)
- [ ] Implement NCBI ID converter client (PMID ↔ PMCID)
- [ ] Build profile synthesis LLM prompt (store in prompts/profile-synthesis.md)
- [ ] Implement profile synthesis service (assemble context, call Claude, parse output)
- [ ] Implement profile validation (word count, minimum fields)
- [ ] Implement full pipeline orchestration (ORCID → PubMed → synthesis → store)
- [ ] Build onboarding UI: profile generation progress indicator
- [ ] Build onboarding UI: profile review/edit page
- [ ] Build profile edit page (direct editing of all synthesized fields)
- [ ] Build user-submitted text management UI (add/edit/delete, max 5)
- [ ] Implement profile refresh (manual trigger)
- [ ] Implement monthly refresh cron job (detect new publications, generate candidate, notify)
- [ ] Build side-by-side profile comparison UI for refresh candidates

## Phase 4: Match Pool

- [ ] Build match pool management page
- [ ] Implement user search (by name, institution)
- [ ] Implement profile preview in search results (excluding user-submitted texts)
- [ ] Implement individual user selection (add/remove from match pool)
- [ ] Implement affiliation selection (institution/department filter, dynamic expansion)
- [ ] Implement "all users" selection (dynamic expansion)
- [ ] Implement match pool cap logic (200 cap, priority ordering)
- [ ] Store AffiliationSelection records
- [ ] Auto-expand match pools when new users join (check affiliation selections and all-users flags)
- [ ] Build match pool view (show who's in it, how added, remove option)
- [ ] Enforce match pool setup as required step before showing main app

## Phase 5: Matching Engine

- [ ] Build matching engine LLM prompt with few-shot examples (store in prompts/matching-engine.md)
- [ ] Implement eligible pair computation (mutual selection + incoming logic)
- [ ] Implement visibility assignment logic
- [ ] Implement context assembly per pair (profiles, abstracts, existing proposals)
- [ ] Implement abstract selection (up to 10 per researcher, prioritized by author position/recency/type)
- [ ] Implement LLM call with structured JSON output parsing
- [ ] Implement output validation (required fields, discard invalid)
- [ ] Implement de-duplication against existing proposals
- [ ] Implement MatchingResult tracking (avoid redundant evaluations)
- [ ] Implement job queue integration (SQS or in-process for dev)
- [ ] Implement matching triggers (match pool change, profile update, scheduled)
- [ ] Implement error handling and retry logic

## Phase 6: Swipe Interface

- [ ] Build swipe queue page with card UI
- [ ] Implement summary card (collaborator info, type, one-line summary, confidence indicator)
- [ ] Implement detail expansion (rationale, contributions, benefits, first experiment, publications)
- [ ] Implement "Interested" swipe action with match detection
- [ ] Implement "Archive" swipe action
- [ ] Implement visibility state transitions (pending_other_interest → visible on interested swipe)
- [ ] Build archive tab (view archived proposals, move back to interested)
- [ ] Build matches tab (full proposal, profiles, contact info per email_visibility setting)
- [ ] Implement empty states for all tabs
- [ ] Implement periodic survey (every Nth archive, multi-select failure modes)
- [ ] Track swipe analytics (viewed_detail, time_spent_ms)

## Phase 7: Notifications

- [ ] Set up AWS SES email sending
- [ ] Implement match notification email (immediate)
- [ ] Implement new proposals digest email (weekly batch)
- [ ] Implement profile refresh notification email
- [ ] Implement unclaimed profile recruitment email (with rate limiting)
- [ ] Implement user-facing invite template for unclaimed profiles
- [ ] Build notification preferences in settings
- [ ] Implement unsubscribe link handling

## Phase 8: Admin and Settings

- [ ] Build settings page (email visibility, incoming proposals toggle, notification prefs)
- [ ] Implement account deletion (with proposal preservation logic)
- [ ] Build admin CLI or panel for seeding profiles by ORCID ID list
- [ ] Implement seeded profile pipeline (create user + run pipeline without OAuth)

## Phase 9: Deployment

- [ ] Create Dockerfile for the app
- [ ] Create Docker Compose for production (app + worker + postgres)
- [ ] Configure HTTPS (Let's Encrypt)
- [ ] Set up DNS for copi.sulab.org
- [ ] Deploy to EC2 instance
- [ ] Configure environment variables
- [ ] Set up CloudWatch logging
- [ ] Create health check endpoint
- [ ] Test full flow end-to-end on deployed instance

## Notes

- Phases can overlap. Phase 1-2 are prerequisites for everything else.
- Phase 3 and 4 can be developed in parallel.
- Phase 5 depends on Phase 3 (profiles) and Phase 4 (match pools).
- Phase 6 depends on Phase 5 (proposals to display).
- Phase 7 can be partially developed in parallel with Phase 6.
