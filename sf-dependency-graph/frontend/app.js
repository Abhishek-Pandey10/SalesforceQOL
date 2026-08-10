/**
 * app.js — SF Dependency Graph frontend logic.
 *
 * Everything needed to render and interact with the graph — blast-radius
 * BFS, edge tooltips, node/edge detail panels — runs entirely client-side
 * against one in-memory node/edge array. That array is fetched once from
 * /api/graph in live mode, or embedded as window.__EXPORT_DATA__ when this
 * page was produced by the standalone export (see backend/export.py) - in
 * both cases the same code path renders and drives interaction, so the
 * exported HTML file is fully interactive with no server running.
 */

'use strict';

const EXPORT_DATA = (typeof window !== 'undefined' && window.__EXPORT_DATA__) || null;

const TYPE_LABELS = {
  apex_class: 'Apex Class', apex_interface: 'Apex Interface',
  apex_trigger: 'Apex Trigger', lwc_component: 'LWC Component',
};

const NODE_COLORS = {
  apex_class:     { bg: 'rgba(88,166,255,.18)',  bgHighlight: 'rgba(88,166,255,.34)',  border: '#58a6ff' },
  apex_interface: { bg: 'rgba(63,185,80,.18)',   bgHighlight: 'rgba(63,185,80,.34)',   border: '#3fb950' },
  apex_trigger:   { bg: 'rgba(227,179,65,.18)',  bgHighlight: 'rgba(227,179,65,.34)',  border: '#e3b341' },
  lwc_component:  { bg: 'rgba(188,140,255,.18)', bgHighlight: 'rgba(188,140,255,.34)', border: '#bc8cff' },
};

const EDGE_COLORS = {
  instantiation: '#3fb950', static_call: '#58a6ff', field_access: '#79b8ff',
  extends: '#e3b341', implements: '#e3b341', instanceof: '#8b949e',
  type_reference: '#484f58', apex_wire: '#bc8cff', apex_imperative: '#bc8cff',
  apex_unused_import: '#f85149', js_import: '#8b949e', composition: '#3fb950',
};

const KIND_LABELS = {
  instantiation: 'instantiates (new)', static_call: 'calls', field_access: 'accesses field',
  extends: 'extends', implements: 'implements', instanceof: 'instanceof check',
  type_reference: 'references type', apex_wire: 'wires (@wire)',
  apex_imperative: 'calls imperatively', apex_unused_import: 'imports (unused)',
  js_import: 'imports', composition: 'renders as child',
};

// Edge kinds that are usually noise rather than signal at scale - filtered
// out of the canvas by default (still visible in the node detail panel).
const LOW_SIGNAL_EDGE_KINDS = new Set(['type_reference', 'apex_unused_import']);

// Above this many nodes, auto-rendering the full graph on load produces an
// unreadable, slow-to-stabilize hairball - show a landing state instead
// (search prompt + top-connected nodes) and let the user opt in.
const LANDING_NODE_THRESHOLD = 60;
// Above this many nodes, even an explicit "show full graph" request gets a
// confirmation first, since it's a deliberately expensive render.
const FULL_GRAPH_CONFIRM_THRESHOLD = 150;
const HOTSPOT_COUNT = 12;

const VIS_OPTIONS = {
  autoResize: true,
  interaction: { hover: true, tooltipDelay: 120, navigationButtons: false, keyboard: false },
  physics: {
    solver: 'barnesHut',
    barnesHut: { gravitationalConstant: -3000, centralGravity: 0.25, springLength: 110, springConstant: 0.03, damping: 0.28, avoidOverlap: 0.2 },
    stabilization: { iterations: 150 },
  },
  nodes: {
    shape: 'dot',
    scaling: { min: 10, max: 34 },
    font: { color: '#e6edf3', size: 12, face: 'Inter, sans-serif', strokeWidth: 3, strokeColor: '#0d1117' },
    borderWidth: 2,
  },
  edges: {
    smooth: { type: 'dynamic' },
    arrows: { to: { enabled: true, scaleFactor: 0.55 } },
    color: { inherit: false },
    font: { size: 0 },
  },
};

const state = {
  summary: null,
  allNodes: [], allEdges: [],
  nodeById: new Map(),
  edgesBySource: new Map(), edgesByTarget: new Map(),
  edgeById: new Map(),          // composite key of the currently rendered graph only
  activeTypes: new Set(['apex_class', 'apex_interface', 'apex_trigger', 'lwc_component']),
  searchQuery: '',
  selectedNodeId: null,
  mode: 'global',               // 'global' | 'focus'
  focusId: null,
  depth: 2,                     // number or null ("all")
  direction: 'both',            // both | upstream | downstream
  network: null, visNodes: null, visEdges: null,
  landingActive: false,         // true when showing the "pick a starting point" state instead of a rendered graph
  hideLowSignalEdges: true,
  minDegree: 0,
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function nodeName(id) {
  const n = state.nodeById.get(id);
  return n ? n.name : id;
}

function humanizeKind(kind) { return KIND_LABELS[kind] || kind; }

function groupBy(list, key) {
  const map = new Map();
  for (const item of list) {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

// ─── Networking ─────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (res.status === 503) {
    const err = new Error('building');
    err.building = true;
    throw err;
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { const body = await res.json(); detail = body.detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

async function waitUntilReady() {
  const start = Date.now();
  for (let i = 0; i < 300; i++) {
    try {
      await fetchJSON('/api/summary');
      return;
    } catch (err) {
      if (!err.building) throw err;
      const elapsed = Math.round((Date.now() - start) / 1000);
      $('loading-text').textContent = elapsed < 2
        ? 'Building dependency graph…'
        : `Building dependency graph… (${elapsed}s — large orgs can take a minute)`;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Timed out waiting for the graph to build (5 min).');
}

let _toastTimer = null;
function showError(msg) {
  const toast = $('error-toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

// ─── Data wiring ────────────────────────────────────────────────────────────

function applyGraphData(summary, graph) {
  state.summary = summary;
  state.allNodes = graph.nodes;
  state.allEdges = graph.edges;
  state.nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  state.edgesBySource = groupBy(graph.edges, 'source');
  state.edgesByTarget = groupBy(graph.edges, 'target');
  updateHeaderSummary();

  const maxDegree = graph.nodes.reduce((m, n) => Math.max(m, (n.in_degree || 0) + (n.out_degree || 0)), 0);
  const slider = $('min-degree-input');
  if (slider) slider.max = String(Math.max(1, Math.min(30, maxDegree)));
}

function updateHeaderSummary() {
  const s = state.summary || {};
  $('header-summary').innerHTML =
    `<span><b>${s.total_nodes ?? 0}</b> nodes</span>` +
    `<span><b>${s.total_edges ?? 0}</b> edges</span>` +
    (s.unresolved_reference_count ? `<span><b>${s.unresolved_reference_count}</b> unresolved refs</span>` : '');
}

// ─── Blast radius (client-side BFS, mirrors backend/graph_builder.py) ─────────

function computeBlastRadius(focusId, depth, direction) {
  const visited = new Map([[focusId, { hop: 0, direction: 'focus' }]]);
  let frontier = [focusId];
  let hop = 0;
  while (frontier.length && (depth === null || hop < depth)) {
    hop += 1;
    const next = [];
    for (const nid of frontier) {
      if (direction === 'both' || direction === 'downstream') {
        for (const e of state.edgesBySource.get(nid) || []) {
          if (!visited.has(e.target)) { visited.set(e.target, { hop, direction: 'downstream' }); next.push(e.target); }
        }
      }
      if (direction === 'both' || direction === 'upstream') {
        for (const e of state.edgesByTarget.get(nid) || []) {
          if (!visited.has(e.source)) { visited.set(e.source, { hop, direction: 'upstream' }); next.push(e.source); }
        }
      }
    }
    frontier = next;
  }

  const nodes = state.allNodes
    .filter((n) => visited.has(n.id))
    .map((n) => Object.assign({}, n, visited.get(n.id)));
  const idSet = new Set(visited.keys());
  const edges = state.allEdges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  return { nodes, edges };
}

function getVisibleGraph() {
  let nodes, edges;
  const inFocus = state.mode === 'focus' && state.focusId;
  if (inFocus) {
    const br = computeBlastRadius(state.focusId, state.depth, state.direction);
    nodes = br.nodes; edges = br.edges;
  } else {
    nodes = state.allNodes; edges = state.allEdges;
  }

  const q = state.searchQuery.trim().toLowerCase();
  // The min-connections filter is a browsing aid for the unscoped global
  // graph; a blast-radius result is already a deliberately-scoped answer to
  // "what touches this node", so trimming it further by degree would just
  // silently drop relevant nodes from the answer.
  let filteredNodes = nodes.filter((n) =>
    state.activeTypes.has(n.type) &&
    (!q || n.name.toLowerCase().includes(q)) &&
    (inFocus || ((n.in_degree || 0) + (n.out_degree || 0)) >= state.minDegree)
  );
  const idSet = new Set(filteredNodes.map((n) => n.id));

  if (inFocus && !idSet.has(state.focusId)) {
    const fn = state.nodeById.get(state.focusId);
    if (fn) { filteredNodes = filteredNodes.concat([fn]); idSet.add(state.focusId); }
  }

  const filteredEdges = edges.filter((e) =>
    idSet.has(e.source) && idSet.has(e.target) &&
    (!state.hideLowSignalEdges || !LOW_SIGNAL_EDGE_KINDS.has(e.kind))
  );
  return { nodes: filteredNodes, edges: filteredEdges };
}

// ─── vis-network rendering ──────────────────────────────────────────────────

function ensureNetwork() {
  if (state.network) return state.network;
  state.visNodes = new vis.DataSet([]);
  state.visEdges = new vis.DataSet([]);
  state.network = new vis.Network($('network'), { nodes: state.visNodes, edges: state.visEdges }, VIS_OPTIONS);
  state.network.on('click', onNetworkClick);
  // vis-network's own auto-fit sizes the viewport to node *radii*, not label
  // text - a node whose label happens to land near the canvas edge after
  // physics settles gets its label clipped. Zooming out slightly past the
  // fit leaves room for labels on every side. Runs after every re-stabilization
  // (filter change, focus mode change, ...), so it self-corrects each time.
  state.network.on('stabilizationIterationsDone', () => {
    settleView();
    // Freeze the layout once it's settled: with physics left on, every drag
    // (or even just hovering, on some builds) re-runs the simulation across
    // every visible node, which gets noticeably laggy well before 200 nodes.
    // renderGraph() re-enables physics before loading a new node/edge set so
    // it can still be laid out from scratch.
    state.network.setOptions({ physics: { enabled: false } });
  });
  return state.network;
}

// Applied to every camera-centering scale (fit AND focus-on-node) so
// whatever node ends up nearest the edge still has room for its label -
// vis-network sizes the viewport to node *radii*, not label text, so a
// "tight" fit/focus reliably clips a label on one side or another.
const VIEW_MARGIN_FACTOR = 0.85;

function fitWithMargin() {
  if (!state.network) return;
  state.network.fit({ animation: false });
  const scale = state.network.getScale();
  state.network.moveTo({ scale: scale * VIEW_MARGIN_FACTOR, animation: false });
}

// After physics settles: keep the camera on whatever node is selected
// (re-applied with final, settled coordinates), otherwise fit the whole
// visible graph with margin.
function settleView() {
  if (state.selectedNodeId && focusOnNode(state.selectedNodeId, { animate: false })) return;
  fitWithMargin();
}

function focusOnNode(id, { animate = true } = {}) {
  if (!state.network || !state.visNodes || !state.visNodes.get(id)) return false;
  try {
    state.network.selectNodes([id]);
    const targetScale = Math.min(Math.max(state.network.getScale(), 0.8), 1.1) * VIEW_MARGIN_FACTOR;
    state.network.focus(id, {
      scale: targetScale,
      animation: animate ? { duration: 300 } : false,
    });
    return true;
  } catch {
    return false;
  }
}

function toVisNode(n) {
  const colors = NODE_COLORS[n.type] || NODE_COLORS.apex_class;
  const isFocus = state.focusId === n.id;
  return {
    id: n.id,
    label: n.name,
    value: Math.max(1, (n.in_degree || 0) + (n.out_degree || 0)),
    shape: 'dot',
    color: {
      background: colors.bg,
      border: isFocus ? '#ffffff' : colors.border,
      highlight: { background: colors.bgHighlight, border: '#ffffff' },
      hover: { background: colors.bgHighlight, border: colors.border },
    },
    borderWidth: isFocus ? 4 : 2,
    title: `${n.name} (${TYPE_LABELS[n.type] || n.type})\n${n.file_path}\nused by ${n.in_degree || 0} · depends on ${n.out_degree || 0}`,
  };
}

function buildEdgeTooltip(e) {
  const wrap = el('div');
  wrap.appendChild(el('div', { style: 'font-weight:700;margin-bottom:4px;' }, `${nodeName(e.source)} → ${nodeName(e.target)}`));
  wrap.appendChild(el('div', { style: 'color:#8b949e;margin-bottom:6px;' },
    `${humanizeKind(e.kind)} · ${e.occurrence_count} occurrence${e.occurrence_count === 1 ? '' : 's'}`));

  (e.occurrences || []).slice(0, 4).forEach((o) => {
    const row = el('div', { style: 'margin-bottom:4px;' });
    row.appendChild(el('div', { style: 'font-family:monospace;font-size:10.5px;' },
      `${o.file}:${o.line}${o.caller_method ? ' in ' + o.caller_method + '()' : ''}`));
    if (o.detail) row.appendChild(el('div', { style: 'font-size:10.5px;color:#8b949e;' }, o.detail));
    wrap.appendChild(row);
  });

  if (e.occurrence_count > 4) {
    wrap.appendChild(el('div', { style: 'font-size:10px;font-style:italic;color:#484f58;margin-top:2px;' },
      `+${e.occurrence_count - 4} more — click the edge for the full list`));
  }
  return wrap;
}

function toVisEdge(e) {
  const color = EDGE_COLORS[e.kind] || '#8b949e';
  const width = Math.min(1 + Math.log2((e.occurrence_count || 1) + 1), 6);
  return {
    id: `${e.source}=>${e.target}`,
    from: e.source, to: e.target,
    color: { color, highlight: color, hover: color, opacity: 0.85 },
    width,
    arrows: 'to',
    title: buildEdgeTooltip(e),
  };
}

function renderGraph(nodes, edges) {
  ensureNetwork();
  state.network.setOptions({ physics: { enabled: true } });
  state.edgeById = new Map(edges.map((e) => [`${e.source}=>${e.target}`, e]));
  state.visNodes.clear();
  state.visNodes.add(nodes.map(toVisNode));
  state.visEdges.clear();
  state.visEdges.add(edges.map(toVisEdge));
}

function onNetworkClick(params) {
  if (params.nodes.length) {
    selectNode(params.nodes[0]);
  } else if (params.edges.length) {
    const edge = state.edgeById.get(params.edges[0]);
    if (edge) renderEdgeDetailPanel(edge, null);
  }
}

function refreshGraph() {
  if (state.landingActive) return; // showLanding()/exitLanding() own the canvas while the landing state is up
  const visible = getVisibleGraph();
  renderGraph(visible.nodes, visible.edges);
  populateSidebarList();
  const hint = $('welcome-hint');
  if (state.mode === 'focus' && state.focusId) {
    const depthLabel = state.depth === null ? 'all' : state.depth;
    hint.textContent = `Focused on ${nodeName(state.focusId)} — depth ${depthLabel}, ${state.direction}. Click "Full graph" to reset.`;
  } else {
    hint.textContent = 'Click a node to see what it depends on and what depends on it. Hover an edge for context. Heuristic, text-based parsing — not a full Apex compiler.';
  }
}

// ─── Focus mode ─────────────────────────────────────────────────────────────

function enterFocus(nodeId, depth, direction) {
  state.focusId = nodeId;
  state.depth = depth;
  state.direction = direction;
  state.mode = 'focus';
  refreshGraph();
  selectNode(nodeId);
}

function exitFocus() {
  state.focusId = null;
  state.mode = 'global';
  refreshGraph();
  if (state.selectedNodeId) selectNode(state.selectedNodeId);
}

// ─── Landing state (large graphs) ──────────────────────────────────────────
// For an org above LANDING_NODE_THRESHOLD nodes, don't auto-render the full
// graph on load - show a search prompt + top-connected "hotspot" nodes
// instead, and let the user opt into a focus view (cheap) or the full graph
// (expensive, confirmed) explicitly.

function computeHotspots(n = HOTSPOT_COUNT) {
  return state.allNodes
    .slice()
    .sort((a, b) => ((b.in_degree || 0) + (b.out_degree || 0)) - ((a.in_degree || 0) + (a.out_degree || 0)))
    .slice(0, n);
}

function renderLandingPanel() {
  const s = state.summary || {};
  $('landing-title').textContent =
    `${s.total_nodes ?? state.allNodes.length} nodes, ${s.total_edges ?? state.allEdges.length} edges — too many to render at once.`;
  $('landing-sub').textContent =
    'Search for a class or component on the left, or jump straight into the blast radius of one of the most-connected nodes:';

  const wrap = $('landing-hotspots');
  wrap.innerHTML = '';
  computeHotspots().forEach((n) => {
    const chip = el('button', { class: 'hotspot-chip', type: 'button' });
    chip.appendChild(el('span', { class: `type-dot dot-${n.type}` }));
    chip.appendChild(el('span', { class: 'hotspot-chip-name' }, n.name));
    chip.appendChild(el('span', { class: 'hotspot-chip-degree' }, `${(n.in_degree || 0) + (n.out_degree || 0)}`));
    chip.addEventListener('click', () => { exitLanding(); enterFocus(n.id, 2, 'both'); });
    wrap.appendChild(chip);
  });
}

function showLanding() {
  state.landingActive = true;
  state.mode = 'global';
  state.focusId = null;
  renderGraph([], []);
  renderLandingPanel();
  $('welcome-hint').style.display = 'none';
  $('landing-panel').style.display = 'flex';
  populateSidebarList();
}

function exitLanding() {
  if (!state.landingActive) return;
  state.landingActive = false;
  $('landing-panel').style.display = 'none';
  $('welcome-hint').style.display = '';
}

function requestFullGraph() {
  if (state.allNodes.length > FULL_GRAPH_CONFIRM_THRESHOLD) {
    const proceed = window.confirm(
      `This will render all ${state.allNodes.length} nodes at once. Large graphs can be slow ` +
      `to lay out and hard to read - a focused blast-radius view is usually more useful. Continue anyway?`
    );
    if (!proceed) return;
  }
  exitLanding();
  exitFocus();
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function populateSidebarList() {
  const q = state.searchQuery.trim().toLowerCase();
  const nodes = state.allNodes
    .filter((n) =>
      state.activeTypes.has(n.type) &&
      (!q || n.name.toLowerCase().includes(q)) &&
      ((n.in_degree || 0) + (n.out_degree || 0)) >= state.minDegree
    )
    .sort((a, b) => ((b.in_degree + b.out_degree) - (a.in_degree + a.out_degree)) || a.name.localeCompare(b.name));

  const list = $('node-list');
  list.innerHTML = '';
  $('no-results').style.display = nodes.length ? 'none' : 'block';

  nodes.forEach((n) => {
    const row = el('div', {
      class: 'node-row' + (n.id === state.selectedNodeId ? ' active' : ''),
      title: `used by ${n.in_degree} · depends on ${n.out_degree}`,
    });
    row.appendChild(el('span', { class: `type-dot dot-${n.type}` }));
    row.appendChild(el('span', { class: 'node-name' }, n.name));
    row.appendChild(el('span', { class: 'node-degree' }, `${n.in_degree}↓ ${n.out_degree}↑`));
    row.addEventListener('click', () => selectNode(n.id));
    list.appendChild(row);
  });

  $('sidebar-footer').textContent = `${nodes.length} of ${state.allNodes.length} nodes shown`;
}

// ─── Detail panel: node ─────────────────────────────────────────────────────

function statBlock(value, label) {
  const wrap = el('div', { class: 'detail-stat' });
  wrap.appendChild(el('b', {}, String(value)));
  wrap.appendChild(document.createTextNode(label));
  return wrap;
}

function buildEdgeList(edges, otherKey, currentNodeId) {
  if (!edges.length) return el('div', { class: 'edge-empty' }, 'None found.');
  const wrap = el('div');
  edges.slice().sort((a, b) => b.occurrence_count - a.occurrence_count).forEach((e) => {
    const otherId = e[otherKey];
    const row = el('div', { class: 'edge-row' });
    row.appendChild(el('div', { class: 'edge-row-name' }, nodeName(otherId)));
    row.appendChild(el('div', { class: 'edge-row-meta' }, `${humanizeKind(e.kind)} · ${e.occurrence_count}x`));
    row.addEventListener('click', () => renderEdgeDetailPanel(e, currentNodeId));
    wrap.appendChild(row);
  });
  return wrap;
}

function buildFocusControls(nodeId) {
  const wrap = el('div', { class: 'focus-controls' });
  const isFocused = state.mode === 'focus' && state.focusId === nodeId;

  const depthRow = el('div', { class: 'focus-controls-row' });
  depthRow.appendChild(el('label', {}, 'Depth'));
  const depthSelect = el('select');
  ['1', '2', '3', 'all'].forEach((v) => {
    const opt = el('option', { value: v }, v === 'all' ? 'All' : v);
    if ((isFocused ? String(state.depth ?? 'all') : '2') === v) opt.setAttribute('selected', 'selected');
    depthSelect.appendChild(opt);
  });
  depthRow.appendChild(depthSelect);
  wrap.appendChild(depthRow);

  const dirRow = el('div', { class: 'focus-controls-row' });
  dirRow.appendChild(el('label', {}, 'Show'));
  const dirSelect = el('select');
  [['both', 'Both directions'], ['downstream', 'Depends on'], ['upstream', 'Used by']].forEach(([v, label]) => {
    const opt = el('option', { value: v }, label);
    if ((isFocused ? state.direction : 'both') === v) opt.setAttribute('selected', 'selected');
    dirSelect.appendChild(opt);
  });
  dirRow.appendChild(dirSelect);
  wrap.appendChild(dirRow);

  const btn = el('button', { id: 'btn-focus', class: 'toolbar-btn' }, isFocused ? 'Update blast radius' : 'Focus blast radius');
  btn.addEventListener('click', () => {
    const depthVal = depthSelect.value === 'all' ? null : parseInt(depthSelect.value, 10);
    enterFocus(nodeId, depthVal, dirSelect.value);
  });
  wrap.appendChild(btn);

  if (isFocused) {
    const exitBtn = el('button', { class: 'toolbar-btn', style: 'margin-top:6px;width:100%;justify-content:center;' }, 'Exit focus (show full graph)');
    exitBtn.addEventListener('click', () => exitFocus());
    wrap.appendChild(exitBtn);
  }

  return wrap;
}

function renderNodeDetailPanel(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) return;
  const outgoing = state.edgesBySource.get(nodeId) || [];
  const incoming = state.edgesByTarget.get(nodeId) || [];

  $('detail-empty').style.display = 'none';
  const content = $('detail-content');
  content.style.display = 'block';
  content.innerHTML = '';

  content.appendChild(el('div', { class: 'detail-title' }, node.name));
  content.appendChild(el('div', { class: 'detail-subtitle' }, node.file_path));
  content.appendChild(el('span', { class: `detail-type-badge badge-${node.type}` }, TYPE_LABELS[node.type] || node.type));

  const stats = el('div', { class: 'detail-stats' });
  stats.appendChild(statBlock(incoming.length, 'Used by'));
  stats.appendChild(statBlock(outgoing.length, 'Depends on'));
  stats.appendChild(statBlock(node.loc, 'Lines'));
  content.appendChild(stats);

  content.appendChild(buildFocusControls(nodeId));

  content.appendChild(el('div', { class: 'detail-section-title' }, `Depends on (${outgoing.length})`));
  content.appendChild(buildEdgeList(outgoing, 'target', nodeId));

  content.appendChild(el('div', { class: 'detail-section-title' }, `Used by (${incoming.length})`));
  content.appendChild(buildEdgeList(incoming, 'source', nodeId));
}

// ─── Detail panel: edge ─────────────────────────────────────────────────────

function buildOccurrenceEl(o) {
  const wrap = el('div', { class: 'occurrence' });
  wrap.appendChild(el('div', { class: 'occurrence-kind' }, humanizeKind(o.kind)));
  wrap.appendChild(el('div', { class: 'occurrence-file' }, `${o.file}:${o.line}${o.caller_method ? ' — in ' + o.caller_method + '()' : ''}`));
  wrap.appendChild(el('div', { class: 'occurrence-snippet' }, o.snippet || ''));
  if (o.detail) wrap.appendChild(el('div', { class: 'occurrence-detail' }, o.detail));
  return wrap;
}

function renderEdgeDetailPanel(edge, backToNodeId) {
  $('detail-empty').style.display = 'none';
  const content = $('detail-content');
  content.style.display = 'block';
  content.innerHTML = '';

  if (backToNodeId) {
    const back = el('div', { id: 'btn-back-to-node' }, `← ${nodeName(backToNodeId)}`);
    back.addEventListener('click', () => selectNode(backToNodeId));
    content.appendChild(back);
  }

  content.appendChild(el('div', { class: 'detail-title' }, `${nodeName(edge.source)} → ${nodeName(edge.target)}`));
  content.appendChild(el('div', { class: 'detail-subtitle' },
    `${humanizeKind(edge.kind)} · ${edge.occurrence_count} occurrence${edge.occurrence_count === 1 ? '' : 's'}`));

  const occWrap = el('div');
  content.appendChild(occWrap);

  const renderOccs = (occs) => {
    occWrap.innerHTML = '';
    occs.forEach((o) => occWrap.appendChild(buildOccurrenceEl(o)));
  };
  renderOccs(edge.occurrences || []);

  const shown = (edge.occurrences || []).length;
  if (edge.truncated && !EXPORT_DATA) {
    const loadMore = el('div', { class: 'occurrence-more', style: 'cursor:pointer;text-decoration:underline;' },
      `Showing ${shown} of ${edge.occurrence_count} — click to load all`);
    loadMore.addEventListener('click', async () => {
      loadMore.textContent = 'Loading…';
      try {
        const full = await fetchJSON(`/api/edges/${encodeURIComponent(edge.source)}/${encodeURIComponent(edge.target)}`);
        renderOccs(full.occurrences || []);
      } catch (err) {
        showError('Could not load the full occurrence list.');
      }
    });
    content.appendChild(loadMore);
  } else if (edge.occurrence_count > shown) {
    content.appendChild(el('div', { class: 'occurrence-more' }, `+${edge.occurrence_count - shown} more`));
  }
}

// ─── Selection ──────────────────────────────────────────────────────────────

function selectNode(id) {
  if (state.landingActive) {
    // Picking a node from the sidebar while on the landing state is a
    // request to start exploring from there, not to inspect it in isolation
    // against an empty canvas.
    exitLanding();
    enterFocus(id, 2, 'both');
    return;
  }
  state.selectedNodeId = id;
  renderNodeDetailPanel(id);
  populateSidebarList();
  focusOnNode(id);
}

// ─── Export ─────────────────────────────────────────────────────────────────

function onExportClick() {
  if (EXPORT_DATA) return;
  if (state.mode === 'focus' && state.focusId) {
    window.location.href = `/api/nodes/${encodeURIComponent(state.focusId)}/export`;
  } else {
    window.location.href = '/api/export';
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

function bindEvents() {
  $('search-input').addEventListener('input', debounce(() => {
    state.searchQuery = $('search-input').value;
    exitLanding();
    refreshGraph();
  }, 150));

  document.querySelectorAll('#type-filters input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const type = cb.dataset.type;
      if (cb.checked) state.activeTypes.add(type); else state.activeTypes.delete(type);
      exitLanding();
      refreshGraph();
    });
  });

  $('hide-low-signal-input').addEventListener('change', () => {
    state.hideLowSignalEdges = $('hide-low-signal-input').checked;
    refreshGraph();
  });

  $('min-degree-input').addEventListener('input', () => {
    state.minDegree = parseInt($('min-degree-input').value, 10) || 0;
    $('min-degree-value').textContent = String(state.minDegree);
    exitLanding();
    refreshGraph();
  });

  $('btn-full-graph').addEventListener('click', () => requestFullGraph());
  $('btn-show-full-graph').addEventListener('click', () => requestFullGraph());
  $('btn-export').addEventListener('click', onExportClick);
}

function resolveFocusParam(raw) {
  if (!raw) return null;
  if (state.nodeById.has(raw)) return raw;
  const lower = raw.toLowerCase();
  // An Apex type and an LWC component can share a display name (e.g. class
  // "AccountCard" + LWC "accountCard") — picking the first match here would
  // silently focus the wrong node with no indication anything was ambiguous.
  const matches = state.allNodes.filter((n) => n.name.toLowerCase() === lower);
  if (matches.length > 1) {
    showError(`"${raw}" matches more than one node (${matches.map((n) => n.id).join(', ')}). Use a qualified id in the URL instead, e.g. ?focus=apex:${lower}.`);
    return null;
  }
  return matches.length === 1 ? matches[0].id : null;
}

async function init() {
  bindEvents();
  try {
    if (EXPORT_DATA) {
      applyGraphData(EXPORT_DATA.summary, EXPORT_DATA.graph);
      $('org-path').textContent = EXPORT_DATA.summary.org_path || '(static export)';
      $('org-path').title = $('org-path').textContent;
      $('btn-export').style.display = 'none';
      if (EXPORT_DATA.focus && state.nodeById.has(EXPORT_DATA.focus)) {
        enterFocus(EXPORT_DATA.focus, EXPORT_DATA.depth ?? 2, EXPORT_DATA.direction || 'both');
      } else {
        refreshGraph();
      }
    } else {
      await waitUntilReady();
      const [summary, graph] = await Promise.all([fetchJSON('/api/summary'), fetchJSON('/api/graph')]);
      applyGraphData(summary, graph);
      $('org-path').textContent = summary.org_path;
      $('org-path').title = summary.org_path;

      const params = new URLSearchParams(window.location.search);
      const focusId = resolveFocusParam(params.get('focus'));
      if (focusId) {
        enterFocus(focusId, 2, 'both');
      } else if (state.allNodes.length > LANDING_NODE_THRESHOLD) {
        showLanding();
      } else {
        refreshGraph();
      }
    }
  } catch (err) {
    showError(err.message || 'Failed to load the dependency graph.');
  } finally {
    $('loading-overlay').style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', init);
