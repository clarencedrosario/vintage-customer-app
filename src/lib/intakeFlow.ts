// ---------------------------------------------------------------------
// Pure client intake & matter-opening engine (Feature 4) — no Convex
// context, no I/O. The server functions in convex/intake.ts delegate
// here so the lifecycle rules, required-field policy, duplicate
// detection, invitation expiry and the exactly-once approval guard are
// pinned by unit tests.
//
// Name/email/phone normalization is REUSED from the conflict module
// (lib/conflictFlow.ts) so duplicate-client prevention and
// conflict-of-interest matching agree on what "the same person" means.
// ---------------------------------------------------------------------

import {
  normalizeEmail,
  normalizePhone,
  normalizeEntityName,
  normalizeOrgName,
  normalizePersonName,
} from "./conflictFlow";
import { invitationBlocker, type InviteLike } from "./invitationFlow";

// ---------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------

export const INTAKE_STATES = [
  "draft",
  "submitted",
  "returned_for_correction",
  "rejected",
  "approved",
  "cancelled",
] as const;
export type IntakeState = (typeof INTAKE_STATES)[number];

export const INTAKE_STATE_LABELS: Record<IntakeState, string> = {
  draft: "Draft",
  submitted: "Awaiting review",
  returned_for_correction: "Returned for correction",
  rejected: "Rejected",
  approved: "Approved — matter opened",
  cancelled: "Cancelled",
};

export type IntakeTransitionAction =
  | "submit"
  | "return_for_correction"
  | "reject"
  | "approve"
  | "cancel";

/**
 * The complete legal transition table. Every other (state, action)
 * combination is illegal and returns null — the server refuses it, the
 * UI never offers it.
 */
export function canTransitionIntake(
  from: IntakeState,
  action: IntakeTransitionAction,
): IntakeState | null {
  switch (action) {
    case "submit":
      return from === "draft" || from === "returned_for_correction"
        ? "submitted"
        : null;
    case "return_for_correction":
      return from === "submitted" ? "returned_for_correction" : null;
    case "reject":
      return from === "submitted" ? "rejected" : null;
    case "approve":
      return from === "submitted" ? "approved" : null;
    case "cancel":
      return from === "draft" ||
        from === "submitted" ||
        from === "returned_for_correction"
        ? "cancelled"
        : null;
  }
  return null;
}

/** Drafts and returned intakes may be edited; everything else is sealed. */
export function mayEditIntake(state: IntakeState): boolean {
  return state === "draft" || state === "returned_for_correction";
}

// ---------------------------------------------------------------
// Staged form data
// ---------------------------------------------------------------

export const INTAKE_CLIENT_KINDS = [
  "individual",
  "company",
  "trust",
  "government",
] as const;
export type IntakeClientKind = (typeof INTAKE_CLIENT_KINDS)[number];

export const INTAKE_MATTER_KINDS = [
  "litigation",
  "advisory",
  "transaction",
  "compliance",
] as const;
export type IntakeMatterKind = (typeof INTAKE_MATTER_KINDS)[number];

export const INTAKE_URGENCY = [
  "routine",
  "time_sensitive",
  "court_deadline",
] as const;
export type IntakeUrgency = (typeof INTAKE_URGENCY)[number];

export const INTAKE_FEE_TYPES = [
  "fixed_fee",
  "hourly",
  "retainer",
  "pro_bono",
] as const;
export type IntakeFeeType = (typeof INTAKE_FEE_TYPES)[number];

export const INTAKE_STAGES = [
  "identity",
  "party_details",
  "matter",
  "parties_involved",
  "conflict",
  "kyc",
  "referral",
  "fees",
  "engagement",
  "risk",
  "team",
  "review",
] as const;
export type IntakeStage = (typeof INTAKE_STAGES)[number];

/** The stages a client (or the firm) fills before the review stage. */
export const CLIENT_FILLABLE_STAGES: IntakeStage[] = INTAKE_STAGES.filter(
  (s): s is IntakeStage => s !== "review",
);

export type IntakeFormData = {
  // identity
  clientKind?: IntakeClientKind;
  fullName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  stateName?: string;
  pincode?: string;
  // organization details (non-individual)
  organisationName?: string;
  organisationRegistrationNo?: string;
  authorisedRepresentative?: string;
  // matter
  matterKind?: IntakeMatterKind;
  matterTitle?: string;
  practiceArea?: string;
  matterDescription?: string;
  court?: string;
  caseNumber?: string;
  urgency?: IntakeUrgency;
  deadlineDate?: string;
  // parties involved
  adverseParties?: string[];
  relatedParties?: string[];
  opposingCounsel?: string;
  witnesses?: string[];
  // conflict stage — human confirmation that parties were disclosed
  conflictPartiesDisclosed?: boolean;
  // KYC
  kycReceived?: string[];
  // referral
  referredBy?: string;
  referralRelationship?: string;
  // fees
  feeType?: IntakeFeeType;
  feeNotes?: string;
  // engagement
  consentGiven?: boolean;
  engagementTemplate?: string;
  engagementAccepted?: boolean;
  engagementSignedAt?: number | null;
  // risk
  riskLevel?: "low" | "medium" | "high";
  riskNotes?: string;
  // team (firm-side)
  responsibleLawyerId?: string;
  teamIds?: string[];
};

export type MissingField = { stage: IntakeStage; key: string; label: string };

const ORG_KINDS: IntakeClientKind[] = ["company", "trust", "government"];

/**
 * Required fields at submit time — "org/matter-type required fields":
 * organizations must supply entity details; litigation matters must
 * name a court; a court-deadline urgency must carry the deadline date.
 * Everything else in the staged form is optional by design.
 */
export function intakeMissingRequiredFields(
  form: IntakeFormData,
): MissingField[] {
  const missing: MissingField[] = [];
  const need = (stage: IntakeStage, key: string, label: string, ok: unknown) => {
    const filled =
      typeof ok === "string" ? ok.trim().length > 0 : Boolean(ok);
    if (!filled) missing.push({ stage, key, label });
  };

  need("identity", "clientKind", "Client type", form.clientKind);
  need("identity", "fullName", "Full name", form.fullName);
  need("identity", "email", "Email", form.email);
  need("identity", "phone", "Phone", form.phone);
  need("identity", "addressLine1", "Address", form.addressLine1);
  need("identity", "city", "City", form.city);

  if (form.clientKind && ORG_KINDS.includes(form.clientKind)) {
    need(
      "party_details",
      "organisationName",
      "Name of the organisation",
      form.organisationName,
    );
    need(
      "party_details",
      "organisationRegistrationNo",
      "Registration / incorporation number",
      form.organisationRegistrationNo,
    );
    need(
      "party_details",
      "authorisedRepresentative",
      "Authorised representative",
      form.authorisedRepresentative,
    );
  }

  need("matter", "matterKind", "Matter type", form.matterKind);
  need("matter", "matterTitle", "Matter title", form.matterTitle);
  need("matter", "practiceArea", "Practice area", form.practiceArea);
  need(
    "matter",
    "matterDescription",
    "Description of the matter",
    form.matterDescription,
  );
  if (form.matterKind === "litigation") {
    need("matter", "court", "Court / forum", form.court);
  }
  if (form.urgency === "court_deadline") {
    need("matter", "deadlineDate", "Deadline date", form.deadlineDate);
  }

  need(
    "conflict",
    "conflictPartiesDisclosed",
    "Confirmation that all adverse and related parties are disclosed",
    form.conflictPartiesDisclosed === true,
  );

  for (const item of kycMissing(form)) {
    missing.push({ stage: "kyc", key: item, label: kycLabel(item) });
  }

  need("fees", "feeType", "Fee arrangement", form.feeType);

  need(
    "engagement",
    "consentGiven",
    "Client consent to proceed",
    form.consentGiven === true,
  );
  need(
    "engagement",
    "engagementAccepted",
    "Engagement letter accepted",
    engagementIsAccepted(form),
  );

  need("risk", "riskLevel", "Risk assessment", form.riskLevel);

  need(
    "team",
    "responsibleLawyerId",
    "Responsible lawyer",
    form.responsibleLawyerId,
  );

  return missing;
}

// ---------------------------------------------------------------
// KYC checklist
// ---------------------------------------------------------------

export const KYC_ITEMS: {
  key: string;
  label: string;
  orgOnly: boolean;
}[] = [
  { key: "identity_proof", label: "Identity proof (Aadhaar / PAN / passport)", orgOnly: false },
  { key: "address_proof", label: "Address proof", orgOnly: false },
  { key: "pan_card", label: "PAN card", orgOnly: false },
  {
    key: "incorporation_certificate",
    label: "Certificate of incorporation / registration",
    orgOnly: true,
  },
  {
    key: "authorisation_letter",
    label: "Board resolution / authorisation letter",
    orgOnly: true,
  },
];

export function kycLabel(key: string): string {
  return KYC_ITEMS.find((i) => i.key === key)?.label ?? key;
}

/** The checklist that applies to this client kind. */
export function kycChecklist(kind: IntakeClientKind | undefined): {
  key: string;
  label: string;
  required: boolean;
}[] {
  const org = kind !== undefined && ORG_KINDS.includes(kind);
  return KYC_ITEMS.map((i) => ({
    key: i.key,
    label: i.label,
    required: org || !i.orgOnly,
  }));
}

/** Required KYC items not yet received. */
export function kycMissing(form: IntakeFormData): string[] {
  return kycChecklist(form.clientKind)
    .filter((i) => i.required && !(form.kycReceived ?? []).includes(i.key))
    .map((i) => i.key);
}

// ---------------------------------------------------------------
// Duplicate-client prevention (normalized email / phone / identity)
// ---------------------------------------------------------------

export type DuplicateCandidate = {
  key: string;
  kind: IntakeClientKind;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** GSTIN, PAN or any registration identity — compared normalized. */
  identityNo?: string | null;
};

export type ProspectiveClient = {
  kind: IntakeClientKind;
  name: string;
  email?: string | null;
  phone?: string | null;
  identityNo?: string | null;
};

export type DuplicateHit = {
  candidate: DuplicateCandidate;
  reasons: string[];
  /** definite = shared email/phone/identity; possible = name-only. */
  severity: "definite" | "possible";
};

function normalizeIdentityNo(v: string | null | undefined): string | null {
  const n = (v ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return n.length >= 6 ? n : null;
}

/**
 * Compare a prospective client against known clients. Identity
 * signals (email, phone, registration number) are "definite" hits;
 * a normalized-name-only match is "possible". Names reuse the
 * conflict module's normalizers (honorifics, initials, corporate
 * suffixes) so both registers agree on identity.
 */
export function findDuplicateClients(
  prospective: ProspectiveClient,
  existing: DuplicateCandidate[],
): DuplicateHit[] {
  const pEmail = prospective.email ? normalizeEmail(prospective.email) : null;
  const pPhone = prospective.phone ? normalizePhone(prospective.phone) : null;
  const pIdentity = normalizeIdentityNo(prospective.identityNo);

  const hits: DuplicateHit[] = [];
  for (const c of existing) {
    const reasons: string[] = [];
    const cEmail = c.email ? normalizeEmail(c.email) : null;
    if (pEmail && cEmail && pEmail === cEmail) {
      reasons.push("Same email address");
    }
    const cPhone = c.phone ? normalizePhone(c.phone) : null;
    if (
      pPhone &&
      cPhone &&
      pPhone.length >= 10 &&
      cPhone.length >= 10 &&
      pPhone === cPhone
    ) {
      reasons.push("Same phone number");
    }
    const cIdentity = normalizeIdentityNo(c.identityNo);
    if (pIdentity && cIdentity && pIdentity === cIdentity) {
      reasons.push("Same registration / identity number");
    }

    const isOrg =
      prospective.kind !== "individual" || c.kind !== "individual";
    const pName = isOrg
      ? normalizeOrgName(prospective.name)
      : normalizePersonName(prospective.name);
    const cName = isOrg
      ? normalizeOrgName(c.name)
      : normalizePersonName(c.name);
    const nameMatch =
      pName.length >= 2 &&
      cName.length >= 2 &&
      (pName === cName ||
        // "R. Iyer" normalizes to "iyer" — contained in "ramesh iyer".
        (pName.length >= 3 && cName.includes(pName)) ||
        (cName.length >= 3 && pName.includes(cName)));

    if (reasons.length > 0) {
      if (!nameMatch) reasons.push("Name differs — verify before merging");
      hits.push({
        candidate: c,
        reasons,
        severity: "definite",
      });
    } else if (nameMatch) {
      hits.push({
        candidate: c,
        reasons: ["Same name (normalized) — verify this is the same client"],
        severity: "possible",
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------
// Expiring completion invitations
// ---------------------------------------------------------------

export const INTAKE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function intakeInvitationExpiry(now = Date.now()): number {
  return now + INTAKE_INVITE_TTL_MS;
}

/**
 * Same blocker semantics as staff/client invitations (tested there);
 * re-declared here for the intake path so the expiry rule is pinned
 * for intake links too.
 */
export function intakeInvitationBlocker(
  invite:
    | (InviteLike & { intakeId?: string })
    | null
    | undefined,
  now: number,
): "not_valid" | "already_used" | "revoked" | "expired" | null {
  return invitationBlocker(invite, now);
}

// ---------------------------------------------------------------
// Engagement letter: unsigned ≠ accepted
// ---------------------------------------------------------------

/**
 * Acceptance is recorded only with a signature timestamp. An intake
 * that merely lists an engagement template is NOT accepted — approval
 * refuses to proceed on an unsigned engagement letter.
 */
export function engagementIsAccepted(form: IntakeFormData): boolean {
  return (
    form.engagementAccepted === true &&
    typeof form.engagementSignedAt === "number" &&
    form.engagementSignedAt > 0
  );
}

// ---------------------------------------------------------------
// Approval guard — create client + matter exactly once
// ---------------------------------------------------------------

export type IntakeApprovalInput = {
  state: IntakeState;
  form: IntakeFormData;
  /** A cleared (or overridden) conflict check is attached. */
  conflictCheckId?: string | null;
  /** Does the approver hold matter.create? */
  approverCanCreateMatters: boolean;
};

/**
 * Full pre-approval validation. Returns the blocking reason, or null
 * when approval may proceed. The conflict gate ties intake approval to
 * the Feature-3 desk: no cleared check, no client/matter creation.
 */
export function intakeApprovalBlocker(input: IntakeApprovalInput): string | null {
  const transition = canTransitionIntake(input.state, "approve");
  if (!transition) {
    return `An intake can only be approved while awaiting review (current state: ${INTAKE_STATE_LABELS[input.state]}).`;
  }
  if (!input.approverCanCreateMatters) {
    return "Your role is not permitted to approve intakes and open matters.";
  }
  if (!input.conflictCheckId) {
    return "Attach a cleared conflict check before approving — open the Conflicts desk for this proposed client.";
  }
  const missing = intakeMissingRequiredFields(input.form);
  if (missing.length > 0) {
    return `Intake is incomplete: ${missing
      .slice(0, 3)
      .map((m) => m.label)
      .join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`;
  }
  return null;
}

/** True once this intake has already produced its client and matter. */
export function intakeCreationAlreadyDone(intake: {
  createdClientId?: string | null;
  createdMatterId?: string | null;
}): boolean {
  return Boolean(intake.createdClientId && intake.createdMatterId);
}
