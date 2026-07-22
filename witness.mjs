#!/usr/bin/env node
// PROVENANCE: born in a multi-agent bake-off in my agentic workshop (a Claude lane authored it,
// given open-ended freedom); verified by hand before release — tamper test: a forged receipt was
// caught, fail-closed.
// witness.mjs — a hash-chained receipt ledger for shell commands.
//
// The problem this answers: an agent (or a tired human) says "I ran the tests and they
// passed" and there is no way to check that claim after the fact except to trust the
// sentence. witness.mjs turns "I ran X" into a RECEIPT: every command you run through it
// is appended to an append-only ledger as a chained hash — each entry's hash covers its
// own fields AND the previous entry's hash, so the chain is tamper-evident the same way a
// git log or a blockchain is. Edit any past line, or delete one, and `witness verify` finds
// the exact point the chain breaks. Nothing here is a security sandbox; it is a memory
// aid with a math proof attached — a fail-closed way to answer "did that actually happen,
// and did anything downstream get quietly edited since."
//
// Design notes (what this borrows, and what it deliberately does NOT borrow):
//   - FAIL-CLOSED verification: `witness verify` reports BROKEN, not "mostly fine," the
//     moment one hash fails to recompute — same instinct as a health check that reads a
//     timeout as RED, never green. An unreadable or truncated ledger file is also BROKEN,
//     never silently skipped.
//   - Deterministic core, no network, no LLM, no API key: sha256 + fs. It either verifies
//     or it doesn't; there's no "trust me" step in the middle.
//   - Zero deps, one file, Node builtins only (fs/crypto/child_process) — runs anywhere
//     Node runs, no install step, no package.json.
//   - Commands run as an argv ARRAY with no shell by default (spawn(cmd, args) — same
//     "no shell" instinct as an argv-only action gate: no injection surface, and quoting
//     survives exactly as you typed it). Pass --shell to opt into the platform shell
//     instead, for pipes/globs/npm-style .cmd shims — Windows' cmd.exe does not escape
//     re-joined arguments (a real, documented Node caveat), so quote defensively in
//     --shell mode. The no-shell default is the safer AND the more literal one; --shell is
//     the deliberate, named trade for convenience.
//   - The ledger lives at .witness/ledger.jsonl under the cwd you ran from (one ledger per
//     project, human-diffable JSON Lines, nothing binary, nothing exotic).
//
// Usage:
//   node witness.mjs run -- git status             record a receipt (no shell, argv exact)
//   node witness.mjs run --shell -- npm test        via the platform shell (.cmd, pipes, globs)
//   node witness.mjs log [-n 20]                   human-readable history, newest last
//   node witness.mjs show <index>                  full stdout/stderr for one receipt
//   node witness.mjs verify [--json]                walk the whole chain, fail-closed
//   node witness.mjs verify --since <index>         verify only from index N onward
//
// Every subcommand accepts --file <path> to point at a different ledger than the default
// .witness/ledger.jsonl under the current directory.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const GENESIS = 'GENESIS';
const ENTRY_SCHEMA_V2 = 'witness-entry/v2';   // see canonicalize() for why the version is load-bearing
const MAX_TAIL = 4000; // chars of stdout/stderr kept verbatim per receipt

// ---------------------------------------------------------------- small cli plumbing
const argv = process.argv.slice(2);
const CMD = argv[0];
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: s => COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim: s => COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green: s => COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  red: s => COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: s => COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  cyan: s => COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

function extractFlag(args, name, hasValue) {
  const i = args.indexOf(name);
  if (i < 0) return { value: undefined, rest: args };
  const rest = args.slice();
  const value = hasValue ? rest[i + 1] : true;
  rest.splice(i, hasValue ? 2 : 1);
  return { value, rest };
}

function ledgerPath(args) {
  const { value } = extractFlag(args, '--file', true);
  return path.resolve(value || path.join('.witness', 'ledger.jsonl'));
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function canonicalize(entry) {
  // Fixed field order so the hash is deterministic regardless of how the object was built.
  // SCHEMA v2 (2026-07-22): v1 hashed stdoutSha256/stdoutBytes but NOT stdoutTail/stderrTail — so the
  // human-readable record of what a command printed could be edited freely and still verify. The
  // tails are the field a person actually READS, which made them the most useful thing to forge and
  // the only unauthenticated thing in the entry. v2 covers them.
  //
  // The version split is load-bearing, not ceremony: adding fields to the canonical form changes
  // every hash, so canonicalizing old entries the new way would mark every pre-existing ledger
  // BROKEN. An entry is hashed under the form it was WRITTEN under — v1 entries stay verifiable
  // forever, v2 entries authenticate their tails. Never "upgrade" an old entry in place; that is
  // indistinguishable from tampering, which is the whole thing this file exists to detect.
  const order = entry.schema === ENTRY_SCHEMA_V2
    ? ['schema', 'index', 'ts', 'cwd', 'command', 'exitCode', 'durationMs',
       'stdoutSha256', 'stdoutBytes', 'stdoutTail', 'stderrSha256', 'stderrBytes', 'stderrTail', 'prevHash']
    : ['index', 'ts', 'cwd', 'command', 'exitCode', 'durationMs',
       'stdoutSha256', 'stdoutBytes', 'stderrSha256', 'stderrBytes', 'prevHash'];
  return order.map(k => (typeof entry[k] === 'object' ? JSON.stringify(entry[k]) : String(entry[k]))).join('');
}

// A read that FAILS is not a read that returns nothing. existsSync only guards absence; EISDIR,
// EACCES, EPERM and friends used to escape as an uncaught exception, so `verify` died with a Node
// stack trace instead of reporting BROKEN — and under --json printed zero bytes, leaving a consumer
// unable to tell "chain broken" from "tool crashed". Fail closed, in the tool's own vocabulary.
class LedgerUnreadable extends Error {
  constructor(file, cause) {
    super(`ledger unreadable: ${cause.code || cause.message} at ${file}`);
    this.name = 'LedgerUnreadable';
    this.code = cause.code || 'EUNREADABLE';
  }
}

function readLedger(file) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new LedgerUnreadable(file, err);
  }
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A line that doesn't parse is itself a tamper signal — surfaced by verify, not
      // swallowed here. We push a sentinel so index math stays aligned.
      entries.push({ __unparseable: true, raw: line });
    }
  }
  return entries;
}

// THE TIP ANCHOR — the fix for silent tail truncation.
//
// A hash chain only proves that the entries you CAN see follow each other. It says nothing about how
// many there were. Delete whole records off the end and what remains is a shorter, perfectly valid
// chain: verify used to answer "Chain intact." That is a false green, and it is the easiest possible
// attack — a truncate, not an edit.
//
// The anchor is a sidecar holding {count, tipHash}. Verify cross-checks it, so removing entries now
// requires a second, consistent edit to a second file.
//
// HONEST LIMIT, stated here and in the README: the sidecar is a plain local file. Anyone who can
// rewrite the ledger can rewrite this too. It defeats accidental truncation, log-rotation damage,
// and single-step tampering — it is NOT a defence against a determined local attacker. Nothing
// stored beside the data can be; that needs an off-box witness (a signature, or the hash pushed
// somewhere you don't control). Don't let this file imply more than it does.
function tipPath(file) { return `${file}.tip.json`; }

function writeTip(file, entries) {
  const tip = { schema: 'witness-tip/v1', count: entries.length, tipHash: entries.length ? entries[entries.length - 1].hash : GENESIS };
  try { writeFileSync(tipPath(file), JSON.stringify(tip) + '\n', 'utf8'); }
  catch { /* a ledger that appends but can't anchor is still better than no ledger; verify reports the gap */ }
}

function readTip(file) {
  const p = tipPath(file);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { __unparseable: true }; }
}

function appendEntry(file, entry) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

// ---------------------------------------------------------------- run
async function cmdRun(args) {
  const file = ledgerPath(args);
  let { value: useShell, rest } = extractFlag(args, '--shell', false);
  rest = rest.filter(a => a !== 'run');
  const dashIdx = rest.indexOf('--');
  const command = dashIdx >= 0 ? rest.slice(dashIdx + 1) : rest;
  if (!command.length) {
    console.error('usage: witness run [--file <path>] [--shell] -- <command...>');
    process.exit(2);
  }

  const existing = readLedger(file);
  const prevHash = existing.length ? existing[existing.length - 1].hash : GENESIS;
  const index = existing.length;
  const cwd = process.cwd();
  const commandLine = command.join(' ');

  const start = Date.now();
  process.stderr.write(c.dim(`witness: running [${index}] ${commandLine}\n`));

  const { code, stdout, stderr } = await new Promise((resolve) => {
    // Pass argv as an array either way — never hand-join into a string ourselves (an
    // earlier version of this file did that and silently ate quoting). Default is
    // shell:false: Node execs the binary directly, argv untouched by any shell grammar.
    // --shell hands the array to the platform shell instead; on Windows that shell is
    // cmd.exe, which — per Node's own documented caveat — does NOT re-escape a rejoined
    // argument list, so a value containing quotes/spaces can come out wrong. That's the
    // named trade for getting .cmd shims (npm, npx) and pipes/globs to work.
    const child = spawn(command[0], command.slice(1), { shell: !!useShell });
    let out = Buffer.alloc(0), err = Buffer.alloc(0);
    child.stdout?.on('data', d => { out = Buffer.concat([out, d]); process.stdout.write(d); });
    child.stderr?.on('data', d => { err = Buffer.concat([err, d]); process.stderr.write(d); });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    child.on('error', (e) => { err = Buffer.concat([err, Buffer.from(String(e.message))]); resolve({ code: -1, stdout: out, stderr: err }); });
  });

  const durationMs = Date.now() - start;
  const entry = {
    schema: ENTRY_SCHEMA_V2,
    index, ts: new Date().toISOString(), cwd, command,
    exitCode: code, durationMs,
    stdoutSha256: sha256(stdout), stdoutBytes: stdout.length,
    stdoutTail: stdout.toString('utf8').slice(-MAX_TAIL),
    stderrSha256: sha256(stderr), stderrBytes: stderr.length,
    stderrTail: stderr.toString('utf8').slice(-MAX_TAIL),
    prevHash,
  };
  entry.hash = sha256(canonicalize(entry));
  appendEntry(file, entry);
  writeTip(file, [...existing, entry]);   // anchor the new length + tip so truncation can be caught

  const verdict = code === 0 ? c.green('PASS') : c.red(`FAIL (exit ${code})`);
  process.stderr.write(`witness: receipt #${index} ${verdict} — ${durationMs}ms — ${entry.hash.slice(0, 12)}  (${file})\n`);
  process.exitCode = code === 0 ? 0 : code;
}

// ---------------------------------------------------------------- verify
function cmdVerify(args) {
  const file = ledgerPath(args);
  const { value: asJson } = extractFlag(args, '--json', false);
  const { value: sinceRaw } = extractFlag(args, '--since', true);
  const since = sinceRaw ? parseInt(sinceRaw, 10) : 0;

  let entries;
  try {
    entries = readLedger(file);
  } catch (err) {
    // Unreadable is BROKEN, reported in the tool's own vocabulary — never a raw stack trace, and
    // never an empty --json body that a caller can't distinguish from a crash.
    if (asJson) {
      console.log(JSON.stringify({ schema: 'witness-verify/v1', file, ok: false, length: null,
        brokenAt: null, reason: 'unreadable', code: err.code, details: [] }, null, 2));
    } else {
      console.log(`${c.bold('witness verify')} — ${file}`);
      console.log(`  ${c.red('BROKEN')} — ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }
  let brokenAt = null;
  const details = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i < since) { details.push({ index: i, status: 'skipped' }); continue; }
    if (e.__unparseable) { brokenAt ??= i; details.push({ index: i, status: 'unparseable-line' }); continue; }
    if (brokenAt !== null) { details.push({ index: i, status: 'unverified-chain-already-broken' }); continue; }

    const expectPrev = i === 0 ? GENESIS : entries[i - 1].hash;
    if (e.prevHash !== expectPrev) { brokenAt = i; details.push({ index: i, status: 'prevHash-mismatch', expected: expectPrev, found: e.prevHash }); continue; }

    const recomputed = sha256(canonicalize(e));
    if (recomputed !== e.hash) { brokenAt = i; details.push({ index: i, status: 'hash-mismatch', expected: recomputed, found: e.hash }); continue; }

    details.push({ index: i, status: 'ok' });
  }

  // THE ANCHOR CHECK — catches truncation, which the chain alone cannot see (a shorter chain is
  // still a valid chain). Only meaningful when the chain itself verified: if the chain is already
  // broken, that is the more specific finding and gets reported first.
  const tip = readTip(file);
  let anchor = null;
  if (!tip) {
    // No sidecar: a ledger written before anchoring existed, or one whose anchor was removed. Say so
    // plainly rather than implying a guarantee we can't make — but don't fail a legacy ledger.
    anchor = { status: 'absent', note: 'no tip anchor — truncation cannot be detected for this ledger' };
  } else if (tip.__unparseable) {
    anchor = { status: 'unparseable' };
  } else if (tip.count !== entries.length) {
    anchor = { status: 'count-mismatch', expected: tip.count, found: entries.length };
  } else if (entries.length && tip.tipHash !== entries[entries.length - 1].hash) {
    anchor = { status: 'tip-mismatch', expected: tip.tipHash, found: entries[entries.length - 1].hash };
  } else {
    anchor = { status: 'ok' };
  }
  const anchorBroken = anchor.status === 'count-mismatch' || anchor.status === 'tip-mismatch' || anchor.status === 'unparseable';

  const ok = brokenAt === null && !anchorBroken;
  if (asJson) {
    console.log(JSON.stringify({ schema: 'witness-verify/v1', file, ok, length: entries.length, brokenAt, anchor, details }, null, 2));
  } else if (anchorBroken && brokenAt === null) {
    console.log(`${c.bold('witness verify')} — ${file}`);
    console.log(`  ${entries.length} receipt(s) in the ledger.`);
    for (const d of details) if (d.status === 'ok') console.log(`  ${c.green('OK')}   #${d.index}`);
    console.log(`\n  ${c.red('BROKEN')} — anchor ${anchor.status}: expected ${anchor.expected}, found ${anchor.found}.`);
    console.log(`  ${c.dim('Every remaining receipt verifies, so entries were REMOVED from the end (or the anchor was edited).')}`);
    process.exitCode = 1;
  } else {
    console.log(`${c.bold('witness verify')} — ${file}`);
    console.log(`  ${entries.length} receipt(s) in the ledger.`);
    for (const d of details) {
      if (d.status === 'ok') console.log(`  ${c.green('OK')}   #${d.index}`);
      else if (d.status === 'skipped') console.log(`  ${c.dim('SKIP')} #${d.index} (before --since)`);
      else console.log(`  ${c.red('BROKEN')} #${d.index} — ${d.status}${d.expected ? `\n         expected ${d.expected}\n         found    ${d.found}` : ''}`);
    }
    console.log(ok ? c.green('\nChain intact.') : c.red(`\nChain BROKEN at #${brokenAt}. Everything from here on is unverifiable — do not trust receipts past this point.`));
  }
  process.exitCode = ok ? 0 : 1;
}

// ---------------------------------------------------------------- log
function cmdLog(args) {
  const file = ledgerPath(args);
  const { value: nRaw } = extractFlag(args, '-n', true);
  const n = nRaw ? parseInt(nRaw, 10) : Infinity;
  const entries = readLedger(file).filter(e => !e.__unparseable);
  const slice = entries.slice(-n);
  if (!slice.length) { console.log(c.dim(`witness: no receipts yet in ${file}`)); return; }
  for (const e of slice) {
    const verdict = e.exitCode === 0 ? c.green('PASS') : c.red(`FAIL(${e.exitCode})`);
    console.log(`#${e.index}  ${c.dim(e.ts)}  ${verdict}  ${c.dim(e.durationMs + 'ms')}  ${c.cyan(e.hash.slice(0, 10))}  ${e.command.join(' ')}`);
  }
}

// ---------------------------------------------------------------- show
function cmdShow(args) {
  const file = ledgerPath(args);
  const idx = parseInt(args.find(a => /^\d+$/.test(a)), 10);
  const entries = readLedger(file);
  const e = entries[idx];
  if (!e || e.__unparseable) { console.error(`witness: no valid receipt #${idx} in ${file}`); process.exitCode = 1; return; }
  console.log(c.bold(`receipt #${e.index}`));
  console.log(`  time:     ${e.ts}`);
  console.log(`  cwd:      ${e.cwd}`);
  console.log(`  command:  ${e.command.join(' ')}`);
  console.log(`  exit:     ${e.exitCode === 0 ? c.green(e.exitCode) : c.red(e.exitCode)}`);
  console.log(`  duration: ${e.durationMs}ms`);
  console.log(`  prevHash: ${e.prevHash}`);
  console.log(`  hash:     ${e.hash}`);
  console.log(c.dim(`\n  stdout (sha256 ${e.stdoutSha256.slice(0, 12)}…, ${e.stdoutBytes} bytes, tail shown):`));
  console.log(e.stdoutTail || c.dim('  (empty)'));
  if (e.stderrBytes) {
    console.log(c.dim(`\n  stderr (sha256 ${e.stderrSha256.slice(0, 12)}…, ${e.stderrBytes} bytes, tail shown):`));
    console.log(e.stderrTail);
  }
}

// ---------------------------------------------------------------- dispatch
const rest = argv.slice(1);
switch (CMD) {
  case 'run': await cmdRun(rest); break;
  case 'verify': cmdVerify(rest); break;
  case 'log': cmdLog(rest); break;
  case 'show': cmdShow(rest); break;
  default:
    console.log(`witness — a hash-chained receipt ledger for shell commands.

usage:
  witness run [--file <path>] [--shell] -- <command...>
  witness log [--file <path>] [-n <count>]
  witness show [--file <path>] <index>
  witness verify [--file <path>] [--json] [--since <index>]

Every "run" appends a receipt to .witness/ledger.jsonl (cwd-relative by default).
Each receipt's hash covers its own fields plus the previous receipt's hash, so
"verify" can prove the log hasn't been edited after the fact — or tell you
exactly which receipt to stop trusting.`);
    process.exitCode = CMD ? 2 : 0;
}
