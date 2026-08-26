# Spec Editorial Cleanup

Status: not yet started.

## Stale line-number citations

`docs/specs/2026-08-ui-redesign-pdf-style.md` has dozens of line-number citations
describing the *pre-sweep* state (e.g. `index.css:1041` sky gradient, `main.tsx:24-43`
sky ramp). Several now point at unrelated code. Replace with selector/symbol names or delete.

## Diary sections

- §7.2: "Files first touched (Phase 1)" with before-state hexes — post-implementation history.
  Compress to one paragraph pointing at the chrome-sweep commit.
- §9: Five "independently mergeable PRs" — the branch shipped as one.
- §14: 134-line process diary. Split the wall-of-text bullet into a deviations table.
  Move runbook lore (redis FLUSHDB, VITE_DEV_PROXY_TARGET, screenshot model) to
  `frontend/screenshots/README`.

## ADR 0014 decision 2

A ~450-word single bullet — break into sub-bullets. The enforcement story is buried
inside the token story.
