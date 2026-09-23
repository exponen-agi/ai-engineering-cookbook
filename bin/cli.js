#!/usr/bin/env node

const { fork } = require('child_process');
const path = require('path');
const readline = require('readline');

const subcommands = {
  'doc-coherence': './install-doc-coherence.js',
  'install-doc-coherence': './install-doc-coherence.js',
  'prompt-optimizer': './install-prompt-optimizer.js',
  'install-prompt-optimizer': './install-prompt-optimizer.js',
  'skill-review': './install-skill-review.js',
  'install-skill-review': './install-skill-review.js',
  'eval-harness': './install-eval-harness.js',
  'install-eval-harness': './install-eval-harness.js'
};

// Coding-agent environments the installer can target. `tool` is passed through
// to the underlying installer via `--tool <tool>`. "others" lands in a generic
// .coding/ folder the user renames to whatever their agent expects.
const ENVIRONMENTS = [
  { tool: 'claude', label: 'Claude Code', dir: '.claude/skills' },
  { tool: 'cursor', label: 'Cursor', dir: '.cursor/skills' },
  { tool: 'vscode', label: 'GitHub Copilot (VS Code)', dir: '.github/skills' },
  { tool: 'codex', label: 'OpenAI Codex', dir: '.codex/skills' },
  { tool: 'antigravity', label: 'Google Antigravity', dir: '.agents/skills' },
  { tool: 'roo', label: 'Roo Code', dir: '.roo/skills' },
  { tool: 'others', label: 'Others (installs to .coding/, rename it afterward)', dir: '.coding/skills' }
];

function showHelp() {
  process.stdout.write(
    [
      '\x1b[1m\x1b[36mAI Engineering Cookbook Skill Installer\x1b[0m',
      'Installs portable Agent Skills (SKILL.md) and supporting hooks/gates into your repositories.',
      '',
      '\x1b[1mUsage:\x1b[0m',
      '  npx ai-engineering-cookbook <skill-name> [options]',
      '  # Run with no arguments for an interactive picker (skill + environments).',
      '  # Fallback (if installed globally or locally):',
      '  ai-engineering-cookbook <skill-name> [options]',
      '',
      '\x1b[1mAvailable Skills:\x1b[0m',
      '  \x1b[1mdoc-coherence\x1b[0m     Kills cross-document drift with a single-source-of-truth gate.',
      '  \x1b[1mprompt-optimizer\x1b[0m  Optimizes agent prompts on session-start with custom scorecards.',
      '  \x1b[1mskill-review\x1b[0m      Vets a SKILL.md before you trust it — spec, portability, hidden characters.',
      '  \x1b[1meval-harness\x1b[0m      Builds an eval suite that can actually fail, and gates it in CI.',
      '',
      '\x1b[1mSupported coding-agent environments:\x1b[0m',
      '  claude · cursor · vscode (GitHub Copilot) · codex · antigravity · roo · others',
      '  "others" installs into a .coding/ folder you rename to match your tool afterward.',
      '',
      '\x1b[1mOptions (passed through to installer):\x1b[0m',
      '  --tool <name>    Target tool: claude (default) | cursor | vscode | codex | antigravity | roo | others | custom',
      '  --target <dir>   With --tool custom, directory where SKILL.md will land',
      '  --user           Install the skill to the tool\'s user-global config directory',
      '  --force          Overwrite existing files',
      '  --dry-run        Print planned actions; write nothing',
      '  -h, --help       Show help',
      '',
      '\x1b[1mExamples:\x1b[0m',
      '  npx ai-engineering-cookbook                       # interactive picker',
      '  npx ai-engineering-cookbook doc-coherence         # Claude Code (default)',
      '  npx ai-engineering-cookbook prompt-optimizer --tool cursor',
      '  npx ai-engineering-cookbook skill-review             # vet skills before you trust them',
      '  npx ai-engineering-cookbook eval-harness             # score whether your LLM feature is any good',
      '  ai-engineering-cookbook doc-coherence --dry-run',
      ''
    ].join('\n')
  );
}

/**
 * Translate a child process's 'close' arguments into an exit code for this
 * process.
 *
 * A child that is killed by a signal reports `code === null` and a signal name.
 * Passing that straight through as `code ?? 0` reports success for a process
 * that crashed — an installer killed by the out-of-memory killer, or a user
 * pressing Ctrl-C, would look like a clean install to whatever is scripting
 * this CLI. Anything that did not exit 0 of its own accord is a failure.
 *
 * @param {number|null} code    exit code, or null if killed by a signal
 * @param {string|null} signal  signal name, or null on a normal exit
 * @returns {number} 0 only on a genuine clean exit
 */
function exitCodeFor(code, signal) {
  if (signal) return 1;
  return code ?? 1;
}

// Run the installer once per selected tool, sequentially. Exits with the first
// non-zero code so a single failure is visible.
function runForTools(scriptPath, tools, extraArgs = []) {
  const fullPath = path.resolve(__dirname, scriptPath);
  let index = 0;
  let exitCode = 0;

  const next = () => {
    if (index >= tools.length) {
      process.exit(exitCode);
      return;
    }
    const tool = tools[index++];
    process.stdout.write(`\n\x1b[1m\x1b[36m── Installing for ${tool} ──\x1b[0m\n`);
    const child = fork(fullPath, ['--tool', tool, ...extraArgs], { stdio: 'inherit' });
    child.on('close', (code, signal) => {
      const resolved = exitCodeFor(code, signal);
      if (resolved && !exitCode) exitCode = resolved;
      next();
    });
  };

  next();
}

function parseSelection(raw, max) {
  // Accept comma/space separated numbers, e.g. "1,3 5". Empty → default [1].
  const trimmed = raw.trim();
  if (trimmed === '') return [1];
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const picks = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > max) return null;
    if (!picks.includes(n)) picks.push(n);
  }
  return picks.length ? picks : null;
}

function promptEnvironments(rl, scriptPath) {
  process.stdout.write('\n\x1b[1mSelect the coding-agent environment(s) to install into.\x1b[0m\n');
  process.stdout.write('You can pick more than one — separate numbers with commas (e.g. 1,3,5).\n\n');
  ENVIRONMENTS.forEach((env, i) => {
    process.stdout.write(`  \x1b[1m${i + 1})\x1b[0m \x1b[32m${env.label}\x1b[0m  \x1b[2m${env.dir}\x1b[0m\n`);
  });
  process.stdout.write('\n');

  rl.question(`\x1b[1mEnter choice(s) [1-${ENVIRONMENTS.length}] (default 1 = Claude Code):\x1b[0m `, (answer) => {
    const picks = parseSelection(answer, ENVIRONMENTS.length);
    if (!picks) {
      rl.close();
      process.stderr.write(`\x1b[31mInvalid selection.\x1b[0m Enter numbers between 1 and ${ENVIRONMENTS.length}, e.g. 1,3.\n`);
      process.exit(1);
      return;
    }
    rl.close();
    const tools = picks.map((n) => ENVIRONMENTS[n - 1].tool);
    process.stdout.write(`\nInstalling into: \x1b[1m${tools.join(', ')}\x1b[0m\n`);
    runForTools(scriptPath, tools);
  });
}

// The interactive picker, as data. Adding a skill used to mean editing the
// printed list, the prompt's "[1-3]" range and the if/else chain separately —
// three places that could disagree, and did. One table cannot drift from
// itself.
const SKILL_MENU = [
  { skill: 'doc-coherence', label: 'Doc Coherence', blurb: 'Single-source-of-truth registry & CI gate' },
  { skill: 'prompt-optimizer', label: 'Prompt Optimizer', blurb: 'Calibrate & optimize agent prompts' },
  { skill: 'skill-review', label: 'Skill Review', blurb: 'Vet a SKILL.md before you trust it' },
  { skill: 'eval-harness', label: 'Eval Harness', blurb: 'Build an eval suite that can actually fail' }
];

/**
 * Turn what the user typed at the skill picker into an action.
 *
 * Pure, so the router's behaviour is testable without a terminal.
 *
 * @param {string} raw     What the user typed.
 * @param {Array}  [menu]  The menu they were shown.
 * @returns {{action: 'install', skill: string} | {action: 'exit'} | {action: 'invalid'}}
 */
function resolveMenuChoice(raw, menu = SKILL_MENU) {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  if (trimmed === '' ) return { action: 'invalid' };
  if (trimmed === 'exit' || trimmed === String(menu.length + 1)) return { action: 'exit' };

  const n = Number(trimmed);
  if (Number.isInteger(n) && n >= 1 && n <= menu.length) {
    return { action: 'install', skill: menu[n - 1].skill };
  }
  // Accept the skill's name as well as its number — people who know what they
  // want should not have to count.
  const byName = menu.find((entry) => entry.skill === trimmed);
  if (byName) return { action: 'install', skill: byName.skill };

  return { action: 'invalid' };
}

function promptUser() {
  process.stdout.write('\n\x1b[1m\x1b[36m=== AI Engineering Cookbook — Skill Installer ===\x1b[0m\n\n');
  process.stdout.write('Select a skill to install:\n');
  SKILL_MENU.forEach((entry, i) => {
    process.stdout.write(`  \x1b[1m${i + 1})\x1b[0m \x1b[32m${entry.label}\x1b[0m (${entry.blurb})\n`);
  });
  const exitChoice = SKILL_MENU.length + 1;
  process.stdout.write(`  \x1b[1m${exitChoice})\x1b[0m Exit\n\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(`\x1b[1mEnter choice [1-${exitChoice}]:\x1b[0m `, (choice) => {
    const resolved = resolveMenuChoice(choice);
    if (resolved.action === 'install') {
      promptEnvironments(rl, subcommands[resolved.skill]);
    } else if (resolved.action === 'exit') {
      rl.close();
      process.stdout.write('Exiting.\n');
      process.exit(0);
    } else {
      rl.close();
      process.stderr.write(
        `\x1b[31mInvalid selection.\x1b[0m Please run again and select a number from 1 to ${exitChoice}.\n`
      );
      process.exit(1);
    }
  });
}

// Main execution
function main(args = process.argv.slice(2)) {
  const cmd = args[0];

  if (!cmd) {
    if (process.stdin.isTTY) {
      promptUser();
    } else {
      showHelp();
      process.exit(0);
    }
  } else if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    showHelp();
    process.exit(0);
  } else if (subcommands[cmd]) {
    const rest = args.slice(1);
    const fullPath = path.resolve(__dirname, subcommands[cmd]);
    const child = fork(fullPath, rest, { stdio: 'inherit' });
    child.on('close', (code, signal) => process.exit(exitCodeFor(code, signal)));
  } else {
    process.stderr.write(`\x1b[31mUnknown command:\x1b[0m "${cmd}"\n\n`);
    showHelp();
    process.exit(1);
  }
}

// Only run when invoked as a program, so `require('./cli.js')` in a test can
// import the pure helpers without the CLI executing or calling process.exit.
if (require.main === module) {
  main();
}

module.exports = {
  ENVIRONMENTS,
  SKILL_MENU,
  subcommands,
  parseSelection,
  resolveMenuChoice,
  showHelp,
  exitCodeFor,
  main
};
