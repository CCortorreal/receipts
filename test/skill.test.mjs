import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = path.join(REPO_ROOT, 'hinge.mjs');
const SKILL_DIR = path.join(REPO_ROOT, 'skills', 'hinge');
const SKILL_COPY = path.join(SKILL_DIR, 'hinge.mjs');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');

test('skill copy of hinge.mjs is byte-identical to the canonical root copy', () => {
  const canonical = readFileSync(CANONICAL);
  const copy = readFileSync(SKILL_COPY);
  assert.ok(
    canonical.equals(copy),
    'skills/hinge/hinge.mjs has drifted from the root hinge.mjs — re-copy it; the skill folder must stay self-contained AND canonical'
  );
});

test('SKILL.md has well-formed frontmatter naming the skill', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, 'SKILL.md must open with a --- frontmatter block');
  assert.match(fm[1], /^name:\s*hinge\s*$/m, 'frontmatter must declare name: hinge');
  const desc = fm[1].match(/^description:\s*(.+)$/m);
  assert.ok(desc && desc[1].trim().length > 40, 'frontmatter needs a substantive description (it is the trigger)');
});

test('bundled copy runs standalone from the skill directory', () => {
  const result = spawnSync(process.execPath, [SKILL_COPY, '--self-test'], {
    cwd: SKILL_DIR,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /FAIL/);
});
