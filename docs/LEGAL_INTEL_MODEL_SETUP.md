# Advokate AI — model configuration & verification checklist (§26.6, demand 6)

Status: **Updated 29 Sep 2026 after the live turn-10 checklist.** The
runner was executed on the deployment and reports:
`Live AI is not configured on this deployment (OPENAI_API_KEY missing)` —
i.e. **the key is still not visible to moonlit-elk-307 itself**, despite
having been added via the platform key UI. The platform's Keys/API-keys
storage does not automatically populate **Convex deployment environment
variables**; the key must be set on the deployment (step 1 below), which
only the owner can do. Everything else about the workflow was verified
live this turn (see `ADVOKATE_PROGRESS.md`, turn 10).

**Exact target (verified 29 Sep 2026):** the preview's Convex deployment is
**moonlit-elk-307** (`https://moonlit-elk-307.convex.site`). Set the key as
an environment variable **on that deployment** — this is the step that was
missing:

1. Convex dashboard → **moonlit-elk-307** → Settings → Environment
   Variables → add `OPENAI_API_KEY` (value from your provider account).
   Owner CLI alternative from the project root: `bunx convex env set
   OPENAI_API_KEY` and paste the value when prompted — the terminal is the
   only place the value is ever typed; never chat, never source.
2. **Verify without exposing the value:** `bunx convex env list
   --names-only` must list `OPENAI_API_KEY` (names only, no values). Then
   submit any research request from the workspace: a done answer (or a
   citation-flagged answer) proves the key works; the specific "Live AI is
   not configured" error proves it is still missing. This is exactly how
   the turn-10 checklist proved the deployment still lacked the key.

The runner uses model **gpt-4o-mini**; no other settings are required.
Note: this deployment serves the dev preview — setting the key there
exercises the real research workflow without touching any production
deployment.

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
