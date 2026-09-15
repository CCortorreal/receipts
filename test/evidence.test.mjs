// evidence.test.mjs — proves each rule FIRES on a known positive before we trust its silence.
// That is E1 applied to the checker itself: a validator whose RED has never been observed is an
// unvalidated detector, and this whole tool exists to refuse exactly that.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TOOL = join(dirname(dirname(fileURLToPath(import.meta.url))), 'evidence.mjs');

/** Run the tool over a synthetic doc; return {code, json}. */
function run(md, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  const file = join(dir, 'doc.md');
  writeFileSync(file, md);
  try {
    const out = execFileSync('node', [TOOL, '--json', ...extraArgs, file], { encoding: 'utf8' });
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    return { code: e.status, json: JSON.parse(e.stdout || '{}') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const codes = (r) => (r.json.violations || []).map(v => v.code);

test('clean doc passes — the silence is meaningful only because the reds below fire', () => {
  const r = run(`
<!-- EVIDENCE id=base rung=established n=6 blind="no ISP-side view" detector=validated -->
The router has a hard NAT ceiling.

<!-- EVIDENCE id=child rung=supported blind="single box, single week" depends=base -->
Saturation upstream explains the stalls.
`);
  assert.strictEqual(r.code, 0, JSON.stringify(codes(r)));
  assert.strictEqual(r.json.claims, 2);
});

test('E4 — a claim with no rung is a violation', () => {
  const r = run(`<!-- EVIDENCE id=x blind="none" -->\nA thing is true.`);
  assert.ok(codes(r).includes('E4-NO-RUNG'), JSON.stringify(codes(r)));
  assert.strictEqual(r.code, 1);
});

test('E4 — a rung off the ladder is a violation', () => {
  const r = run(`<!-- EVIDENCE id=x rung=probably-fine -->\nA thing.`);
  assert.ok(codes(r).includes('E4-BAD-RUNG'));
});

test('E2 — established without an episode count', () => {
  const r = run(`<!-- EVIDENCE id=x rung=established blind="single box, one week" detector=validated -->\nA thing.`);
  assert.ok(codes(r).includes('E2-NO-N'));
});

test('E2 — established below the episode floor (samples masquerading as episodes)', () => {
  const r = run(`<!-- EVIDENCE id=x rung=established n=2 blind="single box, one week" detector=validated -->\nA thing.`);
  assert.ok(codes(r).includes('E2-LOW-N'));
});

test('E2 — the floor is configurable and enforced', () => {
  const md = `<!-- EVIDENCE id=x rung=established n=4 blind="single box, one week" detector=validated -->\nA thing.`;
  assert.strictEqual(run(md).code, 0, 'n=4 passes default min-n 3');
  assert.ok(codes(run(md, ['--min-n', '5'])).includes('E2-LOW-N'), 'n=4 fails min-n 5');
});

test('E3 — supported and above must name the blind spot', () => {
  assert.ok(codes(run(`<!-- EVIDENCE id=x rung=supported -->\nA thing.`)).includes('E3-NO-BLIND'));
  assert.ok(codes(run(`<!-- EVIDENCE id=y rung=established n=9 detector=validated -->\nA thing.`)).includes('E3-NO-BLIND'));
});

test('E3 — suspected does NOT require a blind spot (a hunch may be a hunch)', () => {
  assert.strictEqual(run(`<!-- EVIDENCE id=x rung=suspected -->\nMaybe a thing.`).code, 0);
});

test('E1 — established on an unvalidated detector', () => {
  const r = run(`<!-- EVIDENCE id=x rung=established n=8 blind="single box, one week" detector=unvalidated -->\nA thing.`);
  assert.ok(codes(r).includes('E1-UNVALIDATED'));
});

test('E1 — an unvalidated detector is fine at supported', () => {
  assert.strictEqual(run(`<!-- EVIDENCE id=x rung=supported blind="single box, one week" detector=unvalidated -->\nA thing.`).code, 0);
});

test('E5 — a claim resting on a REFUTED parent must reopen', () => {
  const r = run(`
<!-- EVIDENCE id=parent rung=refuted -->
The deck's wifi radio was the cause.

<!-- EVIDENCE id=kid rung=supported blind="single box, one week" depends=parent -->
Therefore the roaming fix is unnecessary.
`);
  assert.ok(codes(r).includes('E5-MUST-REOPEN'), JSON.stringify(codes(r)));
});

test('structure — a dangling citation is caught', () => {
  const r = run(`<!-- EVIDENCE id=x rung=suspected depends=ghost -->\nA thing.`);
  assert.ok(codes(r).includes('DANGLING-DEP'));
});

test('structure — duplicate ids break the chain anchor', () => {
  const r = run(`
<!-- EVIDENCE id=same rung=suspected -->
One.

<!-- EVIDENCE id=same rung=suspected -->
Two.
`);
  assert.ok(codes(r).includes('DUP-ID'));
});

test('structure — a self-justifying cycle is caught', () => {
  const r = run(`
<!-- EVIDENCE id=a rung=suspected depends=b -->
A because B.

<!-- EVIDENCE id=b rung=suspected depends=a -->
B because A.
`);
  assert.ok(codes(r).includes('CYCLE'), JSON.stringify(codes(r)));
});

test('a doc with no claims is fine by default, an error under --require', () => {
  assert.strictEqual(run(`# Just prose\nNothing asserted.`).code, 0);
  assert.ok(codes(run(`# Just prose`, ['--require'])).includes('NO-CLAIMS'));
});

test('parsing — quoted multi-word blind spots and wrapped blocks survive', () => {
  const r = run(`
<!-- EVIDENCE id=x rung=established n=5
     blind="cannot distinguish upstream shaping from local NAT exhaustion"
     detector=validated -->
A thing.
`);
  assert.strictEqual(r.code, 0, JSON.stringify(codes(r)));
  assert.strictEqual(r.json.graph[0].n, '5');
});

test('the chain is emitted for downstream tooling', () => {
  const r = run(`
<!-- EVIDENCE id=root rung=established n=4 blind="single box, one week" detector=validated -->
Root.

<!-- EVIDENCE id=leaf rung=supported blind="single box, one week" depends=root -->
Leaf.
`);
  const leaf = r.json.graph.find(g => g.id === 'leaf');
  assert.deepStrictEqual(leaf.depends, ['root']);
});

test('worked examples inside a fence are illustrations, not claims', () => {
  // A doc that teaches the convention by SHOWING a block whose depends= points at an id that
  // only exists in the example would, without this rule, get the checker red-flagging its own
  // teaching material — which would teach readers to distrust the red.
  const r = run([
    'Here is how you write one:',
    '',
    '```html',
    '<!-- EVIDENCE id=example-only rung=established n=6 blind="none" depends=ghost-id -->',
    'An illustrative claim.',
    '```',
    '',
    'And a real one:',
    '<!-- EVIDENCE id=real rung=suspected -->',
    'A real claim.',
  ].join('\n'));
  assert.strictEqual(r.code, 0, JSON.stringify(codes(r)));
  assert.strictEqual(r.json.claims, 1, 'only the unfenced claim counts');
  assert.strictEqual(r.json.graph[0].id, 'real');
});

test('tilde fences and indented fences are handled too', () => {
  const r = run('~~~\n<!-- EVIDENCE id=x rung=bogus -->\n~~~\n');
  assert.strictEqual(r.code, 0, JSON.stringify(codes(r)));
});

test('line numbers stay TRUE after fence masking', () => {
  const r = run(['```', 'fenced', '```', '', '<!-- EVIDENCE id=x -->', 'A claim.'].join('\n'));
  assert.strictEqual(r.json.violations[0].line, 5, 'must report the real line, not a shifted one');
});
