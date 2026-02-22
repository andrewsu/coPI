# Data Model Specification

## Overview

CoPI uses PostgreSQL with Prisma ORM. Structured profile fields use Postgres array columns or JSONB where appropriate. All entities use UUID primary keys.

## Entities

### User

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| email | string | Unique, from ORCID OAuth |
| name | string | From ORCID |
| institution | string | From ORCID or user-provided |
| department | string | Optional |
| orcid | string | Unique, required (ORCID OAuth is the only auth method) |
| allow_incoming_proposals | boolean | Default false. When true, user can receive proposals from people outside their match pool who selected them. |
| email_visibility | enum: public_profile, mutual_matches, never | Default: mutual_matches. Controls who can see the user's email address. |
| email_notifications_enabled | boolean | Default true |
| notify_matches | boolean | Default true |
| notify_new_proposals | boolean | Default true |
| notify_profile_refresh | boolean | Default true |
| created_at | timestamp | |
| updated_at | timestamp | |

### ResearcherProfile

One per user. Contains both LLM-synthesized fields and user-submitted content.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | FK → User | Unique |
| research_summary | text | 150-250 word narrative synthesized by LLM |
| techniques | text[] | Array of strings, lowercase |
| experimental_models | text[] | Array of strings, lowercase |
| disease_areas | text[] | Array of strings |
| key_targets | text[] | Array of strings |
| keywords | text[] | Array of strings |
| grant_titles | text[] | Array of strings, from ORCID |
| user_submitted_texts | jsonb | Array of objects: [{label: string, content: text, submitted_at: timestamp}]. Max 5 entries, each max 2000 words. |
| profile_version | integer | Increments on each regeneration or manual edit |
| profile_generated_at | timestamp | When the LLM last synthesized this profile |
| raw_abstracts_hash | string | Hash of source data to detect changes without re-running pipeline |
| created_at | timestamp | |
| updated_at | timestamp | |

**User-submitted text visibility rule:** User-submitted texts are NEVER shown to other users. They are used as input to profile synthesis and the matching engine only. The matching engine prompt must not quote or directly reference user-submitted text in proposals.

**Direct editing:** Users can directly edit all synthesized fields (research_summary, techniques, experimental_models, disease_areas, key_targets, keywords). Manual edits overwrite the current values and bump profile_version. When the monthly refresh pipeline runs and detects new publications, it generates a candidate profile. If any array fields differ from the current profile, the user is notified and shown a side-by-side comparison. They can accept, edit, or dismiss the candidate.

**Pending profile updates:** When the refresh pipeline generates a candidate that differs from the current profile:

| Field | Type | Notes |
|---|---|---|
| pending_profile | jsonb | Nullable. Holds candidate synthesized fields until user accepts/dismisses. |
| pending_profile_created_at | timestamp | Nullable. |

If the user ignores the notification for 30 days, auto-dismiss and retry next month.

### Publication

Many per user. Individual publication records enable the matching engine to anchor proposals to specific papers.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | FK → User | |
| pmid | string | Nullable |
| pmcid | string | Nullable |
| doi | string | Nullable |
| title | text | |
| abstract | text | |
| journal | string | |
| year | integer | |
| author_position | enum: first, last, middle | |
| methods_text | text | Nullable. Populated by deep mining from PMC. |
| created_at | timestamp | |

### MatchPoolEntry

Each row represents "User A wants to see collaboration proposals with User B."

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | FK → User | The person who selected |
| target_user_id | FK → User | The person they selected |
| source | enum: individual_select, affiliation_select, all_users | How this entry was created |
| created_at | timestamp | |

Unique constraint on (user_id, target_user_id).

**Dynamic expansion:** When source is `affiliation_select` or `all_users`, new users matching the criteria are automatically added as MatchPoolEntry rows when they join. The system stores the affiliation selection criteria separately (see AffiliationSelection below) to enable this expansion.

**Match pool cap:** Each user's effective match pool is capped at 200 users per matching cycle. Priority ordering when the pool exceeds 200:
1. Individually selected users (always included)
2. Users who selected this user and this user allows incoming proposals
3. Affiliation/all-users selections (randomly sampled if still over cap, rotating across cycles)

### AffiliationSelection

Stores the criteria for affiliation-based match pool selections so new users can be auto-added.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | FK → User | The person who set up this selection |
| institution | string | Nullable. Match all users at this institution. |
| department | string | Nullable. Further filter by department. |
| select_all | boolean | Default false. If true, match all users on platform. |
| created_at | timestamp | |

### CollaborationProposal

Generated by the matching engine. Multiple proposals can exist for the same pair of researchers if they address distinct collaboration angles.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| researcher_a_id | FK → User | Convention: a_id < b_id by UUID sort |
| researcher_b_id | FK → User | |
| title | string | Short name for the collaboration |
| collaboration_type | string | e.g., "mechanistic extension", "methodological enhancement", "translational application" |
| scientific_question | text | The core question this collaboration addresses |
| one_line_summary_a | text | Tailored to researcher A's perspective |
| one_line_summary_b | text | Tailored to researcher B's perspective |
| detailed_rationale | text | Shared, 2-3 paragraphs |
| lab_a_contributions | text | What lab A brings |
| lab_b_contributions | text | What lab B brings |
| lab_a_benefits | text | What lab A gets out of it |
| lab_b_benefits | text | What lab B gets out of it |
| proposed_first_experiment | text | Concrete pilot with roles for each lab |
| anchoring_publication_ids | uuid[] | Array of FK → Publication. Nullable. Can reference papers from either side. |
| confidence_tier | enum: high, moderate, speculative | LLM self-assessment of proposal quality |
| llm_reasoning | text | Internal reasoning, stored for learning. Not displayed to users. |
| llm_model | string | Which model generated this proposal |
| visibility_a | enum: visible, pending_other_interest, hidden | |
| visibility_b | enum: visible, pending_other_interest, hidden | |
| profile_version_a | integer | Researcher A's profile_version at generation time |
| profile_version_b | integer | Researcher B's profile_version at generation time |
| is_updated | boolean | Default false. True if this replaces a previous proposal for the same pair and angle. |
| created_at | timestamp | |

**Visibility logic:**
- Mutual selection (both in each other's match pool) → both `visible`
- A selected B, B allows incoming but didn't select A → A is `visible`, B is `pending_other_interest`. When A swipes interested, B flips to `visible`.
- A selected B, B doesn't allow incoming and didn't select A → proposal not generated

**Ordering convention:** researcher_a_id < researcher_b_id by UUID sort order. A helper function `get_user_side(user_id, proposal)` returns `a` or `b`.

### Swipe

One per user per proposal.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | FK → User | |
| proposal_id | FK → CollaborationProposal | |
| direction | enum: interested, archive | "interested" = right swipe, "archive" = left swipe |
| viewed_detail | boolean | Did they expand the full rationale before swiping? |
| time_spent_ms | integer | Optional. How long the card was visible before swipe. |
| created_at | timestamp | |

Unique constraint on (user_id, proposal_id).

Users can later change an archived proposal to "interested" from the archive tab. This triggers the same match-check logic as an initial interested swipe.

### Match

Created when both parties swipe interested on the same proposal.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| proposal_id | FK → CollaborationProposal | |
| notification_sent_a | boolean | |
| notification_sent_b | boolean | |
| matched_at | timestamp | |

### MatchingResult

Tracks which pairs have been evaluated to avoid redundant LLM calls.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| researcher_a_id | FK → User | |
| researcher_b_id | FK → User | |
| outcome | enum: proposals_generated, no_proposal | |
| profile_version_a | integer | Profile version at evaluation time |
| profile_version_b | integer | Profile version at evaluation time |
| evaluated_at | timestamp | |

Re-evaluate only when either profile_version has incremented since last evaluation.

### SurveyResponse

Periodic feedback on proposal quality.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | FK → User | |
| failure_modes | text[] | Multi-select from: scientifically_nonsensical, scientifically_uninteresting, lack_of_synergy, experiment_too_large, too_generic, already_pursuing_similar, other |
| free_text | text | Optional |
| created_at | timestamp | |

Survey pops up after every Nth archive action (configurable, default: 5).

## Account Deletion

When a user deletes their account:
- **Deleted:** profile, publications, user-submitted texts, swipe history, match pool entries, affiliation selections, survey responses
- **Preserved:** CollaborationProposals where the other party swiped "interested". Name and institution retained on the proposal. Banner displayed: "The other researcher has deleted their account." Profile details and contact info removed.
- **Terms of use** disclose this behavior. User can email to request full scrub.

## Seeded Profiles

Admin can create profiles by providing a list of ORCID IDs. This creates a User record and runs the profile pipeline, but no OAuth session exists. When the researcher later logs in via ORCID OAuth, they claim the existing account. Seeded profiles are visible in the match pool browser. Proposals involving seeded-but-unclaimed users are generated but the unclaimed user's visibility is `pending_other_interest` until they claim their account.
