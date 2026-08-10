/**
 * app.js — LWC Org Diff frontend logic
 *
 * Same shell and interaction model as apex-org-diff's frontend (search,
 * filter tabs, virtualized sidebar, keyboard nav, deploy list, HTML
 * export, whitespace/layout toggles) but one level deeper: an LWC
 * component is a *bundle* of files, so clicking a component row in the
 * sidebar expands it in place to list its files, and the Monaco diff
 * editor displays whichever file row is active. Monaco's built-in
 * javascript/html/css/xml/json modes are used (chosen per file extension)
 * instead of a custom tokenizer.
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────
const API_BASE = '';

// When this page was produced by the "full report" static export, the
// backend embeds the entire dataset as window.__EXPORT_DATA__ so the file
// can be opened directly (file://, no server) and still look and behave
// like the live app.
const EXPORT_DATA = (typeof window !== 'undefined' && window.__EXPORT_DATA__) || null;

const STATUS_CONFIG = {
  modified:      { label: 'Modified',    dotClass: 'dot-modified',  badgeClass: 'badge-modified'  },
  identical:     { label: 'Identical',   dotClass: 'dot-identical', badgeClass: 'badge-identical' },
  only_in_org_a: { label: 'Only A',      dotClass: 'dot-only-a',    badgeClass: 'badge-only-a'    },
  only_in_org_b: { label: 'Only B',      dotClass: 'dot-only-b',    badgeClass: 'badge-only-b'    },
};

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  allComponents:      [],
  filteredComponents: [],
  activeFilter:      'all',
  searchQuery:       '',
  selectedComponent: null,
  selectedIndex:     -1,        // index into filteredComponents
  counts:            { all: 0, modified: 0, identical: 0, only_in_org_a: 0, only_in_org_b: 0 },
  monacoReady:       false,
  diffEditor:        null,
  renderSideBySide:  true,
  ignoreWhitespace:  false,
  summary:           null,
  currentDetail:     null,     // full detail (all files, both orgs) for the open component
  selectedFileIndex: -1,       // index into currentDetail.files
  dataLoaded:        false,
  markedForDeploy:   new Set(),  // component names marked for deployment
  expandedComponents: new Set(), // component names expanded to show their per-file rows
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
let domRefs = {};

// ─── Sidebar list virtualization ───────────────────────────────────────────────
const ROW_OVERSCAN = 6;
let rowHeight = null;
let _scrollRAF = null;
let _resizeRAF = null;

// Flat list of currently-visible sidebar rows (one entry per component, plus
// one per file when that component is expanded) - rebuilt by
// renderVisibleWindow(). Kept around so scrollRowIntoView() can translate a
// component index into a row position that accounts for any expanded
// components above it.
let _visibleRows = [];

// ─── Preferences (localStorage) ───────────────────────────────────────────────
const PREF_PREFIX = 'lwcOrgDiff.';

function getPref(key, fallback) {
  try {
    const v = localStorage.getItem(PREF_PREFIX + key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function setPref(key, value) {
  try { localStorage.setItem(PREF_PREFIX + key, value); } catch { /* storage unavailable, ignore */ }
}

// ─── Initialise ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  domRefs = {
    searchInput:       $('search-input'),
    filterTabs:        $$('.filter-tab'),
    classList:         $('class-list'),
    classListWrapper:  $('class-list-wrapper'),
    noResults:         $('no-results'),
    sidebarFooter:     $('sidebar-footer'),
    editorFileName:    $('editor-file-name'),
    editorStatusBadge: $('editor-status-badge'),
    editorInfo:        $('editor-info'),
    monacoContainer:   $('monaco-container'),
    welcomeState:      $('welcome-state'),
    loadingOverlay:    $('loading-overlay'),
    errorToast:        $('error-toast'),
    resizeHandle:      $('resize-handle'),
    sidebar:           $('sidebar'),
    orgAPath:          $('org-a-path'),
    orgBPath:          $('org-b-path'),
    countAll:          $('count-all'),
    countModified:     $('count-modified'),
    countIdentical:    $('count-identical'),
    countOnlyA:        $('count-only-a'),
    countOnlyB:        $('count-only-b'),
    headerWarnings:    $('header-warnings'),
    btnPrevDiff:       $('btn-prev-diff'),
    btnNextDiff:       $('btn-next-diff'),
    btnToggleLayout:   $('btn-toggle-layout'),
    btnToggleWs:       $('btn-toggle-ws'),
    btnExport:         $('btn-export'),
    colNoteA:          $('col-note-a'),
    colNoteB:          $('col-note-b'),
    btnShortcuts:      $('btn-shortcuts'),
    btnShortcutsClose: $('btn-shortcuts-close'),
    shortcutsOverlay:  $('shortcuts-overlay'),
    btnToggleDeploy:   $('btn-toggle-deploy'),
    btnDeployList:     $('btn-deploy-list'),
    deployCountBadge:  $('deploy-count-badge'),
    deployOverlay:     $('deploy-overlay'),
    deployPanelCount:  $('deploy-panel-count'),
    btnDeployClose:    $('btn-deploy-close'),
    deployList:        $('deploy-list'),
    deployEmpty:       $('deploy-empty'),
    btnDeployCopy:     $('btn-deploy-copy'),
    btnDeployTxt:      $('btn-deploy-txt'),
    btnDeployXml:      $('btn-deploy-xml'),
    btnDeployClear:    $('btn-deploy-clear'),
  };

  // The export button downloads a whole bundle from a live backend endpoint
  // that doesn't exist in a static export — hide it rather than let it 404.
  if (EXPORT_DATA && domRefs.btnExport) {
    domRefs.btnExport.style.display = 'none';
  }

  restorePrefs();
  initMonaco();
  initEvents();
  loadData();
});

function restorePrefs() {
  const savedWidth = parseInt(getPref('sidebarWidth', ''), 10);
  if (!Number.isNaN(savedWidth)) {
    domRefs.sidebar.style.width = Math.min(560, Math.max(160, savedWidth)) + 'px';
  }

  if (getPref('layout', 'side-by-side') === 'inline') {
    state.renderSideBySide = false;
  }
  renderLayoutButton();

  if (getPref('ignoreWhitespace', '0') === '1') {
    state.ignoreWhitespace = true;
    domRefs.btnToggleWs.classList.add('active');
    domRefs.btnToggleWs.title = 'Whitespace ignored — click to show whitespace changes';
  }

  setActiveFilter(getPref('filter', 'all'));
}

// ─── Monaco Initialisation ───────────────────────────────────────────────────
function initMonaco() {
  require.config({
    paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }
  });

  require(['vs/editor/editor.main'], () => {
    state.diffEditor = monaco.editor.createDiffEditor(
      domRefs.monacoContainer,
      {
        theme:                'vs-dark',
        readOnly:             true,
        renderSideBySide:     state.renderSideBySide,
        // Monaco silently forces inline view below renderSideBySideInlineBreakpoint
        // (900px) when this is left at its default (true) — that makes the layout
        // toggle button appear broken whenever the sidebar is widened or the window
        // is narrow, since clicking "Side by side" then has no visible effect. The
        // toggle should always reflect the user's explicit choice.
        useInlineViewWhenSpaceIsLimited: false,
        minimap:              { enabled: true },
        fontSize:             13,
        fontFamily:           "'JetBrains Mono', 'Fira Code', monospace",
        lineNumbers:          'on',
        scrollBeyondLastLine: false,
        wordWrap:             'off',
        diffWordWrap:         'off',
        renderOverviewRuler:  true,
        ignoreTrimWhitespace: state.ignoreWhitespace,
        renderIndicators:     true,
        smoothScrolling:      true,
        cursorBlinking:       'smooth',
        renderLineHighlight:  'all',
        padding:              { top: 8, bottom: 8 },
        automaticLayout:      true,
      }
    );

    state.monacoReady = true;
    setEditorModels('', '', 'plaintext');
  });
}

// Monaco's basic languages (javascript/html/css/xml/json) ship in the same
// CDN bundle and are lazy-loaded by language id — no custom tokenizer
// registration needed, unlike apex-org-diff's Apex grammar.
function languageForFile(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.js-meta.xml')) return 'xml';
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  switch (ext) {
    case 'js':   return 'javascript';
    case 'html': return 'html';
    case 'css':  return 'css';
    case 'scss': return 'scss';
    case 'xml':  return 'xml';
    case 'json': return 'json';
    case 'svg':  return 'xml';
    case 'ts':   return 'typescript';
    default:     return 'plaintext';
  }
}

// ─── Event Wiring ─────────────────────────────────────────────────────────────
function initEvents() {
  // Search
  domRefs.searchInput.addEventListener('input', () => {
    state.searchQuery = domRefs.searchInput.value.trim().toLowerCase();
    applyFilters();
  });

  // Filter tabs
  domRefs.filterTabs.forEach(tab => {
    tab.addEventListener('click', () => setActiveFilter(tab.dataset.filter));
  });

  // Component list: one delegated click handler instead of one listener per
  // row (rows are re-created on every scroll/filter). Clicking anywhere on a
  // component row (not just the disclosure chevron) opens it and reveals its
  // file rows - there's no separate small hit-target to aim for.
  domRefs.classList.addEventListener('click', e => {
    const checkbox = e.target.closest('.deploy-checkbox');
    if (checkbox) {
      e.stopPropagation();
      toggleDeployMark(checkbox.dataset.name);
      return;
    }

    const btn = e.target.closest('.class-item');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    const cmp = state.filteredComponents[idx];
    if (!cmp) return;

    if (btn.classList.contains('file-item')) {
      openComponentFile(cmp, idx, btn.dataset.file);
      return;
    }

    const alreadyOpen = state.selectedComponent?.name === cmp.name;
    state.selectedIndex = idx;
    selectComponent(cmp, idx);

    if ((cmp.file_count || 0) > 1) {
      if (alreadyOpen) {
        toggleComponentExpand(cmp.name);
      } else if (!state.expandedComponents.has(cmp.name)) {
        state.expandedComponents.add(cmp.name);
        renderVisibleWindow();
      }
    }
  });

  // Re-render the visible window as the list scrolls.
  domRefs.classListWrapper.addEventListener('scroll', () => {
    if (_scrollRAF) return;
    _scrollRAF = requestAnimationFrame(() => {
      _scrollRAF = null;
      renderVisibleWindow();
    });
  });

  window.addEventListener('resize', () => {
    if (_resizeRAF) return;
    _resizeRAF = requestAnimationFrame(() => {
      _resizeRAF = null;
      renderVisibleWindow();
    });
  });

  document.addEventListener('keydown', handleKeyboardNav);

  domRefs.btnPrevDiff.addEventListener('click', jumpToPrevDiff);
  domRefs.btnNextDiff.addEventListener('click', jumpToNextDiff);
  domRefs.btnToggleLayout.addEventListener('click', toggleLayout);
  domRefs.btnToggleWs.addEventListener('click', toggleWhitespace);
  domRefs.btnExport.addEventListener('click', exportDiff);
  domRefs.btnToggleDeploy.addEventListener('click', toggleDeployForSelected);

  domRefs.btnShortcuts.addEventListener('click', openShortcuts);
  domRefs.btnShortcutsClose.addEventListener('click', closeShortcuts);
  domRefs.shortcutsOverlay.addEventListener('click', e => {
    if (e.target === domRefs.shortcutsOverlay) closeShortcuts();
  });

  domRefs.btnDeployList.addEventListener('click', openDeployList);
  domRefs.btnDeployClose.addEventListener('click', closeDeployList);
  domRefs.deployOverlay.addEventListener('click', e => {
    if (e.target === domRefs.deployOverlay) closeDeployList();
  });
  domRefs.deployList.addEventListener('click', e => {
    const rm = e.target.closest('.deploy-item-remove');
    if (rm) toggleDeployMark(rm.dataset.name);
  });
  domRefs.btnDeployCopy.addEventListener('click', copyDeployNames);
  domRefs.btnDeployTxt.addEventListener('click', downloadDeployTxt);
  domRefs.btnDeployXml.addEventListener('click', downloadDeployPackageXml);
  domRefs.btnDeployClear.addEventListener('click', clearDeployList);

  initCopyPathHandlers();
  initResizeHandle();
}

// ─── Filtering ────────────────────────────────────────────────────────────────
function setActiveFilter(filterKey) {
  state.activeFilter = filterKey;

  domRefs.filterTabs.forEach(tab => {
    const active = tab.dataset.filter === filterKey;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  setPref('filter', filterKey);
  applyFilters();
}

// ─── Keyboard shortcuts modal ──────────────────────────────────────────────────
function openShortcuts() {
  domRefs.shortcutsOverlay.classList.add('visible');
  domRefs.btnShortcutsClose.focus();
}

function closeShortcuts() {
  domRefs.shortcutsOverlay.classList.remove('visible');
  domRefs.btnShortcuts.focus();
}

// ─── Copy-to-clipboard org paths ───────────────────────────────────────────────
function initCopyPathHandlers() {
  [domRefs.orgAPath, domRefs.orgBPath].forEach(el => {
    if (!el) return;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('click', () => copyPath(el));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyPath(el);
      }
    });
  });
}

function copyPath(el) {
  const text = el.title || el.textContent;
  if (!text) return;
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast('Clipboard not available in this browser', 'error');
    return;
  }
  navigator.clipboard.writeText(text)
    .then(() => showToast(`Copied: ${text}`, 'info'))
    .catch(() => showToast('Could not copy path', 'error'));
}

// ─── Keyboard Navigation ─────────────────────────────────────────────────────
function handleKeyboardNav(e) {
  if (e.altKey && e.key === 'ArrowDown') {
    e.preventDefault();
    jumpToNextDiff();
    return;
  }
  if (e.altKey && e.key === 'ArrowUp') {
    e.preventDefault();
    jumpToPrevDiff();
    return;
  }

  if (e.key === 'Escape') {
    if (domRefs.shortcutsOverlay.classList.contains('visible')) {
      closeShortcuts();
      return;
    }
    if (domRefs.deployOverlay.classList.contains('visible')) {
      closeDeployList();
      return;
    }
    if (document.activeElement === domRefs.searchInput && state.searchQuery) {
      domRefs.searchInput.value = '';
      state.searchQuery = '';
      applyFilters();
      return;
    }
  }

  const focused = document.activeElement;
  const isTyping = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');

  if (e.key === '?' && !isTyping) {
    e.preventDefault();
    openShortcuts();
    return;
  }

  if (isTyping) return;

  if ((e.key === '[' || e.key === ']') && state.currentDetail) {
    e.preventDefault();
    const files = state.currentDetail.files || [];
    if (files.length < 2) return;
    const delta = e.key === ']' ? 1 : -1;
    const next = (state.selectedFileIndex + delta + files.length) % files.length;
    selectFileByIndex(next);
    return;
  }

  const len = state.filteredComponents.length;
  if (len === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = Math.min(state.selectedIndex + 1, len - 1);
    selectComponentByIndex(next);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = Math.max(state.selectedIndex - 1, 0);
    selectComponentByIndex(prev);
  } else if (e.key === 'Enter' && state.selectedIndex >= 0) {
    e.preventDefault();
    selectComponent(state.filteredComponents[state.selectedIndex], state.selectedIndex);
  } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    domRefs.searchInput.focus();
    domRefs.searchInput.select();
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    toggleDeployForSelected();
  }
}

function selectComponentByIndex(idx) {
  if (idx < 0 || idx >= state.filteredComponents.length) return;
  state.selectedIndex = idx;
  selectComponent(state.filteredComponents[idx], idx);
  scrollRowIntoView(idx);
}

function scrollRowIntoView(componentIdx) {
  if (rowHeight === null) return;
  // Expanded components push subsequent rows down, so the row position for
  // a given component index isn't just componentIdx * rowHeight - look up
  // its actual position in the flattened row list built on the last render.
  const rowIndex = _visibleRows.findIndex(r => r.type === 'component' && r.idx === componentIdx);
  if (rowIndex < 0) return;
  const wrapper  = domRefs.classListWrapper;
  const rowTop    = rowIndex * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop < wrapper.scrollTop) {
    wrapper.scrollTop = rowTop;
  } else if (rowBottom > wrapper.scrollTop + wrapper.clientHeight) {
    wrapper.scrollTop = rowBottom - wrapper.clientHeight;
  }
}

// ─── Toolbar Actions ──────────────────────────────────────────────────────────
function jumpToNextDiff() {
  if (!state.monacoReady || !state.diffEditor) return;
  state.diffEditor.getModifiedEditor().trigger('keyboard', 'editor.action.diffReview.next', null);
}

function jumpToPrevDiff() {
  if (!state.monacoReady || !state.diffEditor) return;
  state.diffEditor.getModifiedEditor().trigger('keyboard', 'editor.action.diffReview.prev', null);
}

const ICON_LAYOUT_SPLIT =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<rect x="1" y="1.5" width="4.3" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
  '<rect x="6.7" y="1.5" width="4.3" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>';
const ICON_LAYOUT_INLINE =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<rect x="1" y="1.5" width="10" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
  '<path d="M1 6h10" stroke="currentColor" stroke-width="1"/></svg>';

function renderLayoutButton() {
  domRefs.btnToggleLayout.innerHTML = state.renderSideBySide
    ? `${ICON_LAYOUT_INLINE} Inline`
    : `${ICON_LAYOUT_SPLIT} Side by side`;
  domRefs.btnToggleLayout.title = state.renderSideBySide
    ? 'Switch to inline diff view'
    : 'Switch to side-by-side diff view';
}

function toggleLayout() {
  state.renderSideBySide = !state.renderSideBySide;
  if (state.diffEditor) {
    state.diffEditor.updateOptions({ renderSideBySide: state.renderSideBySide });
    // Monaco's diff editor can silently ignore this option once setModel() has
    // been called since - see microsoft/monaco-editor#4286. Re-setting the
    // models forces it to rebuild honoring the new value.
    const file = currentFile();
    if (file) {
      const scrollTop = state.diffEditor.getModifiedEditor().getScrollTop();
      setEditorModels(file.org_a?.content ?? '', file.org_b?.content ?? '', languageForFile(file.name));
      state.diffEditor.getModifiedEditor().setScrollTop(scrollTop);
    }
  }
  renderLayoutButton();
  setPref('layout', state.renderSideBySide ? 'side-by-side' : 'inline');
}

function toggleWhitespace() {
  state.ignoreWhitespace = !state.ignoreWhitespace;
  if (state.diffEditor) {
    state.diffEditor.updateOptions({ ignoreTrimWhitespace: state.ignoreWhitespace });
  }
  domRefs.btnToggleWs.classList.toggle('active', state.ignoreWhitespace);
  domRefs.btnToggleWs.title = state.ignoreWhitespace
    ? 'Whitespace ignored — click to show whitespace changes'
    : 'Click to ignore whitespace changes';
  setPref('ignoreWhitespace', state.ignoreWhitespace ? '1' : '0');
}

// ─── Export ──────────────────────────────────────────────────────────────────
// Rendered server-side and returned with a Content-Disposition header, same
// reliability rationale as apex-org-diff (a client-side Blob + synthetic
// <a download> click can lose the filename/extension for HTML content).
function exportDiff() {
  if (EXPORT_DATA) return; // no backend to hit in a static export; button is hidden
  const detail = state.currentDetail;
  if (!detail) {
    showError('No component loaded yet — wait for the diff to appear, then try again.');
    return;
  }
  window.location.href = `${API_BASE}/api/components/${encodeURIComponent(detail.name)}/export`;
}

// ─── Deploy List ────────────────────────────────────────────────────────────
// Marks are scoped to the current org-pair (not global).
function deployStorageKey() {
  const a = state.summary?.org_a_path || '';
  const b = state.summary?.org_b_path || '';
  return `deployMarks::${a}::${b}`;
}

function loadDeployMarks() {
  try {
    const raw = localStorage.getItem(PREF_PREFIX + deployStorageKey());
    if (!raw) return;
    const names = JSON.parse(raw);
    if (Array.isArray(names)) state.markedForDeploy = new Set(names);
  } catch { /* storage unavailable or corrupt — start with an empty list */ }
}

function persistDeployMarks() {
  try {
    localStorage.setItem(PREF_PREFIX + deployStorageKey(), JSON.stringify([...state.markedForDeploy]));
  } catch { /* storage unavailable, ignore */ }
}

function toggleDeployMark(name) {
  if (!name) return;
  if (state.markedForDeploy.has(name)) {
    state.markedForDeploy.delete(name);
  } else {
    state.markedForDeploy.add(name);
  }
  persistDeployMarks();
  updateDeployBadge();
  renderVisibleWindow();
  renderDeployToggleButton();
  if (domRefs.deployOverlay.classList.contains('visible')) renderDeployList();
}

function toggleDeployForSelected() {
  if (!state.selectedComponent) return;
  toggleDeployMark(state.selectedComponent.name);
}

function updateDeployBadge() {
  const n = state.markedForDeploy.size;
  domRefs.deployCountBadge.textContent = n;
  domRefs.btnDeployList.classList.toggle('has-items', n > 0);
}

const ICON_DEPLOY_CHECK =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<path d="M2 6.3l2.3 2.3L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderDeployToggleButton() {
  const cmp = state.selectedComponent;
  const marked = !!(cmp && state.markedForDeploy.has(cmp.name));
  domRefs.btnToggleDeploy.classList.toggle('active', marked);
  domRefs.btnToggleDeploy.title = marked
    ? 'Unmark this component from the deploy list'
    : 'Mark this component for deployment';
  domRefs.btnToggleDeploy.innerHTML = `${ICON_DEPLOY_CHECK} ${marked ? 'Marked' : 'Deploy'}`;
}

function deployNamesSorted() {
  return [...state.markedForDeploy].sort((a, b) => a.localeCompare(b));
}

function openDeployList() {
  renderDeployList();
  domRefs.deployOverlay.classList.add('visible');
  domRefs.btnDeployClose.focus();
}

function closeDeployList() {
  domRefs.deployOverlay.classList.remove('visible');
  domRefs.btnDeployList.focus();
}

function renderDeployList() {
  const names = deployNamesSorted();
  domRefs.deployPanelCount.textContent = names.length;
  domRefs.deployEmpty.style.display = names.length === 0 ? 'block' : 'none';

  const frag = document.createDocumentFragment();
  for (const name of names) {
    const meta = state.allComponents.find(c => c.name === name);
    const cfg  = STATUS_CONFIG[meta?.status] || null;
    const li   = document.createElement('li');
    li.className = 'deploy-item';
    li.innerHTML = `
      <span class="class-item-dot ${cfg ? cfg.dotClass : 'dot-all'}"></span>
      <span class="deploy-item-name">${escHtml(name)}</span>
      <button class="deploy-item-remove" data-name="${escHtml(name)}" title="Remove from deploy list" aria-label="Remove ${escHtml(name)} from deploy list">✕</button>
    `;
    frag.appendChild(li);
  }
  domRefs.deployList.innerHTML = '';
  domRefs.deployList.appendChild(frag);
}

function copyDeployNames() {
  const names = deployNamesSorted();
  if (names.length === 0) { showError('No components marked yet'); return; }
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showError('Clipboard not available in this browser');
    return;
  }
  navigator.clipboard.writeText(names.join('\n'))
    .then(() => showToast(`Copied ${names.length} component name${names.length !== 1 ? 's' : ''}`, 'info'))
    .catch(() => showError('Could not copy list'));
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDeployTxt() {
  const names = deployNamesSorted();
  if (names.length === 0) { showError('No components marked yet'); return; }
  downloadBlob('deploy-list.txt', names.join('\n') + '\n', 'text/plain;charset=utf-8');
}

// Standard Metadata API manifest for the LightningComponentBundle type -
// members are the bundle folder name as-is (no extension to strip, unlike
// Apex classes), matching what `sf project deploy` / Workbench expect.
function downloadDeployPackageXml() {
  const names = deployNamesSorted();
  if (names.length === 0) { showError('No components marked yet'); return; }
  const members = names
    .map(n => `        <members>${escXml(n)}</members>`)
    .join('\n');
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
    '    <types>\n' +
    `${members}\n` +
    '        <name>LightningComponentBundle</name>\n' +
    '    </types>\n' +
    '    <version>59.0</version>\n' +
    '</Package>\n';
  downloadBlob('package.xml', xml, 'application/xml;charset=utf-8');
}

function escXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearDeployList() {
  if (state.markedForDeploy.size === 0) return;
  state.markedForDeploy.clear();
  persistDeployMarks();
  updateDeployBadge();
  renderVisibleWindow();
  renderDeployList();
  renderDeployToggleButton();
  showToast('Deploy list cleared', 'info');
}

// ─── Data Loading ─────────────────────────────────────────────────────────────
let _buildRetryNotified = false;
let _buildRetryTimer = null;

async function loadData() {
  try {
    let summary, components;

    if (EXPORT_DATA) {
      summary = EXPORT_DATA.summary;
      components = EXPORT_DATA.components;
    } else {
      const [summaryRes, componentsRes] = await Promise.all([
        fetch(`${API_BASE}/api/summary`),
        fetch(`${API_BASE}/api/components`),
      ]);

      if (summaryRes.status === 503 || componentsRes.status === 503) {
        if (!_buildRetryNotified) {
          _buildRetryNotified = true;
          showToast('Scanning both orgs — this can take a moment for large ones. Page will update automatically.', 'info');
        }
        clearTimeout(_buildRetryTimer);
        _buildRetryTimer = setTimeout(loadData, 1000);
        return;
      }

      if (!summaryRes.ok) throw new Error(`Summary API error: ${summaryRes.status}`);
      if (!componentsRes.ok) throw new Error(`Components API error: ${componentsRes.status}`);

      summary = await summaryRes.json();
      components = await componentsRes.json();
    }

    state.summary = summary;

    if (domRefs.orgAPath) {
      domRefs.orgAPath.textContent = summary.org_a_path || 'Org A';
      domRefs.orgAPath.title       = summary.org_a_path || '';
    }
    if (domRefs.orgBPath) {
      domRefs.orgBPath.textContent = summary.org_b_path || 'Org B';
      domRefs.orgBPath.title       = summary.org_b_path || '';
    }

    state.counts = {
      all:           summary.total,
      modified:      summary.modified,
      identical:     summary.identical,
      only_in_org_a: summary.only_in_org_a,
      only_in_org_b: summary.only_in_org_b,
    };

    updateCountBadges();
    renderDuplicatesWarning(summary);

    loadDeployMarks();
    updateDeployBadge();

    state.allComponents = components;
    state.dataLoaded = true;
    applyFilters();

    // Deep link: ?component=Name re-selects the same component after a
    // reload or a shared link; &file=relPath additionally opens that file
    // tab. Falls back to the first modified component, then the first
    // component overall.
    const params      = new URLSearchParams(window.location.search);
    const wantedName  = params.get('component');
    const wantedFile  = params.get('file');
    const wanted      = wantedName && components.find(c => c.name.toLowerCase() === wantedName.toLowerCase());
    const autoSelect  = wanted || components.find(c => c.status === 'modified') || components[0];
    if (autoSelect) {
      const idx = state.filteredComponents.findIndex(c => c.name === autoSelect.name);
      if (idx >= 0) {
        state.selectedIndex = idx;
        selectComponent(state.filteredComponents[idx], idx, wantedFile);
      }
    } else if (domRefs.welcomeState) {
      const sub = domRefs.welcomeState.querySelector('#welcome-sub');
      if (sub) sub.textContent = 'No LWC components found in either org folder.';
    }

  } catch (err) {
    showError(`Failed to load component list: ${err.message}`);
  }
}

function updateCountBadges() {
  domRefs.countAll.textContent       = state.counts.all;
  domRefs.countModified.textContent  = state.counts.modified;
  domRefs.countIdentical.textContent = state.counts.identical;
  domRefs.countOnlyA.textContent     = state.counts.only_in_org_a;
  domRefs.countOnlyB.textContent     = state.counts.only_in_org_b;
}

// Components with the same bundle name in two different parent folders of
// one org can only be indexed once - warn so the user knows a comparison
// might not be against the bundle they expect.
function renderDuplicatesWarning(summary) {
  const dupes = summary.duplicates || [];
  let chip = document.getElementById('chip-duplicates');

  if (dupes.length === 0) {
    if (chip) chip.remove();
    return;
  }

  if (!chip) {
    chip = document.createElement('span');
    chip.id = 'chip-duplicates';
    chip.className = 'warning-badge';
    if (domRefs.headerWarnings) domRefs.headerWarnings.appendChild(chip);
  }

  chip.textContent = `⚠ ${dupes.length} duplicate${dupes.length !== 1 ? 's' : ''} ignored`;
  chip.title = dupes
    .map(d => `${d.name} (Org ${d.org.toUpperCase()}): kept "${d.kept_path}", ignored "${d.ignored_path}"`)
    .join('\n');

  console.warn('[LwcDiff] Duplicate component names ignored:', dupes);
}

// ─── Filter & Render ─────────────────────────────────────────────────────────
function applyFilters() {
  if (!state.dataLoaded) return;

  let filtered = state.allComponents;

  if (state.activeFilter !== 'all') {
    filtered = filtered.filter(c => c.status === state.activeFilter);
  }
  if (state.searchQuery) {
    filtered = filtered.filter(c => c.name.toLowerCase().includes(state.searchQuery));
  }

  const ORDER = { modified: 0, only_in_org_a: 1, only_in_org_b: 2, identical: 3 };
  filtered.sort((a, b) => {
    const oa = ORDER[a.status] ?? 99;
    const ob = ORDER[b.status] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });

  state.filteredComponents = filtered;

  if (state.selectedComponent) {
    state.selectedIndex = filtered.findIndex(c => c.name === state.selectedComponent.name);
  }

  renderClassList(filtered);
}

function renderClassList(components) {
  if (rowHeight === null) rowHeight = measureRowHeight();

  if (components.length === 0) {
    domRefs.noResults.style.display  = 'block';
    domRefs.sidebarFooter.textContent = '0 components';
    domRefs.classList.innerHTML = '';
    domRefs.classList.style.height = '0px';
    return;
  }

  domRefs.noResults.style.display  = 'none';
  domRefs.sidebarFooter.textContent = `${components.length} component${components.length !== 1 ? 's' : ''}`;

  domRefs.classListWrapper.scrollTop = 0;
  renderVisibleWindow();
}

// Builds one component row. Shared by the row-height probe and the real
// windowed render.
function buildClassItemEl(cmp, idx) {
  const cfg     = STATUS_CONFIG[cmp.status] || STATUS_CONFIG.identical;
  const isActive = state.selectedComponent?.name === cmp.name;
  const isMarked = state.markedForDeploy.has(cmp.name);
  const isExpanded = state.expandedComponents.has(cmp.name);
  const canExpand = (cmp.file_count || 0) > 1;
  const stats   = cmp.diff_stats || { lines_added: 0, lines_removed: 0 };

  let statHtml = '';
  if (cmp.status === 'modified') {
    statHtml = `<span class="stat-pill">
      <span class="stat-add">+${stats.lines_added}</span>
      <span class="stat-del">−${stats.lines_removed}</span>
    </span>`;
  } else if (cmp.status === 'only_in_org_b') {
    statHtml = `<span class="stat-pill"><span class="stat-add">+${stats.lines_added}</span></span>`;
  } else if (cmp.status === 'only_in_org_a') {
    statHtml = `<span class="stat-pill"><span class="stat-del">−${stats.lines_removed}</span></span>`;
  }

  const btn = document.createElement('button');
  btn.className  = 'class-item' + (isActive ? ' active' : '') + (isMarked ? ' marked' : '');
  btn.dataset.name  = cmp.name;
  btn.dataset.index = idx;
  btn.title      = cmp.has_error ? `${cmp.name} — one or more files could not be read` : cmp.name;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  if (canExpand) btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  btn.innerHTML  = `
    <span class="deploy-checkbox${isMarked ? ' checked' : ''}" data-name="${escHtml(cmp.name)}" role="checkbox" aria-checked="${isMarked}" aria-label="Mark ${escHtml(cmp.name)} for deployment" title="Mark for deployment"></span>
    <span class="expand-toggle${canExpand ? '' : ' expand-toggle-disabled'}${isExpanded ? ' expanded' : ''}" aria-hidden="true"></span>
    <span class="class-item-dot ${cfg.dotClass}"></span>
    <span class="class-item-name">${highlightMatch(cmp.name)}</span>
    <span class="file-count-chip" title="${cmp.file_count} file${cmp.file_count !== 1 ? 's' : ''} in bundle">${cmp.file_count}f</span>
    ${cmp.has_error ? '<span class="err-flag" title="Could not read one of the files — open to see details">⚠</span>' : ''}
    ${statHtml}
  `;
  return btn;
}

// Builds one per-file sub-row, shown beneath a component when it's expanded.
// Reuses the same per-file metadata already fetched with /api/components -
// no extra network round trip needed just to populate the tree.
function buildFileItemEl(cmp, componentIdx, file) {
  const cfg = STATUS_CONFIG[file.status] || STATUS_CONFIG.identical;
  const isActiveFile = state.selectedComponent?.name === cmp.name
    && state.currentDetail?.name === cmp.name
    && state.currentDetail?.files?.[state.selectedFileIndex]?.name === file.name;
  const stats = file.diff_stats || { lines_added: 0, lines_removed: 0 };

  let statHtml = '';
  if (file.status === 'modified') {
    statHtml = `<span class="stat-pill">
      <span class="stat-add">+${stats.lines_added}</span>
      <span class="stat-del">−${stats.lines_removed}</span>
    </span>`;
  } else if (file.status === 'only_in_org_b') {
    statHtml = `<span class="stat-pill"><span class="stat-add">+${stats.lines_added}</span></span>`;
  } else if (file.status === 'only_in_org_a') {
    statHtml = `<span class="stat-pill"><span class="stat-del">−${stats.lines_removed}</span></span>`;
  }

  const btn = document.createElement('button');
  btn.className  = 'class-item file-item' + (isActiveFile ? ' active' : '');
  btn.dataset.index = componentIdx;
  btn.dataset.file  = file.name;
  btn.title      = file.has_error ? `${file.name} — could not be fully read` : file.name;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', isActiveFile ? 'true' : 'false');
  btn.innerHTML  = `
    <span class="class-item-dot ${cfg.dotClass}"></span>
    <span class="class-item-name">${escHtml(file.name)}</span>
    ${file.has_error ? '<span class="err-flag" title="Could not read this file">⚠</span>' : ''}
    ${statHtml}
  `;
  return btn;
}

// Flattens components + their (optional) expanded file rows into the single
// list renderVisibleWindow virtualizes over, so a component with N files
// expanded simply contributes N extra rows instead of needing a second
// rendering path.
function buildVisibleRows() {
  const rows = [];
  for (let idx = 0; idx < state.filteredComponents.length; idx++) {
    const cmp = state.filteredComponents[idx];
    rows.push({ type: 'component', cmp, idx });
    if (state.expandedComponents.has(cmp.name) && cmp.files && cmp.files.length) {
      for (const file of cmp.files) {
        rows.push({ type: 'file', cmp, idx, file });
      }
    }
  }
  return rows;
}

function toggleComponentExpand(name) {
  if (!name) return;
  if (state.expandedComponents.has(name)) {
    state.expandedComponents.delete(name);
  } else {
    state.expandedComponents.add(name);
  }
  renderVisibleWindow();
}

function renderVisibleWindow() {
  const wrapper  = domRefs.classListWrapper;
  const list     = domRefs.classList;
  const rows     = buildVisibleRows();
  _visibleRows   = rows;
  const total    = rows.length;

  list.style.height = (total * rowHeight) + 'px';

  if (total === 0) {
    list.innerHTML = '';
    return;
  }

  const scrollTop = wrapper.scrollTop;
  const viewportH = wrapper.clientHeight || 400;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_OVERSCAN);
  const end   = Math.min(total, Math.ceil((scrollTop + viewportH) / rowHeight) + ROW_OVERSCAN);

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const row = rows[i];
    const el = row.type === 'component'
      ? buildClassItemEl(row.cmp, row.idx)
      : buildFileItemEl(row.cmp, row.idx, row.file);
    el.style.top = (i * rowHeight) + 'px';
    frag.appendChild(el);
  }

  list.innerHTML = '';
  list.appendChild(frag);
}

function measureRowHeight() {
  const probe = buildClassItemEl(
    { name: 'probeComponent', status: 'identical', diff_stats: {}, file_count: 1 },
    0
  );
  probe.style.visibility = 'hidden';
  probe.style.top = '0px';
  domRefs.classList.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.max(1, Math.ceil(h)) + 1;
}

// ─── Component Selection ─────────────────────────────────────────────────────
let _selectRequestId = 0;

async function selectComponent(cmp, idx, wantedFile) {
  // currentDetail must belong to *this* component, not just be non-null —
  // after a failed load it still holds whatever the previously-selected
  // component loaded.
  if (state.selectedComponent?.name === cmp.name && state.currentDetail?.name === cmp.name && !wantedFile) return;

  const requestId = ++_selectRequestId;

  state.selectedComponent = cmp;
  state.selectedIndex     = idx ?? state.filteredComponents.indexOf(cmp);

  const url = new URL(window.location.href);
  url.searchParams.set('component', cmp.name);
  if (wantedFile) url.searchParams.set('file', wantedFile); else url.searchParams.delete('file');
  history.replaceState(null, '', url);
  document.title = `${cmp.name} — LWC Org Diff`;

  // Re-render rather than toggle .active on existing DOM nodes: with file
  // sub-rows now in the mix, "is this the active row" depends on more than
  // just a name match (component vs. file row, which file), so a full
  // rebuild of the visible window is simpler than patching both row kinds.
  if (rowHeight !== null) renderVisibleWindow();

  updateComponentHeader(cmp);
  showLoading(true);
  hideWelcome();

  try {
    let detail;
    if (EXPORT_DATA) {
      detail = EXPORT_DATA.details[cmp.name];
      if (!detail) throw new Error('No embedded data for this component in the export');
    } else {
      const res = await fetch(`${API_BASE}/api/components/${encodeURIComponent(cmp.name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      detail = await res.json();
    }
    if (requestId !== _selectRequestId) return; // a newer selection has since started
    state.currentDetail = detail;

    const files = detail.files || [];
    let fileIdx = 0;
    if (wantedFile) {
      const found = files.findIndex(f => f.name.toLowerCase() === wantedFile.toLowerCase());
      if (found >= 0) fileIdx = found;
    } else {
      const firstModified = files.findIndex(f => f.status === 'modified');
      if (firstModified >= 0) fileIdx = firstModified;
    }
    selectFileByIndex(files.length ? fileIdx : -1);
  } catch (err) {
    if (requestId !== _selectRequestId) return;
    showError(`Could not load '${cmp.name}': ${err.message}`);
    showWelcome();
  } finally {
    if (requestId === _selectRequestId) showLoading(false);
  }
}

// Handles a click on an expanded sidebar file row. If that component is
// already open, just switch the active file tab - no need to re-fetch a
// detail we already have. Otherwise fall through to the normal component
// load, opening straight to the requested file.
function openComponentFile(cmp, idx, fileName) {
  if (state.selectedComponent?.name === cmp.name && state.currentDetail?.name === cmp.name) {
    const files = state.currentDetail.files || [];
    const foundIdx = files.findIndex(f => f.name.toLowerCase() === fileName.toLowerCase());
    if (foundIdx >= 0) {
      state.selectedIndex = idx;
      selectFileByIndex(foundIdx);
      return;
    }
  }
  state.selectedIndex = idx;
  selectComponent(cmp, idx, fileName);
}

function updateComponentHeader(cmp) {
  const cfg = STATUS_CONFIG[cmp.status] || STATUS_CONFIG.identical;
  domRefs.editorFileName.textContent    = cmp.name;
  domRefs.editorStatusBadge.textContent = cfg.label;
  domRefs.editorStatusBadge.className   = `class-item-badge ${cfg.badgeClass}`;
  renderDeployToggleButton();
}

function currentFile() {
  const files = state.currentDetail?.files || [];
  return files[state.selectedFileIndex] || null;
}

function selectFileByIndex(idx) {
  const files = state.currentDetail?.files || [];
  if (idx < 0 || idx >= files.length) {
    state.selectedFileIndex = -1;
    return;
  }
  state.selectedFileIndex = idx;

  // Refresh the sidebar so its per-file rows (the only file navigation now)
  // show the active-file highlight.
  if (rowHeight !== null) renderVisibleWindow();

  const url = new URL(window.location.href);
  url.searchParams.set('file', files[idx].name);
  history.replaceState(null, '', url);

  displayFileDiff(files[idx]);
}

function displayFileDiff(file) {
  if (!state.monacoReady || !state.diffEditor) {
    setTimeout(() => displayFileDiff(file), 100);
    return;
  }

  const cfg = STATUS_CONFIG[file.status] || STATUS_CONFIG.identical;

  // Column notes
  if (file.status === 'only_in_org_a') {
    domRefs.colNoteA.textContent = '';
    domRefs.colNoteB.textContent = '(not present)';
  } else if (file.status === 'only_in_org_b') {
    domRefs.colNoteA.textContent = '(not present)';
    domRefs.colNoteB.textContent = '';
  } else {
    domRefs.colNoteA.textContent = '';
    domRefs.colNoteB.textContent = '';
  }

  const showNav = file.status === 'modified';
  domRefs.btnPrevDiff.style.display = showNav ? '' : 'none';
  domRefs.btnNextDiff.style.display = showNav ? '' : 'none';

  const contentA = file.org_a?.content ?? '';
  const contentB = file.org_b?.content ?? '';

  setEditorModels(contentA, contentB, languageForFile(file.name));

  const linesA  = contentA ? contentA.split('\n').length : 0;
  const linesB  = contentB ? contentB.split('\n').length : 0;
  const stats   = file.diff_stats || { lines_added: 0, lines_removed: 0 };

  let statsHtml = '';
  if (file.status === 'modified') {
    statsHtml = `<span class="info-added">+${stats.lines_added}</span><span class="info-removed">−${stats.lines_removed}</span>`;
  }

  domRefs.editorInfo.innerHTML = `
    <span>Org A: ${linesA.toLocaleString()} lines</span>
    <span>Org B: ${linesB.toLocaleString()} lines</span>
    ${statsHtml}
  `;

  const errA = file.org_a?.error || null;
  const errB = file.org_b?.error || null;
  if (errA && domRefs.colNoteA) {
    domRefs.colNoteA.textContent = '⚠ read error';
    domRefs.colNoteA.title = errA;
  }
  if (errB && domRefs.colNoteB) {
    domRefs.colNoteB.textContent = '⚠ read error';
    domRefs.colNoteB.title = errB;
  }
  if (errA || errB) {
    const parts = [];
    if (errA) parts.push(`Org A: ${errA}`);
    if (errB) parts.push(`Org B: ${errB}`);
    showError(`Could not fully read '${file.name}' — ${parts.join(' | ')}`);
  }
}

function setEditorModels(contentA, contentB, language) {
  const existing = state.diffEditor.getModel();
  if (existing) {
    if (existing.original && !existing.original.isDisposed()) existing.original.dispose();
    if (existing.modified && !existing.modified.isDisposed()) existing.modified.dispose();
  }
  state.diffEditor.setModel({
    original: monaco.editor.createModel(contentA, language),
    modified: monaco.editor.createModel(contentB, language),
  });
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────
function showLoading(v)  { domRefs.loadingOverlay.classList.toggle('visible', v); }
function hideWelcome()   { domRefs.welcomeState.classList.add('hidden'); }
function showWelcome()   { domRefs.welcomeState.classList.remove('hidden'); }

let _toastTimer;
function showToast(msg, type = 'error') {
  domRefs.errorToast.textContent = (type === 'error' ? '⚠ ' : '✓ ') + msg;
  domRefs.errorToast.classList.toggle('toast-info', type === 'info');
  domRefs.errorToast.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => domRefs.errorToast.classList.remove('visible'), type === 'info' ? 2500 : 6000);
  if (type === 'error') console.error('[LwcDiff]', msg);
}

function showError(msg) { showToast(msg, 'error'); }

function highlightMatch(name) {
  const q = state.searchQuery;
  if (!q) return escHtml(name);
  const idx = name.toLowerCase().indexOf(q);
  if (idx === -1) return escHtml(name);
  const before = escHtml(name.slice(0, idx));
  const match  = escHtml(name.slice(idx, idx + q.length));
  const after  = escHtml(name.slice(idx + q.length));
  return `${before}<mark>${match}</mark>${after}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ─── Resize Handle ────────────────────────────────────────────────────────────
function initResizeHandle() {
  const handle = domRefs.resizeHandle;
  const sidebar = domRefs.sidebar;
  const MIN = 160, MAX = 560;
  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    sidebar.style.width = Math.min(MAX, Math.max(MIN, startW + e.clientX - startX)) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor    = '';
    document.body.style.userSelect = '';
    setPref('sidebarWidth', String(sidebar.offsetWidth));
    if (state.diffEditor) state.diffEditor.layout();
  });
}
