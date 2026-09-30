# PROVENANCE.md — Third-Party Assets, Licences & Originality Register

**Owner:** CJ GLOBAL (Advokate)
**Last updated:** 30 Sep 2026 (turn 14)
**Scope:** every externally sourced asset used by Advokate, plus the originality
statement for work we authored. The live per-organization register also exists
in the product itself (`thirdPartyProvenance` table, seeded by
`provenanceRegister.seed`).

---

## 1. Originality statement

Advokate is built from our own authorized codebase and independently written
requirements:

- No competitor source code, proprietary prompts, template collections,
  documentation, marketing text, screenshots, illustrations, or distinctive
  interface designs were copied or adapted.
- No competitor product names are used. Internal working module names
  (matter briefs, drafting revisions, daily priorities, audit chain,
  provenance register) are neutral and **not** represented as
  trademark-cleared.
- No competitor application was scraped, its model behaviour cloned, or its
  access restrictions bypassed.
- Interface design, copy, and prompts are original Advokate work.
- Development history is preserved in this repository's git log and in
  `ADVOKATE_PROGRESS.md`. We do **not** describe this work as a formal
  clean-room implementation.

## 2. Open-source dependencies (runtime)

Licences verified against the versions pinned in `package.json`.

| Asset | Version | Licence | Notice required | Usage scope | Status |
| --- | --- | --- | --- | --- | --- |
| react | ^19.2.0 | MIT | Yes | UI runtime | cleared |
| react-dom | ^19.2.0 | MIT | Yes | UI renderer | cleared |
| react-router | ^7.18.4 | MIT | Yes | Client routing | cleared |
| convex | ^1.46.0 | Convex Open Source Licence (functional-source style, **not** a standard OSI licence) | Yes | Backend functions + managed database | **flagged_for_review** |
| @convex-dev/auth | ^0.0.90 | Apache-2.0 | Yes | Authentication | cleared |
| @noble/ciphers | ^2.4.0 | MIT | Yes | AES-256-GCM secret encryption | cleared |
| @noble/hashes | ^2.4.0 | MIT | Yes | SHA-256 / HMAC / HKDF (audit chain, TOTP) | cleared |
| framer-motion | ^12.23.25 | MIT | Yes | Interface motion | cleared |
| lucide-react | ^0.555.0 | ISC | Yes | Interface icons | cleared |
| tailwindcss | ^4.1.17 | MIT | Yes | Styling engine | cleared |
| recharts | ^2.15.4 | MIT | Yes | Charts | cleared |
| zod | ^4.1.13 | MIT | Yes | Client-side schema validation | cleared |

Dev-tooling dependencies (Vite, TypeScript, Vitest, Convex CLI, shadcn/ui
component sources copied under their licences at generation time) follow the
same policy; they are build-time only and not distributed to end users.

**Flagged item — Convex:** the licence is source-available with a permissive
conversion date per release. Our usage (SaaS built on Convex managed cloud) is
believed to be within terms, but a **qualified rights review is OUTSTANDING**
and recorded as such in the in-app register. We make no claim of guaranteed
non-infringement and no patent/trademark clearance has been completed for any
stack component.

## 3. Third-party data, fonts, icons, datasets

- **No third-party fonts** are bundled; the product uses system font stacks.
- **No third-party legal datasets** are currently embedded. The Indian legal
  corpus ingested by the Legal Intelligence module is loaded from sources the
  operator supplies; each source row records its own origin and access basis
  (`legalSources` provenance, turn 6–7 work). Public accessibility of a source
  was never treated as permission; ingestion proceeded only where the operator
  asserted an authorized basis, recorded per source.
- Cause-list import and two-way calendar sync remain **staged**: they will be
  built only against authorized APIs, with source timestamps shown, and are
  recorded as not implemented.

## 4. Template content

The drafting library ships **6 templates** (actual reviewed inventory; the 300+
figure is a long-term target, reported as an actual count by `templates.stats`
and never claimed in advance):

1. Legal notice — demand of payment
2. Complaint under Section 138 NI Act
3. Written statement (civil suit)
4. Regular bail application
5. Mutual non-disclosure agreement (India)
6. Affidavit of evidence (by affirmation)

All six are **authored in-house for CJ GLOBAL** from the record of law —
licence recorded as `proprietary (CJ GLOBAL)`. No external template collection
was imported. Firm-provided and suitably licensed third-party materials can be
added later; the register (this file and the in-app table) must record their
permission basis before use. Every template carries jurisdiction, document
type, version, review-date field, required fields, provenance, and approval
status.

## 5. Notices

MIT/ISC/Apache licences require retention of copyright and licence notices.
The required notices are preserved in the upstream distributions we ship and
must accompany any redistribution of Advokate source. Location recorded in the
in-app register per entry (`noticeLocation`).

## 6. Register maintenance

- Add an entry to **this file and the in-app register** before any new
  third-party asset is used in production code.
- Uncertain rights → status `flagged_for_review`, never silently `cleared`.
- Review outcomes (who decided, on what basis) are recorded in the register
  note and dated.
- This file is audited at the end of each build turn.
