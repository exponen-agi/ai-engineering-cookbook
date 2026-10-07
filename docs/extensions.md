# Curated Community Extensions Guide

This guide covers the 20 curated community extensions selected from the Spec-Kit catalog. These extensions plug into specific points in the Spec-Kit and Superpowers workflow to enhance security, detect scope creep, generate test fixtures, and analyze side effects.

---

## 🗺️ Extension Placement Map

The diagram below shows where each curated extension integrates into the standard AI-Native workflow.

```mermaid
graph TD
    subgraph Pre-Spec Setup
        A[MemoryLint]
        B[Brownfield Bootstrap]
        C[BrownKit]
        D[Project Health Check]
    end

    subgraph Spec Phase
        E[Memory Loader]
        F[Red Team]
        G[Spec Critique]
    end

    subgraph Plan Phase
        H[OWASP LLM Threat Model]
        I[Spec Scope]
        J[Architect Impact Previewer]
        K[Version Guard]
    end

    subgraph Implementation
        L[SpecTest]
        M[Checkpoint Extension]
        N[Iterate]
    end

    subgraph Post-Implementation
        O[Verify Extension]
        P[Verify Tasks]
        Q[Cleanup Extension]
        R[Ripple]
        S[Security Review]
        T[Reconcile]
    end

    Pre-Spec Setup --> Spec Phase
    Spec Phase --> Plan Phase
    Plan Phase --> Implementation
    Implementation --> Post-Implementation
```

---

## 📦 Extension Directory Tables

### 1. Pre-Spec & Setup Extensions

Run these before starting the specification to establish architectural baselines.

| Extension | Description | Fit | Where in Workflow | Skip When |
| :--- | :--- | :---: | :--- | :--- |
| **MemoryLint** | Validates that `constitution.md` has no contradictions, missing fields, or stale rules before starting a new spec cycle. | Both | After modifying `constitution.md` | Greenfield day 0 (no memory exists yet) |
| **Brownfield Bootstrap** | Auto-scans an existing codebase to detect the framework, test runner, folder structure, and key entry points, then outputs a summary for the constitution. | BF | Before `/speckit-constitution` | Codebase is small and you can write it yourself |
| **BrownKit** | Generates a risk profile of an existing codebase — identifying protected files, high-churn modules, and security-sensitive paths the agent should avoid. | BF | After Bootstrap, before constitution | Low-risk internal tool with no security profile |
| **Project Health Check** | Runs the full test suite, checks coverage, and reports the baseline health of the project before any new feature work begins. | Both | At the start of a brownfield feature | Brand new greenfield project |

---

### 2. Spec Phase Extensions

Run these after `/speckit-clarify` but before `/speckit-plan` to harden the spec.

| Extension | Description | Fit | Where in Workflow | Skip When |
| :--- | :--- | :---: | :--- | :--- |
| **Memory Loader** | Automatically loads `constitution.md` into the agent's context at the start of a spec session, ensuring constraints are always respected without manual copy-paste. | Both | Before any `/speckit-*` command | Auto-loading is already configured |
| **Red Team** | Attempts to find gaps, ambiguities, or security issues in a completed spec by simulating adversarial user behavior against the acceptance criteria. | Both | After clarify, before plan | Minor bug fixes or cosmetic refactors |
| **Spec Critique** | Reviews the spec for clarity, completeness, and testability — flags any acceptance criterion that cannot be mechanically verified. | Both | After clarify, before plan | Time-boxed spikes where the spec is incomplete |

---

### 3. Plan Phase Extensions

Run these after `/speckit-plan` but before `/speckit-tasks` to identify scope creep and security risks.

| Extension | Description | Fit | Where in Workflow | Skip When |
| :--- | :--- | :---: | :--- | :--- |
| **OWASP LLM Threat Model** | Analyzes the plan for OWASP LLM Top 10 risks (prompt injection, insecure output, training data poisoning, etc.) and adds security tasks to `tasks.md`. | Both | After `/speckit-plan` | App does not call, route, or consume LLMs |
| **Spec Scope** | Detects scope creep in `plan.md` — flags any planned file change not justified by an acceptance criterion in `spec.md`. | Both | After `/speckit-plan`, before tasks | Rapid prototypes where scope is unbounded |
| **Architect Impact Previewer** | Maps the planned changes to all dependent modules and services, showing the blast radius before implementation starts. | Both | After `/speckit-tasks` | Simple features with no cross-cutting concerns |
| **Version Guard** | Checks that all packages referenced in the plan match the versions in `package.json` / `pyproject.toml` to prevent dependency drift. | Both | After `/speckit-plan` | Non-JS/TS stacks; lockfiles already verified |

---

### 4. Implementation Phase Extensions

Integrate these directly into the Superpowers TDD loop (`RED ➔ GREEN ➔ REFACTOR`).

| Extension | Description | Fit | Where in Workflow | Skip When |
| :--- | :--- | :---: | :--- | :--- |
| **SpecTest** | Auto-generates the failing (RED phase) test stubs directly from the acceptance criteria in `spec.md`, so the agent starts each task with the test already written. | Both | Before the RED phase | Simple tasks where you can write the test yourself |
| **Checkpoint Extension** | Creates a named git checkpoint (stash + tag) after each TDD cycle so you can easily roll back to any mid-feature state. | Both | After each task's TDD cycle | Tasks so small that git history gets bloated |
| **Iterate** | Handles spec changes mid-implementation by rebasing `tasks.md` against the updated `spec.md` without losing completed work. | Both | When requirements change mid-coding | Specifications are stable |

---

### 5. Post-Implementation & Review Extensions

Run these after all tasks are completed to enforce safety gates.

| Extension | Description | Fit | Where in Workflow | Skip When |
| :--- | :--- | :---: | :--- | :--- |
| **Verify Extension** | Runs a final automated compliance check against all acceptance criteria in `spec.md`, reporting any that are not covered by a test. | Both | After final task, before code review | Non-production prototypes |
| **Verify Tasks** | Cross-references `tasks.md` checkboxes against actual git commits to catch phantom completions (tasks marked done with no corresponding code). | Both | Before `finishing-a-development-branch` | Checklist is short enough to audit in 1 min |
| **Cleanup Extension** | Removes dead code, unused imports, and TODO comments introduced during the implementation phase. | Both | After each task refactor | Tasks smaller than 20 lines of code |
| **Ripple** | Analyzes changed files and finds all dependent modules not in the change set that may be silently broken — essential for legacy codebases. | Both | After all tasks complete | Greenfield projects with no legacy code dependencies |
| **Security Review** | Runs SAST (static analysis), secret scanning, and dependency vulnerability checks across all changed files. | Both | Before finishing branch | Internal prototypes or simple frontend styling |
| **Reconcile** | Detects merge conflicts and drift between long-running branches and `main`, then generates a step-by-step reconciliation plan. | Both | On branches open for > 1 week | Short-lived branches merged within 24 hours |

---

## 🛠️ Situation-Based Decision Matrix

Use this matrix to quickly select which extensions to run on a new feature or project:

| If your situation is... | Add these extensions... |
| :--- | :--- |
| **Starting a new brownfield project** | `Brownfield Bootstrap` ➔ `BrownKit` ➔ `MemoryLint` |
| **Building an LLM/RAG application** | `OWASP LLM Threat Model` + `Security Review` |
| **Requirements changed in the middle of coding**| `Iterate` |
| **Working in a complex legacy database** | `Ripple` + `Architect Impact Previewer` |
| **Worried the subagent skipped tasks** | `Verify Tasks` |
| **Long-running branch with merge conflicts** | `Reconcile` |

---

---

## 🚀 Quick-Start Extension Sets

Copy these pre-configured extension sets for common project types:

### Minimal (New Greenfield Project)

No extensions needed for day 1. Add `SpecTest` after your first spec is approved.

### Standard (Most Projects)

`MemoryLint` → `Spec Critique` → `Version Guard` → `SpecTest` → `Verify Tasks` → `Security Review`

### High-Security (LLM / Fintech / Healthcare)

`MemoryLint` → `Red Team` → `Spec Critique` → `OWASP LLM Threat Model` → `Version Guard` → `SpecTest` → `Checkpoint Extension` → `Verify Extension` → `Security Review`

### Legacy Brownfield

`Brownfield Bootstrap` → `BrownKit` → `Project Health Check` → `MemoryLint` → `Red Team` → `Spec Critique` → `Architect Impact Previewer` → `Ripple` → `Verify Tasks` → `Reconcile`

---

### 📖 Next Steps

- Learn how to install uv and tools: [Installation Guide](./installation.md)
- Walk through a greenfield project: [Greenfield Guide](./greenfield.md)
- View the 5-minute setup cheatsheet: [Quickstart Guide](../QUICKSTART.md)
- Hit a problem? Check the [Troubleshooting Guide](./troubleshooting.md)
