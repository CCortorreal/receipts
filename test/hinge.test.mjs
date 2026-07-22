import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HINGE = path.join(REPO_ROOT, 'hinge.mjs');

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hinge-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function hinge(cwd, ...args) {
  return spawnSync(process.execPath, [HINGE, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 10_000,
  });
}

test('hinge self-test passes every built-in check', (t) => {
  const dir = fixture(t);
  const result = hinge(dir, '--self-test');

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 5);
  assert.ok(lines.every(line => line.startsWith('PASS  ')), result.stdout);
  assert.doesNotMatch(result.stdout, /FAIL/);
});

test('hinge identifies an unverified claim and emits a structured probe', (t) => {
  const dir = fixture(t);
  const plan = path.join(dir, 'plan.md');
  const markdown = [
    '# Import plan',
    '',
    'We assume the parser library can read legacy records without conversion.',
    '',
    '## Build',
    '- The parser library will read every legacy record.',
    '- Once the parser library reads legacy records, store them in the new database.',
    '- The migration depends on legacy records reaching the new database.',
    '',
    '## Release',
    '- Then release the migration after the legacy records are stored.',
    '',
  ].join('\n');
  writeFileSync(plan, markdown, 'utf8');

  const result = hinge(dir, '--json', plan);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'hinge/v1');
  assert.ok(report.statementCount >= 5);
  assert.ok(report.hinge);
  assert.match(report.hinge.text, /parser library|legacy records/i);
  assert.equal(report.hinge.source, plan);
  assert.equal(typeof report.hinge.line, 'number');
  assert.equal(typeof report.hinge.score, 'number');
  assert.notEqual(report.hinge.evidence, 'strong');
  assert.ok(report.hinge.dependentCount >= 1);
  assert.ok(Array.isArray(report.hinge.dependents));
  assert.equal(typeof report.hinge.probe, 'string');
  assert.ok(report.hinge.probe.length > 30);
});
