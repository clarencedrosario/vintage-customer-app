// Pure-engine tests for Feature 4 — Client Intake & Matter Opening.
// Reuses the conflict module's normalizers, so duplicate prevention and
// conflict matching agree on identity.
import { describe, expect, it } from "vitest";
import {
  INTAKE_STATES,
  INTAKE_INVITE_TTL_MS,
  canTransitionIntake,
  mayEditIntake,
  intakeMissingRequiredFields,
  kycChecklist,
  kycMissing,
  findDuplicateClients,
  intakeInvitationExpiry,
  intakeInvitationBlocker,
  engagementIsAccepted,
  intakeApprovalBlocker,
  intakeCreationAlreadyDone,
  type IntakeFormData,
} from "./intakeFlow";

const validIndividual: IntakeFormData = {
  clientKind: "individual",
  fullName: "Ramesh Iyer",
  email: "ramesh@example.in",
  phone: "9840012345",
  addressLine1: "12 Marine Drive",
  city: "Mumbai",
  stateName: "Maharashtra",
  matterKind: "litigation",
  matterTitle: "Recovery suit — Kanpur Steel",
  practiceArea: "Commercial litigation",
  matterDescription: "Suit for recovery of dues under supply contracts.",
  court: "Bombay High Court",
  urgency: "routine",
  conflictPartiesDisclosed: true,
  kycReceived: ["identity_proof", "address_proof", "pan_card"],
  feeType: "hourly",
  consentGiven: true,
  engagementTemplate: "adl-default",
  engagementAccepted: true,
  engagementSignedAt: 1758700000000,
  riskLevel: "low",
  responsibleLawyerId: "u_responsible",
};

describe("intake lifecycle state machine", () => {
  it("declares exactly the six legal states", () => {
    expect(INTAKE_STATES).toEqual([
      "draft",
      "submitted",
      "returned_for_correction",
      "rejected",
      "approved",
      "cancelled",
    ]);
  });

  it("submit: draft → submitted", () => {
    expect(canTransitionIntake("draft", "submit")).toBe("submitted");
  });

  it("resubmit: returned_for_correction → submitted", () => {
    expect(canTransitionIntake("returned_for_correction", "submit")).toBe(
      "submitted",
    );
  });

  it("reviewer may return or reject only a submitted intake", () => {
    expect(canTransitionIntake("submitted", "return_for_correction")).toBe(
      "returned_for_correction",
    );
    expect(canTransitionIntake("submitted", "reject")).toBe("rejected");
    expect(canTransitionIntake("draft", "reject")).toBeNull();
    expect(canTransitionIntake("returned_for_correction", "reject")).toBeNull();
    expect(canTransitionIntake("approved", "return_for_correction")).toBeNull();
  });

  it("approve only from submitted; approved and rejected are terminal", () => {
    expect(canTransitionIntake("submitted", "approve")).toBe("approved");
    expect(canTransitionIntake("draft", "approve")).toBeNull();
    expect(canTransitionIntake("approved", "approve")).toBeNull();
    expect(canTransitionIntake("rejected", "submit")).toBeNull();
    expect(canTransitionIntake("approved", "submit")).toBeNull();
    expect(canTransitionIntake("rejected", "cancel")).toBeNull();
    expect(canTransitionIntake("approved", "cancel")).toBeNull();
    expect(canTransitionIntake("cancelled", "submit")).toBeNull();
  });

  it("cancel is legal from draft, submitted and returned_for_correction", () => {
    for (const s of ["draft", "submitted", "returned_for_correction"] as const) {
      expect(canTransitionIntake(s, "cancel")).toBe("cancelled");
    }
  });

  it("editing is possible only while draft or returned_for_correction", () => {
    expect(mayEditIntake("draft")).toBe(true);
    expect(mayEditIntake("returned_for_correction")).toBe(true);
    for (const s of ["submitted", "approved", "rejected", "cancelled"] as const) {
      expect(mayEditIntake(s)).toBe(false);
    }
  });
});

describe("required fields per client kind and matter type", () => {
  it("a complete individual litigation intake has no missing fields", () => {
    expect(intakeMissingRequiredFields(validIndividual)).toEqual([]);
  });

  it("an empty form is missing every core field", () => {
    const missing = intakeMissingRequiredFields({});
    const keys = missing.map((m) => m.key);
    for (const k of [
      "clientKind",
      "fullName",
      "email",
      "phone",
      "addressLine1",
      "city",
      "matterKind",
      "matterTitle",
      "practiceArea",
      "matterDescription",
      "conflictPartiesDisclosed",
      "feeType",
      "consentGiven",
      "engagementAccepted",
      "riskLevel",
      "responsibleLawyerId",
    ]) {
      expect(keys).toContain(k);
    }
    // Litigation is what makes a court required (covered next).
    expect(
      intakeMissingRequiredFields({ ...validIndividual, court: undefined }).some(
        (m) => m.key === "court",
      ),
    ).toBe(true);
  });

  it("whitespace-only strings count as missing", () => {
    expect(
      intakeMissingRequiredFields({ ...validIndividual, fullName: "   " }).some(
        (m) => m.key === "fullName",
      ),
    ).toBe(true);
  });

  it("organizations require registration number and representative", () => {
    const org: IntakeFormData = {
      ...validIndividual,
      clientKind: "company",
      fullName: "A. Menon",
      organisationName: "Kanpur Steel Pvt Ltd",
      organisationRegistrationNo: "U29299UP2005PTC030123",
      authorisedRepresentative: "A. Menon, Director",
      kycReceived: [
        "identity_proof",
        "address_proof",
        "pan_card",
        "incorporation_certificate",
        "authorisation_letter",
      ],
    };
    expect(intakeMissingRequiredFields(org)).toEqual([]);
  });

  it("a company without organisation details is flagged", () => {
    const org: IntakeFormData = { ...validIndividual, clientKind: "company" };
    const keys = intakeMissingRequiredFields(org).map((m) => m.key);
    expect(keys).toContain("organisationName");
    expect(keys).toContain("organisationRegistrationNo");
    expect(keys).toContain("authorisedRepresentative");
  });

  it("individuals are not asked for organisation registration", () => {
    const keys = intakeMissingRequiredFields(validIndividual).map(
      (m) => m.key,
    );
    expect(keys).not.toContain("organisationRegistrationNo");
  });

  it("non-litigation matters do not require a court", () => {
    const advisory: IntakeFormData = {
      ...validIndividual,
      matterKind: "advisory",
      court: undefined,
    };
    expect(
      intakeMissingRequiredFields(advisory).some((m) => m.key === "court"),
    ).toBe(false);
  });

  it("court-deadline urgency requires the deadline date", () => {
    const urgent: IntakeFormData = {
      ...validIndividual,
      urgency: "court_deadline",
      deadlineDate: undefined,
    };
    expect(
      intakeMissingRequiredFields(urgent).some((m) => m.key === "deadlineDate"),
    ).toBe(true);
    const dated = { ...urgent, deadlineDate: "2026-10-01" };
    expect(
      intakeMissingRequiredFields(dated).some((m) => m.key === "deadlineDate"),
    ).toBe(false);
  });
});

describe("KYC checklist", () => {
  it("individuals owe identity, address and PAN only", () => {
    const list = kycChecklist("individual").filter((i) => i.required);
    expect(list.map((i) => i.key)).toEqual([
      "identity_proof",
      "address_proof",
      "pan_card",
    ]);
  });

  it("organizations additionally owe incorporation + authorisation docs", () => {
    const list = kycChecklist("company").filter((i) => i.required);
    expect(list.map((i) => i.key)).toEqual([
      "identity_proof",
      "address_proof",
      "pan_card",
      "incorporation_certificate",
      "authorisation_letter",
    ]);
  });

  it("missing = required items not yet received", () => {
    expect(
      kycMissing({ clientKind: "individual", kycReceived: ["pan_card"] }),
    ).toEqual(["identity_proof", "address_proof"]);
    expect(kycMissing({ clientKind: "company", kycReceived: [] }).length).toBe(
      5,
    );
  });
});

describe("duplicate-client prevention", () => {
  const existing = [
    {
      key: "c1",
      kind: "individual" as const,
      name: "Ramesh Iyer",
      email: "ramesh@example.in",
      phone: "+91 98400 12345",
    },
    {
      key: "c2",
      kind: "company" as const,
      name: "Meridian Textiles Pvt. Ltd.",
      email: "office@meridian.in",
      phone: "022 4000 5000",
      identityNo: "U27200MH2011PTC221100",
    },
  ];

  it("same normalized email is a definite duplicate", () => {
    const hits = findDuplicateClients(
      { kind: "individual", name: "Someone Else", email: "RAMESH@Example.in " },
      existing,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("definite");
    expect(hits[0]!.reasons).toContain("Same email address");
    expect(hits[0]!.candidate.key).toBe("c1");
  });

  it("phone numbers match across formats (+91, spaces, dashes)", () => {
    const hits = findDuplicateClients(
      { kind: "individual", name: "Different Name", phone: "098400 12345" },
      existing,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reasons).toContain("Same phone number");
  });

  it("registration numbers match ignoring case and punctuation", () => {
    const hits = findDuplicateClients(
      {
        kind: "company",
        name: "Some Other Company LLP",
        identityNo: "u27200-mh-2011-ptc-221100",
      },
      existing,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reasons).toContain("Same registration / identity number");
  });

  it("normalized org name is a possible duplicate (Pvt Ltd suffix ignored)", () => {
    const hits = findDuplicateClients(
      { kind: "company", name: "Meridian Textiles Private Limited" },
      existing,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("possible");
  });

  it("person names match across honorifics and initials", () => {
    const hits = findDuplicateClients(
      { kind: "individual", name: "Shri R. Iyer" },
      existing,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("possible");
  });

  it("a name match plus identity match is still one definite hit", () => {
    const hits = findDuplicateClients(
      { kind: "individual", name: "Ramesh Iyer", email: "ramesh@example.in" },
      existing,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("definite");
    expect(hits[0]!.reasons).toContain("Same email address");
  });

  it("a distinct client produces no hits", () => {
    const hits = findDuplicateClients(
      {
        kind: "individual",
        name: "Vasudha Rao",
        email: "vasudha@elsewhere.in",
        phone: "9900112233",
      },
      existing,
    );
    expect(hits).toHaveLength(0);
  });

  it("partial name overlap alone is not a duplicate", () => {
    const hits = findDuplicateClients(
      { kind: "company", name: "Meridian Logistics Pvt Ltd" },
      existing,
    );
    // Shares "meridian" but the normalized org names differ entirely.
    expect(hits).toHaveLength(0);
  });

  it("short/garbage phones and identity numbers never match", () => {
    const hits = findDuplicateClients(
      { kind: "individual", name: "X Y", phone: "123", identityNo: "A1" },
      existing,
    );
    expect(hits).toHaveLength(0);
  });
});

describe("expiring completion invitations", () => {
  it("expiry is now + 7 days", () => {
    const now = 1_758_700_000_000;
    expect(intakeInvitationExpiry(now)).toBe(now + INTAKE_INVITE_TTL_MS);
    expect(INTAKE_INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("blocker: not_valid / already_used / revoked / expired", () => {
    const now = 1_000_000_000_000;
    expect(intakeInvitationBlocker(null, now)).toBe("not_valid");
    expect(
      intakeInvitationBlocker(
        { expiresAt: now + 1000, email: "a@b.in", usedAt: now - 1 },
        now,
      ),
    ).toBe("already_used");
    expect(
      intakeInvitationBlocker(
        { expiresAt: now + 1000, email: "a@b.in", revokedAt: now - 1 },
        now,
      ),
    ).toBe("revoked");
    expect(
      intakeInvitationBlocker(
        { expiresAt: now - 1, email: "a@b.in" },
        now,
      ),
    ).toBe("expired");
    expect(
      intakeInvitationBlocker({ expiresAt: now + 1000, email: "a@b.in" }, now),
    ).toBeNull();
  });
});

describe("engagement letter — unsigned ≠ accepted", () => {
  it("accepted only with both flag and signature timestamp", () => {
    expect(
      engagementIsAccepted({
        engagementAccepted: true,
        engagementSignedAt: 1758700000000,
      }),
    ).toBe(true);
  });

  it("an accepted flag without a signature is NOT accepted", () => {
    expect(engagementIsAccepted({ engagementAccepted: true })).toBe(false);
    expect(
      engagementIsAccepted({
        engagementAccepted: true,
        engagementSignedAt: null,
      }),
    ).toBe(false);
    expect(
      engagementIsAccepted({
        engagementAccepted: true,
        engagementSignedAt: 0,
      }),
    ).toBe(false);
  });

  it("a signature without the acceptance flag is NOT accepted", () => {
    expect(
      engagementIsAccepted({ engagementSignedAt: 1758700000000 }),
    ).toBe(false);
  });
});

describe("approval guard — exactly-once creation", () => {
  const base = {
    state: "submitted" as const,
    form: validIndividual,
    conflictCheckId: "cx_1",
    approverCanCreateMatters: true,
  };

  it("a complete submitted intake with a cleared check may be approved", () => {
    expect(intakeApprovalBlocker(base)).toBeNull();
  });

  it("only submitted intakes can be approved", () => {
    for (const state of [
      "draft",
      "returned_for_correction",
      "approved",
      "rejected",
      "cancelled",
    ] as const) {
      const reason = intakeApprovalBlocker({ ...base, state });
      expect(reason).toBeTruthy();
      if (state !== "approved" && state !== "rejected" && state !== "cancelled") {
        expect(reason).toContain("awaiting review");
      }
    }
  });

  it("roles without matter.create may not approve", () => {
    const reason = intakeApprovalBlocker({
      ...base,
      approverCanCreateMatters: false,
    });
    expect(reason).toContain("not permitted");
  });

  it("no conflict check, no approval", () => {
    const reason = intakeApprovalBlocker({ ...base, conflictCheckId: null });
    expect(reason).toContain("conflict check");
  });

  it("incomplete intake names the missing fields", () => {
    const reason = intakeApprovalBlocker({
      ...base,
      form: { ...validIndividual, fullName: "", feeType: undefined },
    });
    expect(reason).toContain("incomplete");
    expect(reason).toContain("Full name");
    expect(reason).toContain("Fee arrangement");
  });

  it("unsigned engagement letter blocks approval", () => {
    const reason = intakeApprovalBlocker({
      ...base,
      form: { ...validIndividual, engagementSignedAt: null },
    });
    expect(reason).toContain("Engagement letter accepted");
  });

  it("missing KYC blocks approval", () => {
    const reason = intakeApprovalBlocker({
      ...base,
      form: {
        ...validIndividual,
        clientKind: "company",
        kycReceived: ["identity_proof"],
      },
    });
    expect(reason).toContain("incomplete");
  });

  it("creation-done detection works on either/both ids", () => {
    expect(intakeCreationAlreadyDone({})).toBe(false);
    expect(intakeCreationAlreadyDone({ createdClientId: "c1" })).toBe(false);
    expect(
      intakeCreationAlreadyDone({ createdClientId: "c1", createdMatterId: "m1" }),
    ).toBe(true);
  });
});
