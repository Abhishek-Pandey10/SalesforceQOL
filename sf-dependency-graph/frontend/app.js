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

// Node circle radius: sized by sqrt(degree) rather than degree directly, so
// that circle *area* (what the eye actually compares) scales proportionally
// with connection count instead of quadratically. Normalized against
// state.maxDegree - the max in/out degree across the *whole* loaded graph,
// not just the currently-rendered subset - so a node's size stays stable
// across focus/filter views instead of jumping around as the visible min/max
// changes. Without the sqrt, a fixed linear range would squash every
// ordinary class toward NODE_RADIUS_MIN as soon as a large org's graph
// contains a few mega-connected hubs.
const NODE_RADIUS_MIN = 10;
const NODE_RADIUS_MAX = 30;
function nodeRadius(degree, maxDegree) {
  if (!maxDegree || maxDegree <= 0) return NODE_RADIUS_MIN;
  const t = Math.sqrt(Math.max(0, degree)) / Math.sqrt(maxDegree);
  return NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) * Math.min(1, t);
}

const EDGE_COLORS = {
  instantiation: '#3fb950', static_call: '#58a6ff', instance_call: '#58a6ff', self_call: '#58a6ff', field_access: '#79b8ff',
  extends: '#e3b341', implements: '#e3b341', instanceof: '#8b949e',
  type_reference: '#484f58', apex_wire: '#bc8cff', apex_imperative: '#bc8cff',
  apex_unused_import: '#f85149', js_import: '#8b949e', composition: '#3fb950',
  // Speculative: a call through a declared base type that could dispatch to
  // any known override at runtime - not a proven call chain (see
  // graph_builder's possible_override edges / blast_radius `verified`).
  possible_override: '#f0883e',
  // Speculative, same idea as possible_override but for a call through a
  // declared *interface* type - could dispatch to any known implementer at
  // runtime (see graph_builder's possible_implementation edges).
  possible_implementation: '#db6d28',
  // Type.forName('LiteralClassName') resolved to a real class - same
  // "something gets constructed" meaning as instantiation, kept as its own
  // color so it's visually distinguishable as reflection-derived, not a
  // literal `new X()` in source.
  dynamic_instantiation: '#3fb950',
};

const KIND_LABELS = {
  instantiation: 'instantiates (new)', static_call: 'calls', instance_call: 'calls', self_call: 'calls (same class)',
  field_access: 'accesses field',
  extends: 'extends', implements: 'implements', instanceof: 'instanceof check',
  type_reference: 'references type', apex_wire: 'wires (@wire)',
  apex_imperative: 'calls imperatively', apex_unused_import: 'imports (unused)',
  js_import: 'imports', composition: 'renders as child',
  possible_override: 'possible override target (unverified)',
  possible_implementation: 'possible interface implementation (unverified)',
  dynamic_instantiation: 'instantiates via Type.forName',
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
    // Tuned for a graph made of several small, mutually-disconnected
    // components (a common shape here - e.g. one interface + its
    // implementers, isolated from the next such cluster) rather than one
    // big connected blob:
    //   - avoidOverlap: 0.2 -> 1: at 0.2 the repulsion barely resisted two
    //     same-sized circles landing on top of each other; 1 makes node
    //     radius a hard-ish constraint during stabilization.
    //   - centralGravity: 0.25 -> 0.08 -> 0.15: 0.25 dragged *unrelated*
    //     components into the same patch of canvas (nothing but that shared
    //     center point was pulling them together). But 0.08 left the layout
    //     with almost no restoring force at all, so any strong local event -
    //     e.g. two nodes resolving an overlap via avoidOverlap - had nothing
    //     to damp it and visibly dragged the *entire*, otherwise-settled
    //     graph along with it. 0.15 is enough anchor to stop that global
    //     drift without being strong enough to glue unrelated clusters
    //     together again.
    //   - gravitationalConstant: -3000 -> -9000 -> -5000: -9000 was tuned
    //     back when barnesHut repulsion alone was responsible for pushing
    //     disconnected clusters apart. packComponentsIntoGrid (see below)
    //     now pre-seeds each component into its own non-overlapping grid
    //     cell *before* physics runs, so that job no longer falls on
    //     gravitationalConstant - the extra strength was just amplifying
    //     the same global-ripple problem centralGravity had. -5000 still
    //     resolves in-component overlaps firmly.
    //   - damping 0.28 -> 0.4 -> 0.5: dissipates a local repulsion spike
    //     before it can propagate across the graph instead of just reducing
    //     end-of-stabilization jitter.
    //   - maxVelocity 50 (vis-network default) -> 25: caps how far any
    //     single node - including ones nowhere near the two that triggered
    //     a strong repulsion - can move in one simulation step, so overlap
    //     resolution reads as a local nudge instead of a network-wide jump.
    barnesHut: { gravitationalConstant: -5000, centralGravity: 0.15, springLength: 130, springConstant: 0.03, damping: 0.5, avoidOverlap: 1 },
    maxVelocity: 25,
    // 150 -> 1200: cheap for the graph sizes this UI targets (see
    // LANDING_NODE_THRESHOLD/FULL_GRAPH_CONFIRM_THRESHOLD below - a few
    // hundred nodes at most), and the old cap often froze the layout (see
    // the physics:false below) well before overlaps had actually resolved.
    stabilization: { iterations: 1200, updateInterval: 50, fit: true },
  },
  nodes: {
    shape: 'dot',
    // Radius is set explicitly per-node (see nodeRadius()) rather than via
    // vis-network's value/scaling.min/max, which normalizes against
    // whichever nodes happen to be in the current view.
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
  maxDegree: 0,                 // in_degree+out_degree across the whole loaded graph - see nodeRadius()
  landingActive: false,         // true when showing the "pick a starting point" state instead of a rendered graph
  hideLowSignalEdges: true,
  freePhysics: false,           // false = "performance mode" (physics auto-freezes once settled); true = physics keeps running freely
  minDegree: 0,
  includeTest: false,           // false = @isTest classes/edges excluded from /api/graph (default: less noise)
  methodDetailCache: new Map(), // "id:includeTest" -> /api/nodes/{id} response (methods aren't preloaded, see nodeName())
  verifyChainToken: 0,          // bumped on every panel change so a slow "Verify chain" fetch can't clobber a newer view
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
  if (n) return n.name;
  // Method nodes (id: "apex:class::method") aren't preloaded in the default
  // view (see backend get_graph's default type filter) - format a
  // reasonable display name from the id itself rather than showing the raw
  // key. The owning class usually *is* cached (classes are always in the
  // default view), so this typically still reads as "ClassName.method()".
  const m = /^(apex:[^:]+)::(.+)$/.exec(id || '');
  if (m) {
    const cls = state.nodeById.get(m[1]);
    return cls ? `${cls.name}.${m[2]}()` : `${m[2]}()`;
  }
  return id;
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

// Fetches /api/nodes/{id} (methods aren't in the preloaded graph - see
// get_graph's default type filter), caching per method id and registering
// every node dict it sees (the class/method itself, and its methods list)
// into nodeById so nodeName() resolves them by name afterwards instead of
// falling back to id-parsing.
//
// Cache key includes includeTest: the response content (edges, degree
// counts, which methods even appear) depends on that query param, so a
// cache keyed on id alone would silently serve a stale pre-toggle response
// after the user flips "Include test classes".
async function fetchNodeDetail(id) {
  const cacheKey = `${id}:${state.includeTest ? '1' : '0'}`;
  if (state.methodDetailCache.has(cacheKey)) return state.methodDetailCache.get(cacheKey);
  const detail = await fetchJSON(`/api/nodes/${encodeURIComponent(id)}?include_test=${state.includeTest ? '1' : '0'}`);
  state.methodDetailCache.set(cacheKey, detail);
  if (detail.node) state.nodeById.set(detail.node.id, detail.node);
  (detail.methods || []).forEach((m) => state.nodeById.set(m.id, m));
  return detail;
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
  state.maxDegree = maxDegree;
  const slider = $('min-degree-input');
  if (slider) slider.max = String(Math.max(1, Math.min(30, maxDegree)));
}

function graphUrl() {
  return `/api/graph?include_test=${state.includeTest ? '1' : '0'}`;
}

// Re-fetches /api/graph (and /api/summary, for the test-class count) after
// the include_test toggle changes - a different set of nodes/edges, not
// just a client-side view filter, so it can't be handled by getVisibleGraph().
async function reloadGraphData() {
  if (EXPORT_DATA) return; // static export has no server to re-fetch from
  try {
    const [summary, graph] = await Promise.all([fetchJSON('/api/summary'), fetchJSON(graphUrl())]);
    applyGraphData(summary, graph);
    if (state.focusId && !state.nodeById.has(state.focusId)) {
      state.mode = 'global';
      state.focusId = null;
    }
    if (state.selectedNodeId && !state.nodeById.has(state.selectedNodeId)) {
      state.selectedNodeId = null;
      $('detail-content').style.display = 'none';
      $('detail-empty').style.display = 'block';
    }
    exitLanding();
    if (state.mode === 'global' && !state.searchQuery && state.allNodes.length > LANDING_NODE_THRESHOLD) {
      showLanding();
    } else {
      refreshGraph();
    }
  } catch (err) {
    showError(err.message || 'Failed to reload the dependency graph.');
  }
}

function updateHeaderSummary() {
  const s = state.summary || {};
  // Node/edge counts reflect what's actually loaded (post include_test
  // filtering), not the org-wide totals in `summary` - otherwise the header
  // would read "500 nodes" while the graph itself only has 300 on screen.
  const summaryEl = $('header-summary');
  summaryEl.innerHTML =
    `<span><b>${state.allNodes.length}</b> nodes</span>` +
    `<span><b>${state.allEdges.length}</b> edges</span>` +
    (s.unresolved_reference_count ? `<span><b>${s.unresolved_reference_count}</b> unresolved refs</span>` : '');

  // Built via el() rather than folded into the innerHTML string above:
  // duplicate_names come from file/class names in the scanned org, not a
  // trusted literal, so they need textContent-safe escaping rather than
  // string interpolation into HTML.
  if (s.duplicate_count) {
    const dupSpan = el('span', {
      title: `${(s.duplicate_names || []).join(', ')} — first occurrence kept, rest skipped`,
    });
    dupSpan.appendChild(el('b', {}, String(s.duplicate_count)));
    dupSpan.appendChild(document.createTextNode(' duplicate name(s) skipped'));
    summaryEl.appendChild(dupSpan);
  }

  const label = $('include-test-label');
  if (label) {
    label.textContent = s.test_classes && !state.includeTest
      ? `Include test classes (${s.test_classes} hidden)`
      : 'Include test classes';
  }
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

// state.freePhysics toggles between two user-chosen modes:
//   - performance mode (default, freePhysics: false): physics auto-freezes
//     once the layout settles (or after a hard time cap - see
//     physicsSettleTimer below), because leaving it running costs a
//     per-frame simulation across every visible node, laggy well before 200
//     nodes.
//   - free-run mode (freePhysics: true): physics is left running
//     continuously and never auto-frozen, so the layout keeps reacting on
//     its own - the user is trading that performance cost for it.
// Module-scoped (not per-network-instance) since ensureNetwork only ever
// builds one network, and the free-physics checkbox handler (bindEvents)
// needs to reach this same freeze/timer state to react to the user flipping
// modes mid-session, not just at drag boundaries.
// Three states share this timer/listener pair - frozen (physics off),
// settling (physics on, armed to auto-freeze via 'stabilized' or the hard
// timer below), free-running (physics on indefinitely). cancelPendingFreeze/
// armPendingFreeze/freezePhysics are the only places that touch
// physicsSettleTimer or the 'stabilized' listener, so every transition
// between the three states funnels through one of them instead of each call
// site re-deriving its own timer/listener bookkeeping.
let physicsSettleTimer = null;

function cancelPendingFreeze() {
  if (physicsSettleTimer) { clearTimeout(physicsSettleTimer); physicsSettleTimer = null; }
  if (state.network) state.network.off('stabilized', freezePhysics);
}

function armPendingFreeze() {
  if (!state.network) return;
  state.network.on('stabilized', freezePhysics);
  physicsSettleTimer = setTimeout(freezePhysics, 4000);
}

function freezePhysics() {
  cancelPendingFreeze();
  if (!state.network) return;
  state.network.setOptions({ physics: { enabled: false } });
}

// vis-network only (re)starts its actual per-frame simulation loop on a
// false->true transition of physics.enabled (that's what a drag triggers
// internally) - setOptions'ing `enabled: true` while it's already true is a
// no-op for the running loop. stabilize()'s bounded batch pass ends (and
// stops the loop) on its own once done, so free-run mode needs this explicit
// off-then-on kick after each stabilize() to actually keep physics live,
// not just "enabled" in name.
function kickPhysics() {
  if (!state.network) return;
  state.network.setOptions({ physics: { enabled: false } });
  state.network.setOptions({ physics: { enabled: true } });
}

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
    if (state.freePhysics) kickPhysics(); else freezePhysics();
  });
  // Physics is frozen at rest (above, performance mode only) so a drag by
  // itself doesn't nudge anything else out of the way - re-enable it for the
  // duration of a drag gesture (real per-frame simulation, same as what's
  // already running while the drag is in progress) regardless of mode, then
  // in performance mode, freeze again once it settles.
  //
  // Deliberately NOT reusing stabilize() (the bounded, batched pass used for
  // the initial load/relayout) here: stabilize() computes in discrete jumps
  // rather than rendering every frame, so a drag ending into a stabilize()
  // call looked like a snap/recalibration instead of a smooth settle - and
  // its stabilization.fit option also auto-refits the camera, wiping out
  // whatever pan/zoom the user had mid-drag. But left as plain continuous
  // physics with no cap, this barnesHut config doesn't reliably reach zero
  // kinetic energy on its own - the 'stabilized' event could just never
  // fire, leaving nodes jittering indefinitely. physicsSettleTimer is the
  // compromise: smooth real physics, with a hard time cap so a
  // non-converging layout still freezes instead of running forever.
  state.network.on('dragStart', () => {
    cancelPendingFreeze();
    state.network.setOptions({ physics: { enabled: true } });
  });
  state.network.on('dragEnd', () => {
    if (state.freePhysics) return; // leave physics running indefinitely
    armPendingFreeze();
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

function buildNodeTooltip(n) {
  // Built as a real DOM element (textContent, not innerHTML) rather than a
  // plain string: vis-network renders a string `title` via innerHTML, and
  // n.name/n.file_path aren't guaranteed safe - LWC bundle names come
  // straight from filesystem directory names with no character
  // restriction. Same pattern as buildEdgeTooltip below.
  const wrap = el('div');
  wrap.appendChild(el('div', { style: 'font-weight:700;margin-bottom:4px;' },
    `${n.name} (${TYPE_LABELS[n.type] || n.type})`));
  wrap.appendChild(el('div', { style: 'font-family:monospace;font-size:10.5px;margin-bottom:4px;' }, n.file_path));
  wrap.appendChild(el('div', { style: 'color:#8b949e;' },
    `used by ${n.in_degree || 0} · depends on ${n.out_degree || 0}`));
  if (n.fully_dead) {
    wrap.appendChild(el('div', { style: 'color:#f85149;margin-top:4px;' },
      `fully dead — all ${n.dead_method_count} method(s) unreachable`));
  } else if (n.dead_method_count) {
    wrap.appendChild(el('div', { style: 'color:#f85149;margin-top:4px;' },
      `${n.dead_method_count} dead method(s)`));
  }
  if (n.entry_point_method_count) {
    wrap.appendChild(el('div', { style: 'color:#8b949e;margin-top:2px;' },
      `${n.entry_point_method_count} known entry point method(s)`));
  }
  if (n.test_only_method_count) {
    wrap.appendChild(el('div', { style: 'color:#8b949e;margin-top:2px;' },
      `${n.test_only_method_count} test-only method(s)`));
  }
  return wrap;
}

// ─── Layout: pack disconnected components apart before physics runs ───────
//
// barnesHut physics alone is bad at *global* placement of a graph made of
// several mutually-disconnected pieces (e.g. one interface + its
// implementers, isolated from the next such cluster): nothing repels
// component A from component B except generic node-vs-node repulsion, and
// centralGravity pulls every component toward the same point regardless,
// so two unrelated clusters routinely land on top of each other. Physics
// *is* good at arranging nodes that share edges - it's the inter-component
// macro-layout it can't reason about, since it has no concept of
// "component" at all, only pairwise forces.
//
// Fix: give each connected component (plus every isolated singleton) its
// own non-overlapping cell in a packed grid *before* physics starts, seed
// each node's initial position from that cell, then let physics do what
// it's actually good at - refining the local layout within each
// component - and freeze once settled (see stabilizationIterationsDone).

function computeConnectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adjacency.has(e.source) || !adjacency.has(e.target)) continue;
    adjacency.get(e.source).push(e.target);
    adjacency.get(e.target).push(e.source);
  }
  const seen = new Set();
  const components = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const component = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop();
      component.push(id);
      for (const neighbor of adjacency.get(id) || []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

// Bin-packing components into grid rows/columns is airtight against
// overlap but reads as visibly mechanical - straight rows of same-aligned
// blobs, nothing like the organic scatter a force-directed graph is
// supposed to have (compare Obsidian's own graph view, which is the look
// this tool is explicitly going for - see README).
//
// An earlier version of this tried a force-relaxation pass instead (mutual
// circle repulsion + a size-weighted pull toward the origin), which reads
// organically but doesn't reliably put the *biggest* clusters at the
// center - a small circle can get boxed in by its neighbors early and
// never migrate back out even with a near-zero pull, so the size/distance
// correlation ended up noisy in practice, not the "biggest = most
// central" a reader actually expects (bigger clusters generally being the
// more structurally important ones).
//
// This instead is real circle packing: the same tangent-placement
// algorithm bubble-chart layouts (e.g. d3.pack()) use. Circles are placed
// one at a time, biggest first, each one snapped tangent to whichever pair
// of already-placed circles puts it closest to the origin without
// overlapping anything placed so far. Because the biggest circles are
// placed first - when the center is still open - and every later circle
// is forced to slot into whatever space is left, "big things end up
// central" is a direct consequence of the placement order, not something
// left to hope a force simulation converges toward. The result still reads
// as organic (this is exactly what makes bubble charts look natural, not
// gridded) while actually guaranteeing the requested property.
function packComponentCircles(components) {
  const RADIUS_BASE = 55;   // minimum component radius, for isolated singletons
  const RADIUS_UNIT = 42;   // px per sqrt(node count) (count -> area, not diameter)
  const PADDING = 50;       // gap enforced between adjacent component circles
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // The (up to) two points where a circle of radius r3 sits tangent to
  // both c1 and c2 at once (trilateration from the two known distances,
  // c1-to-candidate = c1.r+r3 and c2-to-candidate = c2.r+r3).
  function tangentCandidates(c1, c2, r3) {
    const d = dist(c1, c2);
    if (d < 1e-6) return [];
    const a = c1.r + r3, b = c2.r + r3;
    const ex = (c2.x - c1.x) / d, ey = (c2.y - c1.y) / d;
    const x = (d * d + a * a - b * b) / (2 * d);
    const h2 = a * a - x * x;
    if (h2 < 0) return []; // no such point exists at this distance apart
    const h = Math.sqrt(h2);
    const midX = c1.x + ex * x, midY = c1.y + ey * x;
    return [
      { x: midX - ey * h, y: midY + ex * h },
      { x: midX + ey * h, y: midY - ex * h },
    ];
  }

  const items = components
    .map((component) => ({ component, r: RADIUS_BASE + RADIUS_UNIT * Math.sqrt(component.length) }))
    .sort((a, b) => b.r - a.r);
  if (items.length === 0) return [];

  const placed = [{ ...items[0], x: 0, y: 0 }];
  if (items.length > 1) {
    placed.push({ ...items[1], x: placed[0].r + items[1].r + PADDING, y: 0 });
  }

  for (let k = 2; k < items.length; k++) {
    const r3 = items[k].r;
    let best = null, bestDist = Infinity;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        for (const cand of tangentCandidates(
          { ...placed[i], r: placed[i].r + PADDING },
          { ...placed[j], r: placed[j].r + PADDING },
          r3,
        )) {
          const fits = placed.every((p) => dist(cand, p) >= p.r + r3 + PADDING - 1e-6);
          if (!fits) continue;
          const d = Math.hypot(cand.x, cand.y);
          if (d < bestDist) { bestDist = d; best = cand; }
        }
      }
    }
    if (!best) {
      // No valid tangent slot (shouldn't normally happen once >=2 circles
      // are down) - fall back to just outside the current pack, spaced by
      // the same golden-angle spiral used elsewhere for organic seeding.
      const outerRadius = Math.max(...placed.map((p) => Math.hypot(p.x, p.y) + p.r)) + r3 + PADDING;
      const angle = k * GOLDEN_ANGLE;
      best = { x: Math.cos(angle) * outerRadius, y: Math.sin(angle) * outerRadius };
    }
    placed.push({ ...items[k], x: best.x, y: best.y });
  }
  return placed;
}

function packComponentsIntoGrid(nodes, edges) {
  const components = computeConnectedComponents(nodes, edges);
  const circles = packComponentCircles(components);

  const positions = new Map();
  for (const { component, x: cx, y: cy, r } of circles) {
    // Seed nodes on a ring inside the circle, each nudged by a little
    // random jitter - a perfectly even ring is its own kind of
    // unnatural-looking symmetry, and real graphs rarely stay on it once
    // physics moves them anyway, but starting slightly off it means two
    // components with the same node count don't visibly mirror each other.
    component.forEach((id, idx) => {
      if (component.length === 1) {
        positions.set(id, { x: cx, y: cy });
        return;
      }
      const angle = (idx / component.length) * 2 * Math.PI + (Math.random() - 0.5) * 0.3;
      const radius = r * 0.55 * (0.8 + Math.random() * 0.2);
      positions.set(id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
  }
  return positions;
}

// A fully_dead class (see models.GraphNode) whose only incoming edges come
// from other fully_dead classes (an isolated dead island - ShapeBase's
// Circle/Square/Triangle/ShapeRunner cluster, DeadLoopA/DeadLoopB, an
// orphaned chain) is an unambiguous delete candidate: nothing anywhere
// touches it and lives to tell about it. A fully_dead class with a
// structural (extends/field access/...) edge from a class that ISN'T
// fully_dead - e.g. BaseController, extended by the actively-@AuraEnabled
// AccountController - reads as contradictory at a glance ("a live class
// depends on a dead one?") even though it's correct: that edge never
// executes BaseController's own code, it just inherits its shape. Softer
// styling for that case keeps the signal (still worth a look) without the
// same "this whole class is safe to delete" implication the strong marker
// carries for the unambiguous case.
// Shared by computeSoftenedDeadIds (canvas styling, bulk) and the node
// detail panel (single node) - "is this edge's source a live (non-dead)
// node" is the one predicate both softened/strong-dead distinctions boil
// down to.
function hasLiveSource(e, nodeById) {
  const source = nodeById.get(e.source);
  return source != null && !source.fully_dead;
}

// Every target id with at least one incoming edge from a live source - one
// O(edges) pass, instead of re-scanning the full edge list per dead node
// with .some().
function targetsWithLiveIncomingEdge(nodes, edges) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const targets = new Set();
  for (const e of edges) {
    if (!targets.has(e.target) && hasLiveSource(e, nodeById)) targets.add(e.target);
  }
  return targets;
}

function computeSoftenedDeadIds(nodes, edges) {
  const liveTargets = targetsWithLiveIncomingEdge(nodes, edges);
  const softened = new Set();
  for (const n of nodes) {
    if (n.fully_dead && liveTargets.has(n.id)) softened.add(n.id);
  }
  return softened;
}

function toVisNode(n, pos, softenedDead) {
  const colors = NODE_COLORS[n.type] || NODE_COLORS.apex_class;
  const isFocus = state.focusId === n.id;
  const isDead = n.fully_dead === true;
  const isSoftened = isDead && softenedDead === true;
  const deadColor = isSoftened ? '#e3b341' : '#f85149'; // amber vs danger red
  const border = isFocus ? '#ffffff' : (isDead ? deadColor : colors.border);
  return {
    id: n.id,
    label: n.name,
    size: nodeRadius((n.in_degree || 0) + (n.out_degree || 0), state.maxDegree),
    shape: 'dot',
    color: {
      background: colors.bg,
      border,
      highlight: { background: colors.bgHighlight, border: '#ffffff' },
      hover: { background: colors.bgHighlight, border },
    },
    borderWidth: isFocus ? 4 : (isDead ? (isSoftened ? 2 : 3) : 2),
    ...(isDead ? { shapeProperties: { borderDashes: isSoftened ? [2, 3] : [4, 3] } } : {}),
    title: buildNodeTooltip(n),
    ...(pos ? { x: pos.x, y: pos.y } : {}),
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
  const positions = packComponentsIntoGrid(nodes, edges);
  const softenedDeadIds = computeSoftenedDeadIds(nodes, edges);
  state.visNodes.clear();
  state.visNodes.add(nodes.map((n) => toVisNode(n, positions.get(n.id), softenedDeadIds.has(n.id))));
  state.visEdges.clear();
  state.visEdges.add(edges.map(toVisEdge));
}

// Physics freezes once it settles (see ensureNetwork's stabilizationIterationsDone
// handler - it's what keeps drags/hovers from re-simulating the whole visible
// graph), so a node that settled somewhere unreasonable - or got dragged
// there by hand - just stays there until something re-runs the simulation.
// This recomputes the component-packed starting positions for the
// *current* node/edge set (no refetch) and re-stabilizes from there -
// same macro-layout renderGraph would produce, not just a continuation of
// physics from wherever nodes currently sit (which can't fix two
// components that already overlap - nothing pulls an already-interleaved
// pair apart, since packing is what prevents that, not physics).
// stabilizationIterationsDone fires again afterward and freezes it once
// more, same as the initial render.
function relayout() {
  if (!state.network || !state.visNodes || !state.visEdges) return;
  const nodes = state.visNodes.get();
  const edges = state.visEdges.get().map((e) => ({ source: e.from, target: e.to }));
  const positions = packComponentsIntoGrid(nodes, edges);
  state.visNodes.update(nodes.map((n) => {
    const pos = positions.get(n.id);
    return pos ? { id: n.id, x: pos.x, y: pos.y } : { id: n.id };
  }));
  state.network.setOptions({ physics: { enabled: true } });
  state.network.stabilize();
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
  const hintText = $('welcome-hint-text');
  if (state.mode === 'focus' && state.focusId) {
    const depthLabel = state.depth === null ? 'all' : state.depth;
    hintText.textContent = `Focused on ${nodeName(state.focusId)} — depth ${depthLabel}, ${state.direction}. Click "Full graph" to reset.`;
  } else {
    hintText.textContent = 'Click a node to see what it depends on and what depends on it. Hover an edge for context. Heuristic, text-based parsing — not a full Apex compiler.';
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
  if (!isHintDismissed()) $('welcome-hint').style.display = '';
}

// ─── Dismissible hint / collapsible legend ─────────────────────────────────
// Both preferences persist in localStorage (falls back to in-memory state if
// unavailable, e.g. a file:// export opened under restrictive settings) so
// they don't reset on every reload.

const HINT_DISMISSED_KEY = 'sfdg:hintDismissed';
const LEGEND_EXPANDED_KEY = 'sfdg:legendExpanded';
const INCLUDE_TEST_KEY = 'sfdg:includeTest';
const FREE_PHYSICS_KEY = 'sfdg:freePhysics';

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function isHintDismissed() {
  return readPref(HINT_DISMISSED_KEY) === '1';
}

function dismissHint() {
  writePref(HINT_DISMISSED_KEY, '1');
  $('welcome-hint').style.display = 'none';
}

function setLegendExpanded(expanded) {
  $('legend').classList.toggle('expanded', expanded);
  $('legend-toggle').setAttribute('aria-expanded', String(expanded));
  $('legend-toggle-icon').innerHTML = expanded ? '&#9662;' : '&#9656;';
  writePref(LEGEND_EXPANDED_KEY, expanded ? '1' : '0');
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

  const nodeType = state.nodeById.get(nodeId)?.type;
  const multiHop = state.depth === null || state.depth > 1;
  if (!EXPORT_DATA && isFocused && nodeType === 'apex_class' && multiHop) {
    // Class-level blast radius over-approximates past 1 hop: A -> B and
    // B -> C existing as class-level edges doesn't mean A really reaches C
    // (see README "Known limitations") unless the *same* method chain
    // connects them. This calls the server's method-level graph to check,
    // for real, which of the currently-shown nodes are backed by an actual
    // call chain from this class's own methods.
    const verifyBtn = el('button', {
      id: 'btn-verify-chain', class: 'toolbar-btn',
      style: 'margin-top:6px;width:100%;justify-content:center;',
      title: 'Check which of these nodes are reached by a real method call chain, not just a class-level over-approximation',
    }, 'Verify chain (method-level)');
    verifyBtn.addEventListener('click', () => runVerifyChain(nodeId));
    wrap.appendChild(verifyBtn);
  }

  if (isFocused) {
    const exitBtn = el('button', { class: 'toolbar-btn', style: 'margin-top:6px;width:100%;justify-content:center;' }, 'Exit focus (show full graph)');
    exitBtn.addEventListener('click', () => exitFocus());
    wrap.appendChild(exitBtn);
  }

  return wrap;
}

async function runVerifyChain(nodeId) {
  const token = ++state.verifyChainToken;
  const btn = $('btn-verify-chain');
  if (btn) { btn.textContent = 'Verifying…'; btn.disabled = true; }
  try {
    const depthParam = state.depth === null ? 'all' : String(state.depth);
    const url = `/api/nodes/${encodeURIComponent(nodeId)}/blast-radius`
      + `?depth=${depthParam}&direction=${state.direction}&include_test=${state.includeTest ? '1' : '0'}`;
    const result = await fetchJSON(url);
    if (token !== state.verifyChainToken || !state.visNodes) return; // superseded by a newer action
    const verifiedById = new Map((result.nodes || []).map((n) => [n.id, n.verified]));
    let unverifiedCount = 0;
    state.visNodes.forEach((vn) => {
      if (verifiedById.get(vn.id) === false) {
        unverifiedCount += 1;
        state.visNodes.update({
          id: vn.id,
          color: { background: vn.color.background, border: '#484f58', highlight: vn.color.highlight, hover: vn.color.hover },
          shapeProperties: { borderDashes: [4, 3] },
        });
      }
    });
    if (btn) {
      btn.disabled = false;
      btn.textContent = unverifiedCount
        ? `${unverifiedCount} node(s) not verified (dashed border)`
        : 'All shown nodes verified ✓';
    }
  } catch (err) {
    if (token !== state.verifyChainToken) return;
    showError(err.message || 'Failed to verify call chain.');
    if (btn) { btn.disabled = false; btn.textContent = 'Verify chain (method-level)'; }
  }
}

// A class's methods aren't in the preloaded graph, so listing them (and
// showing a method's own depends_on/used_by) needs its own fetch - see
// get_graph's default type filter and fetchNodeDetail().
function renderMethodsSection(container, classNode) {
  container.appendChild(el('div', { class: 'detail-section-title' }, 'Methods'));
  if (EXPORT_DATA) {
    // Method nodes/edges aren't embedded in a static export payload - no
    // server to fetch them from (see backend/export.py).
    container.appendChild(el('div', { class: 'edge-empty' }, 'Not available in a static export.'));
    return;
  }
  const body = el('div', { class: 'edge-empty' }, 'Loading…');
  container.appendChild(body);
  fetchNodeDetail(classNode.id).then((detail) => {
    if (state.selectedNodeId !== classNode.id) return; // navigated away meanwhile
    const methods = detail.methods || [];
    body.className = '';
    body.innerHTML = '';
    if (!methods.length) {
      body.className = 'edge-empty';
      body.textContent = 'No methods found.';
      return;
    }
    methods.forEach((m) => {
      const row = el('div', { class: 'edge-row' });
      const label = m.name.startsWith(`${classNode.name}.`) ? m.name.slice(classNode.name.length + 1) : m.name;
      const nameRow = el('div', { style: 'display:flex;align-items:center;gap:6px;' });
      nameRow.appendChild(el('div', { class: 'edge-row-name' }, label));
      // is_dead/is_test_only/entry_point_reason come from the same
      // build-time reachability rollup the Dead Code panel reads from
      // /api/dead-code - shown inline here so a method's status is visible
      // without cross-referencing that separate panel (see models.GraphNode).
      if (m.is_dead) {
        nameRow.appendChild(el('span', { class: 'detail-type-badge badge-dead', style: 'margin:0;' }, 'dead'));
      } else if (m.is_test_only) {
        nameRow.appendChild(el('span', { class: 'detail-type-badge badge-test-only', style: 'margin:0;' }, 'test-only'));
      }
      row.appendChild(nameRow);
      const meta = `${m.in_degree}↓ ${m.out_degree}↑ · precise`
        + (m.entry_point_reason ? ` · entry point: ${m.entry_point_reason}` : '');
      row.appendChild(el('div', { class: 'edge-row-meta' }, meta));
      row.addEventListener('click', () => selectNode(m.id));
      body.appendChild(row);
    });
  }).catch(() => {
    body.textContent = 'Failed to load methods.';
  });
}

// Method nodes have no client-side edge data preloaded (see get_graph's
// default type filter) - fetched on demand instead of read from state.
async function renderMethodDetailPanel(nodeId, node) {
  $('detail-empty').style.display = 'none';
  const content = $('detail-content');
  content.style.display = 'block';
  content.innerHTML = '';

  if (node.parent_id) {
    const back = el('div', { id: 'btn-back-to-node' }, `← ${nodeName(node.parent_id)}`);
    back.addEventListener('click', () => selectNode(node.parent_id));
    content.appendChild(back);
  }
  content.appendChild(el('div', { class: 'detail-title' }, node.name));
  content.appendChild(el('div', { class: 'detail-subtitle' }, node.file_path));
  content.appendChild(el('span', { class: 'detail-type-badge badge-apex_class' }, 'Apex Method — precise call graph'));
  if (node.is_dead) {
    content.appendChild(el('span', { class: 'detail-type-badge badge-dead', style: 'margin-left:6px;' }, 'dead'));
  } else if (node.is_test_only) {
    content.appendChild(el('span', { class: 'detail-type-badge badge-test-only', style: 'margin-left:6px;' }, 'test-only'));
  } else if (node.entry_point_reason) {
    content.appendChild(el('div', { class: 'edge-empty', style: 'margin-bottom:12px;' },
      `Known platform entry point: ${node.entry_point_reason}`));
  }

  const loading = el('div', { class: 'edge-empty', style: 'margin-top:12px;' }, 'Loading…');
  content.appendChild(loading);
  if (EXPORT_DATA) {
    loading.textContent = 'Not available in a static export.';
    return;
  }
  try {
    const detail = await fetchNodeDetail(nodeId);
    if (state.selectedNodeId !== nodeId) return; // navigated away meanwhile
    loading.remove();

    const outgoing = detail.depends_on || [];
    const incoming = detail.used_by || [];
    const stats = el('div', { class: 'detail-stats' });
    stats.appendChild(statBlock(incoming.length, 'Called by'));
    stats.appendChild(statBlock(outgoing.length, 'Calls'));
    stats.appendChild(statBlock(node.loc, 'Lines'));
    content.appendChild(stats);

    content.appendChild(el('div', { class: 'detail-section-title' }, `Calls (${outgoing.length})`));
    content.appendChild(buildEdgeList(outgoing, 'target', nodeId));
    content.appendChild(el('div', { class: 'detail-section-title' }, `Called by (${incoming.length})`));
    content.appendChild(buildEdgeList(incoming, 'source', nodeId));
  } catch (err) {
    loading.textContent = 'Failed to load method detail.';
  }
}

function renderNodeDetailPanel(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) return;
  if (node.type === 'apex_method') {
    renderMethodDetailPanel(nodeId, node);
    return;
  }
  const outgoing = state.edgesBySource.get(nodeId) || [];
  const incoming = state.edgesByTarget.get(nodeId) || [];

  $('detail-empty').style.display = 'none';
  const content = $('detail-content');
  content.style.display = 'block';
  content.innerHTML = '';

  content.appendChild(el('div', { class: 'detail-title' }, node.name));
  content.appendChild(el('div', { class: 'detail-subtitle' }, node.file_path));
  content.appendChild(el('span', { class: `detail-type-badge badge-${node.type}` }, TYPE_LABELS[node.type] || node.type));
  // Same softened/strong distinction as the main canvas (see
  // computeSoftenedDeadIds): a fully_dead class referenced only by other
  // fully_dead classes (an isolated dead island) gets the strong red
  // "delete candidate" badge; one referenced by a class that ISN'T
  // fully_dead (e.g. BaseController, extended by the live AccountController)
  // gets the softer amber badge instead, since that structural edge never
  // executes this class's own code but the class itself clearly isn't an
  // orphan.
  const hasLiveNeighbor = node.fully_dead && incoming.some((e) => hasLiveSource(e, state.nodeById));
  if (node.fully_dead) {
    content.appendChild(el('span', {
      class: `detail-type-badge ${hasLiveNeighbor ? 'badge-test-only' : 'badge-dead'}`, style: 'margin-left:6px;',
    }, `fully dead — ${node.dead_method_count} method(s) unreachable`));
  }

  const stats = el('div', { class: 'detail-stats' });
  stats.appendChild(statBlock(incoming.length, 'Used by'));
  stats.appendChild(statBlock(outgoing.length, 'Depends on'));
  stats.appendChild(statBlock(node.loc, 'Lines'));
  content.appendChild(stats);

  if (node.test_only_method_count) {
    content.appendChild(el('div', { class: 'edge-empty', style: 'margin-bottom:12px;' },
      `${node.test_only_method_count} method(s) reachable only via @isTest code — see Methods below.`));
  }

  if (!node.fully_dead && !incoming.length && node.entry_point_method_count) {
    content.appendChild(el('div', { class: 'edge-empty', style: 'margin-bottom:12px;' },
      `No incoming edges, but ${node.entry_point_method_count} method(s) are known platform `
      + `entry points (invoked from outside this org) — see Methods below.`));
  } else if (node.fully_dead && incoming.length) {
    // "Used by" is class-level and can be nonzero at the same time
    // fully_dead is true without contradiction, for two different reasons -
    // don't conflate them, each needs its own honest explanation:
    //  1. The edge isn't a call at all (extends, field access, a type
    //     mention) - it references the class's shape/data, never executes
    //     any of its methods (e.g. BaseController, extended by the live
    //     AccountController).
    //  2. The edge genuinely IS a call (possible_override/
    //     possible_implementation, a resolved static_call/instance_call,
    //     ...) but its own source method is itself unreachable, so the
    //     call inside it never actually fires either (e.g. SmsNotifier,
    //     "called" only from NotifierRunner.alertAll() - which nothing
    //     calls) - same closed-loop/orphaned-chain reasoning as
    //     DeadLoopA/DeadLoopB, just through polymorphic dispatch.
    const CALL_LIKE_KINDS = new Set([
      'static_call', 'instance_call', 'self_call', 'possible_override',
      'possible_implementation', 'apex_wire', 'apex_imperative', 'dynamic_instantiation',
    ]);
    const callLikeEdge = incoming.find((e) => CALL_LIKE_KINDS.has(e.kind));
    const message = callLikeEdge
      ? `Referenced by ${incoming.length}, including a call (${humanizeKind(callLikeEdge.kind)}) — but its own `
        + `source is itself unreachable, so that call never actually fires. See Methods below for what's dead.`
      : `Referenced by ${incoming.length} (extends/field access/type mention, not a call) — `
        + `see Methods below for what's dead.`;
    content.appendChild(el('div', { class: 'edge-empty', style: 'margin-bottom:12px;' },
      message + (hasLiveNeighbor ? ' At least one of those referencing classes is itself alive.' : '')));
  }

  content.appendChild(buildFocusControls(nodeId));

  content.appendChild(el('div', { class: 'detail-section-title' }, `Depends on (${outgoing.length})`));
  content.appendChild(buildEdgeList(outgoing, 'target', nodeId));

  content.appendChild(el('div', { class: 'detail-section-title' }, `Used by (${incoming.length})`));
  content.appendChild(buildEdgeList(incoming, 'source', nodeId));

  if (node.type === 'apex_class') {
    renderMethodsSection(content, node);
  }
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
        const full = await fetchJSON(
          `/api/edges/${encodeURIComponent(edge.source)}/${encodeURIComponent(edge.target)}`
          + `?include_test=${state.includeTest ? '1' : '0'}`,
        );
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
  const includeTestParam = `include_test=${state.includeTest ? '1' : '0'}`;
  if (state.mode === 'focus' && state.focusId) {
    window.location.href = `/api/nodes/${encodeURIComponent(state.focusId)}/export?${includeTestParam}`;
  } else {
    window.location.href = `/api/export?${includeTestParam}`;
  }
}

// ─── Dead code panel ────────────────────────────────────────────────────────
// Not a node/edge selection - reuses the same #detail-content container every
// other panel (node/edge/method detail) swaps into, via the sentinel below in
// place of a real node id so populateSidebarList()'s active-row highlighting
// and the various "did the user navigate away while this fetch was in
// flight?" guards elsewhere (e.g. renderMethodDetailPanel) keep working
// unmodified - none of them special-case this value, they just won't match it.

const DEAD_CODE_SENTINEL = '__dead_code__';

// A dead-code/entry-point row navigates to that method's own detail panel on
// click, same destination renderMethodsSection's rows already jump to - but
// unlike those (populated from a class's own /api/nodes/{id} response, which
// already registers every method into nodeById), items here come from
// /api/dead-code, a trimmed dict with no full GraphNode fields. Fetching the
// method's own detail first (which does register it) before selecting it is
// what selectNode()/renderNodeDetailPanel() need to find it in nodeById.
function buildDeadCodeRows(items, metaFn, { muted = false } = {}) {
  if (!items.length) return el('div', { class: 'edge-empty' }, 'None found.');
  const wrap = el('div');
  items.forEach((item) => {
    const row = el('div', { class: 'edge-row' + (muted ? ' edge-row-muted' : '') });
    row.appendChild(el('div', { class: 'edge-row-name' }, item.name));
    row.appendChild(el('div', { class: 'edge-row-meta' }, metaFn(item)));
    row.addEventListener('click', () => {
      fetchNodeDetail(item.id).then(() => selectNode(item.id))
        .catch(() => showError('Failed to load method detail.'));
    });
    wrap.appendChild(row);
  });
  return wrap;
}

async function loadDeadCodePanel(includeEntryPoints) {
  exitLanding();
  state.selectedNodeId = DEAD_CODE_SENTINEL;
  populateSidebarList();

  $('detail-empty').style.display = 'none';
  const content = $('detail-content');
  content.style.display = 'block';
  content.innerHTML = '';

  content.appendChild(el('div', { class: 'detail-title' }, 'Dead code candidates'));
  content.appendChild(el('div', { class: 'detail-subtitle' },
    'Apex methods unreachable from anything live in the scanned org — heuristic, verify before deleting.'));

  if (EXPORT_DATA) {
    content.appendChild(el('div', { class: 'edge-empty', style: 'margin-top:12px;' }, 'Not available in a static export.'));
    return;
  }

  const toggleRow = el('label', { class: 'dead-code-toggle' });
  const toggleInput = el('input', { type: 'checkbox' });
  toggleInput.checked = includeEntryPoints;
  toggleRow.appendChild(toggleInput);
  toggleRow.appendChild(document.createTextNode('Show excluded entry points'));
  toggleInput.addEventListener('change', () => loadDeadCodePanel(toggleInput.checked));
  content.appendChild(toggleRow);

  const loading = el('div', { class: 'edge-empty' }, 'Loading…');
  content.appendChild(loading);

  try {
    const data = await fetchJSON(`/api/dead-code?include_entry_points=${includeEntryPoints ? '1' : '0'}`);
    if (state.selectedNodeId !== DEAD_CODE_SENTINEL) return; // navigated away meanwhile
    loading.remove();

    content.appendChild(el('div', { class: 'detail-section-title' }, `Dead code candidates (${data.dead.length})`));
    content.appendChild(buildDeadCodeRows(data.dead, (item) => (
      item.only_reachable_from_dead_code
        ? `${item.file_path}:${item.line} · only called from other unreachable code`
        : `${item.file_path}:${item.line}`
    )));

    content.appendChild(el('div', { class: 'detail-section-title' }, `Test-only usage (${data.test_only.length})`));
    content.appendChild(buildDeadCodeRows(
      data.test_only, (item) => `${item.file_path}:${item.line} · called only from a test`,
    ));

    if (includeEntryPoints) {
      const excluded = data.entry_points_excluded || [];
      content.appendChild(el('div', { class: 'detail-section-title' }, `Excluded entry points (${excluded.length})`));
      content.appendChild(buildDeadCodeRows(excluded, (item) => item.reason, { muted: true }));
    }
  } catch (err) {
    if (state.selectedNodeId !== DEAD_CODE_SENTINEL) return;
    loading.textContent = 'Failed to load dead-code candidates.';
    showError(err.message || 'Failed to load dead-code candidates.');
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

  $('include-test-input').addEventListener('change', () => {
    state.includeTest = $('include-test-input').checked;
    writePref(INCLUDE_TEST_KEY, state.includeTest ? '1' : '0');
    reloadGraphData();
  });

  $('free-physics-input').addEventListener('change', () => {
    state.freePhysics = $('free-physics-input').checked;
    writePref(FREE_PHYSICS_KEY, state.freePhysics ? '1' : '0');
    if (!state.network) return;
    if (state.freePhysics) {
      // Applies immediately even if the layout is currently frozen at rest -
      // otherwise flipping this on would silently do nothing until the next
      // drag or reload. kickPhysics() (not just setOptions enabled:true) is
      // what actually gets the per-frame loop moving again - see its comment.
      cancelPendingFreeze();
      kickPhysics();
    } else {
      freezePhysics();
    }
  });

  $('btn-full-graph').addEventListener('click', () => requestFullGraph());
  $('btn-show-full-graph').addEventListener('click', () => requestFullGraph());
  $('btn-relayout').addEventListener('click', () => relayout());
  $('btn-dead-code').addEventListener('click', () => loadDeadCodePanel(false));
  $('btn-export').addEventListener('click', onExportClick);

  $('welcome-hint-close').addEventListener('click', () => dismissHint());
  $('legend-toggle').addEventListener('click', () => setLegendExpanded(!$('legend').classList.contains('expanded')));
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
  if (isHintDismissed()) $('welcome-hint').style.display = 'none';
  setLegendExpanded(readPref(LEGEND_EXPANDED_KEY) === '1');
  state.includeTest = readPref(INCLUDE_TEST_KEY) === '1';
  $('include-test-input').checked = state.includeTest;
  state.freePhysics = readPref(FREE_PHYSICS_KEY) === '1';
  $('free-physics-input').checked = state.freePhysics;
  try {
    if (EXPORT_DATA) {
      applyGraphData(EXPORT_DATA.summary, EXPORT_DATA.graph);
      $('org-path').textContent = EXPORT_DATA.summary.org_path || '(static export)';
      $('org-path').title = $('org-path').textContent;
      $('btn-export').style.display = 'none';
      // Dead-code detection has no data in a static export payload (see
      // backend/export.py) and nothing to fetch it from - hide the entry
      // point rather than let it open to a permanent "not available" panel.
      $('btn-dead-code').style.display = 'none';
      // The export was already filtered server-side (see backend/export.py)
      // and there's no server here to re-fetch an include_test=1 payload from.
      $('include-test-row').style.display = 'none';
      if (EXPORT_DATA.focus && state.nodeById.has(EXPORT_DATA.focus)) {
        enterFocus(EXPORT_DATA.focus, EXPORT_DATA.depth ?? 2, EXPORT_DATA.direction || 'both');
      } else {
        refreshGraph();
      }
    } else {
      await waitUntilReady();
      const [summary, graph] = await Promise.all([fetchJSON('/api/summary'), fetchJSON(graphUrl())]);
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
