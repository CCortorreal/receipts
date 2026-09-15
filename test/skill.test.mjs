import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKILLS = [
  {
    tool: 'hinge',
    canonical: path.join(REPO_ROOT, 'hinge.mjs'),
    skillDir: path.join(REPO_ROOT, 'skills', 'hinge'),
    selfTestArgs: ['--self-test'],
  },
  {
    tool: 'evidence',
    canonical: path.join(REPO_ROOT, 'evidence.mjs'),
    skillDir: path.join(REPO_ROOT, 'skills', 'evidence'),
    // evidence.mjs has no --self-test; run it against its own SKILL.md, which carries a real
    // (unfenced) EVIDENCE block plus fenced illustrations that must NOT be read as claims.
    selfTestArgs: ['--json', path.join(REPO_ROOT, 'skills', 'evidence', 'SKILL.md')],
  },
];

for (const { tool, canonical, skillDir, selfTestArgs } of SKILLS) {
  const skillCopy = path.join(skillDir, `${tool}.mjs`);
  const skillMd = path.join(skillDir, 'SKILL.md');

  test(`skill copy of ${tool}.mjs is byte-identical to the canonical root copy`, () => {
    const canonicalBytes = readFileSync(canonical);
    const copy = readFileSync(skillCopy);
    assert.ok(
      canonicalBytes.equals(copy),
      `skills/${tool}/${tool}.mjs has drifted from the root ${tool}.mjs — re-copy it; the skill folder must stay self-contained AND canonical`
    );
  });

  test(`${tool} SKILL.md has well-formed frontmatter naming the skill`, () => {
    const text = readFileSync(skillMd, 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(fm, 'SKILL.md must open with a --- frontmatter block');
    assert.match(fm[1], new RegExp(`^name:\\s*${tool}\\s*$`, 'm'), `frontmatter must declare name: ${tool}`);
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    assert.ok(desc && desc[1].trim().length > 40, 'frontmatter needs a substantive description (it is the trigger)');
  });

  test(`bundled copy of ${tool}.mjs runs standalone from the skill directory`, () => {
    const result = spawnSync(process.execPath, [skillCopy, ...selfTestArgs], {
      cwd: skillDir,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /FAIL/);
  });
}
