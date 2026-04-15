/* eslint-disable no-console, n/no-process-exit */
// scripts/release.mjs
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const IS_RELEASE = process.argv.includes('--release');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a shell command and capture output. Exits on failure.
 *
 * @param {string} label - Display label for the step
 * @param {string} cmd - Shell command to run
 */
function step(label, cmd) {
  const padded = label.padEnd(28);
  process.stdout.write(`  ${C.dim}⏳${C.reset} ${padded}`);
  const start = Date.now();

  const result = spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });

  const elapsed = `(${((Date.now() - start) / 1000).toFixed(1)}s)`;

  if (result.status !== 0) {
    process.stdout.write(`\r  ${C.red}❌${C.reset} ${padded} ${C.dim}${elapsed}${C.reset}\n`);
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (out) console.error('\n' + out + '\n');
    process.exit(1);
  }

  process.stdout.write(`\r  ${C.green}✅${C.reset} ${padded} ${C.dim}${elapsed}${C.reset}\n`);
}

/**
 * Run a git command and return trimmed stdout. Throws on error.
 *
 * @param {string} args - Git arguments
 * @returns {string} Trimmed stdout
 */
function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * Read and parse package.json.
 *
 * @returns {object} Parsed package.json
 */
function readPkg() {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
}

/**
 * Write package.json preserving formatting.
 *
 * @param {object} pkg - Package data to write
 */
function writePkg(pkg) {
  writeFileSync(resolve(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

// ── Prerequisite checks ──────────────────────────────────────────────────────

/** Verify prerequisites before running CI or release. */
function checkPrereqs() {
  // 1. No uncommitted changes
  const status = git('status --porcelain');
  if (status) {
    console.error(`${C.red}✗ Uncommitted changes detected. Please commit or stash first.${C.reset}`);
    console.error(status);
    process.exit(1);
  }

  // 2. On main branch (release mode only)
  if (IS_RELEASE) {
    const branch = git('rev-parse --abbrev-ref HEAD');
    if (branch !== 'main') {
      console.error(`${C.red}✗ Release requires branch 'main', currently on '${branch}'.${C.reset}`);
      process.exit(1);
    }

    // 3. NPM_TOKEN must be set
    if (!process.env.NPM_TOKEN) {
      console.error(`${C.red}✗ NPM_TOKEN environment variable is not set.${C.reset}`);
      console.error(`  Export it with: export NPM_TOKEN=your_token`);
      process.exit(1);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${C.bold}🚀 Starting CI pipeline...${C.reset}${IS_RELEASE ? ` ${C.yellow}[release mode]${C.reset}` : ''}\n`);
checkPrereqs();

// ── CI steps ─────────────────────────────────────────────────────────────────

step('Clean build', 'npm run cleanBuild');
step('Lint', 'npm run lint');
step('Format check', 'npm run format:check');
step('Typecheck', 'npm run test:typecheck');
step('Tests + coverage', 'npm run test:coverage');
step('Production build', 'npm run buildProduction');

console.log(`\n${C.green}${C.bold}🎉 CI passed!${C.reset}\n`);

export { readPkg, writePkg };
