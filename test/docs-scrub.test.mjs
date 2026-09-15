// docs-scrub.test.mjs — fails closed if any tracked file in the repo carries a private-infra
// reference (a personal path, a private mesh IP, an internal project name). This repo is public;
// nothing shipped here should assume the reader can see the author's own machine or other repos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each pattern names what it catches so a failure is actionable, not just a red X. `allow` lists
// paths (relative to repo root) that are known-legitimate exceptions — e.g. the author's own
// already-public domain, intentionally linked in this repo before this check existed — rather than
// a private-infra leak this guard exists to catch.
const BANNED = [
  { name: 'personal user path', re: /Users[\\/][A-Z][a-z]+[\\/]/ },
  { name: 'author desktop workspace path', re: /Desktop[\\/]projects/i },
  { name: 'private mesh IP range', re: /100\.64\./ },
  { name: 'internal continuity dir', re: /continuity\// },
  { name: 'internal state-overlay project name', re: /parthenogenesis/i },
  { name: 'author personal domain', re: /cortorreal\.fun/i, allow: ['README.md'] },
  { name: 'author machine name', re: /CarlosPC/i },
];

// This file itself necessarily spells out every banned token as a literal detection pattern —
// scanning it would just be the check failing on its own source, not a real leak.
const SELF = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/');

function trackedFiles() {
  // --cached (already tracked) + --others --exclude-standard (new, not yet committed, not
  // gitignored) — so a file added in the same change that introduces a leak is still caught,
  // not just what a previous commit already shipped.
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).filter(rel => rel.replace(/\\/g, '/') !== SELF);
}

test('no tracked file carries a private-infra reference', () => {
  const files = trackedFiles();
  assert.ok(files.length > 5, 'expected git ls-files to return the repo contents — check cwd/git');

  const hits = [];
  for (const rel of files) {
    const relPosix = rel.replace(/\\/g, '/');
    const full = path.join(REPO_ROOT, rel);
    let text;
    try { text = readFileSync(full, 'utf8'); }
    catch { continue; } // binary or unreadable — not a docs/text file this check cares about
    for (const { name, re, allow } of BANNED) {
      if (allow && allow.includes(relPosix)) continue;
      const m = text.match(re);
      if (m) hits.push(`${rel}: ${name} (matched "${m[0]}")`);
    }
  }
  assert.deepStrictEqual(hits, [], `private-infra reference(s) found:\n  ${hits.join('\n  ')}`);
});

test('npm publication uses an explicit allowlist', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.deepStrictEqual(pkg.files, ['*.mjs', 'BOOTSTRAP.md', 'skills/', 'test/']);
  assert.ok(pkg.files.every(rel => !rel.startsWith('.')), 'hidden worktree state must never be published');
});
