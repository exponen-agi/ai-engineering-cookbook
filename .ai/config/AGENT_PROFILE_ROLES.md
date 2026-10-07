# Agent Profile Roles

> **What this file is:** A team-filled template that defines the multi-agent pod structure for this project.
> Each role maps to specific Spec-Kit commands and Superpowers skills.
>
> **When to update:** When a new agent joins the pipeline, when role responsibilities shift,
> or when a postmortem reveals a handoff gap between roles.
>
> **Spec-Kit mapping:** `.specify/memory/constitution.md` sets the *constraints* agents obey.
> This file sets the *structure* of who does what.

---

## 🗺 Role Overview

| Role | Primary Responsibility | Activated By |
|---|---|---|
| Planner | Spec authorship and clarification | `/speckit-specify`, `/speckit-clarify` |
| Orchestrator | Workflow routing and handoff | Session startup, task transitions |
| Coder | Implementation (TDD loop) | `subagent-driven-development` skill |
| Reviewer | Spec compliance + code quality | `requesting-code-review` skill |
| Verifier | Post-task and pre-merge gates | `verification-before-completion` skill |

---

## Role: Planner

**Responsibilities:**
- Translate human intent into `spec.md` acceptance criteria
- Run `/speckit-clarify` to flush ambiguities before planning begins
- Ensure every acceptance criterion is mechanically verifiable

**Reads (inputs):**
- Human intent statement (plain English feature request)
- `.specify/memory/constitution.md` (constraints to respect)
- `.ai/config/VERIFICATION_AND_EVAL_GUIDE.md` (what "done" means downstream)

**Produces (outputs):**
- `.specify/specs/<feature>/spec.md`
- Clarification Q&A appended to `spec.md`

**Handoff protocol:**
- Signal handoff to Orchestrator when `spec.md` contains all acceptance criteria and clarifications are resolved
- Do not proceed to plan generation without explicit user approval on acceptance criteria

---

## Role: Orchestrator

**Responsibilities:**
- Load context at session start (§ Context Mapping in CLAUDE.md)
- Route tasks to the correct role
- Enforce the Spec-Kit → Superpowers handoff boundary
- Detect when a role is blocked and escalate to the user

**Reads (inputs):**
- `.ai/config/AGENT_PROFILE_ROLES.md` (this file)
- `.ai/config/VERIFICATION_AND_EVAL_GUIDE.md`
- `.specify/memory/constitution.md`
- `.specify/specs/<feature>/tasks.md`

**Produces (outputs):**
- Handoff messages to Coder (see docs/greenfield.md or docs/brownfield.md)
- Escalation notices to the user when gates fail

**Handoff protocol:**
- Issue the standard handoff message (see docs/greenfield.md or docs/brownfield.md) when `tasks.md` is confirmed ready
- After each task cycle, confirm Coder has appended to `.ai/traces/AGENT_LOG_REFLECTIONS.md`

---

## Role: Coder

**Responsibilities:**
- Execute the TDD loop: RED → GREEN → REFACTOR (CLAUDE.md §3)
- Write minimum code to pass each task — no gold-plating
- Append an execution log entry after every implementation session

**Reads (inputs):**
- `.specify/specs/<feature>/tasks.md` (authoritative plan)
- `.specify/specs/<feature>/spec.md` (acceptance criteria)
- `.specify/memory/constitution.md` (constraints)
- `.ai/config/VERIFICATION_AND_EVAL_GUIDE.md` (gate requirements)

**Produces (outputs):**
- Implementation code + tests
- Commit per task cycle (`feat|fix|refactor|test|chore(<slug>): <desc>`)
- Entry appended to `.ai/traces/AGENT_LOG_REFLECTIONS.md`

**Handoff protocol:**
- Signal to Reviewer when RED → GREEN → REFACTOR is complete for a task
- Include the `.ai/traces/` entry reference in the commit message when relevant

---

## Role: Reviewer

**Responsibilities:**
- Stage 1: verify spec compliance (does output match `spec.md` acceptance criteria?)
- Stage 2: verify code quality (clean, minimal, matches existing style?)
- Block on critical issues; fix minor issues inline

**Reads (inputs):**
- `.specify/specs/<feature>/spec.md`
- `.ai/config/VERIFICATION_AND_EVAL_GUIDE.md` (automated check results)
- `.ai/traces/AGENT_LOG_REFLECTIONS.md` (frictions logged by Coder)
- Git diff of the task's commit

**Produces (outputs):**
- APPROVED (proceed to next task) or BLOCKED (return to Coder with specific issue)
- Inline fixes for minor issues, noted in commit message

**Handoff protocol:**
- APPROVED: signal Orchestrator to advance to next task or trigger Verifier
- BLOCKED: return to Coder with the exact spec clause or code quality rule violated

---

## Role: Verifier

**Responsibilities:**
- Run all automated checks defined in `VERIFICATION_AND_EVAL_GUIDE.md`
- Confirm no phantom completions (tasks marked done without implementation)
- Trigger postmortem logging if any gate fails before merge

**Reads (inputs):**
- `.ai/config/VERIFICATION_AND_EVAL_GUIDE.md`
- Full test suite output
- `.specify/specs/<feature>/tasks.md` (completion checklist)

**Produces (outputs):**
- Gate pass/fail report
- If fail: entry in `postmortems/POSTMORTEM_AND_LEARNING_LOG.md`
- If pass: green signal to `finishing-a-development-branch`

**Handoff protocol:**
- Gate pass → hand off to `finishing-a-development-branch` (Superpowers)
- Gate fail → halt, log postmortem, surface specific violation to user

---

## Notes on Spec-Kit and Superpowers Mapping

| Agent Role | Spec-Kit Commands | Superpowers Skills |
|---|---|---|
| Planner | `/speckit-specify`, `/speckit-clarify`, `/speckit-analyze` | — |
| Orchestrator | `/speckit-tasks` (triggers handoff) | Session startup routing |
| Coder | — | `subagent-driven-development`, `test-driven-development` |
| Reviewer | — | `requesting-code-review` |
| Verifier | — | `verification-before-completion`, `finishing-a-development-branch` |
