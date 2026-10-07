#!/usr/bin/env node
/**
 * check-toolchain
 *
 * Deterministic gate over the *build environment* — the sibling of
 * `check-doc-coherence.js`, which guards the prose. It answers five questions
 * that this repo has silently got wrong before:
 *
 *   1. Do `package.json` engines, `.nvmrc` and every CI workflow agree on
 *      which Node versions are supported?
 *   2. Is every tool CI installs pinned to an exact version, so a release
 *      upstream cannot turn the build red with no change here?
 *   3. Does every GitHub Action carry a fixed ref, and do all workflows agree
 *      on which ref, so a half-finished bump cannot pass unnoticed?
 *   4. Do the docs promise a Node version older than the one we support?
 *   5. Do the docs still tell readers to type the legacy `/speckit.<step>`
 *      form, which most agents no longer resolve?
 *   5. (Advisory) Is our declared minimum still receiving upstream security
 *      fixes, or has it reached end-of-life?
 *
 * No LLM, no network, no dependencies — plain string and regex work over files
 * already in the repo, so it is safe and instant in CI. Same contract as the
 * other gate: exit 0 clean, 1 violations, 2 usage/config error.
 *
 * Usage:
 *   node scripts/check-toolchain.js [options]
 *
 * Options:
 *   --root <dir>   Repo root to scan. Default: cwd.
 *   --json         Emit machine-readable JSON instead of text.
 *   --quiet        Only print on failure.
 *   -h, --help     Show help.
 *
 * A Markdown line that must mention an old Node version for legitimate
 * reasons (history, a migration note) can opt out with the marker
 * `toolchain-ignore` in an HTML comment on that line.
 */

const fs = require("fs");
const path = require("path");

/**
 * End-of-life dates for Node.js LTS majors, from the upstream release
 * schedule (https://github.com/nodejs/Release). Used ONLY for the advisory
 * warning in check 5 — never to fail the build, because a gate that turns red
 * on a calendar date with no code change is a time bomb, not a test.
 *
 * Keep in sync when a new LTS line opens; the test suite pins this shape.
 */
const NODE_EOL = {
  16: "2023-09-11",
  18: "2025-04-30",
  20: "2026-04-30",
  22: "2027-04-30",
  24: "2028-04-30",
  26: "2029-04-30",
};

// --- small helpers ------------------------------------------------------

/**
 * Read the minimum major version out of an npm `engines.node` range.
 * Handles the forms this repo and its docs realistically use:
 * ">=22", ">= 22.0.0", "^22", "22.x", "22".
 *
 * @param {string} range
 * @returns {number|null} the minimum major, or null if unparseable
 */
function parseEnginesMajor(range) {
  if (typeof range !== "string") return null;
  const m = /(\d+)/.exec(range);
  return m ? Number(m[1]) : null;
}

/**
 * Read the major version out of an `.nvmrc` body, ignoring comments,
 * blank lines and a leading "v" (all of which nvm itself accepts).
 *
 * @param {string} body
 * @returns {number|null}
 */
function parseNvmrcMajor(body) {
  for (const raw of String(body).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^v?(\d+)/.exec(line);
    return m ? Number(m[1]) : null;
  }
  return null;
}

/**
 * Substitute `${{ env.NAME }}` references using the workflow's own top-level
 * `env:` block.
 *
 * Workflows are expected to hoist version pins into `env:` so there is one
 * place to bump them. Without this step the checks below would see the literal
 * `${{ env.CSPELL_VERSION }}` and wrongly report an unpinned install.
 *
 * Deliberately hand-rolled rather than pulling in a YAML parser: this repo has
 * zero dependencies, and the shape being read here is a flat block of
 * `KEY: "value"` lines.
 *
 * @param {string} yaml raw workflow text
 * @returns {string} the same text with top-level env references resolved
 */
function resolveWorkflowEnv(yaml) {
  const env = {};
  const lines = yaml.split(/\r?\n/);
  let inEnvBlock = false;

  for (const line of lines) {
    if (/^env:\s*(#.*)?$/.test(line)) {
      inEnvBlock = true;
      continue;
    }
    if (!inEnvBlock) continue;

    // A blank line or a comment does not end the block; anything at column 0 does.
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break;

    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

  return yaml.replace(/\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(env, name) ? env[name] : whole,
  );
}

/**
 * Collect every Node major a workflow file asks CI to run on — both the
 * single-version form (`node-version: "24"`) and the matrix form
 * (`node: ["22", "24"]`).
 *
 * `node-version: ${{ matrix.node }}` is deliberately skipped: it is an
 * indirection, and the matrix line it points at is checked on its own.
 *
 * @param {string} yaml raw workflow text
 * @returns {number[]} majors, in the order encountered
 */
function parseWorkflowNodeVersions(yaml) {
  const found = [];

  for (const m of yaml.matchAll(/node-version:\s*["']?(\d+)/g)) {
    found.push(Number(m[1]));
  }
  for (const m of yaml.matchAll(/^\s*node:\s*\[([^\]]*)\]/gm)) {
    for (const part of m[1].split(",")) {
      const v = /(\d+)/.exec(part);
      if (v) found.push(Number(v[1]));
    }
  }
  return found;
}

/**
 * Find `npm install -g` / `npm i -g` steps and report whether each package
 * carries an exact version pin.
 *
 * An unpinned global install means CI resolves `@latest` at run time: the
 * same commit can pass today and fail tomorrow because someone else shipped
 * a release. That is the single most common source of "it broke and nobody
 * touched it" in a docs pipeline.
 *
 * @param {string} yaml raw workflow text
 * @returns {{spec: string, pinned: boolean}[]}
 */
function parseGlobalInstalls(yaml) {
  const out = [];
  const re = /npm\s+(?:install|i)\s+(?:-g|--global)\s+([^\n#|&;]+)/g;

  for (const m of yaml.matchAll(re)) {
    for (const token of m[1].trim().split(/\s+/)) {
      if (!token || token.startsWith("-")) continue;
      // A scoped package starts with "@", so look for the version separator
      // after the first character only: "@scope/pkg@1.2.3".
      const at = token.indexOf("@", 1);
      const version = at > 0 ? token.slice(at + 1) : "";
      out.push({ spec: token, pinned: /^\d+\.\d+\.\d+$/.test(version) });
    }
  }
  return out;
}

/**
 * Refs that name a moving target rather than a release.
 *
 * `uses: owner/action@main` re-resolves on every run, so whatever is on that
 * branch at the moment CI starts is what executes with your repository token.
 * That is the supply-chain risk `docs/agent-security.md` describes, applied to
 * the build itself.
 */
const MUTABLE_ACTION_REFS = new Set(["main", "master", "develop", "latest", "HEAD"]);

/**
 * Collect every third-party GitHub Action a workflow runs, with the ref it is
 * pinned to.
 *
 * Local actions (`./.github/actions/x`) and container actions (`docker://…`)
 * are skipped: neither is a version pin this gate can reason about.
 *
 * @param {string} yaml raw workflow text
 * @returns {{action: string, ref: string|null, mutable: boolean}[]}
 */
function parseActionUses(yaml) {
  const out = [];

  for (const m of String(yaml).matchAll(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)/gm)) {
    const spec = m[1];
    if (spec.startsWith("./") || spec.startsWith(".\\") || spec.startsWith("docker://")) continue;

    const at = spec.lastIndexOf("@");
    const action = at > 0 ? spec.slice(0, at) : spec;
    const ref = at > 0 ? spec.slice(at + 1) : null;

    out.push({ action, ref, mutable: ref !== null && MUTABLE_ACTION_REFS.has(ref) });
  }
  return out;
}

/**
 * Check every Action pin across all workflows at once.
 *
 * Three failures, in increasing subtlety:
 *
 *   1. **No ref at all** (`uses: actions/checkout`). GitHub resolves the
 *      default branch, so the build has no fixed input.
 *   2. **A mutable ref** (`@main`). Same problem, stated explicitly.
 *   3. **Two workflows on different majors of the same action.** This is the
 *      one a human will not notice. Bumping an action means editing every
 *      `uses:` line by hand, and a partial bump — one file updated, another
 *      missed, or one of several Dependabot pull requests merged — leaves the
 *      repository half-migrated with both halves green. The npm pins in this
 *      repository are hoisted into a workflow `env:` block precisely so they
 *      have one place to change; Action refs have no such single place, so
 *      the gate enforces agreement instead.
 *
 * Note what this deliberately does *not* do: it never asks whether a pin is
 * the newest release. That needs a network call, which would make the gate
 * non-deterministic and fail closed when GitHub is unreachable. Keeping pins
 * current is Dependabot's job (see `.github/dependabot.yml`); keeping them
 * consistent and immutable is this gate's.
 *
 * @param {Map<string, Set<string>>} byAction action name → set of refs seen
 * @param {{action: string, ref: string|null, mutable: boolean, file: string}[]} uses
 * @returns {string[]} error messages
 */
function checkActionPins(byAction, uses) {
  const errors = [];

  for (const u of uses) {
    if (u.ref === null) {
      errors.push(
        `${u.file} uses "${u.action}" with no version. GitHub resolves the ` +
          "action's default branch at run time, so the build has no fixed " +
          'input. Pin it as "action@v1".',
      );
    } else if (u.mutable) {
      errors.push(
        `${u.file} pins "${u.action}" to the moving ref "${u.ref}". Whatever ` +
          "is on that branch when CI starts runs with this repository's token. " +
          "Pin a release tag instead.",
      );
    }
  }

  for (const [action, refs] of byAction) {
    if (refs.size > 1) {
      errors.push(
        `"${action}" is pinned to ${[...refs].sort().join(" and ")} in different ` +
          "workflows. A half-finished bump leaves both halves green while only " +
          "one is actually current. Use one ref everywhere.",
      );
    }
  }

  return errors;
}

/**
 * Strip the Markdown punctuation that sits between the word "Node" and the
 * version number, so a claim is matched on what the reader *sees* rather than
 * on the raw source.
 *
 * This exists because of a real escape. The prerequisites list in
 * `docs/installation.md` read:
 *
 *     - **Node.js** (v18 or higher): Required if you are ...
 *
 * A reader sees "Node.js (v18 or higher)" — a minimum-version promise, and a
 * wrong one, since Node 18 left support in April 2025. The gate saw
 * `Node.js** (v18`, where the emphasis markers and the opening bracket sit
 * between the name and the number, so none of the patterns below matched and
 * the stale line survived every CI run.
 *
 * Only emphasis, inline-code ticks and opening brackets are removed. That is
 * enough to normalise every form this repo's docs actually use, and narrow
 * enough that it cannot invent a claim: each pattern still requires digits
 * immediately after the name, so "Node.js (see the table below)" stays unmatched.
 *
 * @param {string} line
 * @returns {string}
 */
function normalizeClaimLine(line) {
  return String(line)
    .replace(/[*_`]+/g, "")
    .replace(/[([]/g, " ");
}

/**
 * Find claims in prose about the minimum Node version, e.g. "Node.js 18+",
 * "Node 20 or newer", "requires Node 18". Only the *minimum* forms are
 * matched — a bare mention of a version is not a promise.
 *
 * Fenced code blocks are skipped. What is inside one is a command, a sample
 * transcript or a quoted error message — an illustration, not a sentence
 * telling the reader which Node to install. Scanning them produced false
 * positives on this gate's own documentation, which quotes its own output.
 *
 * @param {string} md Markdown body
 * @returns {{line: number, major: number, text: string}[]}
 */
function parseNodeClaims(md) {
  const patterns = [
    /Node(?:\.js)?\s*v?(\d+)\s*\+/i,
    /Node(?:\.js)?\s*v?(\d+)\s+or\s+(?:newer|later|above|higher)/i,
    /requires?\s+Node(?:\.js)?\s*v?(\d+)/i,
    /needs\s+Node(?:\.js)?\s*v?(\d+)/i,
  ];
  const claims = [];
  let fence = null; // the exact ``` or ~~~ run that opened the current block

  String(md)
    .split(/\r?\n/)
    .forEach((line, idx) => {
      const delim = /^\s*(`{3,}|~{3,})/.exec(line);
      if (delim) {
        // A fence closes only on the same character, at least as long as the
        // one that opened it — so a ```` block can contain a ``` line.
        if (fence === null) {
          fence = delim[1];
          return;
        }
        if (delim[1][0] === fence[0] && delim[1].length >= fence.length) {
          fence = null;
          return;
        }
      }
      if (fence !== null) return;
      if (line.includes("toolchain-ignore")) return;
      const probe = normalizeClaimLine(line);
      for (const re of patterns) {
        const m = re.exec(probe);
        if (m) {
          // Report the line as written, not as normalised — the author has to
          // find it in the file.
          claims.push({ line: idx + 1, major: Number(m[1]), text: line.trim() });
          break;
        }
      }
    });
  return claims;
}

/**
 * Spec-Kit steps this repo documents. Used to recognise a *step reference*
 * rather than any sentence that happens to contain the word.
 */
const SPECKIT_STEPS = new Set([
  "constitution",
  "specify",
  "clarify",
  "plan",
  "checklist",
  "tasks",
  "analyze",
  "implement",
  "converge",
  "taskstoissues",
]);

/**
 * Find references to the *legacy* dot form of a Spec-Kit step, e.g.
 * `/speckit.specify`.
 *
 * Why this is a gate and not a style preference: since the Spec-Kit 0.16 line,
 * `specify init` installs Spec-Kit as **agent skills** by default, and a skill
 * is invoked with a hyphen (`/speckit-specify`). The dot form only resolves if
 * the project was deliberately initialised in command mode
 * (`--integration-options="--commands"`). So a doc that tells a reader to type
 * `/speckit.specify` is telling most readers to type something their agent does
 * not recognise — and the failure is silent, because an unknown slash command
 * just does nothing.
 *
 * Unlike `parseNodeClaims`, this scans **inside** fenced code blocks too. A
 * command a reader copies is exactly where the wrong prefix does its damage.
 *
 * Escape hatch: `speckit-legacy-ok` skips a line, so a document can explain that
 * the dot form exists and is legacy. That is the same shape as the
 * invisible-character problem this repo already hit twice — a document that
 * teaches you to recognise a stale form has to be able to quote it.
 *
 * The marker also works on a fence's **info string**, which exempts the whole
 * block:
 *
 *     ```text speckit-legacy-ok
 *     /speckit.specify   ← quoted on purpose, inside a diagram
 *     ```
 *
 * A per-line HTML comment cannot be used inside a fenced block, because it
 * would render as visible text to the reader. The info string is invisible in
 * every Markdown renderer, which is why the block form exists.
 *
 * @param {string} md Markdown body
 * @returns {{line: number, step: string, text: string}[]}
 */
function parseLegacySpecKitRefs(md) {
  const re = /speckit\.([a-z]+)/gi;
  const hits = [];
  let fence = null; // the exact run that opened the current block
  let fenceExempt = false; // did that fence's info string carry the marker?

  String(md)
    .split(/\r?\n/)
    .forEach((line, idx) => {
      const delim = /^\s*(`{3,}|~{3,})/.exec(line);
      if (delim) {
        if (fence === null) {
          fence = delim[1];
          fenceExempt = line.includes("speckit-legacy-ok");
          return;
        }
        if (delim[1][0] === fence[0] && delim[1].length >= fence.length) {
          fence = null;
          fenceExempt = false;
          return;
        }
      }
      if (fenceExempt) return;
      if (line.includes("speckit-legacy-ok")) return;
      for (const m of line.matchAll(re)) {
        const step = m[1].toLowerCase();
        if (!SPECKIT_STEPS.has(step)) continue;
        hits.push({ line: idx + 1, step, text: line.trim() });
      }
    });
  return hits;
}

/** Directory names that are generated, vendored, or not ours to check. */
const SKIP_DIRS = new Set([".git", "node_modules", ".specify", ".claude", "design"]);

/**
 * Repo-relative prefixes holding append-only history: the execution journal
 * and the postmortem log. Those files exist to record what was true at the
 * time, so an old version number in them is the point, not drift. Scanning
 * them would make every future journal entry that mentions a past baseline
 * fail the build.
 */
const HISTORY_PREFIXES = [".ai/traces/", "postmortems/"];

/** Recursively collect Markdown files, skipping generated and historical trees. */
function walkMarkdown(dir, root, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      walkMarkdown(full, root, acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      if (HISTORY_PREFIXES.some((p) => rel.startsWith(p))) continue;
      acc.push(rel);
    }
  }
  return acc;
}

// --- the gate -----------------------------------------------------------

/**
 * Run every toolchain check against a repository.
 *
 * Pure with respect to the filesystem it is handed: tests point `root` at a
 * fixture directory, and `now` at a fixed date, so nothing depends on the
 * machine or the calendar.
 *
 * @param {object} [options]
 * @param {string} [options.root] repo root. Default: cwd.
 * @param {Date}   [options.now]  date used for the end-of-life warning.
 * @returns {{ok: boolean, baseline: number|null, errors: string[], warnings: string[], stats: object}}
 */
function checkToolchain({ root = process.cwd(), now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const stats = { workflows: 0, nodeVersions: [], globalInstalls: 0, actionUses: 0, docs: 0, legacySpecKit: 0 };

  // --- 1. the baseline itself -------------------------------------------
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {
      ok: false,
      baseline: null,
      errors: [`package.json not found at ${pkgPath}`],
      warnings,
      stats,
    };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (e) {
    return {
      ok: false,
      baseline: null,
      errors: [`package.json is not valid JSON: ${e.message}`],
      warnings,
      stats,
    };
  }

  const enginesRange = pkg.engines && pkg.engines.node;
  const baseline = parseEnginesMajor(enginesRange);
  if (baseline === null) {
    return {
      ok: false,
      baseline: null,
      errors: [
        'package.json must declare "engines": { "node": ">=<major>" } — ' +
          `found ${JSON.stringify(enginesRange)}`,
      ],
      warnings,
      stats,
    };
  }

  // --- 2. .nvmrc agrees with the baseline -------------------------------
  const nvmrcPath = path.join(root, ".nvmrc");
  if (!fs.existsSync(nvmrcPath)) {
    errors.push(
      ".nvmrc is missing — contributors and CI have no single answer to " +
        '"which Node do I use?". Create it with the version you develop against.',
    );
  } else {
    const nvmrcMajor = parseNvmrcMajor(fs.readFileSync(nvmrcPath, "utf8"));
    if (nvmrcMajor === null) {
      errors.push(".nvmrc does not contain a readable version number");
    } else if (nvmrcMajor < baseline) {
      errors.push(
        `.nvmrc pins Node ${nvmrcMajor}, below the package.json baseline of ` +
          `${baseline}. Raise .nvmrc, or lower engines.node.`,
      );
    }
  }

  // --- 3. workflows: Node versions, tool pins, and Action pins ----------
  const wfDir = path.join(root, ".github", "workflows");
  if (fs.existsSync(wfDir)) {
    const files = fs
      .readdirSync(wfDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort();
    stats.workflows = files.length;

    // Action pins are compared across every workflow at once, so they are
    // collected here and checked after the per-file loop.
    const actionUses = [];
    const refsByAction = new Map();

    for (const file of files) {
      const rel = `.github/workflows/${file}`;
      const yaml = resolveWorkflowEnv(fs.readFileSync(path.join(wfDir, file), "utf8"));

      for (const major of parseWorkflowNodeVersions(yaml)) {
        stats.nodeVersions.push(major);
        if (major < baseline) {
          errors.push(
            `${rel} runs on Node ${major}, below the package.json baseline of ` +
              `${baseline}. CI would be testing a version the package says it ` +
              "does not support.",
          );
        }
      }

      for (const install of parseGlobalInstalls(yaml)) {
        stats.globalInstalls += 1;
        if (!install.pinned) {
          errors.push(
            `${rel} installs "${install.spec}" without an exact version. CI ` +
              "would resolve @latest at run time, so an upstream release can " +
              'turn this build red with no change here. Pin it as "pkg@1.2.3".',
          );
        }
      }

      for (const use of parseActionUses(yaml)) {
        stats.actionUses += 1;
        actionUses.push({ ...use, file: rel });
        if (use.ref !== null) {
          if (!refsByAction.has(use.action)) refsByAction.set(use.action, new Set());
          refsByAction.get(use.action).add(use.ref);
        }
      }
    }

    errors.push(...checkActionPins(refsByAction, actionUses));
  }

  // --- 4. docs do not promise an older Node than we support -------------
  for (const rel of walkMarkdown(root, root, [])) {
    stats.docs += 1;
    const body = fs.readFileSync(path.join(root, rel), "utf8");
    for (const claim of parseNodeClaims(body)) {
      if (claim.major < baseline) {
        errors.push(
          `${rel}:${claim.line} tells readers Node ${claim.major} is enough, ` +
            `but package.json requires ${baseline}: "${claim.text}"`,
        );
      }
    }
    for (const hit of parseLegacySpecKitRefs(body)) {
      stats.legacySpecKit += 1;
      errors.push(
        `${rel}:${hit.line} uses the legacy Spec-Kit command form ` +
          `"/speckit.${hit.step}". Skills mode is the default since 0.16, so ` +
          `write "/speckit-${hit.step}". If the line has to quote the old form, ` +
          `mark it with speckit-legacy-ok: "${hit.text}"`,
      );
    }
  }

  // --- 5. advisory: is the baseline still supported upstream? -----------
  const eol = NODE_EOL[baseline];
  if (eol && new Date(eol) < now) {
    warnings.push(
      `Node ${baseline} reached end-of-life on ${eol} and no longer receives ` +
        "upstream security fixes. Raise engines.node, .nvmrc and the CI matrix " +
        "to a supported LTS line.",
    );
  }

  return { ok: errors.length === 0, baseline, errors, warnings, stats };
}

// --- CLI ----------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(
      [
        "check-toolchain — keep the Node baseline and the CI toolchain honest",
        "",
        "Usage: node scripts/check-toolchain.js [--root <dir>] [--json] [--quiet]",
        "",
        "Checks:",
        "  1. package.json engines, .nvmrc and every CI workflow agree",
        "  2. every `npm install -g` in CI is pinned to an exact version",
        "  3. every `uses:` names a fixed ref, and one ref per action repo-wide",
        "  4. no doc promises an older Node than package.json requires",
        "  5. (warning only) the baseline is still supported upstream",
        "",
        "Exit codes: 0 clean | 1 violations found | 2 usage error",
      ].join("\n") + "\n",
    );
    return 0;
  }

  const rootFlag = args.indexOf("--root");
  const root = path.resolve(
    rootFlag >= 0 && rootFlag + 1 < args.length ? args[rootFlag + 1] : process.cwd(),
  );
  const json = args.includes("--json");
  const quiet = args.includes("--quiet");

  let result;
  try {
    result = checkToolchain({ root });
  } catch (e) {
    process.stderr.write(`! check-toolchain failed to run: ${e.message}\n`);
    return 2;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }

  for (const w of result.warnings) {
    process.stdout.write(`! ${w}\n`);
  }

  if (!result.ok) {
    process.stdout.write(
      `\n✗ check-toolchain: ${result.errors.length} problem(s) found.\n\n`,
    );
    for (const e of result.errors) process.stdout.write(`  • ${e}\n`);
    process.stdout.write("\n");
    return 1;
  }

  if (!quiet) {
    process.stdout.write(
      `✓ check-toolchain: Node >=${result.baseline}, ` +
        `${result.stats.workflows} workflow(s), ` +
        `${result.stats.globalInstalls} pinned CI tool(s), ` +
        `${result.stats.actionUses} action pin(s), ` +
        `${result.stats.docs} docs scanned.\n`,
    );
  }
  return 0;
}

// Only run the CLI when invoked directly, so unit tests can `require()` this
// file and exercise the checks against fixtures.
if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  checkToolchain,
  parseEnginesMajor,
  parseNvmrcMajor,
  resolveWorkflowEnv,
  parseWorkflowNodeVersions,
  parseGlobalInstalls,
  parseActionUses,
  checkActionPins,
  normalizeClaimLine,
  parseNodeClaims,
  parseLegacySpecKitRefs,
  SPECKIT_STEPS,
  NODE_EOL,
  MUTABLE_ACTION_REFS,
  main,
};
