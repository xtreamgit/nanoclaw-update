#!/usr/bin/env node
/**
 * OKF bundle conformance checker — zero dependencies.
 *
 * Conformance per OKF v0.2 §11 is deliberately permissive: a bundle is
 * conformant if (1) every non-reserved .md has parseable YAML frontmatter
 * and (2) that frontmatter has a non-empty `type`. The spec explicitly says
 * consumers MUST NOT reject a bundle for missing optional fields, unknown
 * types, broken cross-links, or a missing index.md — so only those two
 * checks are errors here. Everything else below is a warning: useful
 * hygiene signal, not a conformance failure.
 *
 * Checks:
 *   - every non-reserved .md has frontmatter with a non-empty "type" (error)
 *   - every non-reserved .md has frontmatter at all (error)
 *   - frontmatter missing "title" / "description" (warning — recommended, not required)
 *   - index.md missing, or missing/absent okf_version (warning — both optional per §3, §12)
 *   - every .md link resolves to a real file — both relative and bundle-root
 *     "/path.md" absolute form (§6.1) are resolved; unresolved links warn,
 *     since OKF tolerates broken links by design
 *   - every concept is reachable via a link from index.md or another concept
 *     (orphans warn — they exist on disk but nothing points at them)
 *   - log.md exists (warning — optional per §3)
 *
 * Usage:  node check.mjs [bundleDir]     (defaults to this script's directory)
 * Exit:   0 = clean or warnings only, 1 = errors (unparseable frontmatter or missing type).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RESERVED = new Set(['index.md', 'log.md']);
const bundleDir = path.resolve(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)));

const errors = [];
const warnings = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.md') ? [full] : [];
  });
}

function readFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    fm[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { fm, body: text.slice(m[0].length) };
}

const rel = (f) => path.relative(bundleDir, f).split(path.sep).join('/');

// A link starting with "/" is bundle-root-relative (OKF v0.2 §6.1's
// recommended form), not filesystem-absolute — resolve it against bundleDir
// rather than the linking file's directory.
const resolveLink = (fromFile, link) =>
  link.startsWith('/') ? path.join(bundleDir, link.slice(1)) : path.resolve(path.dirname(fromFile), link);

const allFiles = walk(bundleDir);
const conceptFiles = allFiles.filter((f) => !RESERVED.has(path.basename(f)));
const fileSet = new Set(allFiles.map(rel));

// index.md — optional per §3; okf_version declaration is optional per §12.
const rootIndex = path.join(bundleDir, 'index.md');
if (!fs.existsSync(rootIndex)) {
  warnings.push('index.md: missing at bundle root — optional per OKF, but recommended for navigation');
} else {
  const text = fs.readFileSync(rootIndex, 'utf8');
  if (!/okf_version:\s*["']?[\d.]+/.test(text))
    warnings.push('index.md: no okf_version declared (optional)');
}

// log.md — optional per §3.
if (!fs.existsSync(path.join(bundleDir, 'log.md')))
  warnings.push('log.md: missing — OKF convention is to record every bundle change');

// concept frontmatter + link targets + reachability
const reachable = new Set();
for (const file of allFiles) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  const { fm, body } = readFrontmatter(text);

  if (!RESERVED.has(path.basename(file))) {
    if (!fm) errors.push(`${r}: no frontmatter — not a conformant concept`);
    else {
      if (!fm.type) errors.push(`${r}: frontmatter missing "type"`);
      if (!fm.title) warnings.push(`${r}: frontmatter missing "title" (recommended)`);
      if (!fm.description) warnings.push(`${r}: frontmatter missing "description" (recommended)`);
    }
  }

  // .md links must resolve; each resolved link marks a reachability edge.
  // OKF tolerates broken links (§11), so an unresolved target warns rather
  // than errors.
  for (const m of body.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
    const target = rel(resolveLink(file, decodeURIComponent(m[1])));
    if (!fileSet.has(target)) warnings.push(`${r}: broken link -> ${m[1]}`);
    else reachable.add(target);
  }
}

for (const f of conceptFiles.map(rel)) {
  if (!reachable.has(f)) warnings.push(`${f}: orphan — no .md file links to it`);
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(
  `${conceptFiles.length} concepts, ${allFiles.length - conceptFiles.length} reserved files, ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);
