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
   extracted, including `extends`/`implements` - and so is every
   class/interface/enum **nested** inside it, at any depth (see "Nested
   classes" below).
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

   A call to a method on the enclosing class *itself* - written without a
   receiver (`checkPermission(x)`) or with an explicit `this.`
   (`this.checkPermission(x)`) - is resolved separately, against that
   class's own declared method names rather than the whole-org symbol
   table (kind `self_call`). It only ever produces a method-level edge, not
   a class-level one (a class referencing itself at the class level would
   just be noise - every class textually mentions its own name constantly).
   Scoped to methods declared directly on the class: a bare/`this.`-qualified
   call to a method only *inherited* from a superclass isn't resolved, and
   dispatch through `this` is always resolved to this exact class's own
   method, without the polymorphic fan-out an explicit variable of a
   declared type gets (see "Polymorphic dispatch" below) - a subclass
   instance's inherited base-class code calling `this.someVirtualMethod()`
   really would dispatch to that subclass's override at runtime, which this
   parser doesn't attempt to model for the implicit-`this` case.

   An explicit `super.method(x)` call is resolved separately, directly
   against the class's own `extends` target (kind `instance_call`, no
   polymorphic fan-out - `super.x()` always calls the exact base
   implementation, never a further override further down the hierarchy).
   And a *nested* type's bare call to its *enclosing* type's method
   (`helper()` instead of `Outer.helper()` - legal Apex, a nested class can
   reach its enclosing type's static members unqualified) resolves the same
   way `self_call` does, one lexical scope out (kind `static_call`, targeting
   the enclosing type).

### Nested classes

A class/interface/enum declared *inside* another one - the common
`@AuraEnabled` controller returning an inner DTO/wrapper class pattern -
gets its own node (`Outer.Inner`, with `Outer.Inner.Deeper` for further
nesting), its own method nodes, and its own scoped scan, exactly like a
top-level type: same-class-call resolution, dead-code detection, and
blast radius all work on it independently. Two lookup forms resolve it:
the qualified one (`Outer.Inner`, always registered, unambiguous) and the
bare one (`Inner`, the common same-outer-class reference). The bare form is
resolved per-file: the file being scanned always sees its own nested types'
bare names first, shadowing anything else registered under that name
elsewhere, so `AlphaContainer` and `BetaContainer` can each declare their
own nested `Info` and each one's own `new Info()` correctly resolves to its
own `Info`, never the other's. Only a *cross-file* bare reference (file X
writing an unqualified `Info` that means file Y's nested class) still falls
back to one shared, first-occurrence-wins global guess - a real but
narrower gap than a flat global table would have, and one that only bites
on Apex that wouldn't compile in the first place (an unqualified nested-type
reference is only legal within the declaring class's own lexical scope; any
other file has to spell out `Outer.Inner`). `new Outer.Inner(...)` and a
bare `Outer.Inner` type mention (e.g. a return type) both resolve to the
nested type, not - as they used to - to the outer class itself.

Each type's own scan is deliberately blanked over its direct children's
body ranges (see `apex_parser.blank_ranges`) so a nested type's internal
references aren't also picked up - and misattributed to the outer class -
by the outer type's own scan; that nested type gets its own separate,
correctly-scoped scan instead.

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
resolve dynamic `Type.forName`/reflection, fully-qualified managed-package
names, or anything else constructed at runtime from a string. It only sees
direct, literal references to classes/components that exist in the scanned
folder. References to names it can't resolve (standard/managed-package
classes, sObjects, `new` on something outside the org) are counted and
surfaced as `unresolved_reference_count` in the summary, but don't become
graph edges. Overloads and polymorphism get a best-effort treatment (below)
rather than being silently wrong.

`@isTest` classes (and legacy `testMethod`-modifier methods) are excluded
from the default graph, summary counts, and blast-radius traversal - pass
`include_test=1` to `/api/graph` and `/api/nodes/{name}/blast-radius`, or
check "Include test classes" in the UI, to bring them back. Without this,
a shared `TestDataFactory` (or similar fixture helper) that every test
class calls tends to dominate the graph's in-degree and drowns out the
production coupling that's usually the actual point of looking.

The default graph/`depends_on`/`used_by` views are still **class-level**:
an edge from `A` to `B` means some method in `A` references something in
`B`, not that every method in `A` does - so a naive 2+ hop reading ("A
touches B, B touches C, therefore A touches C") can be wrong if the method
of `A` that calls into `B` isn't the one that leads to `C`.

There is now a **method-level graph** underneath that resolves this for
real, built from the same parse (including calls made *through* a local
variable/field, e.g. `helper.formatDate()`, not just literal
`ClassName.method()` calls - see `_build_local_type_map` in
`apex_parser.py`). `get_node_detail()` exposes a class's methods; focusing
`blast_radius`/`/api/nodes/{name}/blast-radius` on a method id
(`apex:class::method`) traverses the precise call graph instead of the
class-level approximation. Focusing on a **class**, blast_radius also
annotates every multi-hop result node with `verified`: `true` if a real
method-to-method call chain (seeded from that class's own methods) actually
reaches it, `false` if it's only connected via the coarser class-level
edges - the "Verify chain" button in the UI's focus panel surfaces this for
a currently-shown blast radius. `verified` is only computed for a class
focus (methods are already exact; interfaces/triggers/LWC don't have parsed
method bodies to seed from, so it's omitted there rather than guessed at).

**Overloads** are kept as separate method nodes when they differ by
parameter *count* (`foo(Id)` vs `foo(Id, Boolean)` are two distinct
`apex:class::foo!1` / `apex:class::foo!2` nodes - `!` rather than `/` since
node ids are used as URL path segments), and a call site is
matched to the right one by counting its own arguments. Two overloads with
the same arity but different parameter *types* still collapse onto one
node - telling those apart needs real type resolution, which this parser
doesn't do.

**Polymorphic dispatch** gets a sound-but-approximate treatment: a call
made *through* a variable/field/param (`item.describe()`, not the literal
`ClassName.method()` form, since only instance methods can be
`virtual`/`override` in Apex) is resolved against its declared type as
usual, but also fans out - because the object handed in at runtime could be
any of several concrete types:

- If the declared type is a **class**, the fan-out covers every subclass in
  the org that declares its own `override` of that method (a subclass that
  doesn't override just inherits the base's method, so there's no
  divergence to report for it). These edges are kind `possible_override`
  (orange in the UI).
- If the declared type is an **interface**, the fan-out covers every class
  that implements it (directly, or by extending a class that does) -
  interface methods have no default body in Apex, so *every* implementer is
  a candidate, not just ones that would otherwise be flagged `override`.
  These edges are kind `possible_implementation` (a distinct amber in the
  UI, so the two kinds of uncertainty - "maybe this override" vs. "maybe
  this implementation" - stay visually distinguishable).

Both kinds never count toward `verified`, since they're speculative by
construction: the fan-out happens for every candidate regardless of whether
that specific call site could actually receive that concrete type. A call
whose target method can't be pinned down at all (dynamic dispatch through
something other than a known org type, a method not found anywhere in the
hierarchy) stays class-level-only rather than guessing. Treat
`verified: false` as "not proven", not "definitely doesn't happen."

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
- **Dead code** opens a panel listing Apex methods with no callers found
  anywhere in the scanned org - see "Dead code detection" below.

---

## Dead code detection

The method-level call graph described above (the same one blast-radius
`verified` uses) is also what dead-code detection walks. This is a real
mark-and-sweep, not just a per-method in-degree lookup: starting from a set
of *live roots* (every known entry point below, every `@isTest` method, and
every method called from a non-method source like an LWC or a field
initializer), it follows the call graph outward and marks everything it
reaches. Anything never reached - even a method with a nonzero *local*
in-degree, if its only caller(s) are themselves unreachable - is a plausible
delete candidate.

Click **Dead code** in the header for two lists:

- **Dead code candidates** - unreachable at all, from anything live -
  neither a production nor a test code path ever calls this method,
  directly or transitively.
- **Test-only usage** - reachable, but only by passing through at least one
  `@isTest` method somewhere along the way. A weaker signal than the list
  above - it could be a real test helper, or it could be genuinely dead
  production code that a stale test still happens to exercise - so it's
  kept separate rather than merged in or dropped.

A constructor is just another method node here, not a special case: `new
X(...)` resolves to the specific constructor overload's own node (matched by
argument count, same as any other call), and `Type.newInstance()` resolves
to the no-argument constructor (the only one Apex's reflection API can ever
invoke). A constructor only reachable from outside the parsed org entirely
- a Visualforce `controller=`/`extensions=` attribute, or the implicit
`super()` call Apex inserts for a subclass that declares no constructor of
its own - is still invisible to this parser and can still misread as dead;
narrower versions of the Visualforce and reachability gaps below, not
solved here either.

Each item in the **dead** list also carries `only_reachable_from_dead_code`:
`true` means this method *does* have a direct caller, but that caller (or
its own caller, transitively) is itself unreachable - a closed loop or an
orphaned chain, not simply "nothing ever mentions this method's name." See
`fixture_org`'s `DeadLoopA`/`DeadLoopB` (a mutually-referential pair - each
calls only the other, so each has local in-degree 1, yet neither is
reachable from anything live) and `OrphanedLegacyCaller`/
`OrphanedLegacyTarget` (a two-class dead chain) for concrete, tested
examples this now catches that a plain in-degree check would miss.

A method carrying its own `@isTest`/`testMethod` flag is never a candidate
in either list (it's invoked by the test runner, not by other code).
Polymorphic dispatch (`possible_override`/`possible_implementation` fan-out,
see above) already contributes to the call graph the same as a direct call,
so an override or interface-implementation method that's only reachable
through dynamic dispatch still correctly stays off the dead list - as long
as the dispatch's own call site is itself reachable.

### Known entry points (excluded regardless of reachability)

Being unreachable within the *parsed org* doesn't mean "unused" when the
real caller is outside it entirely - these are excluded from both lists
(check "Show excluded entry points" in the panel to see them anyway, with
the reason), and also act as roots that reachability walks outward from:

- `@AuraEnabled`, `@InvocableMethod`, `@RemoteAction`, `@future`,
  `@HttpGet`/`@HttpPost`/`@HttpPut`/`@HttpDelete`/`@HttpPatch`, a bare
  `global` modifier, or the legacy `webservice` modifier - invoked by
  Lightning/Aura, a Flow "Apex Action" or Process Builder action, legacy VF
  remoting, the async executor, a custom REST API endpoint, a managed
  package's public API surface, or the legacy SOAP API respectively. The
  `webservice` modifier gets its own check rather than piggybacking on
  `global`: a `webservice` method's own signature never carries the literal
  word `global` (only the *class* declaration does, a separate buffer this
  per-method scan never sees), so without it these methods were a genuine
  false-positive gap, not just a labelling nicety the way the REST
  annotations mostly are (Salesforce requires `@Http*` methods to also be
  `global static`, so `global modifier` alone would already have excluded
  them - the dedicated check is mainly a clearer, more specific reason).
- **`Batchable.start/execute/finish`, `Schedulable.execute`,
  `Queueable.execute`, `Messaging.InboundEmailHandler.handleInboundEmail`** -
  invoked by the platform's async executor (Email-to-Apex, for the last one),
  not by other in-org code, when the class implements one of those
  interfaces, directly *or indirectly* through a custom interface that itself
  `extends` one (e.g. `interface MyBatchInterface extends
  Database.Batchable<SObject>`, then `class MyBatchJob implements
  MyBatchInterface`) - the indirect case is
  resolved by walking a class's own `implements` list up each entry's
  `extends` chain until it either bottoms out at a platform interface name or
  runs out of org-defined ancestors (`graph_builder._transitive_interface_
  names`). Matched by name, arity, *and* the first parameter's type against
  the platform's fixed signature for each callback - arity alone isn't
  enough, since a class that implements, say, `Queueable` could also legally
  declare an unrelated, genuinely dead `execute(String)` overload, which has
  the *same* arity (1) as the real `execute(QueueableContext)` - only the
  parameter type differs. Also, method nodes are keyed by name+arity, not
  full signature (see "Known limitations" below) - so two same-name-
  same-arity overloads (the exact `execute(String)` vs.
  `execute(QueueableContext)` case above) still collapse onto one method
  node; if *either* declaration looks like the real platform callback, the
  merged node is excluded, regardless of which was declared first.

### `Type.forName('LiteralClassName')` resolution

A common "factory keyed by a hardcoded class name" pattern -
`Type.forName('MyHandlerImpl').newInstance()` - is resolved into a real
edge (`dynamic_instantiation`) when the class name is a literal string
right there in the call, closing what would otherwise be a false-positive
source for that class. Two things it deliberately does *not* resolve,
left unresolvable rather than mis-resolved:

- The namespaced two-argument overload, `Type.forName(namespaceName,
  className)` - a looser regex would risk capturing the namespace as if it
  were the class name, so this form is simply left unmatched.
- Fully data-driven dispatch, e.g. a class name read from a Custom Metadata
  or Custom Setting field at runtime - unresolvable by construction, since
  the name doesn't exist as text anywhere in the Apex source this tool
  reads.

Note that resolving the class only proves the *class* gets instantiated -
it says nothing about which of its methods are ever called, so a
reflectively-instantiated class's individual methods can still correctly
show up as dead.

### Known limitations not solved here

Visualforce is not handled at all: no `.page`/`.component` parsing exists in
this tool, so a method referenced only via a VF `controller=`/`extensions=`
attribute or an `action="{!methodName}"` binding will be flagged dead
incorrectly. This matters more now than it used to: since dead-code
detection does real mark-and-sweep reachability (see "Dead code detection"
above) rather than a purely local in-degree check, a false "unreachable"
verdict on a VF-only-invoked method can now cascade - everything *that*
method calls, and everything those calls call, reads as unreachable too,
not just the one method the VF page actually references. In a VF-heavy org,
treat the dead-code panel as a *starting point* for methods with no
in-org caller at all, not a verdict, and double-check against VF markup
before deleting. Also out of scope: reachability through a disabled branch
(`if (false) { ... }` or a permanently-off feature flag/custom-setting
check) still counts as a real call for this purpose - this tool does
control-flow-blind call-graph analysis, not full reachability analysis in
that sense either.

Dead-code detection's reachability walk is only as complete as the "known
entry points" list above: any invocation path this parser can't recognize
as external (Visualforce, a managed package's own internal calls into a
subscriber org's global methods, an org-wide default sharing/Apex REST
integration this tool has no visibility into, ...) has no root to anchor
on, so a method reachable only that way - and everything downstream of it -
can misread as dead. The `only_reachable_from_dead_code` flag on each dead
item is meant to help here: `false` means the method has no caller at all
anywhere in the scanned org (the same signal the old local check already
gave, low false-positive risk); `true` means it's only reachable through
other code this pass *also* considers dead, which is the newer, more
speculative half of what mark-and-sweep adds - worth a closer look before
deleting, especially in an org that leans on entry points this tool can't
see.

Method nodes are keyed by declared name + parameter **count**, not full
signature - two overloads with the same arity but different parameter
*types* (`foo(Account a)` vs. `foo(Contact c)`) collide onto one node, since
telling them apart would need real type resolution this regex-based parser
doesn't have. In the common case this just merges two call sites that were
always going to the "same" dead-or-alive answer anyway; it only becomes
misleading when exactly one of the colliding overloads is genuinely dead and
the other isn't - the merged node reads as "used" as long as either one is.

Calls made *through* a local variable (`helper.formatDate()`, see
"method-level graph" above) resolve via a best-effort local-type map that's
scoped per enclosing method, so a variable declared in one method never
leaks into another. Within that same method scope, though, two same-named
locals of different declared types (e.g. a `Contact record` in one `for`
loop and an unrelated `Account record` declared later in the same method)
still collide onto whichever declaration was seen last - accepted, for the
same reason the overload-arity collision above is: telling them apart needs
real type resolution this regex-based parser doesn't have.

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

### `GET /api/dead-code?include_entry_points=`

Apex methods unreachable from any live entry point anywhere in the scanned
org - see "Dead code detection" above. Returns `{"dead": [...], "test_only":
[...]}` (`entry_points_excluded` added as a third list when
`include_entry_points=1`); each item has `id`, `name`, `class_name`,
`file_path`, `line`, `only_reachable_from_dead_code` (`reason` instead of
`class_name`/`file_path`/`line`/`only_reachable_from_dead_code` for
`entry_points_excluded` items).

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
