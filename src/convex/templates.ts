import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// GOVERNED TEMPLATE LIBRARY + AI-ASSISTED DRAFTING (section 27.3)
//
// Governance: every template carries type, practice area, jurisdiction,
// version, review date, author/source, usage rights, required fields,
// approval status, instructions and limitations. Only APPROVED templates
// render into drafts. Missing details render as VISIBLE placeholders —
// the system never invents names, dates, facts, authorities or client
// instructions. Prefill comes only from lawyer-CONFIRMED facts or
// matter fields, each value provenance-tagged.
//
// Honesty: the library below ships a small honest seed. The 300+
// long-term target is reported as an actual count everywhere — never
// claimed in advance.
// =====================================================================

const MAX_TEMPLATE_BODY = 40_000;

/** The honest seed: distinct, immediately usable templates. */
const SEED_TEMPLATES: {
  key: string;
  title: string;
  docType: string;
  practiceArea: string;
  jurisdictions: string[];
  requiredFields: {
    key: string;
    label: string;
    kind: "text" | "date" | "amount" | "party" | "court";
    required: boolean;
    prefillFrom?: string;
  }[];
  optionalClauses?: { key: string; label: string; body: string; isDefault: boolean }[];
  bodyTemplate: string;
  instructions: string;
  limitations: string;
}[] = [
  {
    key: "legal-notice-demand-in",
    title: "Legal notice — demand of payment",
    docType: "legal_notice",
    practiceArea: "commercial",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "client_name", label: "Client (sender) name", kind: "party", required: true, prefillFrom: "fact:partyName" },
      { key: "noticee_name", label: "Noticee name", kind: "party", required: true },
      { key: "noticee_address", label: "Noticee address", kind: "text", required: true },
      { key: "demand_amount", label: "Amount demanded", kind: "amount", required: true },
      { key: "cause_date", label: "Date of default/cause", kind: "date", required: true },
      { key: "notice_date", label: "Date of this notice", kind: "date", required: true },
    ],
    optionalClauses: [
      {
        key: "interest",
        label: "Interest clause",
        body: "You are further liable to pay interest at {{interest_rate}}% per annum from {{cause_date}} until realisation.",
        isDefault: false,
      },
      {
        key: "settlement",
        label: "Settlement invitation",
        body: "Without prejudice to the above, our client remains open to an amicable settlement within {{settlement_days}} days.",
        isDefault: false,
      },
    ],
    bodyTemplate: `LEGAL NOTICE
Date: {{notice_date}}

To,
{{noticee_name}}
{{noticee_address}}

Under instructions from and on behalf of our client, {{client_name}}, we serve you with this notice as follows:

1. That on {{cause_date}}, the following default occurred: {{cause_description}}.

2. That a sum of ₹{{demand_amount}} is due and payable by you to our client, which despite demand remains unpaid.

3. Take notice that unless the said amount is paid within {{compliance_days}} days of receipt of this notice, our client shall be constrained to initiate appropriate legal proceedings at your risk, cost and consequences.

{{optional_clauses}}

Copy retained in our office for further necessary action.

{{advocate_name}}
Advocate`,
    instructions:
      "Fill every bracketed field from verified instructions only. Send via RPAD/courier and preserve proof of service on the file. Verify the limitation period for the intended proceeding before sending.",
    limitations:
      "Generic demand structure — NOT a substitute for advice on limitation, jurisdiction-specific pre-institution requirements (e.g. Section 138 NI Act notice timing) or mediation mandates. Review required by an advocate before issue.",
  },
  {
    key: "cheque-bounce-complaint-in",
    title: "Complaint under Section 138 NI Act",
    docType: "complaint",
    practiceArea: "criminal",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "complainant_name", label: "Complainant name", kind: "party", required: true, prefillFrom: "fact:partyName" },
      { key: "accused_name", label: "Accused name", kind: "party", required: true },
      { key: "cheque_number", label: "Cheque number", kind: "text", required: true },
      { key: "cheque_date", label: "Cheque date", kind: "date", required: true },
      { key: "cheque_amount", label: "Cheque amount", kind: "amount", required: true },
      { key: "presentation_date", label: "Presentation date", kind: "date", required: true },
      { key: "memo_date", label: "Return memo date", kind: "date", required: true },
      { key: "notice_date", label: "Demand notice date", kind: "date", required: true },
      { key: "court_name", label: "Court", kind: "court", required: true },
    ],
    bodyTemplate: `IN THE COURT OF {{court_name}}

COMPLAINT U/S 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

Complainant: {{complainant_name}}
Versus
Accused: {{accused_name}}

1. That the accused issued cheque no. {{cheque_number}} dated {{cheque_date}} for ₹{{cheque_amount}} towards {{consideration_description}}.

2. That the said cheque was presented on {{presentation_date}} and returned unpaid vide return memo dated {{memo_date}} with the remark "{{return_remark}}".

3. That a statutory demand notice was served on {{notice_date}}; the notice period expired on {{notice_expiry_date}} without payment.

PRAYER: It is therefore prayed that the accused be punished under Section 138 of the Negotiable Instruments Act, 1881.

Complainant through
{{advocate_name}}`,
    instructions:
      "CRITICAL TIMING: the complaint must be filed within one month of the notice period expiring (proviso to S.138(b),(c), as amended). Verify every date against the bank memo and service proof. Pay the applicable court fee.",
    limitations:
      "Jurisdiction: only the court where the payee's bank branch is located (N. Harihara Krishnan v. J. Thomas). Payable-at-par cheques and company accused need specific pleaded facts. Advocate review mandatory.",
  },
  {
    key: "written-statement-civil-in",
    title: "Written statement (civil suit)",
    docType: "pleading",
    practiceArea: "civil",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "defendant_name", label: "Defendant name", kind: "party", required: true },
      { key: "plaintiff_name", label: "Plaintiff name", kind: "party", required: true },
      { key: "suit_number", label: "Suit number", kind: "text", required: true },
      { key: "court_name", label: "Court", kind: "court", required: true },
      { key: "ws_date", label: "Date of filing", kind: "date", required: true },
    ],
    optionalClauses: [
      {
        key: "limitation",
        label: "Limitation plea",
        body: "That the suit is barred by limitation, the cause of action having arisen on {{limitation_date}}, more than {{limitation_years}} years before institution.",
        isDefault: false,
      },
      {
        key: "setoff",
        label: "Set-off plea",
        body: "That the defendant is entitled to a set-off of ₹{{setoff_amount}} as particularised in Schedule {{setoff_schedule}}.",
        isDefault: false,
      },
    ],
    bodyTemplate: `IN THE COURT OF {{court_name}}

SUIT NO. {{suit_number}}

{{plaintiff_name}} … Plaintiff
Versus
{{defendant_name}} … Defendant

WRITTEN STATEMENT ON BEHALF OF THE DEFENDANT

1. Preliminary objection: {{preliminary_objection}}.

2. That the contents of paragraph {{para_number}} of the plaint are denied as false and misleading. The true facts are: {{defence_facts}}.

3. That the plaintiff has not come to court with clean hands; the suit is liable to be dismissed with costs.

{{optional_clauses}}

PRAYER: It is most respectfully prayed that this Hon'ble Court may dismiss the suit with costs.

Defendant through
{{advocate_name}}
Date: {{ws_date}}`,
    instructions:
      "Admit or deny EACH paragraph of the plaint specifically (Order VIII CPC); evasive denials are deemed admissions. Limitation: 30 days from service, extendable to 90 with costs. Attach all documents relied on.",
    limitations:
      "Structure only — the defence itself must come from verified instructions and the record. Advocate review mandatory before verification and filing.",
  },
  {
    key: "bail-application-in",
    title: "Regular bail application (Sessions/High Court)",
    docType: "application",
    practiceArea: "criminal",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "applicant_name", label: "Applicant/accused name", kind: "party", required: true },
      { key: "fir_number", label: "FIR number", kind: "text", required: true },
      { key: "police_station", label: "Police station", kind: "text", required: true },
      { key: "offences", label: "Sections invoked", kind: "text", required: true },
      { key: "arrest_date", label: "Date of arrest", kind: "date", required: true },
      { key: "court_name", label: "Court", kind: "court", required: true },
    ],
    optionalClauses: [
      {
        key: "no-flight",
        label: "No-flight undertaking",
        body: "The applicant undertakes to abide by any conditions including surrender of passport, and to join investigation as and when called.",
        isDefault: true,
      },
    ],
    bodyTemplate: `IN THE COURT OF {{court_name}}

BAIL APPLICATION NO. ___ OF {{filing_year}}

{{applicant_name}} … Applicant
Versus
State (FIR No. {{fir_number}}, P.S. {{police_station}}) … Respondent

APPLICATION U/S 437/439 Cr.P.C. (READ WITH S.483 BNSS, AS APPLICABLE) FOR REGULAR BAIL

1. The applicant has been arrested on {{arrest_date}} in the said FIR, alleging offences u/s {{offences}}.

2. Grounds: {{bail_grounds}}.

3. The applicant is not a flight risk, has a fixed abode at {{residence_address}}, and undertakes to attend every hearing.

{{optional_clauses}}

PRAYER: Bail be granted to the applicant on such terms as this Hon'ble Court deems fit.

Applicant through
{{advocate_name}}`,
    instructions:
      "Verify the governing procedure for the offence era (Cr.P.C. vs BNSS) from the matter's legal profile before filing. Annex copies of FIR, custody memo and any earlier bail orders. Check for S.437 prohibition cases (punishable death/life).",
    limitations:
      "Bail grounds must be argued on the facts of the case — the template carries structure only. Advocate review mandatory.",
  },
  {
    key: "mutual-nda-in",
    title: "Mutual non-disclosure agreement (India)",
    docType: "agreement",
    practiceArea: "commercial",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "party_a", label: "First party", kind: "party", required: true },
      { key: "party_b", label: "Second party", kind: "party", required: true },
      { key: "effective_date", label: "Effective date", kind: "date", required: true },
      { key: "term_years", label: "Confidentiality term (years)", kind: "text", required: true },
    ],
    optionalClauses: [
      {
        key: "injunction",
        label: "Injunctive relief",
        body: "The parties acknowledge that breach may cause irreparable harm for which damages may be inadequate, entitling the aggrieved party to seek injunctive relief.",
        isDefault: true,
      },
      {
        key: "arbitration",
        label: "Arbitration clause",
        body: "Any dispute shall be referred to arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996; seat: {{arbitration_seat}}; language: English.",
        isDefault: false,
      },
    ],
    bodyTemplate: `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is made on {{effective_date}} between {{party_a}} ("First Party") and {{party_b}} ("Second Party").

1. Purpose: the parties may disclose confidential information for {{purpose_description}}.

2. Confidential information means non-public information disclosed in any form, excluding information that is or becomes public without breach, was lawfully known before disclosure, or is independently developed.

3. Obligations: each party shall use the other's confidential information solely for the Purpose and protect it with no less than reasonable care.

4. Term: obligations continue for {{term_years}} years from disclosure.

{{optional_clauses}}

SIGNED for and on behalf of the parties:
{{party_a}}: ______________
{{party_b}}: ______________`,
    instructions:
      "Confirm stamp-paper value per the state's Stamp Act before execution. Define the Purpose precisely — an over-broad Purpose is unenforceable in practice.",
    limitations:
      "Not legal advice on enforceability of liquidated damages (S.74 Contract Act analysis needed for penalty-style clauses). Advocate review before execution.",
  },
  {
    key: "affidavit-evidence-in",
    title: "Affidavit of evidence (by affirmation)",
    docType: "affidavit",
    practiceArea: "civil",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "deponent_name", label: "Deponent name", kind: "party", required: true },
      { key: "deponent_details", label: "Deponent description (age, occupation, address)", kind: "text", required: true },
      { key: "suit_number", label: "Suit/complaint number", kind: "text", required: true },
      { key: "court_name", label: "Court", kind: "court", required: true },
    ],
    bodyTemplate: `IN THE COURT OF {{court_name}}

{{case_number_and_title}}

AFFIDAVIT OF EVIDENCE OF {{deponent_name}}

I, {{deponent_name}}, {{deponent_details}}, do hereby solemnly affirm and state as under:

1. I am the {{capacity_in_case}} in the above case and am competent to depose to the facts hereof.

2. I state that: {{evidence_narrative}}.

3. The documents filed are true to my knowledge; the contents of paragraphs above are true and correct, nothing material has been concealed, and no part of it is false.

DEPONENT

VERIFICATION:
Verified at {{place}} on this {{verification_date}} that the contents of the above affidavit are true and correct to my knowledge and belief and nothing material has been concealed.

DEPONENT`,
    instructions:
      "Evidence affidavits replace chief-examination by affirmation; keep strictly to facts within the deponent's personal knowledge. Exhibit every document referred to and carry exhibit numbers into the index.",
    limitations:
      "Opinion and hearsay need objection-safe framing per the Evidence Act (or BSA for post-2023 proceedings) — verify which evidence code governs the matter's era. Advocate review mandatory.",
  },
  {
    key: "execution-application-order-in",
    title: "Execution application (arising out of decree/order)",
    docType: "application",
    practiceArea: "civil",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "decree_holder_name", label: "Decree holder name", kind: "party", required: true, prefillFrom: "fact:partyName" },
      { key: "judgment_debtor_name", label: "Judgment debtor name", kind: "party", required: true },
      { key: "suit_number", label: "Suit/execution number", kind: "text", required: true },
      { key: "court_name", label: "Court", kind: "court", required: true },
      { key: "decree_date", label: "Date of decree", kind: "date", required: true },
      { key: "ex_amount", label: "Amount/drelief sought", kind: "amount", required: false },
    ],
    bodyTemplate: `IN THE COURT OF {{court_name}}

EXECUTION APPLICATION NO. ___ OF {{ex_year}}
(ARISING OUT OF JUDGMENT AND DECREE DATED {{decree_date}})

{{decree_holder_name}} … Decree Holder
Versus
{{judgment_debtor_name}} … Judgment Debtor

APPLICATION FOR EXECUTION OF THE DECREE

1. That the decree-holder obtained the judgment and decree dated {{decree_date}} against the judgment-debtor, particulars whereof are: {{decree_particulars}}.

2. That the decree has not been satisfied; the balance payable is {{ex_amount}} ({{recovery_description}}).

3. Mode of execution sought: {{execution_mode}}.

PRAYER: The decree be executed against the judgment-debtor as per law, with costs.

Decree Holder through
{{advocate_name}}
Date: {{ex_date}}`,
    instructions:
      "Attach the certified decree copy and the plaint, and verify limitation for execution (Order XXI; limitation runs from the date the decree becomes enforceable, per the Limitation Act schedule). State the exact balance due with a calculation sheet.",
    limitations:
      "Execution procedure and permissible modes vary with the decree's nature (money vs specific relief) and the state's civil rules of practice. Advocate review mandatory.",
  },
  {
    key: "board-resolution-bank-account-in",
    title: "Board resolution — opening/operation of bank account",
    docType: "corporate",
    practiceArea: "corporate",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "company_name", label: "Company name", kind: "party", required: true },
      { key: "cin", label: "CIN", kind: "text", required: true },
      { key: "board_meeting_date", label: "Board meeting date", kind: "date", required: true },
      { key: "bank_name", label: "Bank name and branch", kind: "text", required: true },
      { key: "signatory_details", label: "Authorised signatory(ies) and limits", kind: "text", required: true },
    ],
    bodyTemplate: `CERTIFIED TRUE COPY OF THE RESOLUTION PASSED AT THE MEETING OF THE BOARD OF DIRECTORS OF {{company_name}} (CIN: {{cin}}) HELD ON {{board_meeting_date}}

"RESOLVED THAT pursuant to the Memorandum and Articles of Association of the Company, a current account be opened in the name of the Company with {{bank_name}}, and the Company hereby authorises:

{{signatory_details}}

RESOLVED FURTHER THAT the said bank be and is hereby authorised to honour all cheques, drafts and electronic instructions drawn/issued in accordance with the above arrangement, and to act on the instructions of the said signatories until written notice of revocation is received by the bank.

RESOLVED FURTHER THAT the Company Secretary/Director be authorised to submit the requisite forms, KYC documents and this resolution to the bank."

Certified true copy.

{{certifying_signatory}}
{{certifying_capacity}}`,
    instructions:
      "Confirm the quorum and notice requirements for the board meeting under the Company's Articles and the Companies Act, 2013 (SS-1 attestation practice). Banks often require their own format — check before certification.",
    limitations:
      "Authorisation limits (joint/individually, amounts) must match the Company's internal policy. Not a substitute for bank-specific documentation. Review by a company secretary/advocate before certification.",
  },
  {
    key: "engagement-letter-in",
    title: "Advocate engagement letter (terms of engagement)",
    docType: "correspondence",
    practiceArea: "practice_management",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "firm_name", label: "Firm/advocate name", kind: "party", required: true },
      { key: "client_name", label: "Client name", kind: "party", required: true, prefillFrom: "fact:partyName" },
      { key: "engagement_scope", label: "Scope of engagement", kind: "text", required: true },
      { key: "fee_structure", label: "Fees and billing terms", kind: "text", required: true },
      { key: "engagement_date", label: "Date", kind: "date", required: true },
    ],
    bodyTemplate: `{{engagement_date}}

To,
{{client_name}}

Re: Terms of engagement — {{matter_reference}}

Dear {{client_salutation}},

1. Scope: {{firm_name}} is engaged for {{engagement_scope}}. Work outside this scope requires written confirmation.

2. Fees: {{fee_structure}}. Statutory fees, court fees, travel and out-of-pocket expenses are billed separately.

3. Client obligations: timely instructions, truthful disclosure of facts, and provision of documents. Our representations depend on the accuracy of your instructions.

4. Conflict and confidentiality: we act subject to professional conduct rules; your information is protected except as required by law or with your consent.

5. Termination: either party may end this engagement by written notice; fees accrued till termination remain payable. Original documents will be returned on request.

6. No outcome assurance: views expressed are professional opinions on the law as it stands; no assurance of any particular outcome is given.

Please confirm acceptance by countersigning below.

{{firm_name}}
{{advocate_name}}

Accepted: {{client_name}} ______________`,
    instructions:
      "Adjust scope and fees to the actual engagement. Where the Advocates Act/BCI rules restrict fee arrangements (e.g. contingent fees), align the clause accordingly. Retain the countersigned copy on the matter file.",
    limitations:
      "This template is practice-management correspondence, not a retainer agreement for every situation; regulated fee structures and state bar rules vary. Review before issue.",
  },
  {
    key: "application-u1563-in",
    title: "Application u/s 156(3) Cr.P.C. (direction to register/investigate FIR)",
    docType: "application",
    practiceArea: "criminal",
    jurisdictions: ["in"],
    requiredFields: [
      { key: "applicant_name", label: "Applicant name", kind: "party", required: true, prefillFrom: "fact:partyName" },
      { key: "accused_name", label: "Accused name(s)", kind: "party", required: true },
      { key: "police_station", label: "Police station", kind: "text", required: true },
      { key: "offence_description", label: "Offence description", kind: "text", required: true },
      { key: "court_name", label: "Magistrate court", kind: "court", required: true },
    ],
    bodyTemplate: `IN THE COURT OF {{court_name}}

APPLICATION U/S 156(3) Cr.P.C. / S.175(3) BNSS (AS APPLICABLE)

{{applicant_name}} … Applicant
Versus
State (through P.S. {{police_station}}) and {{accused_name}} … Respondents

1. That the applicant has made out disclosure of a cognizable offence: {{offence_description}}.

2. That the applicant approached P.S. {{police_station}} on {{complaint_date}}; the police have {{police_action}} (prior application enclosed).

3. That the Magistrate's direction to register/investigate is warranted: {{grounds_u1563}}.

PRAYER: Direct the concerned SHO to register the FIR and investigate as per law, and to submit a status report.

Applicant through
{{advocate_name}}
Date: {{app_date}}`,
    instructions:
      "Annex the police-station complaint and its acknowledgment. Plead the specific parameters for S.156(3) applications (prior police approach, cognizable disclosure, basic evidentiary material) as settled by the Supreme Court. Verify the BNSS equivalent for post-2023 proceedings.",
    limitations:
      "The Magistrate's discretion depends on the applicant's supporting material; false or exaggerated averments carry prosecution risk (S.182/211 IPC / BNS equivalents). Advocate review mandatory.",
  },
];

/** Seed/refresh the library — idempotent by template key. */
export const seedLibrary = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can seed the template library.");
    }
    let created = 0;
    for (const t of SEED_TEMPLATES) {
      const dupe = await ctx.db
        .query("draftTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
        .then((rows) => rows.find((r) => r.key === t.key));
      if (dupe) continue;
      await ctx.db.insert("draftTemplates", {
        orgId: ac.org._id,
        key: t.key,
        title: t.title,
        docType: t.docType,
        practiceArea: t.practiceArea,
        jurisdiction: t.jurisdictions[0]!,
        version: 1,
        reviewDueOn: undefined,
        authorSource: "Advokate seed library (platform-authored)",
        usageRights: "Firm use permitted; client-facing use after advocate review.",
        approvalStatus: "draft", // requires explicit lawyer approval before use
        requiredFields: t.requiredFields,
        optionalClauses: t.optionalClauses ?? [],
        bodyTemplate: t.bodyTemplate,
        instructions: t.instructions,
        limitations: t.limitations,
        createdById: ac.user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }
    return { created, librarySize: SEED_TEMPLATES.length };
  },
});

/** The library (approved by default; all statuses on request). */
export const list = query({
  args: { includeUnapproved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("draftTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .filter((r) => (args.includeUnapproved ? true : r.approvalStatus === "approved"))
      .sort((a, b) => a.title.localeCompare(b.title));
  },
});

/** Actual library statistics — reported honestly. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rows = await ctx.db
      .query("draftTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const jurisdictions = [...new Set(rows.map((r) => r.jurisdiction))].sort();
    return {
      total: rows.length,
      approved: rows.filter((r) => r.approvalStatus === "approved").length,
      practiceAreas: [...new Set(rows.map((r) => r.practiceArea))].sort(),
      jurisdictions,
      longTermTarget: 300,
    };
  },
});

/** Approve a template (lawyer gate). */
export const approve = mutation({
  args: { templateId: v.id("draftTemplates") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "partner") {
      throw new Error("Only owners and partners can approve templates.");
    }
    const t = await ctx.db.get(args.templateId);
    if (!t || t.orgId !== ac.org._id) throw new Error("Template not found.");
    await ctx.db.patch(args.templateId, {
      approvalStatus: "approved",
      approvedById: ac.user._id,
      approvedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Prefill preview for a template on a matter: fills ONLY from
 * lawyer-confirmed facts / matter fields; everything else stays a
 * visible placeholder. Nothing is invented.
 */
export const prefillPreview = query({
  args: {
    templateId: v.id("draftTemplates"),
    matterId: v.id("matters"),
    optionalClauseKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const t = await ctx.db.get(args.templateId);
    if (!t || t.orgId !== ac.org._id) return null;
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return null;

    const facts = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const confirmed = facts.filter((f) => f.status === "confirmed" && !f.supersededById);

    const values: {
      key: string;
      value: string;
      source: "approved_fact" | "matter_field" | "user" | "missing";
    }[] = [];
    const placeholders = new Set<string>();

    for (const rf of t.requiredFields) {
      let value = "";
      let source: "approved_fact" | "matter_field" | "user" | "missing" = "missing";
      // 1. Confirmed-fact prefill by declared prefillFrom key.
      if (rf.prefillFrom === "fact:partyName") {
        const hit = confirmed.find((f) => f.partyName);
        if (hit?.partyName) {
          value = hit.partyName;
          source = "approved_fact";
        }
      } else if (rf.prefillFrom?.startsWith("date:")) {
        const sig = rf.prefillFrom.slice(5);
        const hit = confirmed.find((f) => f.occurredOn);
        if (hit?.occurredOn && hit.factKey.includes(sig)) {
          value = hit.occurredOn;
          source = "approved_fact";
        }
      }
      // 2. Matter-field fallbacks (already lawyer-maintained data).
      if (!value) {
        const matterMap: Record<string, string | undefined> = {
          court_name: matter.court,
          client_name: matter.clientRole,
        };
        const mv = matterMap[rf.key];
        if (mv) {
          value = mv;
          source = "matter_field";
        }
      }
      if (!value) {
        value = `{{${rf.key.toUpperCase()}}}`; // visible placeholder
        placeholders.add(rf.key);
        source = "missing";
      }
      values.push({ key: rf.key, value, source });
    }

    // Render the body: substitute filled values, keep placeholders visible.
    const chosen = new Set(args.optionalClauseKeys ?? []);
    let body = t.bodyTemplate.replace(/\{\{optional_clauses\}\}/g, () => {
      const picked = (t.optionalClauses ?? []).filter((c) => chosen.has(c.key));
      return picked.map((c) => c.body).join("\n\n");
    });
    for (const v of values) {
      if (v.source !== "missing") {
        body = body.split(`{{${v.key}}}`).join(v.value);
      }
    }
    // Optional-clause variables the lawyer still owes.
    for (const c of t.optionalClauses ?? []) {
      if (!chosen.has(c.key)) continue;
      for (const m of c.body.matchAll(/\{\{([a-z_]+)\}\}/g)) {
        const key = m[1]!;
        if (!values.some((v) => v.key === key)) placeholders.add(key);
      }
    }

    return {
      template: { _id: t._id, title: t.title, version: t.version, key: t.key },
      values,
      missingPlaceholders: [...placeholders],
      renderedBody: body,
      templateHash: sha256Hex(`${t._id}:${t.version}:${body.length}`),
    };
  },
});

/** Save a rendered use (the lawyer's actual draft starting point). */
export const saveUse = mutation({
  args: {
    templateId: v.id("draftTemplates"),
    matterId: v.id("matters"),
    values: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
        source: v.union(
          v.literal("approved_fact"),
          v.literal("matter_field"),
          v.literal("user"),
          v.literal("missing"),
        ),
      }),
    ),
    renderedBody: v.string(),
    missingPlaceholders: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const t = await ctx.db.get(args.templateId);
    if (!t || t.orgId !== ac.org._id) throw new Error("Template not found.");
    if (t.approvalStatus !== "approved") {
      throw new Error("Only APPROVED templates can be used for drafting — approve it first.");
    }
    // Tenant isolation: a draft may only be filed under a matter of the
    // SAME organization (a cross-tenant matterId would leak the draft
    // into another firm's workspace).
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    if (args.renderedBody.length > MAX_TEMPLATE_BODY) {
      throw new Error("Rendered draft too large.");
    }
    const id = await ctx.db.insert("templateUses", {
      orgId: ac.org._id,
      matterId: args.matterId,
      templateId: args.templateId,
      templateVersion: t.version,
      values: args.values,
      renderedBody: args.renderedBody,
      missingPlaceholders: args.missingPlaceholders,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    return { useId: id };
  },
});

/**
 * Compare a use against the ORIGINAL template: added/removed/kept
 * lines, so deviations are reviewable rather than silent.
 */
export const compareUse = query({
  args: { useId: v.id("templateUses") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const use = await ctx.db.get(args.useId);
    if (!use || use.orgId !== ac.org._id) return null;
    const t = await ctx.db.get(use.templateId);
    if (!t) return null;
    const norm = (s: string) =>
      s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const base = norm(t.bodyTemplate.replace(/\{\{optional_clauses\}\}/g, ""));
    const rendered = norm(use.renderedBody);
    const baseSet = new Set(base);
    const renderedSet = new Set(rendered);
    return {
      templateTitle: t.title,
      templateVersion: use.templateVersion,
      kept: rendered.filter((l) => baseSet.has(l)),
      added: rendered.filter((l) => !baseSet.has(l)),
      removed: base.filter((l) => !renderedSet.has(l)),
      unfilledPlaceholders: use.missingPlaceholders,
    };
  },
});

/**
 * DOCX/PDF export: generates a clean HTML document the browser can
 * print-to-PDF or open in Word — server-rendered, no external service.
 * (True .docx packaging can be layered later; the export path and
 * provenance already live here.)
 */
export const exportUseHtml = query({
  args: { useId: v.id("templateUses") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const use = await ctx.db.get(args.useId);
    if (!use || use.orgId !== ac.org._id) return null;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!doctype html><html><head><meta charset="utf-8"><title>Advokate draft</title>
<style>body{font-family:Georgia,serif;margin:48px auto;max-width:760px;line-height:1.5;white-space:pre-wrap}
.placeholder{background:#fff3cd;border-bottom:1px dashed #b8860b}</style></head>
<body>${esc(use.renderedBody)
      .replace(/\{\{([A-Z_]+)\}\}/g, '<span class="placeholder">{{$1}}</span>')
      .replace(/\n/g, "<br/>")}
</body></html>`;
  },
});

/** Internal: count for docs/tests (honest reporting). */
export const countInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("draftTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return rows.length;
  },
});
