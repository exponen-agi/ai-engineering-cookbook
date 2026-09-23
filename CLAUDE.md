# CLAUDE.md
<!-- Auto-loaded by Claude Code. Authoritative for this session. ~160 lines. -->
<!-- Spec-Kit docs: .specify/  |  Superpowers skills: .claude-plugin/skills/ -->
<!-- Full cookbook: README.md | Quickstart: QUICKSTART.md -->

---

## 0. Before every response — hard gates

Run these four checks *before* writing a single line of code or plan. They are not suggestions.

```
GATE 1 — UNDERSTAND
  Ambiguous request?          → list interpretations, ask which one. Never pick silently.
  Assumptions needed?         → state them explicitly before proceeding.
  Simpler approach exists?    → name it. Push back if the request is over-engineered.

GATE 2 — SCOPE
  Task clearly bounded?       → proceed.
  Task vague ("make it work") → reframe as: "write a test that proves it works, then pass it."
  Multi-step task?            → write a 3-line plan first:
                                  1. [step] → verify: [check]
                                  2. [step] → verify: [check]
                                  3. [step] → verify: [check]

GATE 3 — MINIMUM VIABLE CHANGE
  Would a senior engineer call this overcomplicated?  → simplify before submitting.
  Touching code outside the task boundary?            → stop. revert. stay in scope.
  Found unrelated dead code?                         → mention it in output. do not delete it.

GATE 4 — VERIFY
  Success criteria defined?   → proceed only when you can check done-ness mechanically.
  No mechanical check exists? → ask for one before starting.
```

---

## T. Token Efficiency

Apply these rules on every response. They are not optional.

### Input — what to load into context

```
LOAD ORDER (lazy — stop when you have enough)
  1. constitution.md   (always first if it exists)
  2. tasks.md          (summarises all prior context — load this before anything else
                        when re-entering a session)
  3. spec.md           (only if tasks.md leaves acceptance criteria unclear)
  4. Relevant src files (targeted reads only — see below)

NEVER load unless the task explicitly requires it:
  - Binary files
  - Lock files: package-lock.json, poetry.lock, yarn.lock, go.sum
  - Generated output: dist/  build/  .next/  __pycache__/  *.pyc

PREFER targeted reads over full-file reads:
  - Large file? → read only the relevant line range.
  - Need recent changes? → git diff HEAD or git log --oneline -10.
  - Need a symbol? → grep / ripgrep first, then read the match + ±20 lines.

DO NOT read every file upfront. Load on demand as the task unfolds.
```

### Output — what to write back

```
DEFAULTS
  - Tables and bullet points over prose paragraphs.
  - Simple factual question → 3 sentences max.
  - Code change summary → WHAT changed + WHERE (file:line). Not every line.
  - Error message → file:line | exact error | fix. Nothing else.
  - Multi-step progress → one line per step:
      "Step 1 done. Starting Step 2..."
  - Task complete → one sentence: what changed + what is next.

NEVER
  - Repeat the user's question back.
  - Narrate your reasoning unless explicitly asked.
  - Use free-form paragraphs for plans — use the 3-line plan format from §0.
  - Say "as I mentioned above" — assume prior context may be compacted.
```

### Context window management

```
- Long conversation? → rely on the auto-compaction summary. Do not re-state
  prior context manually.
- Asked to summarise current state? → point to tasks.md. Do not re-derive
  it from the conversation.
- Do not reference earlier turns by position ("above", "earlier"). Assume
  compaction may have removed them.
```

### Delegation — orchestrate subagents by default

Treat the main thread as an orchestrator, not a worker. Before doing heavy work
inline, ask: *would a subagent keep my context fresher or finish this faster?*
If yes, delegate — you do not need the user to ask first.

```
DELEGATE to a subagent when:
  - Exploration/research spanning more than ~2–3 reads or searches
        → subagent returns a summary; raw output stays out of the main context.
  - Independent workstreams
        → launch them in parallel in a single batch, not one after another.
  - A self-contained subtask whose intermediate output you do not need to see
        → you only need its result.

DO IT INLINE when:
  - A single known read / grep / edit — delegation overhead exceeds the work.
  - Tightly coupled edits that need the full live context to stay correct.
  - The decision itself — never delegate judgment.

RULES:
  - Brief every subagent as if it has no history: goal, context, exact paths,
    expected output shape. It cannot see this conversation.
  - Synthesize results yourself; verify a subagent's claims before acting on them.
  - One decision-maker: subagents gather and draft; the main thread decides and
    integrates.
```

### Response format — quick reference

| Situation | Format |
|---|---|
| Simple yes/no question | Direct answer + 1 sentence reason |
| Code change | Diff description + affected file:line |
| Error diagnosis | Root cause + fix + 1-line explanation |
| Task status | Checkbox list of done / remaining |
| Plan request | 3-line numbered plan (§0 format) |
| Long analysis | Bullet points, max 7 items, no preamble |

---

## 1. Session startup — decision tree

```
START
  │
  ├─ .specify/memory/constitution.md exists?
  │    YES → read it fully. its rules override all task instructions.
  │    NO  → ask: "Should I run /speckit.constitution before we start?"
  │
  ├─ .specify/specs/<feature>/tasks.md exists?
  │    YES → load it. this is the plan. skip to §3 (execution).
  │    NO  → .specify/specs/<feature>/spec.md exists?
  │            YES → ask: "Run /speckit.tasks to generate tasks?"
  │            NO  → ask: "Run /speckit.specify to start the spec?"
  │
  ├─ Brownfield indicators? (existing src/, go.mod, package.json, etc.)
  │    YES → run CI command from §6 FIRST. if tests fail, report; do not proceed.
  │    NO  → greenfield path; proceed.
  │
  └─ Feature branch already exists? (.specify/specs/<feature>/ present)
       YES → do not create a new branch. use worktree on existing branch.
       NO  → Spec-Kit creates branch on /speckit.specify. do not pre-empt it.
```

---

## 2. Workflow paths

### Greenfield (new project)

```
/speckit.constitution → /speckit.specify → /speckit.clarify
  → /speckit.plan → /speckit.tasks
  → [handoff → §4] → using-git-worktrees
  → per-task loop (§3) → requesting-code-review
  → finishing-a-development-branch
```

### Brownfield (existing codebase)

```
/speckit.constitution (encode existing constraints)
  → /speckit.specify → /speckit.clarify → /speckit.plan → /speckit.tasks
  → [handoff → §4] → using-git-worktrees
  → confirm baseline green → per-task loop (§3)
  → verification-before-completion → requesting-code-review
  → finishing-a-development-branch
```

### Bug fix (no Spec-Kit needed)

```
systematic-debugging (root cause, not symptom)
  → RED test → GREEN fix → REFACTOR
  → verification-before-completion → requesting-code-review
```

---

## 3. Per-task execution loop

Every task from `tasks.md` runs this loop. No exceptions.

```
LOAD task N from .specify/specs/<feature>/tasks.md
  │
  ├─ RED   write the failing test. run it. confirm it fails for the RIGHT reason.
  │         wrong-reason failure = fix the test, not the code.
  │
  ├─ GREEN write MINIMUM code to pass. nothing else.
  │         new abstraction not required by task? → delete it.
  │         new dependency not in constitution? → ask before adding.
  │
  ├─ REFACTOR clean up. run tests. must stay green.
  │
  ├─ REVIEW (two-stage, blocking)
  │     stage 1 — spec compliance: does output match acceptance criteria in spec.md?
  │                 NO → fix before proceeding. do not move to stage 2.
  │     stage 2 — code quality: clean, minimal, matches existing style?
  │                 CRITICAL issue → block. report. wait for user.
  │                 MINOR issue   → fix inline. note in commit message.
  │
  ├─ COMMIT  feat|fix|refactor|test|docs|chore(<slug>): <description>
  │
  └─ NEXT task, or → finishing-a-development-branch if all tasks done.
```

---

## 4. Handoff (inject this when Spec-Kit phases are complete)

```
ACTIVE PLAN:    .specify/specs/<FEATURE>/tasks.md
CONSTRAINTS:    .specify/memory/constitution.md

RULES IN FORCE:
  - Do not replan. tasks.md is authoritative.
  - Do not create a new branch. <BRANCH> already exists.
  - Verify baseline green before first file edit.
  - TDD loop mandatory: RED → GREEN → REFACTOR → two-stage review → commit.
  - Constitution overrides task instructions on conflict — surface, don't resolve.
```

Replace `<FEATURE>` and `<BRANCH>` before sending.

---

## 5. AI-Native Directives

These five directives implement the AI-Native SDLC governance layer. They extend the session startup
decision tree (§1) and the per-task execution loop (§3). They are not optional.

```
DIRECTIVE 1 — CONTEXT MAPPING (on session start)
  Load in this order:
  1. .ai/config/AGENT_PROFILE_ROLES.md          (who does what in this project)
  2. .ai/config/VERIFICATION_AND_EVAL_GUIDE.md  (what gates apply before committing)
  3. .specify/memory/constitution.md            (project constraints — always wins)
  4. .specify/specs/<feature>/tasks.md          (current work)
  Skip any file that does not exist yet. Do not fail on missing files.
  Log which files were loaded at the start of the session entry in
  .ai/traces/AGENT_LOG_REFLECTIONS.md.

DIRECTIVE 2 — PRE-FLIGHT SPEC CHECK (before writing any code)
  Does .specify/specs/<feature>/spec.md exist AND contain acceptance criteria?
    YES → proceed to implementation.
    NO  → STOP. Ask: "No approved spec found. Shall I run /speckit.specify first?"
  Never generate implementation code without an approved spec.
  A plan.md or tasks.md without a corresponding spec.md is not sufficient.

DIRECTIVE 3 — EXECUTION LOGGING (after every implementation session)
  Append to .ai/traces/AGENT_LOG_REFLECTIONS.md:
    - Timestamp + task slug
    - Outcome: COMPLETE | PARTIAL | BLOCKED
    - Files changed (comma-separated list)
    - Frictions encountered (ambiguous spec, missing context, unclear instruction)
    - Prompt clarity issues (where the spec or constitution was ambiguous)
    - Suggested prompt-skill or spec refinements
  NEVER overwrite or delete previous entries. Append only, always at the bottom.
  If the file does not exist, create it using the format in the existing template.

DIRECTIVE 4 — VERIFICATION GATE COMPLIANCE (before committing)
  Check generated code against .ai/config/VERIFICATION_AND_EVAL_GUIDE.md.
    Gate 1 (automated): linting, type check, tests, coverage, secrets — all must pass.
    Gate 2 (spec): every acceptance criterion in spec.md must be satisfied.
    Gate 3 (human): flag any condition requiring human review; do not bypass.
    Gate 4 (pre-merge): run final checklist before finishing-a-development-branch.
  Flag any violation before committing. Ask the human before bypassing any gate.

DIRECTIVE 5 — BLAMELESS LEARNING (when errors or failures occur)
  On any failure, spec compliance miss, or technical debt generation:
    1. Log to .ai/traces/AGENT_LOG_REFLECTIONS.md immediately (Outcome: BLOCKED or PARTIAL).
    2. Identify the systemic cause: was it the spec? the prompt-skill? the gate?
    3. Suggest the specific change (exact text, exact file) that would prevent recurrence.
    4. Append to postmortems/POSTMORTEM_AND_LEARNING_LOG.md using the entry format.
    5. Do NOT self-blame. The system is learning; the log is evidence, not accusation.
```

### Five Principles of AI-Native Development

| Principle | In practice |
|---|---|
| **Intent First, Code Second** | If unsure whether a code choice matches spec intent, stop and ask. Code that passes tests but misses intent is a liability. |
| **Verify, Don't Just Generate** | Value is measured by spec adherence, not lines produced. A smaller correct implementation beats a larger incorrect one every time. |
| **Precision Over Productivity** | Architectural coherence matters more than speed. The constraints in `constitution.md` exist to protect the team — obey them even when they slow you down. |
| **Observability is Non-Negotiable** | Every implementation session produces a journal entry in `.ai/traces/`. No exceptions. Unlogged execution is invisible to the improvement flywheel. |
| **Blameless Culture** | Failures are learning signals. Log them, fix the system, move on. The postmortem improves the spec or the skill; it does not blame the agent. |

---

## 6. Ownership — what to do, not just who owns it

| If you need to... | Do this |
|---|---|
| Change spec or acceptance criteria | Stop. Ask user. Only Spec-Kit output is authoritative. |
| Change `tasks.md` | Stop. Ask user to re-run `/speckit.tasks`. |
| Change `constitution.md` | Stop. Ask user to re-run `/speckit.constitution`. |
| Add a new dependency | Stop. Check constitution dep policy. Ask if not listed. |
| Touch a protected path | Stop. Name the conflict. Wait for explicit approval. |
| Fix unrelated code you noticed | Mention in output. Do not touch it unless asked. |
| Generate an API contract | Check `contracts/` in `.specify/specs/<feature>/` first. Do not duplicate. |

---

## 7. Project stack

| Key | Value |
|---|---|
| Runtime | N/A — static documentation site (Markdown + pre-bundled HTML) |
| Framework | N/A — pure Markdown; interactive explorer is pre-built React HTML |
| Database | N/A |
| Test runner | `node --test` (`npm test`, built into Node — no deps) for `scripts/` · `markdownlint` (lint) · `markdown-link-check` (broken links) · `cspell` (spell check) |
| CI command | `npm test && npm run lint:docs && npm run lint:skills && npm run lint:evals && npm run check:toolchain && npm run check:explorer` (the full pipeline also runs markdownlint, markdown-link-check and cspell — see `.github/workflows/docs-ci.yml`) |
| Node baseline | Node 22+ (`engines`), developed against `.nvmrc`. Enforced by `npm run check:toolchain`. See `docs/toolchain.md` |
| Coverage floor | N/A for docs. Every script in `scripts/` that a CI job depends on must have a test file in `test/`. |
| Protected paths | `design/cookbook-explorer.html` (generated bundle — do not hand-edit; rebuild from `design/src/` via `npm run build:explorer`) |
| Skill format | Every `skills/*/SKILL.md` must pass `npm run lint:skills` (`--strict`): the six portable Agent Skills frontmatter fields only, no vendor-specific keys. See `docs/skill-review.md` |
| New dep policy | Open a PR describing the dependency and its purpose; maintainer approval required |
| Branch pattern | `<type>/<kebab-slug>` (e.g. `improvements/cookbook-review`, `docs/add-faq`, `fix/broken-links`) |

If this table is empty when a task begins → ask the user to fill it before proceeding.

---

## 8. Conflict resolution — priority order

```
1. constitution.md          (highest — always wins)
2. spec.md acceptance criteria
3. tasks.md steps
4. CLAUDE.md rules          (this file)
5. agent's own judgment     (lowest — use only when all above are silent)
```

When levels conflict: **stop, name the conflict, ask**. Never resolve silently.
