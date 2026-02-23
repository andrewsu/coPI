/**
 * Monthly profile refresh service.
 *
 * Detects new ORCID publications, fetches new publication metadata, generates
 * a candidate synthesized profile, compares candidate arrays against the
 * current profile, and stores a pending candidate + notification trigger
 * when meaningful changes are found.
 *
 * Spec reference: specs/profile-ingestion.md "Monthly Refresh Cron".
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

import { getJobQueue } from "@/lib/job-queue";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe-token";
import { fetchOrcidGrantTitles, fetchOrcidWorks, type OrcidWork } from "@/lib/orcid";
import {
  fetchPubMedAbstracts,
  determineAuthorPosition,
  type PubMedArticle,
} from "@/lib/pubmed";
import { fetchMethodsSections } from "@/lib/pmc";
import { convertDoisToPmids, convertPmidsToPmcids } from "@/lib/ncbi-id-converter";
import { synthesizeProfile } from "@/services/profile-synthesis";
import { parseUserSubmittedTexts, extractLastName, getNcbiDelayMs } from "@/services/profile-pipeline";
import type { SynthesisInput, SynthesisOutput } from "@/lib/profile-synthesis-prompt";

const PMC_BATCH_SIZE = 10;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CandidateChangedField =
  | "techniques"
  | "experimentalModels"
  | "diseaseAreas"
  | "keyTargets"
  | "keywords"
  | "grantTitles";

type RefreshStatus =
  | "skipped_user_not_found"
  | "skipped_no_profile"
  | "skipped_no_new_publications"
  | "no_array_changes"
  | "candidate_pending";

/** A typed shape stored in ResearcherProfile.pendingProfile JSONB. */
export interface PendingProfileCandidate {
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  keywords: string[];
  grantTitles: string[];
  rawAbstractsHash: string;
  generatedAt: string;
}

/** Outcome metadata for one monthly refresh run. */
export interface MonthlyRefreshResult {
  userId: string;
  status: RefreshStatus;
  newPublicationsStored: number;
  changedFields: CandidateChangedField[];
  notified: boolean;
}

/**
 * Runs monthly refresh for one user.
 *
 * WHY this exists:
 * The monthly cron must avoid expensive no-op updates while still surfacing
 * meaningful profile evolution, so we only notify when candidate arrays differ.
 */
export async function runMonthlyRefresh(
  prisma: PrismaClient,
  llm: Anthropic,
  userId: string,
): Promise<MonthlyRefreshResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      orcid: true,
      name: true,
      institution: true,
      department: true,
      email: true,
      emailNotificationsEnabled: true,
      notifyProfileRefresh: true,
    },
  });

  if (!user) {
    return {
      userId,
      status: "skipped_user_not_found",
      newPublicationsStored: 0,
      changedFields: [],
      notified: false,
    };
  }

  const currentProfile = await prisma.researcherProfile.findUnique({
    where: { userId },
    select: {
      userSubmittedTexts: true,
      techniques: true,
      experimentalModels: true,
      diseaseAreas: true,
      keyTargets: true,
      keywords: true,
      grantTitles: true,
    },
  });

  if (!currentProfile) {
    return {
      userId,
      status: "skipped_no_profile",
      newPublicationsStored: 0,
      changedFields: [],
      notified: false,
    };
  }

  const [grantTitles, orcidWorks, existingPublications] = await Promise.all([
    fetchOrcidGrantTitles(user.orcid),
    fetchOrcidWorks(user.orcid),
    prisma.publication.findMany({
      where: { userId },
      select: {
        pmid: true,
        doi: true,
        title: true,
        year: true,
        journal: true,
      },
    }),
  ]);

  const existingKeys = new Set(existingPublications.map(publicationIdentityKey));
  const newWorks = orcidWorks.filter(
    (work) => !existingKeys.has(workIdentityKey(work)),
  );

  if (newWorks.length === 0) {
    return {
      userId,
      status: "skipped_no_new_publications",
      newPublicationsStored: 0,
      changedFields: [],
      notified: false,
    };
  }

  const ncbiDelayMs = getNcbiDelayMs();
  const doiOnlyWorks = newWorks.filter((w) => !w.pmid && w.doi);
  const doiToPmid = new Map<string, string>();

  if (doiOnlyWorks.length > 0) {
    await delay(ncbiDelayMs);
    const doiRecords = await convertDoisToPmids(
      doiOnlyWorks.map((w) => w.doi!),
    );
    for (const record of doiRecords) {
      if (record.doi && record.pmid) {
        doiToPmid.set(record.doi.toLowerCase(), record.pmid);
      }
    }
  }

  const allNewPmids = Array.from(
    new Set([
      ...newWorks.map((w) => w.pmid).filter((pmid): pmid is string => Boolean(pmid)),
      ...Array.from(doiToPmid.values()),
    ]),
  );

  let pubmedArticles: PubMedArticle[] = [];
  if (allNewPmids.length > 0) {
    await delay(ncbiDelayMs);
    pubmedArticles = await fetchPubMedAbstracts(allNewPmids);
  }

  const pmidToPmcid = new Map<string, string>();
  const methodsByPmcid = new Map<string, string>();

  for (const article of pubmedArticles) {
    if (article.pmcid) {
      pmidToPmcid.set(article.pmid, article.pmcid);
    }
  }

  const pmidsMissingPmcid = pubmedArticles
    .filter((article) => !article.pmcid)
    .map((article) => article.pmid);

  if (pmidsMissingPmcid.length > 0) {
    await delay(ncbiDelayMs);
    const pmcRecords = await convertPmidsToPmcids(pmidsMissingPmcid);
    for (const record of pmcRecords) {
      if (record.pmid && record.pmcid) {
        pmidToPmcid.set(record.pmid, record.pmcid);
      }
    }
  }

  const allPmcids = Array.from(new Set(pmidToPmcid.values()));
  for (let i = 0; i < allPmcids.length; i += PMC_BATCH_SIZE) {
    const batch = allPmcids.slice(i, i + PMC_BATCH_SIZE);
    await delay(ncbiDelayMs);
    const methodsResults = await fetchMethodsSections(batch);
    for (const result of methodsResults) {
      if (result.methodsText) {
        methodsByPmcid.set(result.pmcid.toUpperCase(), result.methodsText);
      }
    }
  }

  const researcherLastName = extractLastName(user.name);

  const recordsFromPubmed = pubmedArticles.map((article) => {
    const authorPosition = determineAuthorPosition(
      article.authors,
      researcherLastName,
    );
    const pmcid =
      pmidToPmcid.get(article.pmid) ?? article.pmcid ?? null;
    const pmcidKey = pmcid?.toUpperCase() ?? null;

    return {
      userId,
      pmid: article.pmid,
      pmcid,
      doi: article.doi,
      title: article.title,
      abstract: article.abstract,
      journal: article.journal,
      year: article.year,
      authorPosition,
      methodsText: pmcidKey ? (methodsByPmcid.get(pmcidKey) ?? null) : null,
    };
  });

  const unresolvedDoiWorks = doiOnlyWorks.filter(
    (work) => !doiToPmid.has(work.doi!.toLowerCase()),
  );

  const recordsFromDoiOnly = unresolvedDoiWorks.map((work) => ({
    userId,
    pmid: null,
    pmcid: work.pmcid,
    doi: work.doi,
    title: work.title,
    abstract: "",
    journal: work.journal ?? "",
    year: work.year ?? 0,
    authorPosition: "middle" as const,
    methodsText: null,
  }));

  const newRecords = [...recordsFromPubmed, ...recordsFromDoiOnly];
  if (newRecords.length > 0) {
    await prisma.publication.createMany({ data: newRecords });
  }

  const allPublications = await prisma.publication.findMany({
    where: { userId },
    select: {
      title: true,
      journal: true,
      year: true,
      authorPosition: true,
      abstract: true,
      methodsText: true,
    },
  });

  const synthesisInput: SynthesisInput = {
    name: user.name,
    affiliation:
      [user.institution, user.department].filter(Boolean).join(", ") || "Unknown",
    grantTitles,
    publications: allPublications.map((publication) => ({
      title: publication.title,
      journal: publication.journal,
      year: publication.year,
      authorPosition: publication.authorPosition,
      abstract: publication.abstract,
      methodsText: publication.methodsText ?? undefined,
    })),
    userSubmittedTexts: parseUserSubmittedTexts(currentProfile.userSubmittedTexts),
  };

  const synthesis = await synthesizeProfile(llm, synthesisInput);
  const candidateOutput = synthesis.output ?? emptySynthesisOutput();
  const candidateHash = computeAbstractsHashFromPublications(allPublications);

  const changedFields = detectChangedArrayFields({
    current: currentProfile,
    candidate: candidateOutput,
    candidateGrantTitles: grantTitles,
  });

  if (changedFields.length === 0) {
    return {
      userId,
      status: "no_array_changes",
      newPublicationsStored: newRecords.length,
      changedFields: [],
      notified: false,
    };
  }

  const pendingProfile: PendingProfileCandidate = {
    researchSummary: candidateOutput.research_summary,
    techniques: candidateOutput.techniques,
    experimentalModels: candidateOutput.experimental_models,
    diseaseAreas: candidateOutput.disease_areas,
    keyTargets: candidateOutput.key_targets,
    keywords: candidateOutput.keywords,
    grantTitles,
    rawAbstractsHash: candidateHash,
    generatedAt: new Date().toISOString(),
  };

  await prisma.researcherProfile.update({
    where: { userId },
    data: {
      pendingProfile: pendingProfile as unknown as Prisma.InputJsonValue,
      pendingProfileCreatedAt: new Date(),
    },
  });

  let notified = false;
  if (
    user.emailNotificationsEnabled &&
    user.notifyProfileRefresh &&
    user.email &&
    !user.email.endsWith("@orcid.placeholder")
  ) {
    await getJobQueue().enqueue({
      type: "send_email",
      templateId: "profile_refresh_candidate",
      to: user.email,
      data: {
        recipientName: user.name,
        newPublicationTitles: newWorks.map((work) => work.title),
        changedFields,
        unsubscribeUrl: buildUnsubscribeUrl(userId, "profile_refresh"),
      },
    });
    notified = true;
  }

  return {
    userId,
    status: "candidate_pending",
    newPublicationsStored: newRecords.length,
    changedFields,
    notified,
  };
}

function emptySynthesisOutput(): SynthesisOutput {
  return {
    research_summary: "",
    techniques: [],
    experimental_models: [],
    disease_areas: [],
    key_targets: [],
    keywords: [],
  };
}

function normalizeArray(values: string[]): string[] {
  return values
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0)
    .sort();
}

function equalAsNormalizedSet(a: string[], b: string[]): boolean {
  const left = normalizeArray(a);
  const right = normalizeArray(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function detectChangedArrayFields(input: {
  current: {
    techniques: string[];
    experimentalModels: string[];
    diseaseAreas: string[];
    keyTargets: string[];
    keywords: string[];
    grantTitles: string[];
  };
  candidate: SynthesisOutput;
  candidateGrantTitles: string[];
}): CandidateChangedField[] {
  const changed: CandidateChangedField[] = [];

  if (!equalAsNormalizedSet(input.current.techniques, input.candidate.techniques)) {
    changed.push("techniques");
  }
  if (
    !equalAsNormalizedSet(
      input.current.experimentalModels,
      input.candidate.experimental_models,
    )
  ) {
    changed.push("experimentalModels");
  }
  if (!equalAsNormalizedSet(input.current.diseaseAreas, input.candidate.disease_areas)) {
    changed.push("diseaseAreas");
  }
  if (!equalAsNormalizedSet(input.current.keyTargets, input.candidate.key_targets)) {
    changed.push("keyTargets");
  }
  if (!equalAsNormalizedSet(input.current.keywords, input.candidate.keywords)) {
    changed.push("keywords");
  }
  if (!equalAsNormalizedSet(input.current.grantTitles, input.candidateGrantTitles)) {
    changed.push("grantTitles");
  }

  return changed;
}

function workIdentityKey(work: OrcidWork): string {
  if (work.pmid) return `pmid:${work.pmid}`;
  if (work.doi) return `doi:${work.doi.toLowerCase()}`;
  return `title:${work.title.toLowerCase()}|year:${work.year ?? 0}`;
}

function publicationIdentityKey(publication: {
  pmid: string | null;
  doi: string | null;
  title: string;
  year: number;
}): string {
  if (publication.pmid) return `pmid:${publication.pmid}`;
  if (publication.doi) return `doi:${publication.doi.toLowerCase()}`;
  return `title:${publication.title.toLowerCase()}|year:${publication.year}`;
}

function computeAbstractsHashFromPublications(
  publications: Array<{ abstract: string }>,
): string {
  const payload = publications
    .map((p) => p.abstract)
    .sort()
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}
