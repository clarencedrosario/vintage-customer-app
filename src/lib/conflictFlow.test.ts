import { describe, expect, it } from "vitest";
import {
  normalizeEntityName,
  normalizeOrgName,
  normalizePersonName,
  normalizeEmail,
  normalizePhone,
  classifyNameMatch,
  runConflictSearch,
  canProceedToMatter,
  renderConflictReport,
  type SearchableRecord,
  type SearchQuery,
} from "./conflictFlow";

const baseQuery: SearchQuery = {
  proposedClient: "Ramesh Industries Pvt Ltd",
  adverseParties: ["Sunil Kumar"],
  relatedCompanies: [],
  directors: [],
  witnesses: [],
  aliases: [],
  relatedMatters: [],
  referringParty: "",
};

describe("name normalization", () => {
  it("strips honorifics, punctuation and case (initials kept for entities)", () => {
    expect(normalizeEntityName("Dr. Ramesh  K. Verma")).toBe("ramesh k verma");
    expect(normalizeEntityName("Adv. SUNITA-Devi")).toBe("sunita devi");
  });

  it("strips corporate tail suffixes for organizations", () => {
    expect(normalizeOrgName("Ramesh Industries Pvt. Ltd.")).toBe("ramesh industries");
    expect(normalizeOrgName("Sunil Traders Limited")).toBe("sunil traders");
    expect(normalizeOrgName("Verma & Sons LLP")).toBe("verma sons");
  });

  it("drops initials but keeps full middle names for persons", () => {
    expect(normalizePersonName("Mr. Ramesh Kumar Verma")).toBe("ramesh kumar verma");
    expect(normalizePersonName("Dr. Ramesh K. Verma")).toBe("ramesh verma");
  });

  it("normalizes emails and Indian phones", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
  });
});

describe("labelled match tiers", () => {
  it("exact: identical raw strings", () => {
    expect(classifyNameMatch("Sunil Kumar", "Sunil Kumar")).toBe("exact");
  });

  it("normalized: case/punctuation/honorific/corporate-suffix variants", () => {
    expect(classifyNameMatch("SUNIL KUMAR", "Sunil Kumar")).toBe("normalized");
    expect(classifyNameMatch("Ramesh Industries Pvt Ltd", "Ramesh Industries (P) Ltd")).toBe(
      "normalized",
    );
    expect(classifyNameMatch("Dr. Ramesh K Verma", "Ramesh Verma")).toBe("normalized");
  });

  it("possible: alias-ish / fuzzy overlap, clearly not exact", () => {
    expect(classifyNameMatch("Ramesh Kumar Verma", "Ramesh K Verma")).toBe("possible");
    expect(classifyNameMatch("Sunil Kumar", "Sunil Kumar Sharma")).toBe("possible");
  });

  it("no match for unrelated names", () => {
    expect(classifyNameMatch("Sunil Kumar", "Anita Desai Associates")).toBe(null);
  });
});

function rec(partial: Partial<SearchableRecord> & { id: string }): SearchableRecord {
  return {
    kind: "client",
    label: partial.label,
    matterIds: [],
    hiddenMatterIds: [],
    restricted: false,
    ...partial,
  } as SearchableRecord;
}

describe("runConflictSearch — alias & adverse-party matching", () => {
  it("finds a current client by exact name and labels the tier", () => {
    const res = runConflictSearch(baseQuery, [
      rec({ id: "c1", kind: "client", label: "Ramesh Industries Pvt Ltd" }),
    ]);
    expect(res.summary.exact).toBe(1);
    expect(res.matches[0]!.matchedAgainst).toContain("proposed_client");
    expect(res.matches[0]!.label).toBe("Ramesh Industries Pvt Ltd");
  });

  it("matches an adverse party against opposing parties on matters", () => {
    const res = runConflictSearch(baseQuery, [
      rec({
        id: "m1",
        kind: "matter_opposing_party",
        label: "Sunil Kumar",
        detail: "ADV/2026/0001 — Verma vs Sunil Kumar",
        matterIds: ["m1"],
      }),
    ]);
    expect(res.summary.exact).toBe(1);
    expect(res.matches[0]!.matchedAgainst).toContain("adverse_party");
    expect(res.matches[0]!.evidence.some((e) => e.includes("adverse party"))).toBe(true);
  });

  it("catches aliases — normalized for org forms, possible for containment", () => {
    const q: SearchQuery = {
      ...baseQuery,
      adverseParties: ["Sunil Kumar"],
      aliases: ["S.K. Traders"],
    };
    const res = runConflictSearch(q, [
      rec({ id: "a1", kind: "alias", label: "S K Traders", matterIds: [] }),
      rec({ id: "c2", kind: "client", label: "Sunil Kumar Sharma", matterIds: [] }),
    ]);
    const alias = res.matches.find((m) => m.recordKind === "alias");
    const client = res.matches.find((m) => m.recordId === "c2");
    expect(alias?.tier).toBe("normalized");
    expect(client?.tier).toBe("possible");
  });

  it("searches former clients, contacts, witnesses, directors and organizations", () => {
    const q: SearchQuery = {
      ...baseQuery,
      relatedCompanies: ["Verma Holdings"],
      directors: ["Geeta Verma"],
      witnesses: ["Ramesh Kumar Verma"],
      referringParty: "Anita Desai",
    };
    const res = runConflictSearch(q, [
      rec({ id: "fc1", kind: "former_client", label: "Geeta Verma", matterIds: [] }),
      rec({ id: "ct1", kind: "contact", label: "Ramesh Kumar Verma", matterIds: [] }),
      rec({ id: "w1", kind: "witness", label: "Anita Desai", matterIds: [] }),
      rec({ id: "o1", kind: "organization", label: "Verma Holdings Ltd", matterIds: [] }),
    ]);
    expect(res.matches.find((m) => m.recordId === "fc1")).toBeTruthy();
    expect(res.matches.find((m) => m.recordId === "ct1")).toBeTruthy();
    expect(res.matches.find((m) => m.recordId === "w1")).toBeTruthy();
    expect(res.matches.find((m) => m.recordId === "o1")).toBeTruthy();
  });
});

describe("runConflictSearch — restricted (confidential) results", () => {
  it("hides label/id for restricted rows but still reports the conflict", () => {
    const res = runConflictSearch(baseQuery, [
      rec({
        id: "m9",
        kind: "matter_opposing_party",
        label: "Sunil Kumar",
        matterIds: ["m9"],
        hiddenMatterIds: ["m9"],
        restricted: true,
      }),
    ]);
    expect(res.summary.restricted).toBe(1);
    const m = res.matches[0]!;
    expect(m.restricted).toBe(true);
    expect(m.label).toBeUndefined();
    expect(m.recordId).toBeUndefined();
    expect(m.detail).toBeUndefined();
    // The tier is preserved so severity is visible.
    expect(m.tier).toBe("exact");
  });

  it("never leaks restricted names into the rendered report", () => {
    const res = runConflictSearch(baseQuery, [
      rec({
        id: "m9",
        kind: "matter",
        label: "Team-Restricted Matter Title",
        matterIds: ["m9"],
        hiddenMatterIds: ["m9"],
        restricted: true,
      }),
    ]);
    const report = renderConflictReport({
      reference: "CNF/2026/0001",
      proposedClient: baseQuery.proposedClient,
      searchedAt: Date.now(),
      searchResult: res,
      classification: null,
      viewerName: "Tester",
      now: Date.now(),
    });
    expect(report).toContain("RESTRICTED");
    expect(report).not.toContain("Team-Restricted Matter Title");
  });

  it("counts restricted matches in the summary so classification is not weakened", () => {
    const res = runConflictSearch(baseQuery, [
      rec({
        id: "r1",
        kind: "matter",
        label: "Ramesh Industries Pvt Ltd",
        restricted: true,
        matterIds: [],
        hiddenMatterIds: [],
      }),
    ]);
    expect(res.summary.restricted).toBe(1);
    expect(res.summary.exact + res.summary.normalized + res.summary.possible).toBe(1);
  });
});

describe("classification gate — matter opening", () => {
  it("blocks while classification is pending", () => {
    expect(canProceedToMatter({ classification: null })).toBe(false);
  });

  it("allows no_conflict and the two middle classifications with reasoning recorded", () => {
    expect(canProceedToMatter({ classification: "no_conflict" })).toBe(true);
    expect(
      canProceedToMatter({
        classification: "possible_conflict",
        override: { byId: "u1", reason: "Walls in place; different matter team." },
      }),
    ).toBe(true);
    expect(canProceedToMatter({ classification: "investigation_required" })).toBe(true);
  });

  it("blocks a confirmed conflict unless an elevated override carries a real reason", () => {
    expect(canProceedToMatter({ classification: "confirmed_conflict" })).toBe(false);
    expect(
      canProceedToMatter({
        classification: "confirmed_conflict",
        override: { byId: "u1", reason: "short" },
      }),
    ).toBe(false);
    expect(
      canProceedToMatter({
        classification: "confirmed_conflict",
        override: { byId: "u1", reason: "Former client, unrelated dispute, consent recorded." },
      }),
    ).toBe(true);
  });
});

describe("timestamped report", () => {
  it("includes reference, timestamps, summary and classification", () => {
    const res = runConflictSearch(baseQuery, [
      rec({ id: "c1", kind: "client", label: "Ramesh Industries Pvt Ltd" }),
    ]);
    const report = renderConflictReport({
      reference: "CNF/2026/0007",
      proposedClient: baseQuery.proposedClient,
      searchedAt: new Date("2026-09-24T10:00:00Z").getTime(),
      searchResult: res,
      classification: "no_conflict",
      classificationReason: "Client is the firm's own; adverse party unknown.",
      decidedByName: "A. Partner",
      viewerName: "A. Partner",
      now: new Date("2026-09-24T11:00:00Z").getTime(),
    });
    expect(report).toContain("CNF/2026/0007");
    expect(report).toContain("2026-09-24");
    expect(report).toContain("exact: 1");
    expect(report).toContain("No conflict");
    expect(report).toContain("A. Partner");
  });

  it("records an elevated override with reason and timestamp", () => {
    const report = renderConflictReport({
      reference: "CNF/2026/0002",
      proposedClient: "X",
      searchedAt: Date.now(),
      searchResult: { matches: [], summary: { exact: 0, normalized: 0, possible: 0, restricted: 0 } },
      classification: "confirmed_conflict",
      classificationReason: "Former client adverse.",
      decidedByName: "A. Partner",
      override: { byName: "Owner", reason: "Informed consent documented.", at: Date.now() },
      viewerName: "Owner",
      now: Date.now(),
    });
    expect(report).toContain("ELEVATED OVERRIDE");
    expect(report).toContain("Informed consent documented.");
  });
});
