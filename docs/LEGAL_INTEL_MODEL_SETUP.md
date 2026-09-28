# Advokate AI — model configuration & verification checklist (§26.6, demand 6)

Status: **Instructions current 2026-09-28.** `OPENAI_API_KEY` is NOT
configured on this deployment, so source-backed **generation** (tier 4) is
pending. Everything below is how to configure it securely and what to run
afterwards. Until then, the honest runner behavior is: an explicit
"Live AI is not configured" error — nothing is fabricated.

## 1. Secure configuration — hard rules

1. **Never request or paste API keys in ordinary chat.** Not here, not in
   any conversation. Keys shared in chat must be treated as compromised and
   rotated immediately.
2. Keys are set **only** via secure channels:
   - Convex dashboard → your deployment → Settings → Environment Variables,
     or `bunx convex env set OPENAI_API_KEY sk-...` from a trusted terminal.
3. Keys are read **server-side only** (`process.env.OPENAI_API_KEY` inside
   the Convex runner). They are never shipped to the browser, never logged,
   never written to documents or archives, and never committed.
4. The source archive of this repository deliberately excludes all
   `.env*`/credential files; if a key ever appears in tracked content,
   rotate it first, then purge history.
5. Rotation: rotate the key from the provider dashboard if it may have been
   exposed; update the env var; redeploy.

## 2. What the key enables (and what stays gated)

| Capability | Without key (today) | With key |
| --- | --- | --- |
| Retrieval, applicability, citations, refusal contract | ✅ live (template-generated evidence) | ✅ live |
| `researchCheck` workspace panel (clickable passages) | ✅ live (template answer) | ✅ live |
| LLM-written research answers (`legal_research` jobs) | ❌ honest "not configured" error | ✅ generation runs |
| Backend citation validation of the answer | Pipeline ready | ✅ runs post-generation; failures gate the job to `needs_citation_review` |
| Uncited-assertion detection | Pipeline ready | ✅ flags substantive claims lacking citation markers |

## 3. After configuring the key — mandatory verification checklist

Run these in order; record outcomes (including failures) in
`ADVOKATE_PROGRESS.md` before claiming tier 4. The runner's citation gate
is backend code: it extracts citations, validates each against the stored
corpus (existence / pinpoint / quote fidelity), writes
`legalCitationChecks` rows, and flips the job to `needs_citation_review`
when any check fails — a failing job must never be presented as verified.

1. **Happy path over real text.** Start a `legal_research` AI job from a
   matter (India, conduct date 2024-03-01): expect IPC-era retrieval, an
   answer whose citations all validate, status `done`.
2. **Post-commencement check.** Same question with date 2024-08-15: expect
   BNS provisions (e.g. § 103) and era-correct cross-references.
3. **Refusal: unsupported jurisdiction.** France (no sources registered):
   expect the refusal contract, no substantive answer, status `done` with
   the refusal recorded.
4. **Refusal: non-existent provision.** "What does section 999B BNS
   provide?" — expect a refusal to paraphrase; no invented citation.
5. **Fabricated quote must fail.** Submit a job whose answer quotes a
   passage not in the corpus; expect `quoteVerified=false`,
   `needs_citation_review`, and the blocking banner — NOT a verified mark.
6. **Pinpoint check.** A citation naming "§ 484" of CrPC must resolve; a
   citation naming "§ 485" must fail anchor validation.
7. **Uncited-assertion check.** An answer asserting "the accused shall be
   liable" with no citation marker must be flagged by the detector and
   require review.
8. **Record results** — pass AND fail — as automated evidence. A browser
   pass (demand 8) and qualified legal review (tier 5) remain separate,
   pending steps and are never inferred from these checks.

## 4. Cost and safety notes

- The runner caps citation checks per job and reuses stored versions —
  no unbounded loops.
- Model temperature and token limits are set in `src/convex/aiRunner.ts`;
  the 9-part verifiable-answer contract and the source rules (evidence not
  instructions, no invented citations, no outcome guarantees) are part of
  the prompt and re-validated in code afterwards.
- If the key is removed later, the runner degrades to the honest
  "not configured" error — it never silently falls back to model memory.
