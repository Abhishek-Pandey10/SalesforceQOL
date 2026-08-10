# SF Dependency Graph

An **Obsidian-style dependency graph** for one Salesforce org folder: pick an
Apex class (or an LWC component), see everything that references it and
everything it references, understand *how* (method call, `new`, `extends`,
an LWC `@wire`d Apex method vs. an imperative call, LWC-to-LWC composition),
and use that to gauge **blast radius** before you change or delete it.

It's the third tool in this repo, alongside
[`apex-org-diff`](../apex-org-diff) and [`lwc-org-diff`](../lwc-org-diff) -
but where those two *diff* two orgs, this one *maps* a single org.

---

## Why

"What breaks if I change this class?" is normally answered by grepping the
codebase and hoping you didn't miss a caller, or by a full deploy/test cycle.
This tool builds the reference graph once, up front, so the answer is a
click away: select a class, click **Focus blast radius**, and see every
class/component within N hops - color-coded by how they're connected, with
the exact file:line and calling method for every edge on hover.

---

## How it works

There is no lightweight Apex AST parser available, so this uses **regex +
brace-depth heuristics** over the raw text, not a real compiler front-end -
consistent with this repo's other tools, which also work directly on text
rather than parsing Salesforce metadata formally.

### Apex (`backend/apex_parser.py`)

1. String literals and comments are blanked out (same length, same line
   breaks) so they can't produce false matches.
2. The file's top-level `class`/`interface`/`trigger` declaration is
   extracted, including `extends`/`implements`.
3. One brace-depth pass finds every method's `{...}` span and name, so any
   reference found inside it is attributed to `callerMethod()`.
4. Every whole-org class/interface/trigger name is then looked for as a
   token in the file; what immediately precedes/follows a match decides the
   reference kind:

   | Pattern | Kind |
   |---|---|
   | `new X(` | `instantiation` |
   | `X.member(` | `static_call` (captures the member name) |
   | `X.member` (no call) | `field_access` |
   | `extends X` / `implements X` | `extends` / `implements` |
   | `instanceof X` | `instanceof` |
   | anything else (a bare type use) | `type_reference` |

### LWC (`backend/lwc_parser.py`)

- `import ALIAS from '@salesforce/apex/Class.method'` → an edge to that
  Apex class. The rest of the file is checked for how `ALIAS` is actually
  used: `@wire(ALIAS` → `apex_wire`, `ALIAS(` elsewhere → `apex_imperative`,
  neither → `apex_unused_import` (a dead-import signal, still useful for
  blast radius).
- `import ALIAS from 'c/childBundle'` → an LWC-to-LWC edge.
- `<c-child-name>` in the `.html` template → a `composition` edge (this
  component renders that one).

### Known limitations

This is textual pattern matching, not semantic analysis. It will not
resolve: method overloads, polymorphic dispatch, dynamic
`Type.forName`/reflection, fully-qualified managed-package names, or
anything constructed at runtime from a string. It only sees direct,
literal references to classes/components that exist in the scanned folder.
References to names it can't resolve (standard/managed-package classes,
sObjects, `new` on something outside the org) are counted and surfaced as
`unresolved_reference_count` in the summary, but don't become graph edges.

---

## Prerequisites

- Python **3.9+**
- Internet access (vis-network is loaded from CDN)

## Installation

```bash
cd sf-dependency-graph
pip install -r requirements.txt
```

## Usage

```bash
python sf_dependency_graph.py <org_folder>
```

Then open **http://localhost:8020**. (Port differs from apex-org-diff's
8000 and lwc-org-diff's 8010 so all three can run side by side.)

```
usage: sf_dependency_graph [-h] [--focus NAME] [--port PORT] [--host HOST] [--no-browser] ORG_FOLDER

positional arguments:
  ORG_FOLDER      Folder containing Apex classes/triggers and/or LWC components (searched recursively)

options:
  --focus NAME    Class or component name to open directly into its blast-radius view
  --port PORT     Port to run the local web server on (default: 8020)
  --host HOST     Host address to bind (default: 127.0.0.1)
  --no-browser    Do not open the browser automatically after starting
```

### Examples

```bash
# Try it on the bundled demo fixture (see below)
python sf_dependency_graph.py fixture_org

# Point at a real org export, jump straight into one class's blast radius
python sf_dependency_graph.py /path/to/org/force-app/main/default --focus AccountController

python sf_dependency_graph.py ../samples/org1 --port 9020 --no-browser
```

### Demo fixture

`samples/org1` (shared with the other two tools) has no cross-references
between its classes, so it wouldn't show much of a graph. This tool ships
its own fixture instead:

```bash
python scripts/create_fixture_org.py     # generates fixture_org/
python sf_dependency_graph.py fixture_org
```

`fixture_org` deliberately exercises every edge kind the parsers detect
(`extends`, `implements`, `instanceof`, instantiation, static calls, a field
access, `@wire`, an imperative Apex call, an unused import, and LWC-to-LWC
composition), plus one isolated class with no connections at all.

---

## Using the graph

- **Sidebar**: search by name, filter by type (Class/Interface/Trigger/LWC),
  click a row to select a node.
- **Canvas**: a force-directed graph (drag nodes, scroll to zoom). Node size
  scales with how connected it is; node color shows its type; edge color
  shows the reference kind (see the in-app legend).
- **Hover an edge** to see why it exists - the calling method, the LWC
  import alias, the exact file:line, up to a few occurrences.
- **Click an edge** for the full occurrence list.
- **Click a node** to open its detail panel: full "Depends on" / "Used by"
  lists, then **Focus blast radius** to re-render the graph limited to N
  hops (1/2/3/All) in either or both directions.
- **Export** downloads the current view (full graph or the current focus)
  as a self-contained HTML file - the same rendering code runs against the
  embedded data, so it's fully interactive offline, no server needed to
  reopen it.

---

## REST API

### `GET /api/summary`

Node/edge counts by type.

### `GET /api/graph?types=&q=`

Full node + edge list. `types` is a comma-separated subset of
`apex_class,apex_interface,apex_trigger,lwc_component`; `q` filters by name
substring. Each edge embeds up to 5 occurrences by default (`truncated:
true` if there are more - fetch `/api/edges/{source}/{target}` for the rest).

### `GET /api/nodes/{name}`

One node's metadata plus its full `depends_on` / `used_by` edge lists.

### `GET /api/nodes/{name}/blast-radius?depth=N&direction=both|upstream|downstream`

The induced subgraph within `depth` hops of `name` (`depth=all` for the
whole connected component). `upstream` = who depends on this node,
`downstream` = what this node depends on.

### `GET /api/edges/{source}/{target}`

Full (untruncated) occurrence list for one edge.

### `GET /api/nodes/{name}/export` · `GET /api/export`

Standalone HTML download of one node's blast radius, or the whole graph.

---

## Project structure

```
sf-dependency-graph/
│
├── sf_dependency_graph.py     ← Entry point (CLI + server startup)
│
├── backend/
│   ├── models.py               ← GraphNode / GraphEdge / Occurrence / GraphSummary
│   ├── apex_parser.py          ← Heuristic Apex reference extraction
│   ├── lwc_parser.py           ← Heuristic LWC reference extraction
│   ├── graph_builder.py        ← Discovery, symbol table, edge assembly, blast-radius BFS
│   ├── api.py                  ← FastAPI routes
│   └── export.py               ← Standalone HTML export (reuses the live frontend)
│
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js                  ← vis-network rendering + client-side blast-radius BFS
│
├── scripts/
│   ├── create_fixture_org.py   ← Generates fixture_org/ (this tool's own demo data)
│   ├── test_backend.py         ← Integration test against fixture_org
│   └── check_stats.py          ← Prints node/edge counts + top-N by blast radius
│
├── requirements.txt
└── README.md
```

### Development scripts

```bash
python scripts/create_fixture_org.py          # (re)generate fixture_org/
python scripts/test_backend.py                # exercises the parsers + graph builder end-to-end
python scripts/check_stats.py [org_folder]     # node/edge stats, defaults to fixture_org
python sf_dependency_graph.py fixture_org      # try it in the browser
```

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `ModuleNotFoundError: fastapi` | Run `pip install -r requirements.txt` |
| Port already in use | Use `--port 9020` (or any free port) |
| Graph is empty / mostly isolated nodes | Your org genuinely may not have much cross-referencing in the scanned folder, or the parser missed a pattern (see Known limitations above) - check `unresolved_reference_count` in `/api/summary` |
| vis-network graph blank | Check internet connection (vis-network loads from CDN) |
| An edge you expect is missing | The parser only matches direct textual references; dynamically-constructed type names, reflection, and managed-package classes aren't resolved |

---

## License

MIT — free for personal and commercial use.
