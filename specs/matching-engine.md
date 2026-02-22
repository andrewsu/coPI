# Matching Engine Specification

## Overview

The matching engine is a background process that generates collaboration proposals for eligible researcher pairs. It uses Claude Opus to analyze two researcher profiles and propose specific, synergistic collaborations with concrete first experiments.

## When Does It Run?

| Trigger | Scope |
|---|---|
| User adds someone to match pool | Generate proposals for that new pair only |
| User's profile is regenerated (version bump) | Re-evaluate all pairs involving that user |
| New user joins and gets added to others' match pools | Generate proposals for new pairs |
| Weekly scheduled run | Catch any missed pairs (configurable frequency) |

The engine does NOT re-run for pairs that already have active proposals unless a profile has been regenerated since the last proposal was created (detected via profile_version comparison against MatchingResult records).

## Eligible Pair Computation

For a pair (A, B), generate proposals if ANY of:
- A has B in their match pool AND B has A in their match pool (mutual selection)
- A has B in their match pool AND B.allow_incoming_proposals = true
- B has A in their match pool AND A.allow_incoming_proposals = true

Otherwise, skip.

### Visibility Assignment

| Scenario | A's visibility | B's visibility |
|---|---|---|
| Mutual selection | visible | visible |
| A selected B, B allows incoming but didn't select A | visible | pending_other_interest |
| B selected A, A allows incoming but didn't select B | pending_other_interest | visible |

When a user with `pending_other_interest` visibility has the other party swipe "interested," their visibility flips to `visible`.

## Input Context Per Pair

The engine assembles a context package for each pair:

```
=== Researcher A ===
Name: [name]
Institution: [institution]
Department: [department]

Research Summary:
[research_summary]

Techniques: [comma-separated list]
Experimental Models: [comma-separated list]
Disease Areas: [comma-separated list]
Key Targets: [comma-separated list]
Keywords: [comma-separated list]
Grant Titles: [list]

User-Submitted Priorities:
[user_submitted_texts — labels and content]

Publication Titles (all, most recent first):
1. [title] ([journal], [year]) [author position]
2. ...

Selected Abstracts (up to 10, selected by criteria below):
- "[title]" ([year])
  [abstract]
- ...

=== Researcher B ===
[same structure]

=== Existing Proposals for This Pair ===
[If any prior proposals exist, include title and scientific_question for each]
```

### Abstract Selection Criteria

Include up to 10 abstracts per researcher, selected by:
1. **Author position:** Prioritize last-author papers, then first-author if needed
2. **Recency:** More recent papers first
3. **Article type:** Research articles only (exclude reviews, editorials, commentaries, letters)

All publication titles are included regardless (they're compact and provide useful signal).

### Context Size Estimate

Two profiles with 10 abstracts each: ~10,000-15,000 input tokens. Output: ~2,000-3,000 tokens per proposal. At Claude Opus pricing, roughly $0.10-0.20 per pair.

## The Prompt

### Core Instructions

The prompt must instruct the LLM to:

1. Identify collaboration opportunities that are SPECIFIC and SYNERGISTIC for both parties
2. Each lab must bring something the other doesn't have
3. Each lab must benefit non-generically
4. A concrete first experiment is REQUIRED, scoped to days-to-weeks of effort
5. Return an empty array if no quality proposal exists — silence is better than noise
6. If existing proposals are provided, propose something DISTINCT or return nothing
7. Maximum 3 proposals per pair per call
8. Do NOT quote or directly reference user-submitted text — frame proposals using publicly available information even if user-submitted text informed the match

### Anti-Genericity Instructions

These are critical and should be prominent in the prompt:

- "If either lab's contribution could be described as a generic service (e.g., 'computational analysis', 'structural studies', 'mouse behavioral testing') without reference to the specific scientific question, the proposal is too generic. Do not generate it."
- "Each lab's contribution must reference specific techniques, models, reagents, or expertise from their profile. Saying 'Lab A's expertise in X' is not sufficient — say what specifically they would do and with what."
- "The proposed first experiment must name specific assays, specific computational methods, specific reagents, or specific datasets. 'We would analyze the data' is not a first experiment."
- "If you cannot articulate what makes this collaboration better than either lab hiring a postdoc to do the other's part, do not generate the proposal."

### Output Schema

The LLM returns structured JSON:

```json
[
  {
    "title": "Short descriptive name",
    "collaboration_type": "e.g., mechanistic extension, methodological enhancement, translational application",
    "scientific_question": "The core question this collaboration addresses",
    "one_line_summary_a": "What researcher A sees in swipe card — emphasizes what B brings and why it matters to A",
    "one_line_summary_b": "What researcher B sees in swipe card — emphasizes what A brings and why it matters to B",
    "detailed_rationale": "2-3 paragraphs, shared between both parties",
    "lab_a_contributions": "What lab A brings — specific techniques, reagents, models",
    "lab_b_contributions": "What lab B brings — specific techniques, reagents, models",
    "lab_a_benefits": "What lab A gets out of this collaboration specifically",
    "lab_b_benefits": "What lab B gets out of this collaboration specifically",
    "proposed_first_experiment": "Concrete pilot: who provides what, what assays/methods, key readouts, interpretation",
    "anchoring_publication_pmids": ["12345678"],
    "confidence_tier": "high | moderate | speculative",
    "reasoning": "Internal reasoning about why this is a good match and clears the quality bar"
  }
]
```

Return an empty array `[]` if no quality proposals exist for this pair.

### Few-Shot Examples

Include in the prompt: 2-3 good examples and 2-3 bad examples with rejection reasons. These are the most-tuned part of the prompt and should be updated based on observed output quality and user swipe feedback.

#### Good Example 1: Computational Optimization of H1R Inverse Agonists

```json
{
  "title": "Computational Optimization of H1R Inverse Agonists for Osteoarthritis",
  "collaboration_type": "mechanistic extension",
  "scientific_question": "What structural features of cyproheptadine are required for FoxO activation in chondrocytes?",
  "one_line_summary_a": "Forli's AutoDock suite and structure-based drug design expertise could model the cyproheptadine-H1R interaction to identify which binding determinants drive your FoxO activation phenotype, guiding design of more selective chondroprotective compounds.",
  "one_line_summary_b": "Lotz's recent JCI paper identified cyproheptadine as an H1R inverse agonist that activates FoxO transcription factors in chondrocytes — an ideal system for your docking and pharmacophore modeling pipeline to dissect structure-activity relationships.",
  "detailed_rationale": "Lotz's recent JCI paper identifies cyproheptadine as a promising osteoarthritis therapeutic that activates FoxO transcription factors and reduces both structural damage and pain via H1R inverse agonism. However, cyproheptadine's FoxO-activating mechanism may work through H1R-dependent signaling effects distinct from classic antihistamine activity, and the structural basis for this selectivity is unknown. Forli's AutoDock-GPU platform and structure-based drug design expertise could model the cyproheptadine-H1R interaction, identify key binding determinants that correlate with FoxO activation versus antihistamine activity, and generate pharmacophore models for virtual screening of compound libraries with enhanced therapeutic windows.",
  "lab_a_contributions": "Cyproheptadine structure-activity relationship data, panel of H1R ligands with FoxO activity measurements, functional chondrocyte assays for validating computational predictions",
  "lab_b_contributions": "AutoDock-GPU docking platform, pharmacophore modeling pipeline, virtual screening infrastructure, computational chemistry expertise in GPCR-ligand interactions",
  "lab_a_benefits": "Structural rationale for the FoxO activation mechanism, computationally guided prioritization of derivative compounds, stronger mechanistic narrative for therapeutic development",
  "lab_b_benefits": "Novel GPCR pharmacology application for the AutoDock platform — modeling a functional selectivity question (FoxO activation vs antihistamine activity) at a therapeutically relevant receptor",
  "proposed_first_experiment": "Lotz Lab provides a panel of 10-15 H1R ligands with quantified FoxO activation data in chondrocytes. Forli Lab performs docking studies of all compounds against the H1R crystal structure and builds pharmacophore models. Key readouts: predicted binding modes and interaction fingerprints correlated with FoxO activation potency. If structure-activity relationships emerge from the docking, this provides the basis for rational design of optimized compounds and a joint R01.",
  "anchoring_publication_pmids": ["38471293"],
  "confidence_tier": "high",
  "reasoning": "Strong match: (1) Anchored to a specific recent finding with a clear mechanistic gap. (2) Complementary capabilities — Lotz has the biological system and activity data, Forli has the computational platform. (3) Neither side is doing generic work — Forli is specifically modeling functional selectivity at H1R, not just 'doing docking.' (4) First experiment is concrete and low-investment: provide compounds, run docking, look for correlations. (5) Clear path to paper and R01."
}
```

#### Good Example 2: ISR Pathway Integration with Ribosome Targeting

```json
{
  "title": "Synergistic Neuroprotection via Atypical Tetracyclines and ISR Activators",
  "collaboration_type": "mechanistic extension",
  "scientific_question": "Do atypical tetracyclines and ISR activators provide additive or synergistic neuroprotection against ferroptosis?",
  "one_line_summary_a": "Wiseman's HRI activators (parogrelil, MBX-2982) could synergize with your atypical tetracyclines through complementary proteostasis pathways — a combination strategy that neither lab could test alone.",
  "one_line_summary_b": "Petrascheck's bioRxiv preprint identifies atypical tetracyclines that provide neuroprotection via ISR-independent cytosolic ribosome targeting — a mechanistically distinct pathway from your HRI-mediated ISR activation, creating a natural combination experiment.",
  "detailed_rationale": "Petrascheck distinguishes two mechanistically distinct classes of tetracyclines: standard variants that activate the integrated stress response (ISR) via mitochondrial ribosome targeting, and atypical variants (4-epiminocycline, 12-aminominocycline) that directly target cytosolic ribosomes to provide neuroprotection against ferroptosis without ISR activation. Wiseman's deep expertise in ISR kinases (HRI, GCN2, PERK) and his recently published HRI activators create a natural combination experiment: can ISR-dependent and ISR-independent neuroprotective pathways be combined for enhanced protection? This question is only answerable by bringing together both labs' specific compounds and assays.",
  "lab_a_contributions": "Atypical tetracyclines (4-epiminocycline, 12-aminominocycline), neuronal ferroptosis assays, C. elegans lifespan models, translation attenuation readouts",
  "lab_b_contributions": "HRI activators (parogrelil, MBX-2982), ISR pathway reporters, ISR kinase expertise for mechanistic interpretation of combination effects",
  "lab_a_benefits": "Mechanistic context for the ISR-independence of atypical tetracyclines through direct comparison with ISR activators, potential combination therapeutic strategy",
  "lab_b_benefits": "Novel combination partner for HRI activators with a distinct mechanism, expanding the therapeutic applicability of ISR modulation to ferroptotic neurodegeneration",
  "proposed_first_experiment": "Petrascheck Lab provides atypical tetracyclines and neuronal ferroptosis assay protocol. Wiseman Lab provides HRI activators. Both labs run combination treatments in neuronal ferroptosis assays. Key readouts: neuronal survival with single agents vs combinations, combination indices (CI) to assess synergy vs additivity. If synergistic, this supports a joint grant exploring dual-pathway neuroprotection.",
  "anchoring_publication_pmids": [],
  "confidence_tier": "high",
  "reasoning": "Strong match: (1) Each lab has specific compounds the other doesn't — this literally cannot be done without both labs. (2) The mechanistic distinction (ISR-dependent vs ISR-independent) creates a clear scientific question. (3) First experiment is straightforward: mix compounds, measure survival, calculate combination indices. (4) Both labs benefit — Petrascheck gets mechanistic context, Wiseman gets a new combination partner."
}
```

#### Good Example 3: Cryo-ET Visualization of Mitochondrial Remodeling

```json
{
  "title": "Cryo-ET Visualization of HRI-Induced Mitochondrial Remodeling",
  "collaboration_type": "methodological enhancement",
  "scientific_question": "How does HRI activation remodel mitochondrial membrane ultrastructure in MFN2-deficient cells?",
  "one_line_summary_a": "Grotjahn's cryo-ET and Surface Morphometrics pipeline could directly visualize the mitochondrial elongation your HRI activators produce in MFN2-deficient cells, providing structural evidence for the protective mechanism at nanometer resolution.",
  "one_line_summary_b": "Wiseman's HRI activators induce a striking mitochondrial remodeling phenotype in patient fibroblasts — an ideal specimen for your cryo-ET pipeline to characterize membrane reorganization during pharmacological organelle rescue.",
  "detailed_rationale": "Wiseman's recent PNAS paper shows that HRI-activating compounds restore mitochondrial function in MFN2-deficient cells, promoting mitochondrial elongation. However, the ultrastructural basis for this remodeling is unknown — are cristae reorganizing? Is membrane thickness changing? Is network connectivity being restored? Grotjahn's cryo-electron tomography expertise, combined with her Surface Morphometrics quantification pipeline, is uniquely suited to answer these questions at nanometer resolution. The MFN2-deficient fibroblasts provide a clean system where mitochondrial morphology is disrupted at baseline and rescued by drug treatment, making before/after comparisons straightforward.",
  "lab_a_contributions": "MFN2-deficient patient fibroblasts, HRI activator compounds (parogrelil, MBX-2982), treatment protocols, functional rescue data for correlation with structural findings",
  "lab_b_contributions": "Cryo-FIB-SEM sample preparation, cryo-electron tomography data collection, Surface Morphometrics pipeline for automated membrane quantification",
  "lab_a_benefits": "Structural evidence for the mechanism of mitochondrial rescue — moves the story from fluorescence-level observation to nanometer-resolution ultrastructural characterization, significantly strengthening the therapeutic narrative",
  "lab_b_benefits": "A compelling biological system with a clear drug-induced phenotype, ideal for demonstrating cryo-ET's power for pharmacological studies — a new application domain for the Surface Morphometrics pipeline",
  "proposed_first_experiment": "Wiseman Lab prepares MFN2-deficient fibroblasts treated with vehicle or HRI activator (48h treatment with parogrelil). Grotjahn Lab performs cryo-FIB-SEM and cryo-ET on both conditions. Key readouts: cristae morphology, inner/outer membrane thickness, mitochondrial network connectivity metrics via Surface Morphometrics. If ultrastructural improvements correlate with the functional rescue Wiseman has documented, this provides the mechanistic basis for a joint paper and R01.",
  "anchoring_publication_pmids": ["38471293"],
  "confidence_tier": "high",
  "reasoning": "Strong match: (1) Specific phenotype needing structural characterization, not generic overlap. (2) Grotjahn has the exact technical capability and quantification pipeline. (3) Self-contained first experiment — treated vs untreated cells, clear readout. (4) Both labs benefit non-generically. (5) Low-medium investment. (6) Clear path to paper and R01."
}
```

#### Bad Example 1: One Side is Generic Service Work

```
Rejected proposal: "Su Lab's knowledge graph mining could identify new drug targets for Bhatt Lab's kinase inhibitor program."

Rejection reason: Su Lab's contribution is generic — "knowledge graph mining" could be applied to any drug target program. No specific knowledge graph, dataset, or analytical approach is identified that makes this collaboration better than Bhatt Lab hiring any computational biologist. What specific knowledge graph? What specific analytical method? What specific aspect of the kinase inhibitor program would benefit from graph-based analysis?
```

#### Bad Example 2: Obvious Overlap, No Complementarity

```
Rejected proposal: "Both labs study Alzheimer's disease using mouse models and could combine their datasets for greater statistical power."

Rejection reason: Shared interest is not synergy. Neither lab brings a capability the other lacks. "Combining datasets" is not a first experiment — it's a vague aspiration with no specific analytical question, no specific readout, and no reason it requires both labs.
```

#### Bad Example 3: No Concrete First Experiment

```
Rejected proposal: "Bhatt's chemical biology expertise and Wiseman's ISR signaling knowledge could lead to novel therapeutic strategies for neurodegeneration."

Rejection reason: No specific question, no specific experiment, no specific reagents or models named. This is an abstract statement of potential, not a collaboration proposal. What specific compound? What specific assay? What would you measure?
```

## Quality Control

### Confidence Tiers

- **high**: Clear complementarity, specific anchoring, concrete first experiment, both sides benefit non-generically
- **moderate**: Good synergy but first experiment is less defined, or one side's benefit is less clear
- **speculative**: Interesting angle but requires more development, or depends on assumptions about unpublished work

### Output Validation

After LLM returns proposals:
1. Parse JSON (retry once with stricter formatting if malformed)
2. For each proposal, validate required fields are present and non-empty
3. Discard proposals missing required fields, keep valid ones
4. Store valid proposals with visibility states per the eligibility rules

### De-duplication

When generating for a pair that has existing proposals:
- Include existing proposal titles and scientific questions in the context
- Instruct the LLM: "Propose something distinct from these existing proposals, or return nothing if you've exhausted the meaningful collaboration space."
- Post-generation: check new proposal titles/questions against existing ones. If substantially similar (LLM judgment or simple similarity check), discard.

## Batch Processing

### Job Queue

Use AWS SQS. Each matching job specifies a pair (researcher_a_id, researcher_b_id). Jobs are enqueued by:
- Match pool change events
- Profile version change events
- Weekly scheduled scan

### Rate Limiting

- Process pairs in batches, respecting Claude API rate limits
- At 20 users with ~150 pairs: ~15-30 minutes total runtime
- At institutional scale (200 users, ~5000 pairs): several hours, run overnight

### Error Handling

| Error | Action |
|---|---|
| LLM call fails | Retry with exponential backoff, max 3 attempts |
| LLM returns malformed JSON | Retry once with stricter formatting instructions |
| LLM returns proposals missing required fields | Discard invalid proposals, keep valid ones |
| LLM returns empty array | Record MatchingResult with outcome=no_proposal |

### Storing "No Proposal" Results

When the engine evaluates a pair and generates nothing, record a MatchingResult with outcome=no_proposal and the current profile_versions. Do not re-evaluate until either profile version increments.

## Cost Estimates

| Scale | Pairs | Cost per full run | Frequency |
|---|---|---|---|
| Pilot (20 users) | ~150 | $15-30 | On-demand + weekly |
| Department (50 users) | ~1,250 | $125-250 | Weekly |
| Institution (200 users) | ~5,000 | $500-1,000 | Weekly/monthly |

These estimates assume Claude Opus pricing and ~15,000 input + ~3,000 output tokens per pair. Costs scale linearly with pairs.
