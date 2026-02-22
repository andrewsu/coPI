# Swipe Interface and Matching Flow Specification

## Overview

The swipe interface is how users evaluate collaboration proposals. Quick binary decisions on a summary view, with optional detail expansion. Target: a researcher should be able to review 10 proposals in 5 minutes.

## Swipe Queue

When a user opens the app, they see a queue of proposals where their visibility is `visible`.

### Queue Ordering

1. High confidence proposals first, then moderate, then speculative
2. Within a confidence tier, most recent proposals first
3. Proposals marked `is_updated` (regenerated versions of previously archived proposals) are labeled "Updated proposal"

No indication is given about whether the other party has already swiped. This avoids biasing the user's decision.

## The Card — Summary View

Visible at a glance, scannable in 10-15 seconds:

- **Collaborator name**, institution, department
- **Collaboration type** label (e.g., "Mechanistic Extension", "Methodological Enhancement")
- **Tailored one-line summary** (`one_line_summary_a` or `_b` depending on which side the user is)
- **Confidence tier** as a subtle visual indicator (color or icon, not a number)
- **"See details" button**
- **"Updated proposal" badge** if `is_updated` is true

That's all. No contributions, no first experiment, no rationale on the summary card.

## The Card — Detail View

User taps "See details" and the card expands or transitions to a detail page:

- Everything from the summary view
- **Scientific question**
- **Detailed rationale** (2-3 paragraph shared narrative)
- **What you bring** / **What they bring** (contributions from each lab)
- **What you gain** / **What they gain** (benefits for each lab)
- **Proposed first experiment** (concrete pilot with roles)
- **Anchoring publications** (linked to PubMed via PMIDs)
- **Collaborator's public profile:** research summary, techniques, experimental models, disease areas, key targets, grant titles, publication titles
  - EXCLUDES: user-submitted texts, keywords, raw abstracts

The detail view should be readable in 1-2 minutes.

## Swipe Actions

- **"Interested"** (swipe right / green button): "I'd like to discuss this"
- **"Archive"** (swipe left / gray button): moves to archive, reviewable later

No skip button. No "maybe." If the user isn't ready to decide, they close the app — the queue persists.

## What Happens After Each Action

### Interested (right swipe)

1. Record Swipe entity: direction=interested, viewed_detail, time_spent_ms
2. Check: has the other party already swiped interested on this proposal?
   - **Yes** → Create Match, trigger match notifications for both parties
   - **No** → No immediate action
3. Check: is the other user's visibility `pending_other_interest`?
   - **Yes** → Flip to `visible`. This proposal now appears in the other user's swipe queue. Include in their next "new proposals" batch email.
   - **No** → No change needed
4. Show next card

### Archive (left swipe)

1. Record Swipe entity: direction=archive, viewed_detail, time_spent_ms
2. Proposal moves to the user's archive tab
3. If the other user's visibility is `pending_other_interest`, it stays that way — the proposal is effectively dead since this user archived it. The other user will never see it.
4. Show next card

### Match Created

When both users swipe interested on the same proposal:

1. Create Match entity with matched_at = now
2. Send match notification emails to both parties (see notifications spec)
3. Proposal moves from swipe queue to "Matches" tab for both users

## Archive Tab

- Shows all archived proposals
- Sorted by most recently archived
- User can tap to expand details (same detail view as swipe queue)
- User can move a proposal from archive back to "Interested"
  - This triggers the same match-check logic as an initial interested swipe
  - If the other party had already swiped interested, a match is created immediately

## Matches Tab

Shows all mutual matches. For each match:

- The full collaboration proposal (all fields from detail view)
- Both researchers' public profiles (research summary, techniques, models, disease areas, key targets, grant titles, publications)
- Contact information based on each user's email_visibility setting:
  - If the matched user's setting is `public_profile` or `mutual_matches`: show their email
  - If `never`: show "This researcher prefers not to share their email. You may reach them through their institutional directory."
- A prompt: "Reach out to [name] to discuss this collaboration"
- **EXCLUDES:** user-submitted texts from either party

If the other researcher has deleted their account: show banner "The other researcher has deleted their account." Name and institution preserved, but profile details and contact info removed.

## Empty States

| State | Message |
|---|---|
| No proposals, profile complete, match pool populated | "We're generating collaboration proposals for you. Check back soon." |
| No proposals, no match pool entries | "Add colleagues to your network to start seeing collaboration proposals." |
| No proposals, profile incomplete | "Complete your profile to enable collaboration matching." |
| All proposals reviewed | "You've reviewed all current proposals. We'll notify you when new ones are available." |
| Archive empty | "No archived proposals yet." |
| Matches empty | "No matches yet. Keep reviewing proposals!" |

## Periodic Survey

After every Nth archive action (configurable, default: 5), a lightweight survey pops up.

**Question:** "What's the most common issue you've seen in recent proposals?"

**Options (multi-select):**
- Scientifically nonsensical
- Scientifically uninteresting
- Lack of synergy between labs
- Initial experiment is too large/complex
- Too generic / not specific enough
- Already pursuing something similar
- Other (optional free text)

Stored as a SurveyResponse with timestamp and user_id. Used for aggregate analysis of proposal quality, not per-proposal feedback.

## Updated Proposals

When a researcher's profile is regenerated and the matching engine produces new proposals for an existing pair:
- If the user previously archived a proposal for this pair on a similar topic, the new proposal is marked `is_updated = true`
- It appears in the swipe queue with an "Updated proposal" badge
- The user sees it as a fresh card to evaluate

## Analytics (Stored, Not Displayed)

For each swipe, record:
- `viewed_detail`: did they expand before swiping?
- `time_spent_ms`: how long the card was visible

These feed future learning:
- Consistently archiving without viewing details → summaries aren't compelling
- Viewing details then archiving → detailed rationale isn't convincing
- High interested rate on high-confidence proposals → confidence tiers are calibrated well
