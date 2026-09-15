---
name: evidence
description: Make a claim's confidence machine-checkable — pick an honest rung on the evidence ladder (suspected/supported/established/refuted), name the blind spot, state the episode count, and wire the chain so a refuted parent forces its children to re-open. Invoke when writing up a finding, a diagnosis, a design decision, a test-suite result, or any doc that asserts something is true; when reviewing whether a claim has earned its confidence; when a conclusion falls and you need to know what it took down with it; or when the user says "/evidence", "how confident are we", "what does this rest on", "prove it fires", or "is that established". Do NOT trigger for gathering evidence in a legal sense, or for ordinary code comments that assert nothing about the world.
---

# Evidence — confidence you can check with a tool

Docs quietly accumulate claims — a diagnosis, a benchmark, "the fix worked" — with no way to tell
later whether that was a hunch, one measurement, or something actually nailed down. This skill
runs `evidence.mjs` — a deterministic, zero-dependency, read-only linter that lives **in this
skill's directory** — against the claim's own confidence-marking, so a machine catches what
discipline alone would eventually skip.

## Step 1 — Mark the claim

An HTML comment directly above the sentence it governs (never renders):

```html
<!-- EVIDENCE id=nat-ceiling rung=established n=6
     blind="no ISP-side view; cannot separate upstream shaping from local NAT exhaustion"
     detector=validated depends=saturation-test -->
The router has a hard NAT ceiling that becomes a cliff at ~100 Mbps.
```

Then check it:

```bash
node <this-skill-dir>/evidence.mjs --graph <paths>
```

`--json` for machine-readable output (wire it into a CI check), `--min-n N` for a stricter episode
floor, `--require` to insist a path carries at least one claim. Exit 0 = clean, 1 = violations,
2 = bad usage or nothing was scanned.

### Edges worth knowing before you lose ten minutes to them

1. **The directory scan does NOT recurse.** Pointing it at `docs/` will not reach
   `docs/handoffs/*.md`. Every leaf directory needs listing explicitly. If your file count looks
   suspiciously low, this is usually why.
2. **`depends=none` is not "no dependency"** — it reads as a reference to a claim whose id is
   literally `none`, and fails DANGLING-DEP. **Omit `depends=` entirely instead.**
3. **Fence your syntax examples — inline backticks are not enough.** A block shown in prose with
   single-backtick spans is parsed as a real claim and will fail against your own documentation.
   Only a true triple-backtick fence marks it as an illustration.
4. **A `>`-blockquoted fence is still not shielded** — the fence mask anchors at column start, so
   a fence inside a blockquote banner does not register. Use prose-only there, or unwrap the fence.

## Step 2 — Pick the rung honestly (this is the whole skill)

The tool cannot judge your rung; it can only refuse the ones you haven't earned.

- **suspected** — a hypothesis. You noticed something. **This is a fine thing to publish** — E4
  exists so a low-confidence finding can be reported *as* low-confidence and still be useful. Do
  not sit on a hunch until it is bulletproof; label it and ship it.
- **supported** — evidence points this way, and you can say what evidence. Still one vantage point.
- **established** — multiple **independent episodes** agree, and you have said how many. The tool
  demands `n` because *you* are the only one who knows whether a thousand readings were a thousand
  samples inside one episode (that is n=1 with good resolution) or six real occurrences.
- **refuted** — you were wrong. **Mark it refuted; do not delete it.** A deleted wrong answer takes
  its reasoning with it, and the next reader re-derives it from scratch.

**The most common dishonesty is not lying, it is skipping a rung** — going from "I fixed it" to
"established" without the intervening "did the symptom stay gone across independent occurrences".

## Step 3 — Name what you cannot see

Required at `supported` and above. Not a disclaimer — a *fact about the instrument*. "No
production traffic sampled", "single machine", "only tested while idle", "reads the archive, not
the live stream". A correct check run through a blind instrument returns a correct zero that means
nothing; the `blind` field is where the reader learns the zero was blind.

If you cannot name a blind spot, you have not thought about your vantage point yet. Every
measurement has one.

## Step 4 — Wire the chain

`depends=` lists the claim ids this rests on. Then, when something falls:

```bash
node <this-skill-dir>/evidence.mjs --graph <paths>
```

Flip the fallen claim to `rung=refuted` and re-run. Every child raises **E5-MUST-REOPEN**. That is
the rule people skip, because re-opening settled ground feels like going backwards — so the tool
does the remembering. A refuted conclusion takes its exclusions with it: everything it ruled *out*
is live again.

Cycles are caught too. A chain that justifies itself is not evidence.

## Step 5 — Prove your detector fires

`detector=validated` means you fed it a **known positive** and watched it go RED. `unvalidated`
caps you at `supported`, by force. This applies to the thing you just built, too: a validator whose
RED nobody has observed is exactly the unvalidated detector this tool refuses to trust — hold your
own checks to the same rule before you cite their silence as support.

## Traps

- **`n` counts episodes, not samples.** The tool cannot tell the difference and will accept a lie.
  This is the one place it trusts you completely.
- **A test that passes because of what is ABSENT is not evidence.** Prove isolation bites: point
  the mock at something impossible and confirm it now fails.
- **A check you can turn green by touching a file measures the wrong thing.** Any mtime/existence
  check inherits this.
- **Do not mark up everything.** Claims about the world earn a block. Ordinary prose, task lists,
  and code comments do not. A doc where every sentence is annotated is a doc nobody reads.
- **Inherited confidence is not evidence.** Citing a doc that said "established" does not make your
  claim established — go look at what *that* claim actually rested on.

## Fail-closed

Unparseable blocks are errors, never skipped. Dangling `depends` ids are errors — a citation to
nothing looks like support and isn't. Duplicate ids are errors, because ids anchor the chain.
Scanning zero files is an error too, not a silent pass.

<!-- EVIDENCE id=skill-copy-stays-canonical rung=supported
     blind="checked at authoring time by a repo test; not proven to hold under a manual edit that skips the test" -->
This skill folder's `evidence.mjs` is a byte-identical copy of the repo-root canonical file, and a
repo test fails closed the moment the two drift.

## Provenance

Part of [receipts](https://github.com/CCortorreal/receipts) — small, zero-dependency,
fail-closed tools for agent-assisted development. `evidence.mjs` was workshopped between a
Claude Code session and a Codex session; [the-wire](https://github.com/CCortorreal/the-wire), a
sibling project, carried the messages between them. The canonical `evidence.mjs` lives at the
repo root; this directory carries a byte-identical copy so the skill folder is self-contained,
and a repo test fails if the two ever drift.
