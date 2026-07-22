---
name: hinge
description: Pre-flight a Markdown plan before expanding work behind it — surface the single most load-bearing UNVERIFIED claim, with citations and the smallest falsifiable probe. Invoke when the user says /hinge, asks "what does this plan actually lean on?", or is about to commit significant work behind a written plan, spec, or design doc. Not for code review, and not a summarizer — it finds the one sentence everything else quietly depends on.
---

# Hinge — find the sentence the plan leans on

Plans fail at the claim everything else quietly depends on: *"the library will provide
stable readings"*, *"the API supports batch writes"*. This skill runs `hinge.mjs` — a
deterministic, zero-dependency, read-only scorer that lives **in this skill's directory**
— against the plan and reports the most load-bearing unverified claim before work
expands behind it.

## How to run it

1. Identify the plan file(s) — the Markdown doc the user is about to act on. If the plan
   is only in the conversation, write it to a temp file first; hinge reads files or stdin.
2. Run the bundled copy (same directory as this SKILL.md):

   ```bash
   node <this-skill-dir>/hinge.mjs <plan.md> [more.md ...]
   ```

   Use `--json` when you want to post-process; `--self-test` if you suspect the tool
   itself (5 built-in checks).

## How to report the result

Present exactly three things, in this order:

1. **The hinge claim, verbatim**, with its `file:line` citation and the tool's evidence
   rating.
2. **Why it matters** — how many later statements lean on it, across how many sections
   (the tool lists them; cite two or three, don't dump all).
3. **The smallest proof** — the tool's suggested probe.

Then stop and put the decision to the user: verify the claim (offer to run the probe),
rewrite it into something already-verified, or knowingly proceed with the risk named.

## Rules (fail-closed, same as the tool)

- **Hinge never executes probes — and neither do you, unprompted.** The tool prints a
  probe; running it is a separate, deliberate step the user opts into. When a probe does
  run, record its result (the receipt) back into the plan next to the claim.
- **Don't substitute vibes for the score.** The skill's value is the deterministic pass.
  If the tool errors or can't read the file, report that plainly and fix the input — do
  not silently fall back to your own impression of "what the plan leans on."
- **"No hinge found" is a real answer.** If the tool reports no load-bearing unverified
  claim stood out, say so. Do not invent one to seem useful.
- You may **disagree with the tool** — its heuristics are lexical, and you can read
  meaning. If you believe a different claim is the true hinge, present the tool's answer
  first, then yours, clearly labeled as your judgment. Never present your candidate as
  the tool's output.

## Provenance

Part of [receipts](https://github.com/CCortorreal/receipts) — small, zero-dependency,
fail-closed tools for agent-assisted development. The canonical `hinge.mjs` lives at the
repo root; this directory carries a byte-identical copy so the skill folder is
self-contained, and a repo test fails if the two ever drift.
