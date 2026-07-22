# receipts

Small, zero-dependency, fail-closed tools for agent-assisted development.

The common thesis: when an agent (or a tired human) says *"I ran the tests and they passed"* or *"this plan is solid"* or *"I'm only pushing my own work"*, that sentence is not evidence. These tools replace the sentence with a **receipt** — something you can verify after the fact, that fails **closed** (loud, blocking, exact) instead of open (silent, "probably fine").

Each tool is a single `.mjs` file. Node builtins only — no `package.json` install step, no lockfile, no supply chain. Copy the file you want, or clone the repo.

| Tool | One line |
|---|---|
| [`witness.mjs`](witness.mjs) | Hash-chained receipt ledger for shell commands — prove "that actually ran, and nothing was edited since." |
| [`hinge.mjs`](hinge.mjs) | Reads a Markdown plan, surfaces the most load-bearing **unverified** claim, and proposes the smallest falsifiable probe. |
| [`git-safe-push.mjs`](git-safe-push.mjs) | Blocks a `git push` from silently shipping another concurrent session's commits. |

---

## witness.mjs — receipts for commands

Every command run through witness is appended to an append-only ledger (`.witness/ledger.jsonl`) as a chained hash: each entry's hash covers its own fields **and** the previous entry's hash, so the ledger is tamper-evident the same way a git log is. Edit or delete any past line and `verify` reports the exact index where the chain breaks — and refuses to trust anything after it.

A chain alone proves that the entries you can *see* follow each other; it says nothing about how many there were. So `verify` also cross-checks a **tip anchor** sidecar (`<ledger>.tip.json`, holding `{count, tipHash}`) — otherwise deleting whole records off the end would leave a shorter, perfectly valid chain that verifies clean.

**What this does and does not protect against — plainly.** The anchor defeats accidental truncation, log-rotation damage, and single-step tampering: removing entries now requires a second, consistent edit to a second file. It is **not** a defence against a determined local attacker, because the sidecar is an ordinary local file that anyone able to rewrite the ledger can also rewrite. No artifact stored *beside* the data can give you more than that; real tamper-*proofing* needs an off-box witness — a signature you hold elsewhere, or the tip hash pushed somewhere you don't control. Ledgers written before the anchor existed still verify, and `verify` reports `anchor: absent` for them rather than implying a guarantee it can't make.

```bash
node witness.mjs run -- npm test          # record a receipt (argv exact, no shell)
node witness.mjs run --shell -- npm test  # via the platform shell (pipes, globs, .cmd shims)
node witness.mjs log                      # human-readable history
node witness.mjs show 3                   # full stdout/stderr for receipt #3
node witness.mjs verify                   # walk the whole chain, fail-closed
```

Design choices worth stealing:

- **Fail-closed verify.** One hash mismatch → `BROKEN`, never "mostly fine." An unparseable or truncated ledger line is itself a tamper signal, not something to skip. A ledger that cannot be *read at all* (a directory, bad permissions) is `BROKEN` too — reported in the tool's own vocabulary, with well-formed output under `--json`, never a raw stack trace.
- **No shell by default.** Commands run as an argv array via `spawn(cmd, args)` — no injection surface, quoting survives exactly as typed. `--shell` is the deliberate, named trade for pipes and npm's `.cmd` shims (with Windows' documented cmd.exe re-quoting caveat called out in the source).
- **Deterministic core.** sha256 + fs. No network, no LLM, no API key, no "trust me" step.

This is not a security sandbox — it's a memory aid with a math proof attached.

## hinge.mjs — find the sentence your plan leans on

Plans fail at the claim everything else quietly depends on: *"the library will provide stable readings"*, *"the API supports batch writes"*. Hinge parses a Markdown plan, scores every statement on foundation-language, uncertainty-language, visible evidence, and how many later statements lean on its terms — and prints the single most load-bearing **unverified** claim, with citations and the smallest probe that would falsify it.

```bash
node hinge.mjs plan.md            # the hinge claim + dependents + suggested probe
node hinge.mjs --demo             # worked example, no file needed
node hinge.mjs --json plan.md     # machine-readable
node hinge.mjs --self-test        # 5-check built-in test
```

Hinge only reads text. Proposed probes are printed, never executed. Run it as a pre-flight before expanding work behind a plan — cheaper than discovering the load-bearing assumption three days in.

### hinge as a Claude Code skill

Hinge also ships as a [Claude Code skill](https://code.claude.com/docs/en/skills) at [`skills/hinge/`](skills/hinge/), so the pre-flight can run inside an agent session (`/hinge`, or triggered when you're about to build behind a plan). The skill folder is self-contained — it carries a byte-identical copy of `hinge.mjs`, and a repo test fails closed if the copy ever drifts from the canonical root file.

Install by copying the folder:

```bash
# project-scoped
cp -r skills/hinge your-repo/.claude/skills/hinge
# or user-scoped
cp -r skills/hinge ~/.claude/skills/hinge
```

The skill keeps the tool's own discipline: the deterministic scorer is the authority (the agent may disagree, but must label its own judgment as such), probes are surfaced rather than auto-executed, and "no hinge found" is reported honestly instead of inventing one.

## git-safe-push.mjs — don't ship someone else's commits

Born from a real incident: on a shared checkout, a plain `git push` from one agent session shipped two commits belonging to a *different* concurrent session — commits still awaiting their owner's go-ahead. `git push` operates at the branch level: whoever pushes ships **every** local-only commit, not just their own.

The guard classifies everything in `<upstream>..HEAD` by its `Session-Id:` commit trailer — `mine` / `foreign` / `unstamped` — and loud-halts (exit 1) if a foreign-session commit, or more than one session's commits, would ship:

```bash
node git-safe-push.mjs                    # verdict for the current repo/branch
node git-safe-push.mjs --json             # classified payload
node git-safe-push.mjs --advisory         # never blocks — surface-only, for a soft pre-push hook
```

Run standalone before pushing, or wire it as a git `pre-push` hook. It resolves the current session id from `--sid` or `CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID` / `HAPPY_SESSION_ID`. Deliberately *not* zealous: unstamped commits (the pre-adoption baseline) warn instead of block, so the guard survives contact with a real repo and hardens automatically as your tooling starts stamping commits.

---

## Provenance

These tools come out of my multi-agent development workshop — different model lanes (Claude, Codex) are given a problem and freedom, and what they produce is verified by hand before anything ships: witness had to catch a deliberately forged receipt, hinge had to pass its self-test *and* catch a real unverified claim in one of my own plans. The verification step is the point; it's the same thesis the tools themselves encode.

More on the approach: [writing.cortorreal.fun](https://writing.cortorreal.fun/)

## License

[MIT](LICENSE)
