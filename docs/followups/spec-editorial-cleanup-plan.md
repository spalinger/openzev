# Spec Editorial Cleanup — Implementation Plan

- Branch: `followup/spec-editorial-cleanup` — base `feat/ui-print-parity`
- Companion note: `docs/followups/spec-editorial-cleanup.md`
- Status: plan drafted 2026-08-25; implementation not started.
- All references below verified against the branch tip at planning time.

## Goal

Editorial-only pass over the redesign spec and ADR 0014: no behaviour claims change,
the docs stop rotting the moment line numbers shift, and the process diary stops
masquerading as specification.

Targets:
- `docs/specs/2026-08-ui-redesign-pdf-style.md` (733 lines)
- `docs/adr/0014-print-parity-and-ui-tokens.md`

## Steps

### 1. Stale line-number citations

The spec has ~11 `index.css:` and ~4 `main.tsx:` citations plus other `file:NNN`
references describing the *pre-sweep* state; several now point at unrelated code.

- Sweep every `file:number` citation. For each: keep the fact, drop the number —
  reference selectors/symbols instead (`the `.sky-gradient` rule in index.css`,
  `the sky-ramp setup in main.tsx`). Delete citations that carry no information
  the surrounding sentence doesn't.
- Rule going forward: no line numbers in specs (they rot); selectors, function names,
  and section anchors only.

### 2. §7.2 "Files first touched (Phase 1)" (spec line ~290)

Post-implementation history (before-state hexes, first-touch list). Compress to one
paragraph: what the sweep did + a pointer to the chrome-sweep commit. The before/after
hex table belongs in the commit, not the spec.

### 3. §9 "Phased rollout" (spec line ~410)

Intro says "every phase = independently mergeable PRs" — the branch shipped as one.
Rewrite the intro: phases remain as a conceptual ordering, note the actual delivery
(single branch). Keep the phase contents.

### 4. §14 "Implementation notes" (spec line ~600, 134-line wall)

- Turn the deviation bullets into a **table**: `Planned | Actual | Reason`.
- Move runbook lore out of the spec into `frontend/screenshots/README.md`
  (create it): redis `FLUSHDB` for demo data, `VITE_DEV_PROXY_TARGET`, the screenshot
  model/browser setup, how to run `npm run screenshots`.

### 5. ADR 0014 decision 2

`docs/adr/0014-print-parity-and-ui-tokens.md` — the ~450-word single bullet gets
broken into sub-bullets; separate the **enforcement** story (CI gates, hex sweep,
token checks) from the **token model** story (primitives → semantics → themes).

## Validation

- Docs-only change: no code, no tests.
- Re-read each changed section: does it still let someone re-implement the feature?
  (AGENTS.md quality bar.) Every *behavioural* claim preserved; only history, numbers,
  and structure change.
- Confirm internal heading references elsewhere still resolve
  (`grep -rn "ui-redesign-pdf-style.md#" docs/`).

## Spec/doc updates

- This branch **is** the doc update; no other specs affected. Link it in the PR per
  `.github/PULL_REQUEST_TEMPLATE.md`.

## Risks & decisions

- Only risk is accidentally deleting a still-true claim while compressing — review
  diff hunk-by-hunk against the note's three criteria (stale citation, diary, buried
  decision).
