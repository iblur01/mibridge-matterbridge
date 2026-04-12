# Local CI & Release Script — Design

**Date:** 2026-04-12
**Status:** Approved

## Overview

A single Node.js ESM script (`scripts/release.mjs`) that mirrors the GitHub Actions CI pipeline locally and optionally performs a full release (version bump, git tag, npm publish, push).

## Two Modes

```
node scripts/release.mjs            # CI mode: validate only
node scripts/release.mjs --release  # Release mode: CI + bump + publish
```

## CI Pipeline Steps

Sequential steps, colored output (✅/❌), stops immediately on failure:

| # | Step | Command |
|---|------|---------|
| 1 | Prérequis | Check branch (main), no uncommitted changes, NPM_TOKEN present |
| 2 | Clean build | `npm run cleanBuild` |
| 3 | Lint | `npm run lint` |
| 4 | Format check | `npm run format:check` |
| 5 | Typecheck | `npm run test:typecheck` |
| 6 | Tests + coverage | `npm run test:coverage` |
| 7 | Production build | `npm run buildProduction` |

Release-only steps (after all CI steps pass):

| # | Step | Details |
|---|------|---------|
| 8 | Version bump | Parse commits since last tag → patch/minor/major → update `package.json` |
| 9 | Git commit + tag | `git commit -am "chore: release vX.Y.Z"` + `git tag vX.Y.Z` |
| 10 | npm publish | `npm publish --tag latest` |
| 11 | Push | `git push && git push --tags` (triggers GitHub Actions as a bonus) |

## Version Detection (Conventional Commits)

Parse `git log <lastTag>..HEAD` (or all commits if no tag exists):

- `feat!:` or `BREAKING CHANGE` in body → **major**
- `feat:` → **minor** (if no major)
- anything else (`fix:`, `refactor:`, `chore:`, `test:`, ...) → **patch**

Pre-release versions (e.g. `0.0.1-alpha`) are treated as the base for bumping (strip pre-release suffix first).

If no releasable commits found since last tag → abort with error.

## Output Style

```
🚀 Starting CI pipeline...
  ✅ Clean build          (2.3s)
  ✅ Lint                 (1.1s)
  ✅ Format check         (0.4s)
  ✅ Typecheck            (3.2s)
  ✅ Tests + coverage     (8.7s)
  ✅ Production build     (1.9s)

🎉 CI passed!

── Release mode ──────────────────────
  📦 Bump: 0.0.1-alpha → 0.1.0  (minor — 3 feat commits)
  ✅ package.json updated
  ✅ Git commit + tag v0.1.0
  ✅ Published to npm (latest)
  ✅ Pushed tag to GitHub
```

## npm Token

Read from `process.env.NPM_TOKEN`. No auto-loading of `.env` — export in shell or source manually. Script aborts before touching anything if token is missing in `--release` mode.

## Constraints

- Zero new dependencies — uses only Node.js built-ins (`child_process`, `fs`, `path`)
- File: `scripts/release.mjs`
- Added to `package.json` scripts: `"release:ci"` and `"release"`
- `matterbridge` assumed already linked locally (not re-cloned)
