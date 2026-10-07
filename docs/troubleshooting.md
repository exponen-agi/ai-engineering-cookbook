# Troubleshooting Guide

Common failure scenarios and their fixes. If you're stuck, check here first before opening an issue.

For bugs not covered here, [open a GitHub issue](https://github.com/exponen-agi/ai-engineering-cookbook/issues) with your OS, agent version, and the exact error message.

---

## Installation Problems

### ❓ `specify` command not found after `uv tool install`

**Symptom:** Running `specify --version` returns `command not found` or `'specify' is not recognized`.

**Cause:** `uv tool install` places binaries in a directory that isn't on your system PATH yet.

**Fix:**

```bash
# Check where uv puts tool binaries
uv tool dir

# Add that directory to your PATH (example for bash/zsh)
export PATH="$(uv tool dir):$PATH"

# Make it permanent — add the line above to ~/.bashrc or ~/.zshrc
```

On Windows (PowerShell):

```powershell
# Fix for the current terminal session only
$env:PATH = "$(uv tool dir);" + $env:PATH

# Make it permanent for your user account, so you do not repeat this every session
[System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";" + (uv tool dir), "User")
```

> [!IMPORTANT]
> The permanent Windows setting is only read when a terminal starts. Close the terminal and open a new one, then run `specify --version` again.

**Prevention:** After any `uv tool install`, run `uv tool dir` and confirm it's in your PATH.

---

### ❓ `uv` command not found after install

**Symptom:** `uv --version` fails immediately after the install script completes.

**Cause:** The install script updated your PATH in the shell profile, but the current terminal session hasn't reloaded it.

**Fix:**

```bash
# macOS — the default shell is zsh
source ~/.zshrc

# Linux — most distributions default to bash
source ~/.bashrc

# Windows — close and reopen the terminal, or run:
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
```

---

### ❓ `specify init` fails with a permission error on Windows

**Symptom:** `specify init . --integration claude` returns `PermissionError` or `Access is denied`.

**Cause:** PowerShell is not running as Administrator, or the project folder is in a protected location (e.g. `C:\Program Files\`).

**Fix:**

1. Move your project folder to a non-protected location (e.g. `C:\Users\<you>\projects\`).
2. Or run PowerShell as Administrator for the init step only.

---

### ❓ Superpowers plugin not activating in the agent

**Symptom:** Agent doesn't respond to `/sp-status` or Superpowers skills like `using-git-worktrees` don't trigger.

**Cause:** Plugin install command may have failed silently, or the agent needs a restart.

**Fix:**

1. Restart the agent completely (close and reopen Claude Code / Cursor).
2. Re-run the install command for your agent (see [Installation Guide](./installation.md)).
3. Verify by typing `/sp-status` in the chat — you should see a list of active skills.

> [!NOTE]
> Plugin install commands can change between agent versions. If the command in the Installation Guide fails, check the [official Superpowers repository](https://github.com/obra/superpowers) for the current command.

---

## Spec-Kit Workflow Problems

### ❓ The agent created a new git branch instead of using the existing one

**Symptom:** After pasting the handoff message, you see a new branch like `feat/my-feature-2` when `001-my-feature` already existed.

**Cause:** The handoff message was missing the constraint `Do not create a new git branch`. The agent defaulted to its own branching behavior.

**Fix:** Checkout the correct branch manually and delete the duplicate:

```bash
git checkout 001-my-feature
git branch -D feat/my-feature-2
```

Then re-paste the handoff message with all constraints included.

**Prevention:** Always include `Do not create a new git branch (already created by Spec-Kit)` in your handoff message.

---

### ❓ `/speckit-clarify` asks irrelevant or confusing questions

**Symptom:** Spec-Kit asks questions that have nothing to do with your feature.

**Cause:** The spec description in `/speckit-specify` was too vague or included implementation details (how) instead of user requirements (what).

**Fix:** Re-run `/speckit-specify` with a clearer, user-facing description:

- ❌ `Build a JWT auth system using bcryptjs and Express middleware`
- ✅ `Allow users to log in with email and password. Return an error if credentials are wrong. Keep them logged in across page refreshes.`

---

### ❓ The agent rewrote `spec.md` from scratch

**Symptom:** `spec.md` looks completely different from what Spec-Kit generated.

**Cause:** The agent wasn't given the handoff message and decided to plan from scratch.

**Fix:** Restore the original `spec.md` from git:

```bash
git checkout HEAD -- .specify/specs/<feature>/spec.md
```

Then re-paste the correct handoff message.

---

### ❓ `tasks.md` checkboxes are all marked done, but no code was written (Phantom Completion)

**Symptom:** The agent reports all tasks complete, but the repository has no new code commits.

**Cause:** The agent checked off tasks without implementing them — a phantom completion.

**Fix:**

1. Run `git log --oneline` to see how many commits actually exist for the feature.
2. Uncheck all tasks that have no matching commit: edit `tasks.md` and change `[x]` back to `[ ]`.
3. Re-run the handoff with an explicit instruction: `For each task, you MUST write a git commit before marking it complete.`

**Prevention:** Use the `Verify Tasks` extension after implementation — it cross-references `tasks.md` checkboxes against actual commits.

---

### ❓ Agent generated `plan.md` but skipped `tasks.md`

**Symptom:** `.specify/specs/<feature>/plan.md` exists but `tasks.md` does not.

**Cause:** You didn't run `/speckit-tasks` after `/speckit-plan`.

**Fix:** Run `/speckit-tasks` — it converts the plan into the checkbox checklist. Don't paste the handoff message until `tasks.md` exists.

---

## TDD Loop Problems

### ❓ RED test passed immediately — it never failed

**Symptom:** The agent writes a test, runs it, and it passes before any implementation code exists.

**Cause:** The test was either (a) testing something trivially true, (b) importing a function that already exists elsewhere, or (c) written incorrectly (e.g. it always returns true).

**Fix:** Inspect the test. Ask the agent: `Why does this test pass without an implementation? What is it actually asserting?` A correct RED test should fail with a `function not found`, `module not found`, or assertion failure.

---

### ❓ The agent skipped the RED phase and wrote code first

**Symptom:** You see implementation code commits before any test commits.

**Cause:** The TDD constraint wasn't clear enough in the handoff message.

**Fix:** Interrupt the agent and say: `Stop. Roll back to before the implementation. Write the failing test first, confirm it fails, then write the implementation.`

**Prevention:** Include `Write tests before implementation code (TDD). The test MUST fail before you write any implementation.` in your handoff message.

---

### ❓ Tests pass but behavior doesn't match the spec acceptance criteria

**Symptom:** All tests are green, but the feature doesn't behave as described in `spec.md`.

**Cause:** The tests were written to match the implementation rather than the acceptance criteria. This is "testing the code, not the spec."

**Fix:** Go back to `spec.md`, re-read each acceptance criterion, and for each one ask: "Which test proves this criterion passes?" If no test maps to a criterion, that test is missing.

---

### ❓ Test coverage dropped below the floor after refactor

**Symptom:** Gate 1 CI check fails with `coverage: 74% (floor: 80%)`.

**Cause:** Refactoring removed or simplified code that was previously covered, without adjusting tests.

**Fix:** Run coverage locally to find uncovered lines:

```bash
# Node.js / vitest
pnpm test --coverage

# Python / pytest
pytest --cov=src --cov-report=term-missing
```

Add tests for the uncovered lines before committing.

---

## Governance / Log Problems

### ❓ Agent forgot to append to `AGENT_LOG_REFLECTIONS.md`

**Symptom:** A task was committed but `.ai/traces/AGENT_LOG_REFLECTIONS.md` has no new entry.

**Cause:** The agent didn't follow DIRECTIVE 3 from `CLAUDE.md`.

**Fix:** Append a manual entry now — describe the outcome (COMPLETE / PARTIAL / BLOCKED), any frictions, and suggestions. The log must never be left empty after an implementation session.

---

### ❓ Gate 3 triggered but the agent proceeded anyway

**Symptom:** A protected path was modified and committed without human approval.

**Cause:** The agent bypassed the gate — either `constitution.md` didn't list the path as protected, or the agent ignored the constraint.

**Fix:**

1. Revert the commit: `git revert HEAD`
2. Add the path to `constitution.md` as a protected path.
3. Re-run the task with the corrected constitution loaded.
4. Log this as a gate escape in `postmortems/POSTMORTEM_AND_LEARNING_LOG.md`.

---

## General Problems

### ❓ Interactive Explorer (`cookbook-explorer.html`) shows a blank page

**Symptom:** Opening the HTML file in a browser shows nothing, or the browser console shows CORS errors.

**Cause:** Some browsers block local file requests for bundled HTML. This is a browser security restriction, not a bug.

**Fix:**

- Use a simple local server instead of opening the file directly:

  ```bash
  # macOS / Linux
  python3 -m http.server 8080

  # Windows (PowerShell)
  python -m http.server 8080

  # Then open http://localhost:8080/design/cookbook-explorer.html
  ```

  > [!NOTE]
  > On macOS and most Linux distributions the command is `python3`, because plain `python` may be missing or point to Python 2. On Windows the command is `python`.

- Or use the [hosted GitHub Pages version](https://exponen-agi.github.io/ai-engineering-cookbook/design/cookbook-explorer.html).

---

### ❓ Mermaid diagrams don't render on GitHub

**Symptom:** Mermaid code blocks show as raw text in GitHub instead of diagrams.

**Cause:** GitHub renders Mermaid in markdown, but only when the code block uses ` ```mermaid ` (not ` ```mermaid{...} ` or other variants). The preview may also lag by a few seconds.

**Fix:** Ensure the code fence is exactly:

````
```mermaid
graph TD
    ...
```
````

No extra attributes or language qualifiers. Hard-refresh the GitHub page after pushing.
