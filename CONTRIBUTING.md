# Contributing Guide

Thank you for wanting to improve the AI Engineering Cookbook. This guide covers every path from a one-line typo fix to adding a brand-new guide section.

---

## Ways to Contribute

| Type | Effort | Where to start |
|---|---|---|
| Fix a typo or broken link | Minutes | Edit the file directly, open a PR |
| Improve an existing guide | 30 min | Read the guide, identify the gap, edit and PR |
| Add a new extension to the catalog | 1 hour | See [Adding a New Extension](#adding-a-new-extension) |
| Add a real-world example | 2–4 hours | See [Adding a Real-World Example](#adding-a-real-world-example) |
| Improve the interactive explorer | Half day | See [Updating the Interactive Explorer](#updating-the-interactive-explorer) |

---

## Before You Start

1. **Read the [Quickstart](./QUICKSTART.md)** to understand the workflow this cookbook teaches.
2. **Check [open issues](https://github.com/exponen-agi/ai-engineering-cookbook/issues)** — your improvement may already be tracked.
3. **Check the [Glossary](./GLOSSARY.md)** if you encounter unfamiliar terms.

---

## Branch Naming

Use this pattern: `<type>/<kebab-slug>`

| Type | Use for |
|---|---|
| `docs/` | New or improved documentation |
| `fix/` | Broken links, typos, incorrect info |
| `feat/` | New sections, guides, or extensions |
| `ci/` | CI/CD workflow changes |

**Examples:** `docs/add-faq`, `fix/broken-install-links`, `feat/new-owasp-extension`

---

## Markdown Style Guide

- **Tables over prose** for structured information — easier to scan.
- **Mermaid diagrams** for workflows and relationships. Use `graph TD` (top-down) for flows, `sequenceDiagram` for step-by-step interactions.
- **GitHub admonitions** for callout boxes:

  ```markdown
  > [!NOTE]    ← informational, non-blocking
  > [!TIP]     ← helpful suggestion
  > [!WARNING] ← action that could cause problems
  > [!IMPORTANT] ← must-read before proceeding
  ```

- **Code blocks** with language tags for all commands and file contents.
- **Relative links** between docs (e.g. `[Greenfield Guide](./docs/greenfield.md)`).
- One blank line between sections; two blank lines before `---` horizontal rules.

---

## Adding a New Extension

Extensions are community tools that plug into specific points of the workflow. To add one to `docs/extensions.md`:

1. **Identify the category** — which workflow phase does it belong to? (Pre-Spec, Spec, Plan, Implementation, Post-Implementation)
2. **Gather the required info:**
   - Name and link to the extension
   - One-sentence description of what it does
   - Fit: `GF` (Greenfield only), `BF` (Brownfield only), or `Both`
   - Where in the workflow it runs
   - Skip when: the condition under which you wouldn't use it
3. **Add a row** to the correct table in `docs/extensions.md`.
4. **Update the Extension Placement Map** (the mermaid diagram at the top) if the extension adds a genuinely new node.
5. **Check the Decision Matrix** — does your extension fit a common situation? Add a row.

---

## Adding a Real-World Example

Examples live inside the workflow guides (e.g. the Expense Tracker in `docs/greenfield.md`). A good example:

- Uses a realistic, relatable scenario (not "foo/bar")
- Shows all three Spec-Kit artifacts: `spec.md`, `plan.md`, `tasks.md`
- Includes at least one acceptance criterion and its corresponding test

To add one: edit the relevant guide (`docs/greenfield.md` or `docs/brownfield.md`) and add a new `## Real-World Example: <Name>` section following the same format as the existing examples.

---

## Adding a New Skill

This repository publishes portable [Agent Skills](https://agentskills.io/specification).
Adding one touches **eight** files, and until now that list lived only in
people's heads. Follow it in order and CI stays green; skip a step and the test
named in the right-hand column tells you which one.

Replace `my-skill` with your skill's name (lowercase, hyphens, no spaces).

| # | File | What to add | Caught by |
| :---: | :--- | :--- | :--- |
| 1 | `skills/my-skill/SKILL.md` | The skill. `name:` must equal the folder name, and `description:` must say **when** to use it, not only what it does | `npm run lint:skills` |
| 2 | `bin/install-my-skill.js` | The installer. Copy the closest existing one — `bin/install-skill-review.js` is the simplest | `test/published-skills.test.js` |
| 3 | `bin/cli.js` | Three edits: a `subcommands` pair (`'my-skill'` **and** `'install-my-skill'`), a `SKILL_MENU` row, and a line in `showHelp()` | `test/cli.test.js`, `test/published-skills.test.js` |
| 4 | `package.json` | A `bin` entry: `"install-my-skill": "./bin/install-my-skill.js"` | `test/published-skills.test.js` |
| 5 | `docs/my-skill.md` | The guide | `test/published-skills.test.js` |
| 6 | `README.md` | The `npx` block, the Installable Skills table, and the guide directory table | `test/published-skills.test.js` |
| 7 | `index.html` | A card in the "All the guides" section, linking to `docs/my-skill.md` | `test/landing-page.test.js` |
| 8 | `.claude-plugin/marketplace.json` | Name the skill in the `description` — the marketplace is how Claude Code users install all of them at once | `test/plugin-manifest.test.js` |

### Rules that are easy to miss

- **Only the six portable frontmatter fields.** `name`, `description`,
  `license`, `compatibility`, `metadata`, `allowed-tools` — nothing else. CI
  runs `lint:skills` under `--strict`, so a Claude-Code-only field such as
  `when_to_use` fails the build. See [Skill Review](./docs/skill-review.md).
- **Declare provenance.** Every skill here carries
  `metadata.source` pointing at this repository, because our own
  `skill-review` skill tells readers to ask who published a skill.
- **A new script needs a test.** Anything under `scripts/` that a CI job
  depends on needs a matching file in `test/` — see CLAUDE.md §7.
- **Give commands for every platform.** If your skill or guide includes a
  command, give the macOS/Linux form *and* the Windows PowerShell form. The
  install commands themselves are identical everywhere; paths are not.
- **Keep `SKILL.md` under 500 lines.** Move long reference material into
  `references/` inside the skill folder.

### Before you open the pull request

```bash
# macOS and Linux
npm test && npm run lint:docs && npm run lint:skills && npm run lint:semconv && npm run lint:evals && npm run lint:hidden && npm run check:toolchain && npm run check:explorer
```

```powershell
# Windows (PowerShell) — identical
npm test; npm run lint:docs; npm run lint:skills; npm run lint:semconv; npm run lint:evals; npm run lint:hidden; npm run check:toolchain; npm run check:explorer
```

> [!NOTE]
> `design/src/` does **not** need editing for a new skill. The explorer
> documents the workflow, not this repository's own skill catalogue.

---

## Updating the Interactive Explorer

The interactive web UI lives in `design/`. The source is in `design/src/*.jsx`. The `design/cookbook-explorer.html` file is a **pre-built standalone bundle** — it must be regenerated after source changes.

See `design/README.md` for full instructions on editing source files and regenerating the bundle.

> [!IMPORTANT]
> Never hand-edit `design/cookbook-explorer.html` directly — it is generated output. Edit the `.jsx` source files and regenerate.

---

## PR Checklist

Before opening a PR, confirm all items:

- [ ] `npm test` passes (runs the unit tests for the scripts in `scripts/` — needs Node 22 or newer; no install step required)
- [ ] `npm run lint:docs` passes (the doc-coherence gate)
- [ ] `npm run lint:skills` passes (every `SKILL.md` uses only the six portable frontmatter fields — see [Skill Review](./docs/skill-review.md))
- [ ] `npm run lint:hidden` passes (no invisible characters anywhere in the repo — see [Skill Review](./docs/skill-review.md#the-same-scan-across-the-whole-repository))
- [ ] `npm run lint:evals` passes (the example eval dataset still passes its own gate — see [Eval Harness](./docs/eval-harness.md))
- [ ] `npm run check:toolchain` passes (Node baseline and pinned CI tools — see [Toolchain](./docs/toolchain.md))
- [ ] `npm run check:explorer` passes (if you touched `design/src/`, rebuild with `npm run build:explorer` and commit the bundle)
- [ ] A new guide is linked from **both** the README table and `index.html` (a test enforces the second)
- [ ] Spell-checked (no obvious typos)
- [ ] All links work (internal and external)
- [ ] Tone is consistent with the rest of the guide (direct, plain English, no fluff)
- [ ] Mermaid diagrams render correctly in the GitHub preview
- [ ] Tables are correctly aligned
- [ ] No `<!-- placeholder -->` text left in files
- [ ] New file is linked from its parent document (e.g. a new guide is in the README table)
- [ ] If adding an example, the scenario has been manually validated as plausible

---

## Licensing of Contributions

This project is released under the [MIT License](./LICENSE). By opening a pull request you agree that your contribution is licensed under those same terms. There is no separate CLA to sign.

---

## Code of Conduct

The blameless culture this cookbook preaches extends to contributors. Feedback on PRs should be specific, actionable, and constructive — "this section is unclear because X" beats "this is confusing." We improve the content, not each other. Every contribution, however small, makes this resource better for the next engineer who finds it.
