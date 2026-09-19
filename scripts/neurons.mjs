/**
 * Checks every `// @signal X` anchor in src/ against the neuron doc that claims to describe its
 * unit.
 *
 * ql-pipeline reviews other repositories for exactly this — "the repo has a knowledge harness, but
 * the changed units were not updated in this commit" is one of its own findings — and had no way
 * to ask the question of itself. Five units had drifted before this existed, two of them from the
 * change that added the rule the reviewer cited.
 *
 * Deliberately narrow. It does not check edges, reflection or sinks the way ql-docs' harness does;
 * it answers one question — is there a documented entry for every signal this code exports — which
 * is the drift that actually happened, and is cheap enough to run on every push.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const slash = (value) => value.replaceAll('\\', '/');
const ROOT = slash(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(slash(full));
  }
  return out;
}

const files = walk(`${ROOT}/src`);

/** unit path -> the signal names its doc declares. */
const docs = new Map();
for (const file of files.filter((f) => f.endsWith('.yml'))) {
  try {
    const doc = YAML.parse(readFileSync(file, 'utf8'));
    if (doc?.unit) docs.set(doc.unit, new Set((doc.signals ?? []).map((s) => s.signal)));
  } catch (error) {
    console.error(`UNPARSEABLE   ${file.slice(ROOT.length + 1)}  ${String(error)}`);
    process.exitCode = 1;
  }
}

let drifted = 0;
for (const file of files.filter((f) => f.endsWith('.ts') && !f.includes('/documentation/'))) {
  const signals = [...readFileSync(file, 'utf8').matchAll(/\/\/ @signal (\w+)/g)].map((m) => m[1]);
  if (signals.length === 0) continue;

  const unit = file.slice(ROOT.length + 1);
  const documented = docs.get(unit);
  if (documented === undefined) {
    console.error(`NO DOC        ${unit}  (${String(signals.length)} signal(s): ${signals.join(', ')})`);
    drifted += 1;
    continue;
  }
  const missing = signals.filter((signal) => !documented.has(signal));
  if (missing.length > 0) {
    console.error(`UNDOCUMENTED  ${unit}  ->  ${missing.join(', ')}`);
    drifted += 1;
  }
}

if (drifted === 0 && process.exitCode !== 1) {
  console.log('OK: every @signal has a documented entry');
} else {
  console.error(`\n${String(drifted)} unit(s) drifted from their neuron docs.`);
  console.error('ql-pipeline blocks other repositories for this; it has to hold itself to it too.');
  process.exit(1);
}
