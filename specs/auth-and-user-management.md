# Auth and User Management Specification

## Authentication

CoPI uses ORCID OAuth exclusively. No email/password authentication. ORCID cannot be unlinked.

### ORCID OAuth Flow

1. User clicks "Sign in with ORCID"
2. Redirect to ORCID OAuth authorization endpoint
3. User authenticates on ORCID
4. ORCID redirects back with authorization code
5. Backend exchanges code for access token
6. Backend fetches user's ORCID ID, name, and email from ORCID API
7. If ORCID ID matches an existing User record → log in (handles seeded profile claiming)
8. If no matching User record → create new account

### Session Management

Standard session-based auth with secure HTTP-only cookies. Sessions expire after 30 days of inactivity.

## Signup Flow

Account creation happens automatically on first ORCID login:

1. **ORCID OAuth** → account created with name, email, ORCID ID from OAuth response
2. **Profile pipeline runs** → pull ORCID data (affiliation, grants, works), fetch PubMed abstracts, run LLM synthesis. Show progress indicator: "Pulling your publications... Analyzing your research... Building your profile..."
3. **Review generated profile** → user sees their synthesized research summary, techniques, models, disease areas, key targets. User can edit any field directly.
4. **Build match pool (required)** → user must add at least one person or selection before proceeding. The app should not show proposals, matches, or any other content until the match pool has entries. If the user wants to pause and come back later, that's fine — they just see a prompt to complete this step.
5. **Optional settings** → toggle allow_incoming_proposals, add user-submitted texts, set email visibility preference

### Seeded Profile Claiming

When a user logs in with ORCID and their ORCID ID matches a seeded profile:
- The existing User record is linked to their OAuth session
- Their profile is already generated — show it for review/editing
- Proceed to match pool setup (step 4)
- Any proposals with visibility `pending_other_interest` are evaluated for potential visibility changes

## Profile Management

### Viewing and Editing

Users can view and directly edit all profile fields:
- Research summary (text area)
- Techniques (editable tag list)
- Experimental models (editable tag list)
- Disease areas (editable tag list)
- Key targets (editable tag list)
- Keywords (editable tag list)
- Grant titles (from ORCID, displayed but not directly editable — user should update on ORCID)

Edits save immediately and bump `profile_version`. The matching engine will re-evaluate pairs involving this user on the next cycle.

### User-Submitted Texts

Users can add up to 5 text submissions, each max 2000 words. Each has:
- A label (user-provided, e.g., "R01 specific aims", "current research interests", "equipment and resources")
- Content (free text)

Users can add, replace, and delete submissions. Adding or modifying submissions triggers profile re-synthesis (the user is notified and can accept/edit/dismiss the new profile, same as the publication refresh flow).

**Privacy:** User-submitted texts are NEVER shown to other users. They inform profile synthesis and the matching engine but are not exposed in any user-facing view except to the submitting user.

### Profile Refresh

**Manual:** User can click "Refresh profile" to re-run the full pipeline (fetch ORCID data, fetch publications, re-synthesize).

**Automatic (monthly):**
1. Cron job re-fetches ORCID works for all users
2. Diffs against stored publications
3. If new publications found: runs synthesis pipeline to generate candidate profile
4. Compares candidate profile arrays (techniques, experimental_models, disease_areas, key_targets, keywords, grant_titles) against current profile
5. If any array changed: notifies user via email ("We found new publications! Review your updated profile"), stores candidate as `pending_profile`
6. If no arrays changed: stores new publications but does not bother user
7. User sees side-by-side comparison of current vs candidate profile, can accept as-is, edit before saving, or dismiss
8. If ignored for 30 days: auto-dismiss, retry next month
9. Refresh frequency is configurable (default: monthly)

## Match Pool Management

### Adding to Match Pool

Three methods:

1. **Individual selection** — search for users by name, institution, or email. Shows profile preview (research summary, techniques, disease areas — but NOT user-submitted texts). Click to add. Creates a MatchPoolEntry with source=individual_select.

2. **Affiliation selection** — select an institution and optionally a department. Adds all current users matching that criteria. Creates an AffiliationSelection record and MatchPoolEntry rows for all current matches with source=affiliation_select. When new users join matching the criteria, MatchPoolEntry rows are auto-created.

3. **All users** — adds all current users. Creates an AffiliationSelection record with select_all=true and MatchPoolEntry rows for all current users with source=all_users. New users auto-added on join.

### Match Pool Cap

Effective match pool is capped at 200 users per matching cycle. Priority when over cap:
1. Individually selected users (always included)
2. Incoming (users who selected this user, where this user allows incoming)
3. Affiliation/all-users selections (randomly sampled with rotation across cycles)

If over cap, display: "Your match pool includes [N] researchers. We'll evaluate up to 200 collaboration opportunities per cycle, prioritizing researchers you individually selected."

### Removing from Match Pool

- Remove individual users
- Remove affiliation selections (removes all auto-added entries from that selection)
- Removing someone from the match pool hides (not deletes) any pending proposals involving that pair

### Viewing Match Pool

Shows all users in the match pool with:
- Name, institution, department
- How they were added (individual, affiliation, all users)
- Option to view their profile (excluding user-submitted texts)

## Settings

- Email visibility: public_profile | mutual_matches | never
- Allow incoming proposals: on/off
- Email notification preferences: match notifications, new proposal digest, profile refresh notifications (each on/off independently)
- Manage user-submitted texts
- Request profile refresh
- Delete account

## Account Deletion

See data-model.md for deletion behavior. The settings page should:
1. Explain what will be deleted and what will be preserved
2. Require confirmation
3. Note that they can email to request full scrub of preserved data

## Admin Functions

### Seed Profiles

Admin provides a list of ORCID IDs (via admin panel or CLI tool). For each:
1. Create User record with ORCID ID, name, and affiliation from ORCID API
2. Run full profile pipeline
3. Profile is visible in match pool browser
4. No OAuth session — user claims on first login

### Invite/Recruitment

When a user swipes "interested" on a proposal involving a seeded-but-unclaimed user:
1. Show user A: "Dr. [B] hasn't joined yet. Want to invite them?" with a pre-filled email template they can copy/send
2. System sends B a notification email: "A researcher at [institution] is interested in collaborating with you on [one-line topic description]. Sign up to see the details." (Does not reveal A's identity)
3. Rate-limited: max one system email per unclaimed user per week. After 3 emails with no action, stop emailing.
4. When B claims their account, pending proposals are evaluated for visibility changes
