# DPDP_REVIEW.md — Privacy / DPDP Act Assessment Record

**Owner:** CJ GLOBAL (Advokate)
**Last updated:** 30 Sep 2026 (turn 14)
**Status of this document: an honest WORKING RECORD. The assessment is
OUTSTANDING — nothing here is a compliance claim.**

---

## 1. What this document is (and is not)

Section 10 of the independently developed workspace requirements asks us to
assess applicable Indian privacy obligations — including the Digital Personal
Data Protection Act, 2023 (DPDP) — **against current official sources and the
actual deployment**, and to document hosting locations, providers, retention
and transfers **without assuming a blanket data-residency obligation or
claiming compliance merely because settings exist**.

This document records what is verifiably true about the deployment today, and
lists what remains unassessed. It does **not** assert DPDP compliance. No
qualified privacy professional has reviewed this product. That review is a
recorded, open item.

## 2. Deployment facts (verified)

| Item | Current state |
| --- | --- |
| Application host | Vite + React SPA served by the platform's managed hosting (provider details recorded by the operator; not independently audited for this review) |
| Backend / database | Convex managed cloud (deployment `moonlit-elk-307`), logical tenant isolation, **shared infrastructure** |
| Logical isolation | Every query/mutation resolves the caller's session and filters by `orgId`; matter-level and document-level rules layered on top; cross-tenant denial is under automated test |
| Physical separation | **None claimed.** Firms share infrastructure with logical isolation — this is stated accurately everywhere, never as per-firm physically separate storage |
| Data residency | **Not assessed.** Convex managed cloud region selection is an operator-side fact we have not verified, and no blanket India-residency obligation is assumed or asserted for this deployment |
| Encryption in transit | Provider-managed TLS (platform default) |
| Encryption at rest / credentials | Merchant secrets and API credentials encrypted with AES-256-GCM (`crypto.ts`, @noble/ciphers) under a server-side master key; the key itself is platform-environment-managed |
| Authentication | `@convex-dev/auth` session-based auth; anonymous users excluded from access contexts |
| Sub-processors | Convex (cloud), platform hosting, Razorpay (payments, when merchants configure it) — a formal sub-processor register is NOT maintained yet |

## 3. Personal data actually processed (observed in schema/code)

- Advocates & staff: name, email, role, permissions, audit trail of actions.
- Clients: name, contact details, matter records, uploaded documents,
  portal messages.
- Client-portal uploads: documents with uploader identity, checksums
  (declared-by-uploader, honestly labelled), malware-scan status (or an honest
  `awaiting_configuration` marker — no false "scanned" claims).
- Audit log: actor identity + action per organization, hash-chained for
  tamper evidence (§ auditChain).
- Payments: handled by Razorpay; card data is NOT stored by Advokate.

## 4. Controls already implemented (verified by tests)

- Server-side tenant and matter isolation; role-based permissions; cross-tenant
  read/write denial tests (multiple suites).
- No cross-firm AI retrieval; AI surfaces re-check org + matter access.
- Auditable sensitive changes via the hash-chained audit log.
- Human-approval boundaries: the AI cannot file, sign, send legal
  communications, pay, or change permissions — enforced by separate
  permission-gated workflows, not prompts.

## 5. Gaps / outstanding items (honest list)

1. **DPDP gap analysis against the final Rules** — not started. The Act's
   phased obligations (notice content, consent managers, children's data,
   significant-fiduciary duties, breach reporting timelines) must be mapped
   against **current official sources** at assessment time, not from memory.
2. **Notice + consent flows** for data principals — not implemented.
3. **Retention, deletion and legal-hold policy** — a deletion path exists for
   some entities; a documented, tested retention schedule is missing.
4. **Sub-processor register + DPAs** — not maintained.
5. **Data-residency determination** — must follow the assessment of what the
   law actually requires for this deployment, plus verification of the
   provider's region commitments. No assumption made either way.
6. **Breach-response playbook** — not written.
7. **Qualified review** — the entire area awaits a review by a qualified
   privacy professional. Until then this file records facts, not conclusions.

## 6. Review cadence

Re-verify this document whenever: the deployment region or providers change,
a new personal-data category is introduced, or at each major delivery
checkpoint — whichever comes first.
