# Notifications Specification

## Overview

CoPI uses email notifications to pull users back to the app. For the pilot, email is the only notification channel. In-app indicators (badge counts) can be added later.

## Notification Types

### 1. Match Notification

**Trigger:** Both parties swipe interested on the same proposal.

**Timing:** Sent immediately (within minutes of the second swipe).

**Subject:** "Mutual interest with Dr. [Name] on a collaboration idea"

**Body:**
- Tailored one-line summary of the proposal
- "Both you and Dr. [Name] expressed interest in this collaboration."
- Contact info based on the OTHER user's email_visibility setting:
  - `public_profile` or `mutual_matches`: include their email address
  - `never`: "Dr. [Name] prefers not to share their email directly. You may reach them through their institutional directory."
- Name, institution, department of the matched researcher
- Link to the full proposal in the app
- "We suggest reaching out to start the conversation."

**Tone:** Warm introduction, not a system alert. Keep it short — the goal is to get them to email each other.

**Respects:** notify_matches user setting.

### 2. New Proposals Available

**Trigger:** Matching engine generates new proposals where the user's visibility is `visible`.

**Timing:** Batched. At most one email per week. Accumulates proposals across multiple engine runs. Sent on a configurable day (default: Monday morning).

**Subject:** "You have [N] new collaboration suggestions"

**Body:**
- Count of new proposals since last digest
- Preview of the highest-confidence proposal (title + one-line summary)
- Link to the swipe queue
- "Review your latest collaboration ideas"

**Note:** Proposals unlocked via the `pending_other_interest → visible` transition (incoming proposals) are folded into this digest with no special treatment. The user does not know which proposals were triggered by someone else's interest.

**Respects:** notify_new_proposals user setting.

### 3. Profile Refresh Candidate

**Trigger:** Monthly publication check finds new works AND the candidate profile has different array fields than the current profile.

**Timing:** Sent when candidate is ready. No batching.

**Subject:** "We found new publications — review your updated profile"

**Body:**
- List of new publication titles found
- "Your research profile may need updating based on these publications."
- Link to side-by-side comparison in the app
- "Review and accept your updated profile, or dismiss to keep your current one."

**Respects:** notify_profile_refresh user setting.

### 4. Unclaimed Profile Recruitment

**Trigger:** A user swipes "interested" on a proposal involving a seeded-but-unclaimed researcher.

**Timing:** Sent within a day of the trigger.

**Subject:** "A collaboration opportunity in [topic area]"

**Body:**
- "Based on your published research, a potential collaboration has been identified involving [one-line topic from proposal title or scientific_question]."
- "A researcher has expressed interest in exploring this with you."
- Does NOT reveal who the interested researcher is
- "Claim your profile to see the full proposal and explore collaboration opportunities."
- Link to sign up / claim profile
- Brief explanation of what CoPI is (1-2 sentences)

**Rate limiting:**
- Max one system email per unclaimed user per week
- After 3 emails with no action, stop emailing that user entirely
- Multiple interested swipes from different users within the same week do not trigger additional emails

**Additionally:** The user who swiped interested is shown: "Dr. [B] hasn't joined yet. Want to invite them?" with a pre-filled email template they can copy/send directly.

## Email Infrastructure

AWS SES for the pilot. Simple HTML emails with inline styles. No template engine needed initially.

### Sender Configuration

- From: notifications@copi.science (or noreply@copi.science)
- Reply-to: noreply@copi.science (reply-to should NOT go to the matched researcher)

### Unsubscribe

Every email includes an unsubscribe link. Users can also configure notification preferences in app settings:
- Email notifications on/off (master switch)
- Match notifications: on/off (default: on)
- New proposals digest: on/off (default: on)
- Profile refresh notifications: on/off (default: on)

Match notifications should have a confirmation if turning off: "Are you sure? You won't be notified when someone wants to collaborate with you."

## Timing Summary

| Notification | Timing | Max Frequency |
|---|---|---|
| Match | Immediate | No limit (each match is unique) |
| New proposals digest | Batched weekly | Once per week |
| Profile refresh | When ready | Once per month (tied to publication check) |
| Recruitment (unclaimed) | Within 1 day | Once per week per unclaimed user, max 3 total |
