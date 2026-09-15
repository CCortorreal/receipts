#!/usr/bin/env node
// PROVENANCE: workshopped between a Claude Code session and a Codex session in my multi-agent
// dev workshop — different model lanes given a problem and freedom, verified by hand before
// release. The messages that carried the back-and-forth were relayed by a sibling project,
// the-wire (https://github.com/CCortorreal/the-wire).
/**
 * evidence.mjs — machine-checkable evidence status for Markdown artifacts.
 *
 * The common failure mode this targets: a doc asserts something as fact, and six months later
 * nobody — human or agent — can tell whether that was a hunch, a single observation, or something
 * actually nailed down. This tool makes four rules about stating confidence FAIL LOUD instead of
 * relying on the author remembering them at 4am.
 *
 * THE CONVENTION — an HTML comment immediately above the claim it governs, so it never renders:
 *
 *   <!-- EVIDENCE id=a7-nat-ceiling rung=established n=6
 *        blind="no ISP-side view; cannot distinguish upstream shaping from local NAT"
 *        detector=validated depends=sabnzbd-saturation -->
 *   The router has a hard NAT ceiling that becomes a cliff at ~100 Mbps.
 *
 * FIELDS
 *   id        (required) slug, unique across the scanned set — the anchor other claims cite
 *   rung      (required) suspected | supported | established | refuted   [E4]
 *   n         episodes — INDEPENDENT OCCURRENCES, not samples             [E2]
 *   blind     what this measurement CANNOT see, in the artifact           [E3]
 *   detector  validated | unvalidated | n/a — was it proven to fire?      [E1]
 *   depends   comma-separated ids this claim rests on                     [E5]
 *
 * WHAT IT ENFORCES (each maps to one rule; nothing here is a style opinion):
 *   E1  a claim resting on a detector never proven to fire cannot outrank `supported`
 *   E2  `established` requires n >= --min-n (default 3). A thousand samples in one episode is
 *       ONE observation with good resolution, so n counts EPISODES and the tool cannot tell —
 *       it can only refuse to let you claim `established` without saying how many you had.
 *   E3  anything at `supported` or above must name its blind spot
 *   E4  every claim must state a rung; an unstated confidence gets read at whatever confidence
 *       the reader needs it to have
 *   E5  a claim depending on a REFUTED claim is flagged MUST-REOPEN — a refuted conclusion takes
 *       its exclusions with it, and this is the rule most often skipped because re-opening
 *       settled ground feels like going backwards
 *   plus structural integrity: dangling citations, duplicate ids, dependency cycles
 *
 * FAIL-CLOSED: unparseable EVIDENCE blocks are ERRORS, never skipped. An artifact with no
 * EVIDENCE blocks at all is fine (not every doc makes claims) — but --require makes their absence
 * an error for paths that must carry them. And scanning ZERO FILES is never clean: an empty scan
 * set exits 2, because "no violations found" and "nothing was opened" must not read the same.
 *
 *   node evidence.mjs docs/*.md              # check
 *   node evidence.mjs --json <paths>         # machine-readable, for a check spine
 *   node evidence.mjs --graph <paths>        # print the dependency chain
 *   node evidence.mjs --min-n 5 <paths>      # stricter episode floor
 *   node evidence.mjs --require <paths>      # every path MUST carry >=1 claim
 *
 * Exit 0 = clean · 1 = violations · 2 = bad usage/unreadable input.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const JSON_OUT = has('--json'), GRAPH = has('--graph'), REQUIRE = has('--require');
const MIN_N = Number(val('--min-n', '3'));
const RUNGS = ['suspected', 'supported', 'established', 'refuted'];
const RANK = { suspected: 1, supported: 2, established: 3, refuted: 0 };

const paths = argv.filter((a, i) =>
  !a.startsWith('--') && !(argv[i - 1] === '--min-n'));
if (!paths.length) {
  console.error('usage: evidence.mjs [--json|--graph|--require|--min-n N] <file-or-dir>...');
  process.exit(2);
}

// ── collect files ────────────────────────────────────────────────────────────
function expand(p) {
  if (!existsSync(p)) return { missing: p };
  if (statSync(p).isDirectory()) {
    return readdirSync(p).flatMap(f => {
      const full = join(p, f);
      try { return statSync(full).isDirectory() ? [] : (extname(full) === '.md' ? [full] : []); }
      catch { return []; }
    });
  }
  return [p];
}
const files = [], missing = [], barren = [];
for (const p of paths) {
  const r = expand(p);
  if (r && r.missing) { missing.push(r.missing); continue; }
  if (r.length === 0) barren.push(p);
  files.push(...r);
}
if (missing.length) { console.error(`evidence: no such path: ${missing.join(', ')}`); process.exit(2); }

// ZERO FILES EXAMINED IS NOT A CLEAN BILL. Every check below is a count-of-violations being zero,
// so an empty scan set would print "OK — every claim states a rung, earns it, and its chain
// resolves" and exit 0 having opened nothing. The ways that happens are all quiet: expand() is
// deliberately NON-RECURSIVE, so `evidence.mjs docs/` on a tree whose claims live in docs/sub/
// scans nothing; a directory of .txt/.mdx scans nothing; and a caller that passes a shell glob
// which the shell did not expand (PowerShell does not) lands on the missing-path branch only by
// luck of the literal name. A checker wired into CI that greens on an empty set is worse than
// absent, because it gets counted as coverage. --require is not the same guard: it only fires for
// files that were found, so it never runs when the set is empty.
if (!files.length) {
  const why = (p) => {
    try {
      if (statSync(p).isDirectory() && readdirSync(p).some(f => { try { return statSync(join(p, f)).isDirectory(); } catch { return false; } })) {
        return 'contains no .md files at its top level — the scan is NOT recursive, so name the subdirectory';
      }
    } catch { /* fall through */ }
    return 'contains no .md files';
  };
  const detail = barren.map(p => ({ path: p, reason: why(p) }));
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, files: 0, claims: 0, minN: MIN_N, byRung: {},
      violations: [{ code: 'NOTHING-SCANNED', file: paths.join(' '), line: 0,
        msg: 'the given paths expanded to zero .md files — nothing was examined, so nothing can be reported clean', detail }],
      graph: [] }, null, 2));
    process.exit(2);
  }
  console.error(`evidence: scanned ZERO files — nothing was examined, so nothing can be reported clean.`);
  for (const d of detail) console.error(`  ${d.path} — ${d.reason}`);
  process.exit(2);
}

// ── parse ────────────────────────────────────────────────────────────────────
// Deliberately tolerant of whitespace/newlines inside the block and of quoted values, because a
// blind-spot description is prose and will wrap. Deliberately INtolerant of anything else.
const BLOCK = /<!--\s*EVIDENCE\b([\s\S]*?)-->/g;
const claims = [];
const errors = [];

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (e) { errors.push({ file, line: 0, code: 'UNREADABLE', msg: e.message }); continue; }
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;

  // ── Worked examples are not claims ──────────────────────────────────────────
  // A doc that teaches the convention by SHOWING a block — complete with a depends= pointing at
  // an id that exists only in the example — will fail DANGLING-DEP against its own teaching
  // material unless that block is recognized as illustrative. A checker that red-flags its own
  // documentation is wrong, and it trains readers to distrust the red.
  //
  // Fix: EVIDENCE blocks inside a fenced code region are ILLUSTRATIONS and are skipped. A fence is
  // already the universal "this is being shown, not said" marker, so this needs no new convention
  // to remember — which matters, because a convention nobody remembers is the thing this tool
  // exists to route around. Masked with spaces rather than deleted so every reported line number
  // stays true.
  text = text.replace(/^([ \t]*)(`{3,}|~{3,})[\s\S]*?^[ \t]*\2[ \t]*$/gm,
    (m) => m.replace(/[^\n]/g, ' '));

  let m;
  while ((m = BLOCK.exec(text)) !== null) {
    const line = lineOf(m.index);
    const raw = m[1];
    const fields = {};
    // key=value | key="value with spaces"
    const FIELD = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/g;
    let f;
    while ((f = FIELD.exec(raw)) !== null) {
      fields[f[1].toLowerCase()] = (f[3] ?? f[4] ?? f[5] ?? '').trim();
    }
    // the claim text = first non-empty, non-comment line after the block
    const after = text.slice(m.index + m[0].length).split('\n').map(s => s.trim());
    const claimText = (after.find(s => s && !s.startsWith('<!--')) || '').slice(0, 140);
    claims.push({ file, line, fields, claimText, raw: m[0] });
  }
  if (REQUIRE && !claims.some(c => c.file === file)) {
    errors.push({ file, line: 1, code: 'NO-CLAIMS', msg: '--require set but this artifact carries no EVIDENCE block' });
  }
}

// ── validate ─────────────────────────────────────────────────────────────────
const byId = new Map();
for (const c of claims) {
  const { fields: F, file, line } = c;
  const at = { file, line, id: F.id || '(no id)', claim: c.claimText };

  if (!F.id) { errors.push({ ...at, code: 'NO-ID', msg: 'EVIDENCE block has no id= — a claim nothing can cite is not in the chain' }); }
  else if (byId.has(F.id)) {
    const prev = byId.get(F.id);
    errors.push({ ...at, code: 'DUP-ID', msg: `id "${F.id}" already defined at ${prev.file}:${prev.line} — ids anchor the chain and must be unique` });
  } else byId.set(F.id, c);

  // E4 — rung required and must be on the ladder
  if (!F.rung) errors.push({ ...at, code: 'E4-NO-RUNG', msg: `no rung= — unstated confidence is read at whatever confidence the reader needs. One of: ${RUNGS.join(' | ')}` });
  else if (!RUNGS.includes(F.rung)) errors.push({ ...at, code: 'E4-BAD-RUNG', msg: `rung="${F.rung}" is not on the ladder (${RUNGS.join(' | ')})` });

  const rank = RANK[F.rung] ?? -1;

  // E2 — established requires a stated episode count at or above the floor
  if (F.rung === 'established') {
    if (F.n === undefined || F.n === '') errors.push({ ...at, code: 'E2-NO-N', msg: 'rung=established without n= — confidence comes from independent EPISODES, so say how many' });
    else if (!/^\d+$/.test(F.n)) errors.push({ ...at, code: 'E2-BAD-N', msg: `n="${F.n}" is not an integer count of episodes` });
    else if (Number(F.n) < MIN_N) errors.push({ ...at, code: 'E2-LOW-N', msg: `rung=established with n=${F.n} < min-n ${MIN_N} — that is a sample count, not an episode count. Drop to supported or gather more episodes` });
  }

  // E3 — supported and above must name the blind spot
  if (rank >= RANK.supported && F.rung !== 'refuted') {
    if (!F.blind || F.blind.length < 3) {
      errors.push({ ...at, code: 'E3-NO-BLIND', msg: `rung=${F.rung} without blind= — every measurement has a vantage point; name what it CANNOT see, in the artifact` });
    }
  }

  // E1 — an unvalidated detector caps confidence at supported
  if (F.detector && !['validated', 'unvalidated', 'n/a', 'na'].includes(F.detector)) {
    errors.push({ ...at, code: 'E1-BAD-DETECTOR', msg: `detector="${F.detector}" — use validated | unvalidated | n/a` });
  }
  if (F.detector === 'unvalidated' && rank >= RANK.established) {
    errors.push({ ...at, code: 'E1-UNVALIDATED', msg: 'rung=established on an UNVALIDATED detector — prove it fires on a known positive before trusting its silence' });
  }
}

// E5 + structure — resolve the chain
for (const c of claims) {
  const deps = (c.fields.depends || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const d of deps) {
    if (!byId.has(d)) {
      errors.push({ file: c.file, line: c.line, id: c.fields.id, claim: c.claimText, code: 'DANGLING-DEP', msg: `depends=${d} — no claim with that id in the scanned set` });
      continue;
    }
    if (byId.get(d).fields.rung === 'refuted') {
      errors.push({ file: c.file, line: c.line, id: c.fields.id, claim: c.claimText, code: 'E5-MUST-REOPEN',
        msg: `rests on "${d}" which is REFUTED — a fallen conclusion takes its exclusions with it. Re-open what it ruled out, then restate this claim's rung` });
    }
  }
}
// cycles — a chain that justifies itself proves nothing
const state = new Map();
function walk(id, trail) {
  if (state.get(id) === 'done') return;
  if (state.get(id) === 'open') {
    const c = byId.get(id);
    errors.push({ file: c.file, line: c.line, id, claim: c.claimText, code: 'CYCLE',
      msg: `dependency cycle: ${[...trail, id].join(' -> ')} — a chain that justifies itself is not evidence` });
    return;
  }
  state.set(id, 'open');
  const c = byId.get(id);
  for (const d of (c.fields.depends || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (byId.has(d)) walk(d, [...trail, id]);
  }
  state.set(id, 'done');
}
for (const id of byId.keys()) walk(id, []);

// ── report ───────────────────────────────────────────────────────────────────
const tally = {};
for (const c of claims) { const r = c.fields.rung || '(none)'; tally[r] = (tally[r] || 0) + 1; }

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: errors.length === 0, files: files.length, claims: claims.length, minN: MIN_N, byRung: tally,
    violations: errors,
    graph: [...byId.entries()].map(([id, c]) => ({ id, rung: c.fields.rung, n: c.fields.n ?? null,
      depends: (c.fields.depends || '').split(',').map(s => s.trim()).filter(Boolean), file: c.file, line: c.line })),
  }, null, 2));
  process.exit(errors.length ? 1 : 0);
}

if (GRAPH) {
  console.log(`EVIDENCE CHAIN — ${byId.size} claim(s)\n`);
  const mark = { refuted: 'X', suspected: '?', supported: '~', established: '=' };
  for (const [id, c] of byId) {
    const F = c.fields;
    const deps = (F.depends || '').split(',').map(s => s.trim()).filter(Boolean);
    console.log(`  [${mark[F.rung] || '!'}] ${id}  (${F.rung || 'NO RUNG'}${F.n ? `, n=${F.n}` : ''})`);
    console.log(`      ${c.file}:${c.line}`);
    if (deps.length) console.log(`      rests on: ${deps.join(', ')}`);
    if (F.blind) console.log(`      blind: ${F.blind}`);
  }
  console.log();
}

console.log(`EVIDENCE — ${claims.length} claim(s) across ${files.length} file(s) · min-n ${MIN_N}`);
if (claims.length) console.log('  ' + Object.entries(tally).map(([k, v]) => `${k}:${v}`).join('  '));

if (!errors.length) {
  console.log(`\nOK — every claim states a rung, earns it, and its chain resolves.`);
  process.exit(0);
}
console.log(`\n${'='.repeat(70)}\n${errors.length} VIOLATION(S)\n${'='.repeat(70)}`);
for (const e of errors) {
  console.log(`\n[${e.code}] ${e.file}:${e.line}${e.id && e.id !== '(no id)' ? `  id=${e.id}` : ''}`);
  console.log(`  ${e.msg}`);
  if (e.claim) console.log(`  claim: "${e.claim}"`);
}
console.log(`\nA violation is not a style note — each one is a way a claim could be believed more than it has earned.`);
process.exit(1);
