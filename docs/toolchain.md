# Toolchain and Node Baseline

This page answers two questions: **which Node.js version does this repo need**, and **why does CI pin every tool to an exact version**. It also tells you exactly what to change when either one moves.

If you only want to run the tests, you need one thing: Node.js 22 or newer. There is nothing to install.

---

## 🧭 Why this page exists

A documentation repository looks like it has no dependencies. This one nearly does — the scripts use only what ships inside Node itself. But two things still drift quietly, and both broke here before:

| What drifts | What it looks like when it breaks |
| :--- | :--- |
| The **Node version** | `package.json` says one thing, CI tests another, and a guide tells readers a third. Someone follows the guide, hits an error, and the guide was wrong. |
| The **CI tools** | Nobody changed the repo, but the build went red overnight, because a tool CI installs published a new release with a new rule. |

Neither is caught by a normal test. So there is a gate for them:

```bash
npm run check:toolchain
```

It runs in CI as the **Toolchain Consistency** job, and you can run it locally at any time. It needs no network and finishes instantly.

---

## 🟢 The Node baseline

| Setting | Value | Where it lives |
| :--- | :--- | :--- |
| Minimum supported | **Node 22** | `package.json` → `engines.node` |
| Version we develop against | **Node 24** | `.nvmrc` |
| Versions CI tests | **22 and 24**, on macOS, Windows and Linux | `.github/workflows/docs-ci.yml` |

**Why 22 and not 20?** Node 20 reached end-of-life on **30 April 2026**. After that date the Node project stops publishing security fixes for it, so telling readers it is fine to use would be telling them to run something unpatched. Node 22 is supported until April 2027 and Node 24 until April 2028.

### Installing the right version

If you use a version manager, `.nvmrc` means you do not have to think about it:

```bash
# macOS and Linux — nvm reads .nvmrc automatically
nvm use

# If that version is not installed yet
nvm install
```

```powershell
# Windows (PowerShell) — nvm-windows does not read .nvmrc,
# so pass the version from that file explicitly
nvm install 24
nvm use 24
```

If you do not use a version manager, download an LTS build from [nodejs.org](https://nodejs.org) and check it:

```bash
# macOS and Linux
node --version
# Expected: v22.x.x or v24.x.x
```

```powershell
# Windows (PowerShell)
node --version
# Expected: v22.x.x or v24.x.x
```

---

## 📌 Why every CI tool is pinned

The docs pipeline installs three tools. Each one is pinned to an exact version in the `env:` block at the top of `.github/workflows/docs-ci.yml`:

| Tool | What it checks | Blocks a merge? |
| :--- | :--- | :--- |
| `markdownlint-cli` | Markdown formatting | Yes |
| `markdown-link-check` | Broken links | Yes |
| `cspell` | Spelling | No — advisory only |

An **unpinned** install (`npm install -g cspell`) quietly means `cspell@latest`. The version CI installs is then decided by whoever publishes next, not by this repository. The practical result is a build that passes on Monday and fails on Tuesday with nobody having touched the code — the single most confusing kind of CI failure, because the diff contains no cause.

Pinning trades that for a deliberate, visible bump.

### Bumping a pinned tool

Do this in its **own** pull request, so that if the new version changes behaviour, the cause is obvious and the revert is one click.

```bash
# 1. See what is available
npm view markdownlint-cli version

# 2. Edit the version in .github/workflows/docs-ci.yml (the env: block at the top)

# 3. Run the same check CI runs, with the new version
npx markdownlint-cli@0.49.1 "**/*.md" --ignore node_modules --ignore ".specify/**" --ignore ".claude/**"

# 4. Confirm the gate still agrees with itself
npm run check:toolchain
```

```powershell
# Windows (PowerShell) — identical commands; only the quoting differs
npm view markdownlint-cli version
npx markdownlint-cli@0.49.1 "**/*.md" --ignore node_modules --ignore ".specify/**" --ignore ".claude/**"
npm run check:toolchain
```

> [!NOTE]
> **Dependabot cannot do this for you.** It updates the GitHub Actions in `.github/dependabot.yml`'s scope, but the tool pins live inside `run:` shell steps, which it does not read. That is the trade-off for having no `package.json` dependencies at all — and `check:toolchain` is what makes sure the pins are never simply dropped to make the problem go away.

---

## ✅ What the gate actually checks

| # | Check | Fails the build? |
| :---: | :--- | :--- |
| 1 | `package.json` engines, `.nvmrc` and every CI workflow agree on the supported Node versions | Yes |
| 2 | Every `npm install -g` in a workflow names an exact version (`pkg@1.2.3`, not `pkg` or `pkg@^1.2.3`) | Yes |
| 3 | Every `uses:` names a fixed ref, and the same action is pinned to the same ref in every workflow | Yes |
| 4 | No Markdown file tells readers an older Node version is enough than `package.json` requires | Yes |
| 5 | No Markdown file tells readers to type the legacy `/speckit.<step>` form | Yes |
| 6 | The declared minimum is still supported upstream | **No** — prints a warning only |

Check 6 is deliberately a warning. A gate that turns red because a date passed, with no change to the code, is a time bomb: it breaks an unrelated pull request and teaches people to ignore the gate. It tells you, and a human decides when to move.

### 🧩 Check 3 — why Actions get their own rule

The npm tool pins live in one `env:` block, so bumping one is a single edit. Action pins do not: `uses: actions/checkout@v7` is repeated on every job in every workflow. That difference is what makes them rot.

Picture the usual sequence:

```text
Dependabot opens 2 pull requests
        │
        ├─ "bump actions/checkout"     → merged      → 7 lines now on v7
        └─ "bump actions/setup-node"   → not merged  → 4 lines still on v4
                                                          │
        Every job still passes. Nothing is red. ───────────┘
        The repository is half-migrated and nothing says so.
```

Check 3 turns that silent state into a failed build. It asserts two things, neither of which needs the network:

- **Every `uses:` carries a ref.** `uses: actions/checkout` resolves the action's default branch when the job starts, so the build has no fixed input.
- **One ref per action, repository-wide.** If `actions/checkout` is `@v7` in one workflow and `@v4` in another, the gate names both and fails.

It deliberately does **not** ask whether a pin is the newest release. That needs a network call, which would make the gate non-deterministic and turn every GitHub outage into a red build. Keeping pins *current* stays Dependabot's job; keeping them *consistent and fixed* is the gate's.

> [!WARNING]
> **Stale Action majors are a real deadline, not a style preference.** GitHub retires the Node runtime that older action versions run on. When that happens, a workflow pinned to a retired major stops starting at all — the failure is not a warning inside your job, it is the job never running. Merge the Dependabot pull requests.

### When a check fires

Every message names the file, the line, and the fix. For example:

```text
✗ check-toolchain: 1 problem(s) found.

  • docs/installation.md:42 tells readers Node 20 is enough,
    but package.json requires 22: "Requires **Node.js 20+**."
```

If a sentence genuinely has to mention an older version — a history note, a migration guide — mark that line so the gate skips it:

```markdown
Node 20 was the baseline until April 2026. <!-- toolchain-ignore -->
```

Use it sparingly. Each one is a promise that a human checked the line.

Two things are never scanned, so you do not need the marker there:

- **Fenced code blocks.** What is inside one is a command or a sample transcript — an illustration, not a sentence telling you what to install.
- **The append-only history** in `.ai/traces/` and `postmortems/`. Those files record what was true at the time. An old version number in them is the point.

### 🧩 Check 5 — why a stale Spec-Kit prefix is a build failure

Spec-Kit steps used to be slash *commands* written with a dot
(`/speckit.specify`). <!-- speckit-legacy-ok --> Since the 0.16 line, `specify init` installs them as
**agent skills**, and a skill is invoked with a **hyphen**
(`/speckit-specify`). The dot form only still resolves if the project was
deliberately initialised in command mode with
`--integration-options="--commands"`.

So a doc that tells a reader to type the dot form is handing most readers a
string their agent does not recognise — and this is the worst shape a docs bug
can have, because **nothing errors**. An unknown slash command simply does
nothing, so the reader concludes the *workflow* is broken rather than the
instruction.

```text speckit-legacy-ok
  Doc says:   /speckit.specify          Reader's agent (skills mode)
                    │                            │
                    └────────── types ───────────┤
                                                 │
                                        no such skill → silence
                                                 │
                              "this cookbook doesn't work" ◀── wrong conclusion
```

Unlike check 4, this one **does** scan inside fenced code blocks — a fenced
command is exactly what a reader copies, so a wrong prefix in one is the whole
problem. If a line genuinely has to quote the old form, mark it:

```markdown speckit-legacy-ok
The old form was `/speckit.specify`. <!-- speckit-legacy-ok -->
```

To exempt a whole diagram or example block, put the marker on the fence itself —
it is invisible to readers, unlike an HTML comment inside the block:

````markdown speckit-legacy-ok
```text speckit-legacy-ok
/speckit.specify   ← quoted on purpose
```
````

The per-agent prefix table lives in
[Installation → How to invoke Spec-Kit in your agent](./installation.md#️-how-to-invoke-spec-kit-in-your-agent).

---

## 🔁 Raising the baseline later

When Node 22 approaches end-of-life, the gate will start printing its warning. The change is then four files:

1. `package.json` → `"engines": { "node": ">=24" }`
2. `.nvmrc` → the new version to develop against
3. `.github/workflows/docs-ci.yml` → the `unit-tests` matrix and `NODE_DEFAULT`
4. Any doc that states a minimum — run `npm run check:toolchain`, and it lists them for you

Then confirm:

```bash
npm test && npm run check:toolchain
```

---

### 📖 Next Steps

- [Installation & Setup](./installation.md) — prerequisites for using the cookbook itself.
- [Contributing](../CONTRIBUTING.md) — branch naming, style guide, and the PR checklist.
- [Doc Coherence](./doc-coherence.md) — the sibling gate that guards the prose instead of the build.
- [Back to the main README](../README.md).
