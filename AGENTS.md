# AGENTS.md

Every coding agent reads this file first. It is the entry point for working in
this repository, and it is short on purpose — it is loaded on every session, so
every line here costs tokens on every run.

## Start here

**Read [`CLAUDE.md`](./CLAUDE.md) before you do anything else.** It is the single
place the rules live: the four pre-flight gates, the token-efficiency policy, the
per-task TDD loop, and the conflict-resolution order. This file does not repeat
those rules; it points at them.

## Setup

No install step and no dependencies. The test suite uses `node:test`, which is
built into Node.

```bash
node --version   # must be 22 or newer — see docs/toolchain.md
```

## Tests

Run the full pipeline before you commit. It is the same command CI runs, and it
works identically on macOS, Windows (PowerShell) and Linux.

```bash
npm test && npm run lint:docs && npm run lint:skills && npm run lint:semconv && npm run lint:evals && npm run lint:hidden && npm run check:toolchain && npm run check:explorer
```

## Rules

- **Never hand-edit `design/cookbook-explorer.html`.** It is generated. Change
  `design/src/` and run `npm run build:explorer`; CI fails on drift.
- **Never restate a fact another document owns.** Link to it instead. The
  registry is [`templates/coherence.config.json`](./templates/coherence.config.json)
  and `npm run lint:docs` enforces it. It runs under `--strict`, so rewording a
  marker sentence in an owning document fails the build instead of quietly
  switching that fact's protection off.
- **Do not add a dependency** without maintainer approval — see CLAUDE.md §7.
- **Every script under `scripts/` that CI depends on needs a test** in `test/`.
- **Every skill in `skills/` must pass `npm run lint:skills`.** It runs under
  `--strict`, so a skill published here uses only the six portable frontmatter
  fields — see [`docs/skill-review.md`](./docs/skill-review.md). The gate reads
  the whole skill folder, so a bundled script is checked too. To quote an
  attack in a document without failing the build, put
  `check-skills-allow: <rule-id>` on that line or the line above it.
- **Where a skill installs to lives in one table:**
  [`bin/tool-profiles.js`](./bin/tool-profiles.js). Do not add a second copy to
  an installer — that table used to exist four times and had already drifted.
  Every path in it carries the vendor documentation it was verified against.
- **Branch names** follow `<type>/<kebab-slug>`, e.g. `docs/add-faq`.
- **Check the open pull requests before you plan.** This repository is worked
  on by unattended sessions as well as people, and nothing in the repo records
  what an in-flight branch already proposes. Two runs have independently
  planned the same change. List the open PRs first, and treat their file lists
  as an exclusion list.
- **Adding a skill?** Follow the seven-file checklist in
  [`CONTRIBUTING.md`](./CONTRIBUTING.md#adding-a-new-skill) — not from memory.

---

## Agents Reference

> **What is an "agent" here?** An agent is an AI model (like Claude, Cursor, or Copilot) given a specific role, a set of input files, and clear constraints — so it behaves predictably within a defined boundary.

This cookbook uses a **five-agent pod** model. Each role has a distinct responsibility and a clear handoff protocol. No single agent does everything.

---

## The Five-Agent Pod

```mermaid
graph LR
    P[🗂️ Planner] -->|spec.md| O[🔀 Orchestrator]
    O -->|tasks.md + /speckit-implement| C[💻 Coder]
    C -->|code diff| R[🔍 Reviewer]
    R -->|approved| V[✅ Verifier]
    V -->|green signal| Prod[🚀 Merge]
```

| Role | One-Line Job | Triggered By |
|---|---|---|
| **Planner** | Turns a human's idea into a verified, testable spec | `/speckit-specify`, `/speckit-clarify` |
| **Orchestrator** | Routes work between roles; enforces the planning → execution boundary (one executor per feature) | Session startup, task transitions |
| **Coder** | Implements each task with TDD (RED → GREEN → REFACTOR) | `/speckit-implement` |
| **Reviewer** | Checks spec compliance first, code quality second | `/speckit-converge`, then code review |
| **Verifier** | Runs all automated gates before merge | All tasks done and converged |

---

## Role Summaries

### 🗂️ Planner

Translates human intent into `spec.md` acceptance criteria. Runs `/speckit-clarify` to flush ambiguities *before* planning. Every criterion must be mechanically verifiable.

**Key rule:** Does not proceed to plan generation without explicit user approval on acceptance criteria.

### 🔀 Orchestrator

Loads context at session start, routes tasks to the correct agent, and enforces the handoff boundary between planning and execution — Spec-Kit is the only executor. Escalates blocked states to the user rather than guessing.

**Key rule:** Runs `/speckit-implement` with the standard handoff constraints (see [Greenfield Guide](./docs/greenfield.md) or [Brownfield Guide](./docs/brownfield.md)) only after `tasks.md` is confirmed ready.

### 💻 Coder

Executes the TDD loop for each task: write a failing test → write minimum code to pass → refactor. Appends an execution log entry to `.ai/traces/AGENT_LOG_REFLECTIONS.md` after every session.

**Key rule:** Writes minimum code only. No gold-plating, no unrequested abstractions.

### 🔍 Reviewer

Two-stage review: (1) spec compliance — does the output satisfy every acceptance criterion? (2) code quality — is it clean, minimal, consistent with the existing style? Blocks on critical issues; fixes minor ones inline.

**Key rule:** Stage 1 must pass before Stage 2 begins.

### ✅ Verifier

Runs all gates defined in `.ai/config/VERIFICATION_AND_EVAL_GUIDE.md`. Catches phantom completions. Triggers a postmortem entry if any gate fails before merge.

**Key rule:** Gate failure halts the branch. Logs to postmortems before surfacing the violation to the user.

---

## Detailed Profiles

Full role specifications — including inputs, outputs, and handoff protocols — are in:

→ [`.ai/config/AGENT_PROFILE_ROLES.md`](./.ai/config/AGENT_PROFILE_ROLES.md)

---

## Command & Skill Mapping

Spec-Kit runs every step. The Superpowers column is **optional**: those skills
add discipline inside a step if the plugin is installed, and never plan or
execute a feature on their own.

| Role | Spec-Kit Commands | Optional Superpowers Skills |
|---|---|---|
| Planner | `/speckit-specify`, `/speckit-clarify`, `/speckit-analyze` | — |
| Orchestrator | `/speckit-tasks`, then `/speckit-implement` (the handoff) | — |
| Coder | `/speckit-implement` | `test-driven-development`, `using-git-worktrees` |
| Reviewer | `/speckit-converge` | `requesting-code-review` |
| Verifier | — (runs the gates in `VERIFICATION_AND_EVAL_GUIDE.md`) | `verification-before-completion`, `finishing-a-development-branch` |
