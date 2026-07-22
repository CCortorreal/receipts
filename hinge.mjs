#!/usr/bin/env node
// PROVENANCE: born in a multi-agent bake-off in my agentic workshop (a Codex lane authored it,
// given open-ended freedom); verified by hand before release — 5/5 self-test, plus a live catch
// of a real unverified load-bearing claim in one of my own plans.
/**
 * Hinge - find the unverified sentence a plan leans on most.
 * Zero dependencies. Read-only. Proposed probes are never executed.
 */
import fs from 'node:fs';
import path from 'node:path';

const STOP = new Set(`a an and are as at be been but by can could did do does for from had has have
he her here hers him his how i if in into is it its may me might must my no not of on once only or
our ours she should so than that the their theirs them then there these they this those to too under
up us very was we what when where which while who why will with would you your yours`.split(/\s+/));
const FOUNDATION = /\b(assum(?:e|es|ed|ing|ption)|depend(?:s|ed|ency)?|require(?:s|d)?|must|need(?:s|ed)?|only if|provided that|before we|once we|will|can)\b/i;
const UNCERTAIN = /\b(tbd|todo|unknown|unclear|maybe|perhaps|likely|probably|hope|expect|believe|should|could|might|risk|unverified|pending)\b/i;
const RECEIPT = /\b(verified|measured|tested|confirmed|observed|receipt|evidence|benchmark(?:ed)?|exit code|passes?|passed|proof)\b/i;
const CONSEQUENCE = /\b(then|therefore|so that|after|once|before|blocks?|unblocks?|enables?|depends?|requires?|because|next)\b/i;

function usage() {
  return `Hinge - find the unverified sentence a plan leans on most

Usage:
  node hinge.mjs plan.md [notes.md ...]
  producing-command | node hinge.mjs -
  node hinge.mjs --demo
  node hinge.mjs --json plan.md
  node hinge.mjs --self-test

Hinge only reads text. Suggested probes are printed, never executed.`;
}

function cleanMarkdown(s) {
  return s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+] |\d+[.)] |>[ ]?)/, '')
    .replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();
}

function statementsFrom(text, source) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let section = '(opening)', fence = false, paragraph = [], paragraphStart = 1;
  const flush = () => {
    if (!paragraph.length) return;
    const raw = paragraph.join(' '), clean = cleanMarkdown(raw);
    if (clean.length >= 20) out.push({ source, line: paragraphStart, section, text: clean, raw });
    paragraph = [];
  };
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { flush(); fence = !fence; return; }
    if (fence) return;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) { flush(); section = cleanMarkdown(heading[1]); return; }
    if (!line.trim()) { flush(); return; }
    if (/^\s*(?:[-*+] |\d+[.)] |>[ ]?)/.test(line)) {
      flush();
      const clean = cleanMarkdown(line);
      if (clean.length >= 12) out.push({ source, line: i + 1, section, text: clean, raw: line });
      return;
    }
    if (!paragraph.length) paragraphStart = i + 1;
    paragraph.push(line.trim());
  });
  flush();
  return out;
}

function terms(text) {
  const found = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  return new Set(found.filter(t => !STOP.has(t) && !/^\d+$/.test(t)));
}
function overlap(a, b) { let n = 0; for (const t of a) if (b.has(t)) n++; return n; }

function evidenceLevel(s) {
  let e = 0;
  if (RECEIPT.test(s.text)) e += 2;
  if (/`[^`]+`/.test(s.raw)) e++;
  if (/https?:\/\//i.test(s.raw)) e++;
  if (/(?:^|\s)(?:\.\.?[\\/]|[A-Za-z]:[\\/]|[\w.-]+[\\/])[\w./\\-]+/.test(s.raw)) e++;
  if (/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|minutes?|hours?|days?|%|kb|mb|gb|x)\b/i.test(s.text)) e++;
  return Math.min(e, 4);
}

function analyze(statements) {
  const all = statements.map((s, index) => ({ ...s, index, terms: terms(s.text) }));
  const candidates = [];
  for (const s of all) {
    const foundational = FOUNDATION.test(s.text), uncertain = UNCERTAIN.test(s.text);
    const evidence = evidenceLevel(s), dependents = [];
    for (const later of all.slice(s.index + 1)) {
      const shared = overlap(s.terms, later.terms);
      if (!shared) continue;
      const normalized = shared / Math.max(3, Math.min(s.terms.size, later.terms.size));
      const weight = normalized + (CONSEQUENCE.test(later.text) ? 0.7 : 0)
        + (later.section === s.section ? 0.25 : 0);
      if (weight >= 0.45) dependents.push({ ...later, shared, weight });
    }
    if (!foundational && !uncertain && dependents.length < 2) continue;
    const sections = new Set(dependents.map(d => d.section)).size;
    const downstreamWeight = dependents.reduce((n, d) => n + d.weight, 0);
    const early = 1 - s.index / Math.max(1, all.length - 1);
    const doubt = (foundational ? 1.4 : 0.5) + (uncertain ? 1.3 : 0)
      + Math.max(0, 1.5 - evidence * 0.55);
    const score = doubt * (1 + Math.sqrt(downstreamWeight)) + sections * 0.65 + early * 0.4;
    candidates.push({ ...s, evidence, dependents, sections, score });
  }
  return candidates.sort((a, b) => b.score - a.score || a.index - b.index);
}

function suggestProbe(c) {
  const cmd = c.raw.match(/`([^`]{3,120})`/);
  if (cmd) return `Run the named check in an isolated/read-only mode (${cmd[1]}), and record expected output plus exit code.`;
  const url = c.raw.match(/https?:\/\/[^\s)>]+/i);
  if (url) return `Open ${url[0]} and record the exact fact, date, and page section supporting this claim.`;
  const file = c.raw.match(/(?:[A-Za-z]:[\\/]|\.\.?[\\/])[^\s`"'<>|]+|[\w.-]+[\\/][\w./\\-]+/);
  if (file) return `Read ${file[0]} and write down one observable pass/fail condition before continuing dependent work.`;
  if (/\b(api|service|vendor|customer|user|network|database|model|platform|library|package)\b/i.test(c.text))
    return 'Make the smallest disposable probe of the named external capability; preserve the response or error as the receipt.';
  const claim = c.text.replace(/[.?!]+$/, '').trim();
  return `Is it observably true that "${claim}"? Name one observable that would falsify it, then check only that observable.`;
}

function resultFor(statements) {
  const ranked = analyze(statements);
  if (!ranked.length) return { schema: 'hinge/v1', statementCount: statements.length, hinge: null, alternatives: [] };
  const shape = c => ({
    source: c.source, line: c.line, section: c.section, text: c.text,
    score: Number(c.score.toFixed(2)),
    evidence: ['none visible', 'thin', 'partial', 'substantial', 'strong'][c.evidence],
    dependentCount: c.dependents.length, dependentSections: c.sections,
    dependents: c.dependents.slice(0, 5).map(d => ({
      source: d.source, line: d.line, section: d.section, text: d.text
    })),
    probe: suggestProbe(c),
  });
  return { schema: 'hinge/v1', statementCount: statements.length, hinge: shape(ranked[0]), alternatives: ranked.slice(1, 3).map(shape) };
}

function printHuman(result) {
  if (!result.hinge) {
    console.log(`HINGE - ${result.statementCount} statements read\n\nNo load-bearing unverified claim stood out.`);
    return;
  }
  const h = result.hinge;
  console.log(`HINGE - ${result.statementCount} statements read`);
  console.log(`\nLOAD-BEARING CLAIM  ${h.source}:${h.line}  [score ${h.score}; evidence ${h.evidence}]`);
  console.log(`  ${h.text}`);
  console.log(`\nWHY IT MATTERS  ${h.dependentCount} later statement(s) across ${h.dependentSections} section(s) lean on its language`);
  for (const d of h.dependents) console.log(`  -> ${d.source}:${d.line}  ${d.text}`);
  console.log(`\nSMALLEST PROOF\n  ${h.probe}`);
  console.log('\nNEXT: verify or rewrite the claim before expanding the work behind it.');
  if (result.alternatives.length) {
    console.log('\nRUNNERS-UP');
    for (const a of result.alternatives) console.log(`  ${a.source}:${a.line}  [${a.score}] ${a.text}`);
  }
}

function demoText() {
  return `# Pocket weather station

We assume the sensor library works on the target board without calibration.

## Build
- Wire the sensor to the board.
- The library will provide stable humidity readings.
- Once stable humidity readings arrive, store them in the local database.

## Interface
- The dashboard depends on stable humidity readings updating every minute.
- Then add humidity alerts when readings cross the safe range.

## Launch
- Maybe the enclosure can sit outdoors without affecting sensor accuracy.
- Ship ten units after the humidity dashboard and alerts are complete.`;
}

function selfTest() {
  const ss = statementsFrom(demoText(), '<demo>'), r = resultFor(ss);
  const checks = [
    ['extracts statements', ss.length >= 7],
    ['finds a hinge', Boolean(r.hinge)],
    ['selects load-bearing reading claim', /stable humidity readings/i.test(r.hinge?.text || '')],
    ['finds downstream dependencies', (r.hinge?.dependentCount || 0) >= 2],
    ['emits a probe', (r.hinge?.probe || '').length > 30],
  ];
  for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
}

const args = process.argv.slice(2);
const take = flag => { const i = args.indexOf(flag); if (i < 0) return false; args.splice(i, 1); return true; };
const json = take('--json');
if (take('--help') || take('-h')) { console.log(usage()); process.exit(0); }
if (take('--self-test')) { selfTest(); process.exit(process.exitCode || 0); }

let inputs = [];
if (take('--demo')) inputs = [{ source: '<demo>', text: demoText() }];
else {
  if (!args.length) { console.error(usage()); process.exit(2); }
  for (const name of args) {
    if (name === '-') inputs.push({ source: '<stdin>', text: fs.readFileSync(0, 'utf8') });
    else {
      try { inputs.push({ source: name, text: fs.readFileSync(path.resolve(name), 'utf8') }); }
      catch (e) { console.error(`hinge: cannot read ${name}: ${e.message}`); process.exit(2); }
    }
  }
}
const result = resultFor(inputs.flatMap(x => statementsFrom(x.text, x.source)));
if (json) console.log(JSON.stringify(result, null, 2));
else printHuman(result);
process.exit(process.exitCode ? process.exitCode : 0);
