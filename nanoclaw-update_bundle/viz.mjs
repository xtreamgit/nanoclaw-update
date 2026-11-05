#!/usr/bin/env node
/**
 * OKF bundle visualizer — producer-independent, zero dependencies.
 *
 * Reads every concept in the bundle this script sits in and emits a single
 * self-contained `viz.html`: no backend, no CDN, no install on the viewing
 * side, nothing leaves the page.
 *
 * Usage:  node viz.mjs [bundleDir]     (defaults to this script's directory)
 *
 * Only `.md` files are read. Reserved filenames (`index.md`, `log.md`, OKF
 * v0.2 §3.1) are not concepts and are skipped.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RESERVED = new Set(['index.md', 'log.md']);
const bundleDir = path.resolve(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.md') ? [full] : [];
  });
}

/**
 * Frontmatter reader for the scalar and inline-sequence forms the viewer
 * displays (`type`, `title`, `description`, `tags`, `status`, `resource`).
 * Nested families (`sources`, `generated`, `verified`) are counted, not
 * parsed — a full YAML parser is a dependency this file exists to avoid.
 */
function readFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trim().replace(/^["'](.*)["']$/, '$1');
    if (value === '') fm[key] = null;
    else if (value.startsWith('[')) fm[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (value.startsWith('{')) fm[key] = value;
    else fm[key] = value;
  }
  fm.__families = ['sources', 'generated', 'verified', 'status', 'stale_after'].filter((k) =>
    new RegExp(`^${k}:`, 'm').test(m[1]),
  );
  return { fm, body: text.slice(m[0].length) };
}

const allFiles = walk(bundleDir);
const conceptFiles = allFiles.filter((f) => !RESERVED.has(path.basename(f)));
// Reserved files are listed in the viewer so the bundle's real shape on disk is
// visible, and so it is obvious which .md files are NOT concepts (§3.1).
const reservedFiles = allFiles
  .filter((f) => RESERVED.has(path.basename(f)))
  .map((f) => path.relative(bundleDir, f).split(path.sep).join('/'));
const nodes = [];
const byId = new Map();

for (const file of conceptFiles) {
  const rel = path.relative(bundleDir, file).split(path.sep).join('/');
  const { fm, body } = readFrontmatter(fs.readFileSync(file, 'utf8'));
  if (!fm || !fm.type) {
    console.warn(`skipped (no frontmatter type, non-conformant): ${rel}`);
    continue;
  }
  const node = {
    id: rel.replace(/\.md$/, ''),
    file: rel,
    group: rel.includes('/') ? rel.split('/')[0] : '(root)',
    type: fm.type,
    title: fm.title ?? path.basename(rel, '.md'),
    description: fm.description ?? '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    status: fm.status ?? 'stable',
    resource: fm.resource ?? '',
    families: fm.__families,
    body,
  };
  nodes.push(node);
  byId.set(node.id, node);
}

// Edges: markdown links between concepts. The bundle graph is richer than the
// directory hierarchy, so links — not folders — are the edges. A link
// starting with "/" is bundle-root-relative (OKF v0.2 §6.1's recommended
// form), not filesystem-absolute, so it resolves against bundleDir rather
// than the linking file's directory.
const edges = [];
const seen = new Set();
for (const node of nodes) {
  for (const m of node.body.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
    const link = decodeURIComponent(m[1]);
    const resolved = link.startsWith('/')
      ? path.join(bundleDir, link.slice(1))
      : path.resolve(path.dirname(path.join(bundleDir, node.file)), link);
    const target = path.relative(bundleDir, resolved).split(path.sep).join('/').replace(/\.md$/, '');
    if (!byId.has(target) || target === node.id) continue;
    const key = `${node.id}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: node.id, target });
  }
}

const rootIndex = path.join(bundleDir, 'index.md');
const okfVersion = fs.existsSync(rootIndex)
  ? (fs.readFileSync(rootIndex, 'utf8').match(/okf_version:\s*["']?([\d.]+)/) ?? [, 'unspecified'])[1]
  : 'unspecified';

const payload = JSON.stringify({
  bundle: path.basename(bundleDir),
  okfVersion,
  generatedAt: new Date().toISOString(),
  nodes,
  edges,
  reservedFiles,
}).replace(/</g, '\\u003c');

// Optional per-bundle theme. `theme.css` is read from the bundle and inlined
// AFTER the built-in styles, so it overrides them by cascade order without this
// file needing to know anything about it. Absent theme.css changes nothing.
const themePath = path.join(bundleDir, 'theme.css');
const themeCss = fs.existsSync(themePath) ? fs.readFileSync(themePath, 'utf8') : '';

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${path.basename(bundleDir)} — OKF bundle</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --violeta: #6200EA; --azul: #376CF5; --teal: #2BD9C8;
    --bg: #101014; --panel: #17171d; --line: #26262f;
    --ink: #e8e8ef; --dim: #8b8b9b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  header { padding: 14px 20px; border-bottom: 1px solid var(--line); display: flex;
    align-items: baseline; gap: 14px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 15px; letter-spacing: .02em; }
  header .meta { color: var(--dim); font-size: 12px; }
  header .pill { border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px;
    font-size: 11px; color: var(--teal); }
  main { display: grid; grid-template-columns: 250px 1fr 460px; height: calc(100vh - 53px); }
  @media (max-width: 1200px) { main { grid-template-columns: 250px 1fr; } #detail { display: none; } }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; } #graph { display: none; } }
  #files { border-right: 1px solid var(--line); overflow-y: auto; padding: 14px 0 40px; }
  #files .dir { font-size: 11px; text-transform: uppercase; letter-spacing: .09em;
    color: var(--dim); padding: 14px 16px 6px; font-family: ui-monospace, Menlo, monospace; }
  #files a { display: block; padding: 6px 16px 6px 22px; cursor: pointer; border-left: 2px solid transparent; }
  #files a:hover { background: #1b1b22; }
  #files a.on { background: #1b1b22; border-left-color: var(--teal); }
  #files .fn { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  #files .ty { font-size: 10.5px; color: var(--dim); }
  #files .reserved { padding: 6px 16px 6px 22px; color: #55555f; font-size: 12px;
    font-family: ui-monospace, Menlo, monospace; }
  #graph { position: relative; overflow: hidden; }
  #graph svg { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph svg:active { cursor: grabbing; }
  .edge { stroke: #35353f; stroke-width: 1.2px; }
  .edge.hot { stroke: var(--teal); stroke-width: 2px; }
  .node circle { stroke: #0b0b0e; stroke-width: 2px; cursor: pointer; transition: r .12s; }
  .node text { fill: var(--ink); font-size: 11px; pointer-events: none;
    paint-order: stroke; stroke: #0b0b0e; stroke-width: 3px; }
  .node.dim { opacity: .28; }
  .node.sel circle { stroke: #fff; }
  #detail { border-left: 1px solid var(--line); background: var(--panel);
    overflow-y: auto; padding: 20px 22px 60px; }
  #detail h2 { margin: 0 0 2px; font-size: 17px; }
  #detail .sub { color: var(--dim); font-size: 12px; margin-bottom: 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .chip { font-size: 11px; border: 1px solid var(--line); border-radius: 4px;
    padding: 2px 7px; color: var(--dim); }
  .chip.type { color: #fff; border-color: transparent; }
  .chip.draft { color: #f0b429; border-color: #4a3a10; }
  .md { border-top: 1px solid var(--line); padding-top: 14px; }
  .md h1 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--teal); margin: 22px 0 8px; }
  .md h2 { font-size: 13px; margin: 18px 0 6px; }
  .md p, .md li { color: #c9c9d6; }
  .md table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
  .md th, .md td { border: 1px solid var(--line); padding: 5px 8px; text-align: left;
    vertical-align: top; }
  .md th { background: #1d1d25; }
  .md code { background: #1d1d25; border-radius: 3px; padding: 1px 4px; font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .md pre { background: #0d0d11; border: 1px solid var(--line); border-radius: 6px;
    padding: 10px 12px; overflow-x: auto; }
  .md pre code { background: none; padding: 0; }
  .md pre[data-lang] { position: relative; padding-top: 26px; }
  .md pre[data-lang]::before { content: attr(data-lang); position: absolute; top: 0; left: 0;
    font: 10px/1.6 ui-monospace, Menlo, monospace; color: var(--dim); background: #1d1d25;
    padding: 2px 9px; border-bottom-right-radius: 6px; letter-spacing: .06em; }
  .md pre code .tk { color: var(--teal); }                       /* keys, yaml keys */
  .md pre code .ts { color: #a5d6a7; }                           /* strings */
  .md pre code .tn { color: #f0b429; }                           /* numbers */
  .md pre code .tw { color: #e0559c; }                           /* keywords: true/false/null */
  .md pre code .tc { color: #6f6f80; font-style: italic; }       /* comments */
  .md pre code .tv { color: #f0b429; }                           /* $variables */
  .md pre code .tf { color: var(--azul); }                       /* --flags */
  .md pre code .to { color: #8b8b9b; }                           /* && | ; operators */
  .md blockquote { border-left: 2px solid var(--violeta); margin: 10px 0; padding: 2px 0 2px 12px;
    color: var(--dim); }
  .md a { color: var(--azul); }
  .empty { color: var(--dim); padding-top: 40px; text-align: center; }
  footer { position: fixed; bottom: 0; left: 0; padding: 6px 12px; font-size: 11px;
    color: var(--dim); background: linear-gradient(90deg, #101014, transparent); }
</style>
${themeCss ? `<style id="okf-theme">\n${themeCss}\n</style>` : ''}
<header>
  <h1 id="bundleName"></h1>
  <span class="pill" id="okfv"></span>
  <span class="meta" id="counts"></span>
  <span class="meta" id="stamp"></span>
</header>
<main>
  <nav id="files"></nav>
  <div id="graph"><svg id="svg"></svg></div>
  <div id="detail"><div class="empty">Select a concept.</div></div>
</main>
<footer>each concept is one .md file · click a file or a node to read it · drag to pan, scroll to zoom</footer>
<script id="data" type="application/json">${payload}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const COLORS = ['#6200EA', '#376CF5', '#2BD9C8', '#f0b429', '#e0559c', '#57c94d'];
const groups = [...new Set(DATA.nodes.map(n => n.group))];
const colorOf = n => COLORS[groups.indexOf(n.group) % COLORS.length];

document.getElementById('bundleName').textContent = DATA.bundle;
document.getElementById('okfv').textContent = 'OKF v' + DATA.okfVersion;
document.getElementById('counts').textContent =
  DATA.nodes.length + ' concepts · ' + DATA.edges.length + ' links · ' + groups.length + ' groups';
document.getElementById('stamp').textContent = 'built ' + DATA.generatedAt;

/* ---- file list: every .md in the bundle, concepts and reserved alike ---- */
const dirOf = f => f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
const nav = document.getElementById('files');
const navLinks = new Map();
const allDirs = [...new Set(DATA.nodes.map(n => dirOf(n.file)).concat(DATA.reservedFiles.map(dirOf)))]
  .sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
for (const dir of allDirs) {
  const head = document.createElement('div');
  head.className = 'dir';
  head.textContent = dir === '.' ? '/' : dir + '/';
  nav.appendChild(head);
  for (const n of DATA.nodes.filter(x => dirOf(x.file) === dir)) {
    const a = document.createElement('a');
    a.innerHTML = '<div class="fn">' + n.file.split('/').pop() + '</div><div class="ty">' + n.type + '</div>';
    a.addEventListener('click', () => select(index.get(n.id)));
    nav.appendChild(a);
    navLinks.set(n.id, a);
  }
  for (const f of DATA.reservedFiles.filter(x => dirOf(x) === dir)) {
    const d = document.createElement('div');
    d.className = 'reserved';
    d.textContent = f.split('/').pop() + '  · reserved, not a concept';
    nav.appendChild(d);
  }
}

/* ---- layout: a small force simulation, run to rest before first paint ---- */
const W = 900, H = 640;
const nodes = DATA.nodes.map((n, i) => ({
  ...n,
  x: W / 2 + Math.cos(i / DATA.nodes.length * 6.283) * 200,
  y: H / 2 + Math.sin(i / DATA.nodes.length * 6.283) * 200,
  vx: 0, vy: 0, pinned: false,
}));
const index = new Map(nodes.map(n => [n.id, n]));
const links = DATA.edges.map(e => ({ s: index.get(e.source), t: index.get(e.target) }));
const degree = new Map(nodes.map(n => [n.id, 0]));
for (const l of links) {
  degree.set(l.s.id, degree.get(l.s.id) + 1);
  degree.set(l.t.id, degree.get(l.t.id) + 1);
}
const radius = n => 7 + Math.min(degree.get(n.id), 8) * 1.6;

function step() {
  for (const a of nodes) {
    for (const b of nodes) {
      if (a === b) continue;
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy || 0.01;
      const f = 9000 / d2;
      a.vx += dx / Math.sqrt(d2) * f; a.vy += dy / Math.sqrt(d2) * f;
    }
    a.vx += (W / 2 - a.x) * 0.012; a.vy += (H / 2 - a.y) * 0.012;
  }
  for (const l of links) {
    const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const f = (d - 170) * 0.02;
    l.s.vx += dx / d * f; l.s.vy += dy / d * f;
    l.t.vx -= dx / d * f; l.t.vy -= dy / d * f;
  }
  for (const n of nodes) {
    if (n.pinned) { n.vx = n.vy = 0; continue; }
    n.x += (n.vx *= 0.82); n.y += (n.vy *= 0.82);
  }
}
for (let i = 0; i < 600; i++) step();

// Fit the settled layout to the canvas: the simulation's resting scale depends
// on node count, so without this a small bundle drifts into one corner.
(function fit() {
  const pad = 70;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((W - pad * 2) / Math.max(maxX - minX, 1), (H - pad * 2) / Math.max(maxY - minY, 1), 1.6);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (const n of nodes) {
    n.x = W / 2 + (n.x - cx) * k;
    n.y = H / 2 + (n.y - cy) * k;
  }
})();

/* ---- render ---- */
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
const root = document.createElementNS(NS, 'g');
svg.appendChild(root);
const edgeLayer = document.createElementNS(NS, 'g');
const nodeLayer = document.createElementNS(NS, 'g');
root.append(edgeLayer, nodeLayer);

const edgeEls = links.map(l => {
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('class', 'edge');
  edgeLayer.appendChild(line);
  return { l, line };
});
const nodeEls = nodes.map(n => {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'node');
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('r', radius(n));
  c.setAttribute('fill', colorOf(n));
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dy', -radius(n) - 6);
  t.textContent = n.title;
  g.append(c, t);
  // Selection is driven from pointerup below, NOT a 'click' listener here:
  // svg.setPointerCapture() retargets the click to the svg, so a listener on
  // this group would never fire once dragging is enabled.
  nodeLayer.appendChild(g);
  return { n, g, c };
});

function paint() {
  for (const { l, line } of edgeEls) {
    line.setAttribute('x1', l.s.x); line.setAttribute('y1', l.s.y);
    line.setAttribute('x2', l.t.x); line.setAttribute('y2', l.t.y);
  }
  for (const { n, g } of nodeEls) g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
}
paint();

/* ---- pan, zoom, drag ---- */
let view = { x: 0, y: 0, k: 1 };
const applyView = () =>
  root.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
  view.k = k; applyView();
}, { passive: false });

let drag = null;
const MOVE_SLOP = 4; // px of travel below which a press counts as a click, not a drag

svg.addEventListener('pointerdown', e => {
  const hit = nodeEls.find(({ g }) => g.contains(e.target));
  drag = hit
    ? { kind: 'node', n: hit.n, x0: e.clientX, y0: e.clientY, moved: false }
    : { kind: 'pan', x: e.clientX - view.x, y: e.clientY - view.y, x0: e.clientX, y0: e.clientY, moved: false };
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > MOVE_SLOP) drag.moved = true;
  if (drag.kind === 'pan') {
    if (drag.moved) { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); }
    return;
  }
  if (!drag.moved) return; // a press that has not travelled yet must not pin the node
  const r = svg.getBoundingClientRect();
  drag.n.pinned = true;
  drag.n.x = (e.clientX - r.left) * (W / r.width) / view.k - view.x / view.k;
  drag.n.y = (e.clientY - r.top) * (H / r.height) / view.k - view.y / view.k;
  paint();
});
svg.addEventListener('pointerup', e => {
  if (drag && drag.kind === 'node' && !drag.moved) select(drag.n);
  if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  drag = null;
});
svg.addEventListener('pointercancel', () => { drag = null; });

/* ---- minimal markdown rendering, enough for OKF bodies ---- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
  .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
  .replace(/\\[\\^([^\\]]+)\\]/g, '<sup>$1</sup>')
  .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');

/* ---- syntax highlighting: a tiny sticky-regex tokenizer, no dependency ----
   Ordered rules; first match at each position wins. Strings are scanned before
   comments so a '#' inside quotes never starts a comment. Unknown languages
   fall through to plain escaped text. */
const HL_ALIAS = { bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', yml: 'yaml',
  jsonc: 'json', json5: 'json', text: '', txt: '', plain: '' };
const HL = {
  json: [
    ['tk', /"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)/y],
    ['ts', /"(?:[^"\\\\]|\\\\.)*"/y],
    ['tn', /-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?/y],
    ['tw', /true|false|null/y],
  ],
  sh: [
    ['ts', /'[^'\\n]*'|"(?:[^"\\\\\\n]|\\\\.)*"/y],
    ['tc', /#[^\\n]*/y],
    ['tv', /\\$\\{[^}]*\\}|\\$[A-Za-z_]\\w*|\\$\\d/y],
    ['tf', /(?<![\\w-])--?[A-Za-z][\\w-]*/y],
    ['to', /&&|\\|\\||[|;&<>]/y],
  ],
  yaml: [
    ['ts', /'[^'\\n]*'|"(?:[^"\\\\\\n]|\\\\.)*"/y],
    ['tc', /#[^\\n]*/y],
    ['tk', /[A-Za-z_][\\w.-]*(?=\\s*:)/y],
    ['tn', /-?\\d+(?:\\.\\d+)?/y],
    ['tw', /true|false|null|~/y],
  ],
};

function highlight(code, lang) {
  const rules = HL[lang] || HL[HL_ALIAS[lang]];
  if (!rules) return esc(code);
  let out = '', i = 0;
  while (i < code.length) {
    let ok = false;
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m) {
        out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
        i = re.lastIndex; ok = true; break;
      }
    }
    if (!ok) { out += esc(code[i]); i++; }
  }
  return out;
}

function renderMd(src) {
  const out = [];
  const lines = src.split(/\\r?\\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('\`\`\`')) {
      const lang = line.slice(3).trim();
      const buf = [];
      for (i++; i < lines.length && !lines[i].startsWith('\`\`\`'); i++) buf.push(lines[i]);
      i++;
      out.push('<pre' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' +
        highlight(buf.join('\\n'), lang) + '</code></pre>');
    } else if (/^\\|/.test(line) && /^\\|[\\s:|-]+\\|$/.test(lines[i + 1] ?? '')) {
      const cells = r => r.split('|').slice(1, -1).map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') +
        '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') +
        '</tr>').join('') + '</tbody></table>');
    } else if (/^#{1,6}\\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      out.push('<h' + Math.min(level + 0, 3) + '>' + inline(line.replace(/^#+\\s*/, '')) +
        '</h' + Math.min(level + 0, 3) + '>');
      i++;
    } else if (/^\\s*[-*]\\s/.test(line) || /^\\s*\\d+\\.\\s/.test(line)) {
      const items = [];
      const isItem = s => /^\\s*[-*]\\s/.test(s) || /^\\s*\\d+\\.\\s/.test(s);
      while (i < lines.length && isItem(lines[i])) {
        const buf = [lines[i++].replace(/^\\s*(?:[-*]|\\d+\\.)\\s*/, '')];
        // A wrapped item continues on indented lines; without this they fall
        // through to the paragraph branch and break out of the list.
        while (i < lines.length && lines[i].trim() !== '' && !isItem(lines[i]) && /^\\s+\\S/.test(lines[i]))
          buf.push(lines[i++].trim());
        items.push('<li>' + inline(buf.join(' ')) + '</li>');
      }
      out.push('<ul>' + items.join('') + '</ul>');
    } else if (/^>\\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\\s?/, ''));
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
    } else if (line.trim() === '' || /^-{3,}$/.test(line.trim())) {
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^[#>|\\s]*$/.test(lines[i]) &&
             !/^\`\`\`/.test(lines[i]) && !/^\\s*[-*]\\s/.test(lines[i]) && !/^\\|/.test(lines[i]) &&
             !/^#{1,6}\\s/.test(lines[i])) buf.push(lines[i++]);
      if (buf.length) out.push('<p>' + inline(buf.join(' ')) + '</p>'); else i++;
    }
  }
  return out.join('');
}

/* ---- selection ---- */
function select(n) {
  const neighbors = new Set([n.id]);
  for (const l of links) {
    if (l.s.id === n.id) neighbors.add(l.t.id);
    if (l.t.id === n.id) neighbors.add(l.s.id);
  }
  for (const { n: m, g } of nodeEls) {
    g.classList.toggle('dim', !neighbors.has(m.id));
    g.classList.toggle('sel', m.id === n.id);
  }
  for (const { l, line } of edgeEls)
    line.classList.toggle('hot', l.s.id === n.id || l.t.id === n.id);
  for (const [id, a] of navLinks) a.classList.toggle('on', id === n.id);

  const chips = ['<span class="chip type" style="background:' + colorOf(n) + '">' + n.type + '</span>']
    .concat(n.status && n.status !== 'stable' ? ['<span class="chip ' + n.status + '">' + n.status + '</span>'] : [])
    .concat(n.families.filter(f => f !== 'status').map(f => '<span class="chip">' + f + '</span>'))
    .concat(n.tags.map(t => '<span class="chip">#' + t + '</span>'))
    .join('');

  document.getElementById('detail').innerHTML =
    '<h2>' + n.title + '</h2>' +
    '<div class="sub">' + n.file + '</div>' +
    '<div class="chips">' + chips + '</div>' +
    (n.description ? '<p>' + n.description + '</p>' : '') +
    (n.resource ? '<div class="sub">resource: ' + n.resource + '</div>' : '') +
    '<div class="md">' + renderMd(n.body) + '</div>';
  document.getElementById('detail').scrollTop = 0;
}

// Open a document on load: a viewer that shows nothing until clicked reads as
// an empty bundle. Prefer a Migration Plan, else the most-linked concept.
select(
  nodes.find(n => n.type === 'Migration Plan') ??
  nodes.slice().sort((a, b) => degree.get(b.id) - degree.get(a.id))[0],
);
</script>
</html>
`;

const outPath = path.join(bundleDir, 'viz.html');
fs.writeFileSync(outPath, html);
console.log(
  `${path.relative(process.cwd(), outPath)} — ${nodes.length} concepts, ${edges.length} links, ` +
    `${(html.length / 1024).toFixed(0)} KB, OKF v${okfVersion}`,
);
