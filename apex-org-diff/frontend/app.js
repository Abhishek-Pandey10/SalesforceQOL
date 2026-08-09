/**
 * app.js — Apex Org Diff frontend logic (v2)
 *
 * Improvements over v1:
 *  1. Original filename casing (AccountController.cls, not accountcontroller.cls)
 *  2. Keyboard navigation (↑/↓ arrows + Enter in sidebar)
 *  3. Diff stats (+N −N) per class in sidebar, computed server-side
 *  4. Jump to next/prev diff toolbar buttons
 *  5. Apex Monarch syntax highlighting (full tokenizer)
 *  6. Auto-select first modified class on load
 *  7. Export self-contained HTML diff file
 *  8. Inline ↔ Side-by-side toggle
 *  9. Ignore whitespace toggle
 * 10. Preferences (layout, whitespace, filter, sidebar width) persisted to localStorage
 * 11. Deep-linkable class selection via ?class= query param + tab title sync
 * 12. Search match highlighting, click-to-copy org paths, keyboard shortcuts help (?)
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────
const API_BASE = '';

// When this page was produced by the "full report" static export, the
// backend embeds the entire dataset as window.__EXPORT_DATA__ so the file
// can be opened directly (file://, no server) and still look and behave
// like the live app — same sidebar, search/filter, Monaco diff editor —
// just reading from this object instead of hitting /api/* endpoints.
const EXPORT_DATA = (typeof window !== 'undefined' && window.__EXPORT_DATA__) || null;

const STATUS_CONFIG = {
  modified:      { label: 'Modified',    dotClass: 'dot-modified',  badgeClass: 'badge-modified'  },
  identical:     { label: 'Identical',   dotClass: 'dot-identical', badgeClass: 'badge-identical' },
  only_in_org_a: { label: 'Only A',      dotClass: 'dot-only-a',    badgeClass: 'badge-only-a'    },
  only_in_org_b: { label: 'Only B',      dotClass: 'dot-only-b',    badgeClass: 'badge-only-b'    },
};

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  allClasses:        [],
  filteredClasses:   [],
  activeFilter:      'all',
  searchQuery:       '',
  selectedClass:     null,
  selectedIndex:     -1,        // index into filteredClasses
  counts:            { all: 0, modified: 0, identical: 0, only_in_org_a: 0, only_in_org_b: 0 },
  monacoReady:       false,
  diffEditor:        null,
  renderSideBySide:  true,
  ignoreWhitespace:  false,
  summary:           null,
  currentDetail:     null,     // last loaded detail (for export)
  dataLoaded:        false,    // true once loadData() has populated allClasses, even if it's empty
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
let domRefs = {};

// ─── Sidebar list virtualization ───────────────────────────────────────────────
// Orgs can easily have 500+ Apex classes. Rendering every row on each
// filter/search/scroll would mean creating hundreds of DOM nodes (plus a
// click listener each) per frame. Instead the list is windowed: rows are
// absolutely positioned at `index * rowHeight`, and only the rows currently
// scrolled into view (+ overscan) are ever in the DOM.
const ROW_OVERSCAN = 6;      // extra rows rendered above/below the viewport
let rowHeight = null;        // px; measured once from a real rendered row
let _scrollRAF = null;
let _resizeRAF = null;

// ─── Preferences (localStorage) ───────────────────────────────────────────────
const PREF_PREFIX = 'apexOrgDiff.';

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
  };

  // The export button downloads a single class from a live backend endpoint
  // that doesn't exist in a static export — hide it rather than let it 404.
  if (EXPORT_DATA && domRefs.btnExport) {
    domRefs.btnExport.style.display = 'none';
  }

  restorePrefs();
  initMonaco();
  initEvents();
  loadData();
});

// Applies saved layout/whitespace/filter/sidebar-width preferences before
// Monaco and the class list exist, so the first render already matches them
// instead of flashing defaults and then snapping to the saved state.
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
    registerApexLanguage();

    state.diffEditor = monaco.editor.createDiffEditor(
      domRefs.monacoContainer,
      {
        theme:                'vs-dark',
        readOnly:             true,
        renderSideBySide:     state.renderSideBySide,
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
    setEditorModels('', '');
  });
}

// ─── Apex Monarch Tokenizer ──────────────────────────────────────────────────
function registerApexLanguage() {
  if (monaco.languages.getLanguages().some(l => l.id === 'apex')) return;

  monaco.languages.register({
    id: 'apex',
    extensions: ['.cls', '.apex', '.trigger', '.page'],
    aliases: ['Apex', 'Salesforce Apex'],
  });

  monaco.languages.setLanguageConfiguration('apex', {
    comments:  { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets:  [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}]*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });

  monaco.languages.setMonarchTokensProvider('apex', {
    defaultToken: '',
    tokenPostfix: '.apex',

    // ── Apex keywords ───────────────────────────────────────────────────
    keywords: [
      'abstract','activate','and','any','array','as','asc','autonomous',
      'begin','bigdecimal','blob','boolean','break','bulk','by',
      'catch','char','class','collect','commit','const','continue',
      'convertcurrency','custom',
      'date','datetime','decimal','default','delete','desc','do','double',
      'else','end','enum','exception','exit','export','extends',
      'false','final','finally','float','for','from',
      'get','global','group','groupby',
      'having','hints','hour',
      'id','if','implements','import','in','inner','insert','instanceof',
      'integer','interface','into',
      'join',
      'last_90_days','last_month','last_n_days','last_week','like',
      'limit','list','long',
      'map','merge','minute','month','multiselect',
      'new','next_month','next_n_days','next_week','not','null','nulls',
      'number',
      'object','of','on','or','order','orderby','outer','override',
      'package','parallel','private','protected','public',
      'readonly','reference','return','returning','rollback',
      'savepoint','search','second','select','set','short','sort','stat',
      'static','string','super','switch',
      'system','testmethod','then','this','time','today','tomorrow',
      'transaction','trigger','true','try','type',
      'undelete','update','upsert','using',
      'virtual','void','webservice','when','where','while',
      'with','without','yesterday',
    ],

    // ── SOQL / DML keywords (highlighted differently) ──────────────────
    soqlKeywords: [
      'SELECT','FROM','WHERE','AND','OR','NOT','IN','LIKE','NULL',
      'ORDER','BY','ASC','DESC','LIMIT','OFFSET','GROUP','HAVING',
      'COUNT','SUM','MIN','MAX','AVG','COUNT_DISTINCT',
      'ROLLUP','CUBE','GROUPING','TYPEOF','USING SCOPE',
      'UPDATE TRACKING','UPDATE VIEWSTAT',
      'WITH DATA CATEGORY','WITH SECURITY_ENFORCED',
      'FOR VIEW','FOR REFERENCE','FOR UPDATE',
      'INCLUDES','EXCLUDES',
      'LAST_N_DAYS','NEXT_N_DAYS','LAST_MONTH','NEXT_MONTH',
      'LAST_N_MONTHS','NEXT_N_MONTHS','LAST_90_DAYS','NEXT_90_DAYS',
      'LAST_WEEK','NEXT_WEEK','THIS_WEEK','THIS_MONTH','THIS_QUARTER',
      'LAST_QUARTER','NEXT_QUARTER','THIS_YEAR','LAST_YEAR','NEXT_YEAR',
      'TODAY','TOMORROW','YESTERDAY',
    ],

    // ── Annotations ────────────────────────────────────────────────────
    annotations: [
      'AuraEnabled','Deprecated','Future','HttpDelete','HttpGet',
      'HttpPatch','HttpPost','HttpPut','InvocableMethod','InvocableVariable',
      'IsTest','JsonAccess','NamespaceAccessible','ReadOnly',
      'RemoteAction','RestResource','SuppressWarnings','TestSetup',
      'TestVisible','isTest',
    ],

    // ── Apex built-in types ────────────────────────────────────────────
    typeKeywords: [
      'Account','Contact','Lead','Opportunity','Case','User',
      'Schema','Database','System','Math','String','Integer','Long',
      'Double','Decimal','Boolean','Date','DateTime','Time','Id',
      'Blob','List','Set','Map','SObject','Type','Exception',
      'ApexPages','PageReference','SelectOption',
    ],

    operators: [
      '=', '>', '<', '!', '~', '?', ':',
      '==', '<=', '>=', '!=', '<>', '&&', '||',
      '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
      '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
      '%=', '<<=', '>>=', '>>>=',
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"'0-9xu])/,

    tokenizer: {
      root: [
        // Annotations
        [/@[a-zA-Z_]\w*/, {
          cases: {
            '@annotations': 'annotation',
            '@default':     'annotation',
          }
        }],

        // SOQL inside square brackets [SELECT ...]
        [/\[/, { token: 'soql.bracket', bracket: '@open', next: '@soql' }],

        // Identifiers and keywords
        [/[a-zA-Z_$][\w$]*/, {
          cases: {
            '@keywords':     'keyword',
            '@typeKeywords': 'type',
            'true|false':    'constant.language',
            'null':          'constant.language',
            '@default':      'identifier',
          }
        }],

        // Whitespace
        { include: '@whitespace' },

        // Delimiters and operators
        [/[{}()\[\]]/, '@brackets'],
        [/[<>](?!@symbols)/, '@brackets'],
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default':   '',
          }
        }],

        // Numbers
        [/\d*\.\d+([eE][\-+]?\d+)?[fFdDlL]?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+[lL]?/,            'number.hex'],
        [/\d+[lL]?/,                           'number'],

        // Delimiters
        [/[;,.]/, 'delimiter'],

        // Strings
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/'/, 'string', '@string_single'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_double'],
      ],

      // ── SOQL block ──────────────────────────────────────────────────
      soql: [
        [/\]/, { token: 'soql.bracket', bracket: '@close', next: '@pop' }],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@soqlKeywords': 'soql.keyword',
            '@default':      'soql.identifier',
          }
        }],
        [/\d+/, 'number'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/[,.:()]/, 'delimiter'],
        { include: '@whitespace' },
      ],

      // ── Strings ──────────────────────────────────────────────────────
      string_single: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, 'string', '@pop'],
      ],
      string_double: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop'],
      ],

      // ── Whitespace & comments ────────────────────────────────────────
      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],
      comment: [
        [/[^\/*]+/, 'comment'],
        [/\/\*/, 'comment', '@push'],
        [/\*\//, 'comment', '@pop'],
        [/[\/*]/, 'comment'],
      ],
    },
  });
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

  // Class list: one delegated click handler instead of one listener per row
  // (rows are re-created on every scroll/filter, so per-row listeners would
  // mean constantly attaching/detaching hundreds of them).
  domRefs.classList.addEventListener('click', e => {
    const btn = e.target.closest('.class-item');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    const cls = state.filteredClasses[idx];
    if (!cls) return;
    state.selectedIndex = idx;
    selectClass(cls, idx);
  });

  // Re-render the visible window as the list scrolls (rAF-throttled so a
  // fast scroll doesn't queue up more re-renders than frames).
  domRefs.classListWrapper.addEventListener('scroll', () => {
    if (_scrollRAF) return;
    _scrollRAF = requestAnimationFrame(() => {
      _scrollRAF = null;
      renderVisibleWindow();
    });
  });

  // The viewport row-count depends on the wrapper's height, which changes
  // if the browser window is resized.
  window.addEventListener('resize', () => {
    if (_resizeRAF) return;
    _resizeRAF = requestAnimationFrame(() => {
      _resizeRAF = null;
      renderVisibleWindow();
    });
  });

  // Keyboard navigation in sidebar
  document.addEventListener('keydown', handleKeyboardNav);

  // Toolbar buttons
  domRefs.btnPrevDiff.addEventListener('click', jumpToPrevDiff);
  domRefs.btnNextDiff.addEventListener('click', jumpToNextDiff);
  domRefs.btnToggleLayout.addEventListener('click', toggleLayout);
  domRefs.btnToggleWs.addEventListener('click', toggleWhitespace);
  domRefs.btnExport.addEventListener('click', exportDiff);

  // Keyboard shortcuts help modal
  domRefs.btnShortcuts.addEventListener('click', openShortcuts);
  domRefs.btnShortcutsClose.addEventListener('click', closeShortcuts);
  domRefs.shortcutsOverlay.addEventListener('click', e => {
    if (e.target === domRefs.shortcutsOverlay) closeShortcuts();
  });

  // Click-to-copy org path badges
  initCopyPathHandlers();

  // Resize handle
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
  // Diff-hunk navigation is checked first because it should work even while
  // Monaco's hidden <textarea> has focus (which the input-focus guard below
  // would otherwise treat as "typing" and ignore).
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
    if (document.activeElement === domRefs.searchInput && state.searchQuery) {
      domRefs.searchInput.value = '';
      state.searchQuery = '';
      applyFilters();
      return;
    }
  }

  // Only when not focused on a text input (other than the class list area)
  const focused = document.activeElement;
  const isTyping = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');

  if (e.key === '?' && !isTyping) {
    e.preventDefault();
    openShortcuts();
    return;
  }

  if (isTyping) return;

  const len = state.filteredClasses.length;
  if (len === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = Math.min(state.selectedIndex + 1, len - 1);
    selectClassByIndex(next);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = Math.max(state.selectedIndex - 1, 0);
    selectClassByIndex(prev);
  } else if (e.key === 'Enter' && state.selectedIndex >= 0) {
    e.preventDefault();
    selectClass(state.filteredClasses[state.selectedIndex], state.selectedIndex);
  } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
    // Ctrl+F → focus search
    e.preventDefault();
    domRefs.searchInput.focus();
    domRefs.searchInput.select();
  }
}

function selectClassByIndex(idx) {
  if (idx < 0 || idx >= state.filteredClasses.length) return;
  state.selectedIndex = idx;
  selectClass(state.filteredClasses[idx], idx);
  scrollRowIntoView(idx);
}

// Row `idx` may not currently be rendered (virtualized list), so this can't
// rely on scrollIntoView against a DOM node — it scrolls the wrapper
// directly using the row's computed offset, same "nearest" behaviour as
// scrollIntoView({ block: 'nearest' }).
function scrollRowIntoView(idx) {
  if (rowHeight === null) return;
  const wrapper  = domRefs.classListWrapper;
  const rowTop    = idx * rowHeight;
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

// Icon markup for the layout toggle's two states (side-by-side vs inline),
// swapped into the button alongside its label — see renderLayoutButton.
const ICON_LAYOUT_SPLIT =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<rect x="1" y="1.5" width="4.3" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
  '<rect x="6.7" y="1.5" width="4.3" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>';
const ICON_LAYOUT_INLINE =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<rect x="1" y="1.5" width="10" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
  '<path d="M1 6h10" stroke="currentColor" stroke-width="1"/></svg>';

// Button shows the icon/label for the mode a click will switch *to* (so
// "Inline" + inline icon while currently side-by-side, and vice versa).
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
// The report is rendered server-side and returned with a Content-Disposition
// header so the browser's normal download handling takes over. A client-side
// Blob + synthetic <a download> click is unreliable for HTML content in some
// browsers — the filename/extension can get dropped and the saved file ends
// up with a random name that nothing knows how to open.
function exportDiff() {
  if (EXPORT_DATA) return; // no backend to hit in a static export; button is hidden
  const detail = state.currentDetail;
  if (!detail) {
    showError('No class loaded yet — wait for the diff to appear, then try again.');
    return;
  }
  window.location.href = `${API_BASE}/api/classes/${encodeURIComponent(detail.name)}/export`;
}



// ─── Data Loading ─────────────────────────────────────────────────────────────
// For a large org the backend scans both folders on a background thread
// (see apex_diff.py / backend.api._readiness_gate) so the page loads
// immediately instead of the browser hanging on a blank tab. While that
// scan is still running, /api/* returns 503 with {status: "building"} —
// treat that as "not ready yet", not an error, and poll until it flips.
let _buildRetryNotified = false;
let _buildRetryTimer = null;

async function loadData() {
  try {
    let summary, classes;

    if (EXPORT_DATA) {
      summary = EXPORT_DATA.summary;
      classes = EXPORT_DATA.classes;
    } else {
      const [summaryRes, classesRes] = await Promise.all([
        fetch(`${API_BASE}/api/summary`),
        fetch(`${API_BASE}/api/classes`),
      ]);

      if (summaryRes.status === 503 || classesRes.status === 503) {
        if (!_buildRetryNotified) {
          _buildRetryNotified = true;
          showToast('Scanning both orgs — this can take a moment for large ones. Page will update automatically.', 'info');
        }
        clearTimeout(_buildRetryTimer);
        _buildRetryTimer = setTimeout(loadData, 1000);
        return;
      }

      if (!summaryRes.ok) throw new Error(`Summary API error: ${summaryRes.status}`);
      if (!classesRes.ok) throw new Error(`Classes API error: ${classesRes.status}`);

      summary = await summaryRes.json();
      classes = await classesRes.json();
    }

    state.summary = summary;

    // Paths
    if (domRefs.orgAPath) {
      domRefs.orgAPath.textContent = summary.org_a_path || 'Org A';
      domRefs.orgAPath.title       = summary.org_a_path || '';
    }
    if (domRefs.orgBPath) {
      domRefs.orgBPath.textContent = summary.org_b_path || 'Org B';
      domRefs.orgBPath.title       = summary.org_b_path || '';
    }

    // Counts
    state.counts = {
      all:           summary.total,
      modified:      summary.modified,
      identical:     summary.identical,
      only_in_org_a: summary.only_in_org_a,
      only_in_org_b: summary.only_in_org_b,
    };

    updateCountBadges();
    renderDuplicatesWarning(summary);

    state.allClasses = classes;
    state.dataLoaded = true;
    applyFilters();

    // Deep link: ?class=Name.cls re-selects the same class after a reload
    // or a shared link. Falls back to the first modified class, then the
    // first class overall, when there's no match or no param.
    const wantedName = new URLSearchParams(window.location.search).get('class');
    const wanted     = wantedName && classes.find(c => c.name.toLowerCase() === wantedName.toLowerCase());
    const autoSelect = wanted || classes.find(c => c.status === 'modified') || classes[0];
    if (autoSelect) {
      const idx = state.filteredClasses.findIndex(c => c.name === autoSelect.name);
      if (idx >= 0) selectClassByIndex(idx);
    } else if (domRefs.welcomeState) {
      const sub = domRefs.welcomeState.querySelector('#welcome-sub');
      if (sub) sub.textContent = 'No .cls files found in either org folder.';
    }

  } catch (err) {
    showError(`Failed to load class list: ${err.message}`);
  }
}

function updateCountBadges() {
  domRefs.countAll.textContent       = state.counts.all;
  domRefs.countModified.textContent  = state.counts.modified;
  domRefs.countIdentical.textContent = state.counts.identical;
  domRefs.countOnlyA.textContent     = state.counts.only_in_org_a;
  domRefs.countOnlyB.textContent     = state.counts.only_in_org_b;
}

// Classes with the same filename in two different subfolders of one org can
// only be indexed once — the rest are silently dropped by the scanner. Warn
// so the user knows a comparison might not be against the file they expect,
// instead of finding out the hard way.
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

  console.warn('[ApexDiff] Duplicate .cls filenames ignored:', dupes);
}

// ─── Filter & Render ─────────────────────────────────────────────────────────
function applyFilters() {
  // Nothing has loaded yet (e.g. a saved filter is applied before the
  // initial fetch resolves) — leave the "Loading…" footer alone rather
  // than flashing a misleading "0 classes". Gated on dataLoaded rather than
  // allClasses.length so a genuinely empty comparison (both orgs have zero
  // .cls files) still renders the empty state instead of hanging on
  // "Loading…" forever.
  if (!state.dataLoaded) return;

  let filtered = state.allClasses;

  if (state.activeFilter !== 'all') {
    filtered = filtered.filter(c => c.status === state.activeFilter);
  }
  if (state.searchQuery) {
    filtered = filtered.filter(c => c.name.toLowerCase().includes(state.searchQuery));
  }

  // Sort: modified first, then only_a, only_b, identical; then alpha
  const ORDER = { modified: 0, only_in_org_a: 1, only_in_org_b: 2, identical: 3 };
  filtered.sort((a, b) => {
    const oa = ORDER[a.status] ?? 99;
    const ob = ORDER[b.status] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });

  state.filteredClasses = filtered;

  // Recompute selected index
  if (state.selectedClass) {
    state.selectedIndex = filtered.findIndex(c => c.name === state.selectedClass.name);
  }

  renderClassList(filtered);
}

function renderClassList(classes) {
  if (rowHeight === null) rowHeight = measureRowHeight();

  if (classes.length === 0) {
    domRefs.noResults.style.display  = 'block';
    domRefs.sidebarFooter.textContent = '0 classes';
    domRefs.classList.innerHTML = '';
    domRefs.classList.style.height = '0px';
    return;
  }

  domRefs.noResults.style.display  = 'none';
  domRefs.sidebarFooter.textContent = `${classes.length} class${classes.length !== 1 ? 'es' : ''}`;

  // The result set just changed (new filter/search) — start back at the top
  // rather than preserving a scroll position that no longer means anything.
  domRefs.classListWrapper.scrollTop = 0;
  renderVisibleWindow();
}

// Builds one row. Shared by the row-height probe and the real windowed
// render so both produce identical markup.
function buildClassItemEl(cls, idx) {
  const cfg     = STATUS_CONFIG[cls.status] || STATUS_CONFIG.identical;
  const isActive = state.selectedClass?.name === cls.name;
  const stats   = cls.diff_stats || { lines_added: 0, lines_removed: 0 };

  // Build stat pill only for non-identical
  let statHtml = '';
  if (cls.status === 'modified') {
    statHtml = `<span class="stat-pill">
      <span class="stat-add">+${stats.lines_added}</span>
      <span class="stat-del">−${stats.lines_removed}</span>
    </span>`;
  } else if (cls.status === 'only_in_org_b') {
    statHtml = `<span class="stat-pill"><span class="stat-add">+${stats.lines_added}</span></span>`;
  } else if (cls.status === 'only_in_org_a') {
    statHtml = `<span class="stat-pill"><span class="stat-del">−${stats.lines_removed}</span></span>`;
  }

  const btn = document.createElement('button');
  btn.className  = 'class-item' + (isActive ? ' active' : '');
  btn.dataset.name  = cls.name;
  btn.dataset.index = idx;
  btn.title      = cls.has_error ? `${cls.name} — one or more files could not be read` : cls.name;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  btn.innerHTML  = `
    <span class="class-item-dot ${cfg.dotClass}"></span>
    <span class="class-item-name">${highlightMatch(cls.name)}</span>
    ${cls.has_error ? '<span class="err-flag" title="Could not read one of the files — open to see details">⚠</span>' : ''}
    ${statHtml}
  `;
  return btn;
}

// Renders only the rows currently scrolled into view (+ overscan) as
// absolutely-positioned children of #class-list, whose own height is set to
// the full list's height so the wrapper's scrollbar behaves normally.
function renderVisibleWindow() {
  const wrapper  = domRefs.classListWrapper;
  const list     = domRefs.classList;
  const classes  = state.filteredClasses;
  const total    = classes.length;

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
  for (let idx = start; idx < end; idx++) {
    const el = buildClassItemEl(classes[idx], idx);
    el.style.top = (idx * rowHeight) + 'px';
    frag.appendChild(el);
  }

  list.innerHTML = '';
  list.appendChild(frag);
}

// Renders one throwaway row off-screen to read its real height (padding +
// font metrics), so row positioning stays correct if the CSS ever changes
// instead of relying on a hardcoded pixel value.
function measureRowHeight() {
  const probe = buildClassItemEl(
    { name: 'Probe.cls', status: 'identical', diff_stats: {} },
    0
  );
  probe.style.visibility = 'hidden';
  probe.style.top = '0px';
  domRefs.classList.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  // +1px reproduces the 1px row gap the previous flex layout had.
  return Math.max(1, Math.ceil(h)) + 1;
}

// ─── Class Selection & Editor Update ─────────────────────────────────────────
let _selectRequestId = 0;

async function selectClass(cls, idx) {
  // currentDetail must belong to *this* class, not just be non-null — after a
  // failed load it still holds whatever the previously-selected class loaded,
  // which would otherwise make re-clicking the failed class a silent no-op.
  if (state.selectedClass?.name === cls.name && state.currentDetail?.name === cls.name) return;

  // Guard against out-of-order responses: if the user picks another class
  // before this fetch resolves, a stale response must not overwrite it.
  const requestId = ++_selectRequestId;

  state.selectedClass  = cls;
  state.selectedIndex  = idx ?? state.filteredClasses.indexOf(cls);

  // Deep-linkable URL + tab title, so a reload or a shared link lands back
  // on the same class.
  const url = new URL(window.location.href);
  url.searchParams.set('class', cls.name);
  history.replaceState(null, '', url);
  document.title = `${cls.name} — Apex Org Diff`;

  // Update active styling
  $$('.class-item').forEach(el => {
    const isActive = el.dataset.name === cls.name;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  updateEditorHeader(cls);
  showLoading(true);
  hideWelcome();

  try {
    let detail;
    if (EXPORT_DATA) {
      detail = EXPORT_DATA.details[cls.name];
      if (!detail) throw new Error('No embedded data for this class in the export');
    } else {
      const res = await fetch(`${API_BASE}/api/classes/${encodeURIComponent(cls.name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      detail = await res.json();
    }
    if (requestId !== _selectRequestId) return; // a newer selection has since started
    state.currentDetail = detail;
    displayDiff(detail);
  } catch (err) {
    if (requestId !== _selectRequestId) return;
    showError(`Could not load '${cls.name}': ${err.message}`);
    showWelcome();
  } finally {
    if (requestId === _selectRequestId) showLoading(false);
  }
}

function updateEditorHeader(cls) {
  const cfg = STATUS_CONFIG[cls.status] || STATUS_CONFIG.identical;
  domRefs.editorFileName.textContent    = cls.name;
  domRefs.editorStatusBadge.textContent = cfg.label;
  domRefs.editorStatusBadge.className   = `class-item-badge ${cfg.badgeClass}`;

  // Column notes
  if (cls.status === 'only_in_org_a') {
    domRefs.colNoteA.textContent = '';
    domRefs.colNoteB.textContent = '(not present)';
  } else if (cls.status === 'only_in_org_b') {
    domRefs.colNoteA.textContent = '(not present)';
    domRefs.colNoteB.textContent = '';
  } else {
    domRefs.colNoteA.textContent = '';
    domRefs.colNoteB.textContent = '';
  }

  // Show / hide toolbar nav buttons
  const showNav = cls.status === 'modified';
  domRefs.btnPrevDiff.style.display   = showNav ? '' : 'none';
  domRefs.btnNextDiff.style.display   = showNav ? '' : 'none';
}

function displayDiff(detail) {
  if (!state.monacoReady || !state.diffEditor) {
    setTimeout(() => displayDiff(detail), 100);
    return;
  }

  const contentA = detail.org_a?.content ?? '';
  const contentB = detail.org_b?.content ?? '';

  setEditorModels(contentA, contentB);

  const linesA  = contentA ? contentA.split('\n').length : 0;
  const linesB  = contentB ? contentB.split('\n').length : 0;
  const stats   = detail.diff_stats || { lines_added: 0, lines_removed: 0 };

  let statsHtml = '';
  if (detail.status === 'modified') {
    statsHtml = `<span class="info-added">+${stats.lines_added}</span><span class="info-removed">−${stats.lines_removed}</span>`;
  }

  domRefs.editorInfo.innerHTML = `
    <span>Org A: ${linesA.toLocaleString()} lines</span>
    <span>Org B: ${linesB.toLocaleString()} lines</span>
    ${statsHtml}
  `;

  // A file that couldn't be read (permission/OS error) shows up as empty
  // content with no other indication — surface it instead of letting it
  // silently look like an empty or missing file.
  const errA = detail.org_a?.error || null;
  const errB = detail.org_b?.error || null;
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
    showError(`Could not fully read '${detail.name}' — ${parts.join(' | ')}`);
  }
}

function setEditorModels(contentA, contentB) {
  const existing = state.diffEditor.getModel();
  if (existing) {
    if (existing.original && !existing.original.isDisposed()) existing.original.dispose();
    if (existing.modified && !existing.modified.isDisposed()) existing.modified.dispose();
  }
  state.diffEditor.setModel({
    original: monaco.editor.createModel(contentA, 'apex'),
    modified: monaco.editor.createModel(contentB, 'apex'),
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
  if (type === 'error') console.error('[ApexDiff]', msg);
}

function showError(msg) { showToast(msg, 'error'); }

// Wraps the first case-insensitive match of the current search query in
// <mark>, HTML-escaping every segment so the query itself can't inject markup.
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
