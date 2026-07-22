import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WITNESS = path.join(REPO_ROOT, 'witness.mjs');

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'witness-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, ledger: path.join(dir, 'ledger.jsonl') };
}

function witness(cwd, ...args) {
  return spawnSync(process.execPath, [WITNESS, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 10_000,
  });
}

function runReceipt(cwd, ledger, label, exitCode = 0) {
  const program = 'process.stdout.write(' + JSON.stringify(label) + '); process.exit(' + exitCode + ')';
  return witness(cwd, 'run', '--file', ledger, '--', process.execPath, '-e', program);
}

function readEntries(ledger) {
  return readFileSync(ledger, 'utf8').trimEnd().split(/\r?\n/).map(JSON.parse);
}

function verifyJson(cwd, ledger) {
  const result = witness(cwd, 'verify', '--file', ledger, '--json');
  return { result, report: JSON.parse(result.stdout) };
}

test('running a command appends a receipt and an intact ledger verifies', (t) => {
  const { dir, ledger } = fixture(t);
  const first = runReceipt(dir, ledger, 'first');
  const second = runReceipt(dir, ledger, 'second');

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const entries = readEntries(ledger);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].index, 0);
  assert.equal(entries[0].prevHash, 'GENESIS');
  assert.equal(entries[1].index, 1);
  assert.equal(entries[1].prevHash, entries[0].hash);
  assert.equal(entries[0].stdoutTail, 'first');
  assert.equal(entries[1].stdoutTail, 'second');

  const { result, report } = verifyJson(dir, ledger);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.brokenAt, null);
  assert.deepEqual(report.details.map(({ status }) => status), ['ok', 'ok']);
});

test('tampering with entry N is reported as a break at N', (t) => {
  const { dir, ledger } = fixture(t);
  for (const label of ['zero', 'one', 'two']) assert.equal(runReceipt(dir, ledger, label).status, 0);
  const entries = readEntries(ledger);
  entries[1].stdoutBytes += 1;
  writeFileSync(ledger, entries.map(JSON.stringify).join('\n') + '\n', 'utf8');

  const { result, report } = verifyJson(dir, ledger);
  assert.equal(result.status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.brokenAt, 1);
  assert.equal(report.details[1].status, 'hash-mismatch');
  assert.equal(report.details[2].status, 'unverified-chain-already-broken');
});

test('tampering with a recorded output-tail field breaks its entry', (t) => {
  const { dir, ledger } = fixture(t);
  assert.equal(runReceipt(dir, ledger, 'original output').status, 0);
  const entries = readEntries(ledger);
  entries[0].stdoutTail = 'forged output';
  writeFileSync(ledger, entries.map(JSON.stringify).join('\n') + '\n', 'utf8');

  const { result, report } = verifyJson(dir, ledger);
  assert.equal(result.status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.brokenAt, 0);
  assert.equal(report.details[0].status, 'hash-mismatch');
});

test('deleting a middle ledger line breaks the next chain link at that position', (t) => {
  const { dir, ledger } = fixture(t);
  for (const label of ['zero', 'one', 'two']) assert.equal(runReceipt(dir, ledger, label).status, 0);
  const lines = readFileSync(ledger, 'utf8').trimEnd().split(/\r?\n/);
  writeFileSync(ledger, [lines[0], lines[2]].join('\n') + '\n', 'utf8');

  const { result, report } = verifyJson(dir, ledger);
  assert.equal(result.status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.brokenAt, 1);
  assert.equal(report.details[1].status, 'prevHash-mismatch');
});

test('truncating complete receipts from the tail is reported as BROKEN', (t) => {
  const { dir, ledger } = fixture(t);
  for (const label of ['zero', 'one', 'two']) assert.equal(runReceipt(dir, ledger, label).status, 0);
  const firstLineBytes = Buffer.byteLength(readFileSync(ledger, 'utf8').split(/\r?\n/)[0] + '\n');
  truncateSync(ledger, firstLineBytes);

  const result = witness(dir, 'verify', '--file', ledger);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + '\n' + result.stderr, /BROKEN/);
});

test('a byte-truncated final receipt is reported at its line index', (t) => {
  const { dir, ledger } = fixture(t);
  for (const label of ['zero', 'one', 'two']) assert.equal(runReceipt(dir, ledger, label).status, 0);
  truncateSync(ledger, statSync(ledger).size - 12);

  const { result, report } = verifyJson(dir, ledger);
  assert.equal(result.status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.brokenAt, 2);
  assert.equal(report.details[2].status, 'unparseable-line');
});

test('a corrupt ledger is BROKEN and exits non-zero', (t) => {
  const { dir, ledger } = fixture(t);
  writeFileSync(ledger, '{ definitely-not-json\n', 'utf8');

  const result = witness(dir, 'verify', '--file', ledger);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BROKEN/);
  assert.doesNotMatch(result.stdout, /Chain intact/);
});

test('an unreadable ledger is reported as BROKEN rather than crashing', (t) => {
  const { dir } = fixture(t);
  const ledgerDirectory = path.join(dir, 'ledger-is-a-directory');
  mkdirSync(ledgerDirectory);

  const result = witness(dir, 'verify', '--file', ledgerDirectory);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + '\n' + result.stderr, /BROKEN/);
});

test('a failing command still records its non-zero exit and stderr', (t) => {
  const { dir, ledger } = fixture(t);
  const program = "process.stderr.write('deliberate failure'); process.exit(7)";
  const result = witness(dir, 'run', '--file', ledger, '--', process.execPath, '-e', program);

  assert.equal(result.status, 7);
  const [entry] = readEntries(ledger);
  assert.equal(entry.exitCode, 7);
  assert.equal(entry.stderrTail, 'deliberate failure');
  assert.equal(entry.command[0], process.execPath);
  assert.equal(verifyJson(dir, ledger).result.status, 0);
});

test('default execution preserves argv literally without invoking a shell', (t) => {
  const { dir, ledger } = fixture(t);
  const literal = 'alpha & beta | gamma > output.txt';
  const program = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
  const result = witness(dir, 'run', '--file', ledger, '--', process.execPath, '-e', program, literal);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, JSON.stringify([literal]));
  assert.equal(readEntries(ledger)[0].command.at(-1), literal);
  assert.equal(verifyJson(dir, ledger).result.status, 0);
});
