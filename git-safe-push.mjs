#!/usr/bin/env node
/**
 * git-safe-push.mjs — the co-mingled-push guard (the git half of "unfuckupable").
 *
 * THE INCIDENT (2026-07-02): a plain `git push` on a shared checkout flushed 2 commits from a
 * DIFFERENT concurrent agent session — commits still awaiting their owner's go-ahead. `git push`
 * operates at the branch level — whoever pushes ships EVERY local-only commit, not just their own.
 *
 * THE FIX: before a push, surface exactly what `<upstream>..HEAD` would ship, attributed by the
 * `Session-Id:` commit trailer. A commit whose Session-Id ≠ this session's is FOREIGN → loud-halt
 * (exit 1) so the co-mingle is seen + confirmed, never silent. Designed to NOT false-block the
 * current unstamped baseline (a commit with no Session-Id is WARNED, not blocked) so it survives
 * contact and doesn't get disabled — it hardens automatically as your tooling starts stamping
 * commits with `Session-Id:` trailers.
 *
 * Usage: node git-safe-push.mjs [--repo <dir>] [--branch <b>] [--sid <mysid>] [--json] [--advisory]
 *   Runnable standalone OR from a git `pre-push` hook. Resolves mySid from --sid → env
 *   CLAUDE_CODE_SESSION_ID / CLAUDE_SESSION_ID / HAPPY_SESSION_ID.
 *   Exit 0 = safe to push (or nothing outgoing / no upstream). Exit 1 = a FOREIGN-session commit is
 *   in the push (blocked). --advisory never exits 1 (surface-only, for a non-blocking pre-push hook).
 *   --json emits the classified payload.
 */

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) continue;
  const k = a.slice(2), n = argv[i + 1];
  if (n !== undefined && !n.startsWith('--')) { flags[k] = n; i++; } else flags[k] = true;
}
const REPO = typeof flags.repo === 'string' ? flags.repo : process.cwd();
const ADVISORY = !!flags.advisory;
const mySid = (typeof flags.sid === 'string' && flags.sid) || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.env.HAPPY_SESSION_ID || null;

const isTTY = process.stderr.isTTY === true && !process.env.NO_COLOR;
const c = {
  bold: s => isTTY ? `\x1b[1m${s}\x1b[0m` : s, dim: s => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  red: s => isTTY ? `\x1b[31m${s}\x1b[0m` : s, green: s => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: s => isTTY ? `\x1b[33m${s}\x1b[0m` : s, cyan: s => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
};
function git(args) { try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return null; } }
function done(code, payload) { if (flags.json) console.log(JSON.stringify(payload, null, 2)); process.exit(ADVISORY ? 0 : code); }

// upstream (local ref, no fetch) — nothing to guard if there's none
const branch = (typeof flags.branch === 'string' && flags.branch) || (git(['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || 'HEAD';
const up = (git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || '').trim();
if (!up) { if (!flags.json) console.error(c.dim(`git-safe-push: ${branch} has no upstream — nothing to compare (push creates it).`)); done(0, { repo: REPO, branch, upstream: null, outgoing: [] }); }

// outgoing commits: sha | author | reldate | subject | Session-Id trailer
const US = '\x1f';
const raw = git(['log', `${up}..HEAD`, `--format=%H${US}%an${US}%cr${US}%s${US}%(trailers:key=Session-Id,valueonly)`]) || '';
const outgoing = raw.split('\n').filter(Boolean).map(line => {
  const [sha, author, when, subject, sidRaw] = line.split(US);
  const sid = (sidRaw || '').trim() || null;
  const cls = !sid ? 'unstamped' : !mySid ? 'unknown-owner' : (sid === mySid ? 'mine' : 'foreign');
  return { sha: sha.slice(0, 9), author, when, subject, sid, cls };
});
if (!outgoing.length) { if (!flags.json) console.error(c.dim(`git-safe-push: ${branch} is level with ${up} — nothing to push.`)); done(0, { repo: REPO, branch, upstream: up, outgoing: [] }); }

const foreign = mySid ? outgoing.filter(o => o.cls === 'foreign') : [];
const unstamped = outgoing.filter(o => o.cls === 'unstamped');
const authors = [...new Set(outgoing.map(o => o.author))];
const stampedSids = [...new Set(outgoing.filter(o => o.sid).map(o => o.sid))];
// BLOCK: a commit owned by ANOTHER session (mySid known), OR >1 distinct Session-Id in the push (a
// co-mingle regardless of which is "mine"). WARN (never block — unstamped is the current baseline): a
// multi-author unstamped push (SEE what ships). Else: clean.
const multiSession = stampedSids.length > 1;
const blocked = foreign.length > 0 || multiSession;
const warn = !blocked && unstamped.length > 0 && authors.length > 1;

if (!blocked && !warn) {
  const allMine = outgoing.length > 0 && outgoing.every(o => o.cls === 'mine');
  if (!flags.json) {
    if (allMine) console.error(c.green(`git-safe-push: ✓ ${outgoing.length} commit(s), all carry your Session-Id — safe to push.`));
    else console.error(c.dim(`git-safe-push: ${outgoing.length} commit(s), single author (${authors[0]}), no cross-session markers — looks safe. Stamp 'Session-Id:' to make provenance provable.`));
  }
  done(0, { repo: REPO, branch, upstream: up, outgoing, verdict: allMine ? 'clean' : 'presumed-clean' });
}

// loud banner (stderr — visible even when stdout is piped)
const mark = o => o.cls === 'foreign' ? c.red('✗ FOREIGN') : o.cls === 'unstamped' ? c.yellow('? unstamped') : o.cls === 'unknown-owner' ? c.cyan('· stamped') : c.green('✓ mine');
const E = s => console.error(s);
E('');
E((blocked ? c.red : c.yellow)(c.bold(`  ┏━ git-safe-push — ${blocked ? 'CO-MINGLED PUSH BLOCKED' : 'REVIEW BEFORE PUSH'} ━ ${branch} → ${up}`)));
E((blocked ? c.red : c.yellow)(`  ┃ A push ships ALL ${outgoing.length} local commit(s) below — not just yours. ${mySid ? `(your session ${mySid.slice(0, 8)})` : '(session id unknown — cannot attribute)'}`));
for (const o of outgoing.slice(0, 20)) E(`  ┃ ${mark(o)}  ${c.dim(o.sha)} ${c.dim('(' + o.author + ', ' + o.when + ')')} ${o.subject.slice(0, 66)}`);
if (outgoing.length > 20) E(`  ┃ ${c.dim(`…and ${outgoing.length - 20} more`)}`);
if (blocked) {
  const why = foreign.length ? `${foreign.length} commit(s) belong to ANOTHER session` : `${stampedSids.length} distinct sessions' commits are co-mingled here`;
  E(c.red(`  ┃ ${why} — pushing may ship peer work still gated on its owner's approval.`));
  E(c.red(`  ┗━ BLOCKED. Push only your own session's commits (branch-per-session), or a human confirms + re-runs.`));
  done(1, { repo: REPO, branch, upstream: up, outgoing, verdict: 'blocked', foreign: foreign.length, sessions: stampedSids.length });
} else {
  E(c.yellow(`  ┃ commits are unattributed (no Session-Id trailer yet) across ${authors.length} author(s) — SEE what ships; confirm it's all intended.`));
  E(c.yellow(`  ┗━ WARN (not blocked — unstamped baseline). Stamp commits with 'Session-Id: <claudeSid>' to make this a hard gate.`));
  done(0, { repo: REPO, branch, upstream: up, outgoing, verdict: 'warn' });
}
