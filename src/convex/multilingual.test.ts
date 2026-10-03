import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  buildSideBySide,
  evaluateExternalPermission,
  humanVerificationDisclosure,
  isValidLanguageCode,
  languageLabel,
  machineTranslationDisclosure,
  manualTranslationDisclosure,
  MAX_TRANSLATION_CHARS,
  MIN_POLICY_NOTE_CHARS,
  providerFacts,
  STALE_ORIGINAL_DISCLOSURE,
  splitSegments,
  validateTranslationTexts,
} from "../lib/multilingual";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + matter. */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Owner (synthetic)",
      email: "owner@t21.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "T21 Chamber (multilingual)",
      slug: "t21-multilingual",
      kind: "chamber" as const,
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "INV",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      orgId,
      userId: ownerId as never,
      orgRole: "owner" as const,
      status: "active" as const,
      createdAt: Date.now(),
    });
    await ctx.db.patch(ownerId as never, { activeOrgId: orgId });
    const clientId = await ctx.db.insert("clients", {
      orgId,
      kind: "company" as const,
      name: "Multilingual Test Pvt. Ltd. (synthetic)",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "T21/2026/0001",
      title: "Multilingual test matter (synthetic)",
      practiceArea: "civil",
      clientRole: "Multilingual Test Pvt. Ltd.",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { orgId, clientId, matterId };
  });
  return { ownerId, ...seeded };
}

/** Seed one aiSource + one matterFact with fixed original texts. */
async function seedTargets(
  t: ReturnType<typeof convexTest>,
  ids: { orgId: string; matterId: string; ownerId: string },
) {
  return asUser(t, "system").run(async (ctx) => {
    const SOURCE_TEXT =
      "The agreement was executed on 12 March 2025.\n\nThe defendants took possession the same week.";
    const aiSourceId = await ctx.db.insert("aiSources", {
      orgId: ids.orgId as never,
      matterId: ids.matterId as never,
      name: "agreement-extract.txt",
      role: "opposing_party" as const,
      text: SOURCE_TEXT,
      charCount: SOURCE_TEXT.length,
      extraction: "manual" as const,
      addedById: ids.ownerId as never,
      createdAt: Date.now(),
    });
    const FACT_TEXT =
      "मुकदमे में कहा गया कि राशि का भुगतान नहीं हुआ।\n\nब्याज की मांग की गई।";
    const factId = await ctx.db.insert("matterFacts", {
      orgId: ids.orgId as never,
      matterId: ids.matterId as never,
      factKey: "payment-claim",
      statement: FACT_TEXT,
      status: "extracted" as const,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { aiSourceId, factId, SOURCE_TEXT, FACT_TEXT };
  });
}

describe("Turn 21 — §32 Phase 9 multilingual evidence review", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("pure layer: language codes, segment pairing (incl. honest mismatch), permission matrix, labels, limits", () => {
    // Language codes: valid forms pass; garbage fails; unknown-but-
    // well-formed codes display as themselves (never invented names).
    expect(isValidLanguageCode("en")).toBe(true);
    expect(isValidLanguageCode("hi-IN")).toBe(true);
    expect(isValidLanguageCode("ta")).toBe(true);
    expect(isValidLanguageCode("eng")).toBe(true);
    expect(isValidLanguageCode("abcd")).toBe(false);
    expect(isValidLanguageCode("e")).toBe(false);
    expect(isValidLanguageCode("EN")).toBe(false);
    expect(isValidLanguageCode("en-")).toBe(false);
    expect(isValidLanguageCode("")).toBe(false);
    expect(languageLabel("en")).toBe("English");
    expect(languageLabel("hi")).toBe("Hindi");
    expect(languageLabel("xx")).toBe("xx"); // honest pass-through

    // Segmentation: newline paragraphs, empties dropped, CRLF handled.
    expect(splitSegments("a\r\n\r\nb\n\nc")).toEqual(["a", "b", "c"]);
    expect(splitSegments("  ")).toEqual([]);

    // Aligned pairing.
    const aligned = buildSideBySide("p1\n\np2", "q1\n\nq2");
    expect(aligned.alignment).toBe("aligned");
    expect(aligned.rows).toHaveLength(2);
    expect(aligned.rows[0]).toEqual({ index: 0, original: "p1", translated: "q1" });
    expect(aligned.originalOnly).toEqual([]);
    expect(aligned.translatedOnly).toEqual([]);

    // Mismatch is the HEADLINE, remainders are exposed — never hidden.
    const mismatch = buildSideBySide("p1\n\np2\n\np3", "q1\n\nq2");
    expect(mismatch.alignment).toBe("segment_count_mismatch");
    expect(mismatch.rows).toHaveLength(2);
    expect(mismatch.originalOnly).toEqual(["p3"]);
    expect(mismatch.translatedOnly).toEqual([]);

    // Permission matrix: manual and self-hosted never need permission;
    // machine_external needs an explicit "allowed" decision — the
    // unset DEFAULT refuses (no silent external disclosure).
    expect(evaluateExternalPermission("manual", "unset").allowed).toBe(true);
    expect(evaluateExternalPermission("machine_self_hosted", "unset").allowed).toBe(true);
    const unsetExt = evaluateExternalPermission("machine_external", "unset");
    expect(unsetExt.allowed).toBe(false);
    expect(unsetExt.reason).toMatch(/unset/);
    expect(evaluateExternalPermission("machine_external", "restricted").allowed).toBe(false);
    expect(evaluateExternalPermission("machine_external", "allowed").allowed).toBe(true);

    // Provider facts derived from the kind.
    expect(providerFacts("manual")).toEqual({ machineTranslated: false, externalTransfer: false });
    expect(providerFacts("machine_external")).toEqual({ machineTranslated: true, externalTransfer: true });
    expect(providerFacts("machine_self_hosted")).toEqual({ machineTranslated: true, externalTransfer: false });

    // Mandatory labels.
    const mach = machineTranslationDisclosure("OpenAI", "gpt-4o-mini");
    expect(mach).toContain("MACHINE TRANSLATION");
    expect(mach).toContain("OpenAI");
    expect(mach).toContain("gpt-4o-mini");
    expect(mach).toContain("NOT authoritative");
    expect(machineTranslationDisclosure(undefined, undefined)).toContain("unspecified provider");
    const manual = manualTranslationDisclosure("R. Kumar");
    expect(manual).toContain("R. Kumar");
    expect(manual).toContain("not the evidence");
    const ver = humanVerificationDisclosure("A. Lawyer", Date.UTC(2026, 9, 3));
    expect(ver).toContain("A. Lawyer");
    expect(ver).toContain("2026-10-03");
    expect(ver).toContain("attests a comparison");
    expect(STALE_ORIGINAL_DISCLOSURE).toContain("STALE");

    // Limits: empties and oversized snapshots refused (never truncated).
    expect(validateTranslationTexts("orig", "trans")).toEqual({ ok: true });
    expect(validateTranslationTexts("  ", "trans").ok).toBe(false);
    expect(validateTranslationTexts("orig", "").ok).toBe(false);
    expect(validateTranslationTexts("o".repeat(MAX_TRANSLATION_CHARS + 1), "t").ok).toBe(false);
    expect(MIN_POLICY_NOTE_CHARS).toBe(10);
  });

  it("recording: original preserved, machine-labelled side-by-side, supersession chain, human verification, staleness flag", async () => {
    const firm = await seedFirm(t);
    const targets = await seedTargets(t, firm);
    const owner = asUser(t, firm.ownerId);

    // Record an external machine translation (policy recorded first —
    // the honest sequence the UI would walk the lawyer through).
    await owner.mutation(api.multilingual.setHandlingPolicy, {
      matterId: firm.matterId as never,
      externalProcessors: "allowed",
      authorityNote: "Client engagement letter clause 7 permits cloud translation services.",
    });
    const policy = await owner.query(api.multilingual.getHandlingPolicy, {
      matterId: firm.matterId as never,
    });
    expect(policy!.status).toBe("allowed");
    expect(policy!.setByName).toContain("Owner");

    const rec1 = await owner.mutation(api.multilingual.recordTranslation, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
      originalText: targets.SOURCE_TEXT,
      sourceLanguage: "en",
      targetLanguage: "hi",
      translatedText: "समझौता 12 मार्च 2025 को निष्पादित हुआ।\n\nप्रतिवादियों ने उसी सप्ताह कब्ज़ा लिया।",
      providerKind: "machine_external" as const,
      providerName: "OpenAI",
      providerVersion: "gpt-4o-mini",
    });
    expect(rec1.supersededCount).toBe(0);

    // ORIGINAL PRESERVED: the aiSource row is untouched.
    const liveSource = await t.run((ctx) => ctx.db.get(targets.aiSourceId as never));
    expect(liveSource!.text).toBe(targets.SOURCE_TEXT);

    // Side-by-side: frozen pair, aligned, machine-labelled, not stale.
    const sbs1 = await owner.query(api.multilingual.sideBySide, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
    });
    expect(sbs1!.translation!.recordId).toBe(rec1.recordId);
    expect(sbs1!.translation!.machineTranslated).toBe(true);
    expect(sbs1!.translation!.externalTransfer).toBe(true);
    expect(sbs1!.disclosure).toContain("MACHINE TRANSLATION");
    expect(sbs1!.disclosure).toContain("gpt-4o-mini");
    expect(sbs1!.pairs!.alignment).toBe("aligned");
    expect(sbs1!.pairs!.rows).toHaveLength(2);
    expect(sbs1!.staleOriginal).toBe(false);
    expect(sbs1!.verifiedDisclosure).toBeNull();

    // Supersession: a NEW rendering for the same target+language
    // supersedes (chain preserved) — never overwrites.
    const rec2 = await owner.mutation(api.multilingual.recordTranslation, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
      originalText: targets.SOURCE_TEXT,
      sourceLanguage: "en",
      targetLanguage: "hi",
      translatedText: "अनुबंध 12 मार्च 2025 को किया गया।\n\nप्रतिवादियों ने उसी सप्ताह अधिकार प्राप्त किया।",
      providerKind: "machine_external" as const,
      providerName: "OpenAI",
      providerVersion: "gpt-4o-mini",
      note: "Revised rendering after terminology review.",
    });
    expect(rec2.supersededCount).toBe(1);
    const first = await t.run((ctx) => ctx.db.get(rec1.recordId as never));
    expect(first!.supersededById).toBe(rec2.recordId);
    const sbs2 = await owner.query(api.multilingual.sideBySide, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
    });
    expect(sbs2!.translation!.recordId).toBe(rec2.recordId);

    // Human verification: an ATTESTATION with a mandatory note — it
    // changes no text and never promotes the rendering to evidence.
    await expect(
      owner.mutation(api.multilingual.verifyTranslation, {
        recordId: rec2.recordId as never,
        note: "short",
      }),
    ).rejects.toThrow(/10 characters/);
    await owner.mutation(api.multilingual.verifyTranslation, {
      recordId: rec2.recordId as never,
      note: "Compared both paragraphs against the scanned original page by page.",
    });
    const sbs3 = await owner.query(api.multilingual.sideBySide, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
    });
    expect(sbs3!.verifiedDisclosure).toContain("HUMAN-VERIFIED");
    expect(sbs3!.verifiedDisclosure).toContain("Owner");
    // The attestation did NOT launder the machine label away.
    expect(sbs3!.disclosure).toContain("MACHINE TRANSLATION");
    const verifiedRow = await t.run((ctx) => ctx.db.get(rec2.recordId as never));
    expect(verifiedRow!.translatedText).not.toBe(first!.translatedText);

    // Manual rendering on a FACT (Devanagari original → English), with
    // the translator named: allowed without any external-permission
    // decision, labelled as manual, and never the evidence.
    const recFact = await owner.mutation(api.multilingual.recordTranslation, {
      matterId: firm.matterId as never,
      targetType: "matter_fact" as const,
      targetId: targets.factId as never,
      originalText: targets.FACT_TEXT,
      sourceLanguage: "hi",
      targetLanguage: "en",
      translatedText:
        "It was stated in the suit that the amount was never paid.\n\nInterest was claimed.",
      providerKind: "manual" as const,
      providerName: "R. Kumar (empanelled translator)",
    });
    expect(recFact.recordId).toBeTruthy();
    const factRow = await t.run((ctx) => ctx.db.get(targets.factId as never));
    expect(factRow!.statement).toBe(targets.FACT_TEXT); // original preserved
    const sbsFact = await owner.query(api.multilingual.sideBySide, {
      matterId: firm.matterId as never,
      targetType: "matter_fact" as const,
      targetId: targets.factId as never,
    });
    expect(sbsFact!.disclosure).toContain("MANUAL RENDERING");
    expect(sbsFact!.disclosure).toContain("R. Kumar");
    expect(sbsFact!.translation!.machineTranslated).toBe(false);

    // STALENESS: if the live fact text changes afterwards, the view
    // flags it — the frozen pairing is shown as-is, never re-pointed.
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.patch(targets.factId as never, {
        statement: "यह कथन संशोधित है — राशि आंशिक रूप से चुकाई गई थी।",
        version: 2,
        updatedAt: Date.now(),
      });
    });
    const sbsStale = await owner.query(api.multilingual.sideBySide, {
      matterId: firm.matterId as never,
      targetType: "matter_fact" as const,
      targetId: targets.factId as never,
    });
    expect(sbsStale!.staleOriginal).toBe(true);
    expect(sbsStale!.staleDisclosure).toContain("STALE");
    expect(sbsStale!.translation!.originalText).toBe(targets.FACT_TEXT); // frozen

    // Matter list: active records only, with standing disclosure.
    const list = await owner.query(api.multilingual.listForMatter, {
      matterId: firm.matterId as never,
    });
    expect(list!.records).toHaveLength(2); // rec2 (ai_source) + recFact
    expect(list!.records.every((r) => !!r.languagePair)).toBe(true);
    expect(list!.disclosure).toContain("never the evidence");
  });

  it("data-handling restrictions: unset/restricted refuse external machine translation; manual + self-hosted pass; cross-tenant hidden", async () => {
    const firm = await seedFirm(t);
    const targets = await seedTargets(t, firm);
    const owner = asUser(t, firm.ownerId);

    const attempt = () =>
      owner.mutation(api.multilingual.recordTranslation, {
        matterId: firm.matterId as never,
        targetType: "ai_source" as const,
        targetId: targets.aiSourceId as never,
        originalText: targets.SOURCE_TEXT,
        sourceLanguage: "en",
        targetLanguage: "ta",
        translatedText: "ஒப்பந்தம் 12 மார்ச் 2025 அன்று கையொப்பமிடப்பட்டது.",
        providerKind: "machine_external" as const,
        providerName: "ExternalTranslate",
      });

    // DEFAULT (unset): refused — no silent external disclosure.
    await expect(attempt()).rejects.toThrow(/unset/);

    // A "restricted" decision also refuses external machine output.
    await owner.mutation(api.multilingual.setHandlingPolicy, {
      matterId: firm.matterId as never,
      externalProcessors: "restricted",
      authorityNote: "Client instruction dated 1 Sep 2026: no cloud processing of case documents.",
    });
    await expect(attempt()).rejects.toThrow(/RESTRICTS/);

    // Thin authority notes are refused on the policy itself.
    await expect(
      owner.mutation(api.multilingual.setHandlingPolicy, {
        matterId: firm.matterId as never,
        externalProcessors: "allowed",
        authorityNote: "because",
      }),
    ).rejects.toThrow(/10 characters/);

    // Manual and self-hosted renderings do NOT need the permission —
    // restricted means external processors, not translation review.
    await owner.mutation(api.multilingual.recordTranslation, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
      originalText: targets.SOURCE_TEXT,
      sourceLanguage: "en",
      targetLanguage: "ta",
      translatedText: "ஒப்பந்தம் 12 மார்ச் 2025 அன்று செய்யப்பட்டது.\n\nபிரதிவாதிகள் அதே வாரம் உடைமை எடுத்தனர்.",
      providerKind: "manual" as const,
      providerName: "S. Priya (empanelled translator)",
    });
    await owner.mutation(api.multilingual.recordTranslation, {
      matterId: firm.matterId as never,
      targetType: "ai_source" as const,
      targetId: targets.aiSourceId as never,
      originalText: targets.SOURCE_TEXT,
      sourceLanguage: "en",
      targetLanguage: "kn",
      translatedText: "ಒಪ್ಪಂದವನ್ನು 12 ಮಾರ್ಚ್ 2025 ರಂದು ಮಾಡಲಾಯಿತು.\n\nಪ್ರತಿವಾದಿಗಳು ಅದೇ ವಾರ ಸ್ವಾಧೀನ ಪಡೆದರು.",
      providerKind: "machine_self_hosted" as const,
      providerName: "in-firm translation service",
      providerVersion: "v1.2",
    });

    // Same-language "translations" are refused — this records
    // translations, not rewordings.
    await expect(
      owner.mutation(api.multilingual.recordTranslation, {
        matterId: firm.matterId as never,
        targetType: "ai_source" as const,
        targetId: targets.aiSourceId as never,
        originalText: targets.SOURCE_TEXT,
        sourceLanguage: "en",
        targetLanguage: "en",
        translatedText: "Reworded plain-English summary.",
        providerKind: "manual" as const,
      }),
    ).rejects.toThrow(/must differ/);

    // An explicit allowed decision unlocks external machine recording.
    await owner.mutation(api.multilingual.setHandlingPolicy, {
      matterId: firm.matterId as never,
      externalProcessors: "allowed",
      authorityNote: "Client consent recorded 30 Sep 2026 (email on file) for cloud translation.",
    });
    await expect(attempt()).resolves.toBeTruthy();

    // Cross-tenant: a rival org gets NULL for side-by-side reads, and
    // every action on the foreign matter is refused.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@t21.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Rival T21",
        slug: "rival-t21",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: uid as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        orgId,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: orgId });
      return uid;
    });
    const rival = asUser(t, rivalId);
    expect(
      await rival.query(api.multilingual.sideBySide, {
        matterId: firm.matterId as never,
        targetType: "ai_source" as const,
        targetId: targets.aiSourceId as never,
      }),
    ).toBeNull();
    await expect(
      rival.query(api.multilingual.listForMatter, { matterId: firm.matterId as never }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.multilingual.setHandlingPolicy, {
        matterId: firm.matterId as never,
        externalProcessors: "allowed",
        authorityNote: "Rival org attempting to authorize external processing.",
      }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.multilingual.recordTranslation, {
        matterId: firm.matterId as never,
        targetType: "matter_fact" as const,
        targetId: targets.factId as never,
        originalText: targets.FACT_TEXT,
        sourceLanguage: "hi",
        targetLanguage: "en",
        translatedText: "Stolen translation.",
        providerKind: "manual" as const,
      }),
    ).rejects.toThrow();
    // The rival's own matter has its own independent policy space.
    const rivalMatterId = await asUser(t, "system").run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: (await ctx.db.get(rivalId as never))!.activeOrgId as never,
        kind: "company" as const,
        name: "Rival Client (synthetic)",
        createdBy: rivalId as never,
        createdAt: Date.now(),
      });
      return ctx.db.insert("matters", {
        orgId: (await ctx.db.get(rivalId as never))!.activeOrgId as never,
        clientId,
        reference: "RIV/2026/0001",
        title: "Rival matter (synthetic)",
        practiceArea: "civil",
        clientRole: "Rival Client",
        status: "open" as const,
        createdBy: rivalId as never,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const rivalPolicy = await rival.query(api.multilingual.getHandlingPolicy, {
      matterId: rivalMatterId as never,
    });
    expect(rivalPolicy!.status).toBe("unset");
  });
});
