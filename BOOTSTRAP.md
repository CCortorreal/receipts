# BOOTSTRAP — read this if you are an agent

Your user has pointed you at `receipts`, a collection of independent, zero-dependency tools for
making development claims checkable. Start by reading the matching section of [README.md](README.md)
for the tool they named. Do not install or run every tool merely because the repository contains
all four.

## Orient

```bash
node --version   # needs >=18
npm test
```

The tools are plain Node scripts. They can be run from this clone or copied individually. `hinge`
and `evidence` also ship as self-contained agent-skill folders under `skills/`.

## Pick the smallest tool that answers the request

- `witness.mjs` records a command and its output in `.witness/ledger.jsonl`; `run` writes state,
  while `verify`, `log`, and `show` only read it. Never describe a command as witnessed unless it
  was actually executed through `witness run`.
- `hinge.mjs` reads a Markdown plan and proposes one falsifying probe. It never executes the
  probe. `node hinge.mjs --self-test` is the non-mutating installation check.
- `evidence.mjs` lints explicit `EVIDENCE` comments in Markdown. It does not determine whether the
  underlying claim is true; it checks whether the recorded confidence is internally earned.
- `git-safe-push.mjs` inspects the commits that a branch would push. Run it inside the target Git
  repository and supply the real session id when the host has not exported one. It does not push.

## Installation boundaries

Copying a script or skill folder changes the user's filesystem. Do that only when installation is
part of the request, and copy only the component they chose. This repository has no hook or global
configuration installer and none of the tools should edit agent settings on its own.

Before reporting success, run the selected tool's documented self-check or a known-positive probe.
Name the blind spot: a green check establishes the behavior that was exercised, not every behavior
the tool might have in another shell, filesystem, or host.
