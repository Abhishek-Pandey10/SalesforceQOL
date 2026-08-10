# LWC Org Diff

A lightweight, local **Lightning Web Component comparison tool** that reads
two org folders and displays bundle-level differences using **Monaco
Editor's DiffEditor** in a browser-based UI.

It's the sibling of [`apex-org-diff`](../apex-org-diff) in this repo, built
for the same workflow (diff two orgs, review, mark what to deploy) but for
LWC bundles instead of single `.cls` files.

---

## Why not just apex-org-diff?

An Apex class is one file. An LWC component is a **bundle** of files -
`.js`, `.html`, `.css`, `.js-meta.xml`, optionally `__tests__/*.test.js` and
`.svg`. Comparing "the component" means comparing the whole bundle: which
files changed, which were added or removed on one side, and what changed
inside each one. This tool is bundle-aware from the ground up - the sidebar
lists components, and opening one shows a **file tab bar** so you can flip
between `.js` / `.html` / `.css` / `.js-meta.xml` without leaving the
component.

---

## Features

- **Bundle-aware diffing**: components are matched by folder name; files
  inside are matched by relative path, so a file added/removed on just one
  side shows up per-file, not just at the component level
- **Side-by-side Monaco DiffEditor** with line-level highlighting, using
  Monaco's built-in JavaScript/HTML/CSS/XML/JSON language modes (no custom
  grammar needed)
- **File tab bar** per component with a per-file status dot
- **Status detection**: Modified · Identical · Only in Org A · Only in Org B
  - at both the component level and the file level
- **Sidebar filters** with live counts per status
- **Real-time search** across component names
- **Sortable component list**: modified components shown first
- **In-memory indexing**: files read once at startup, O(1) lookups
- **Safe path handling**: API cannot read files outside the two configured folders
- **Zero-build frontend**: no npm/webpack — plain HTML + Monaco CDN
- **Cross-platform**: Windows, Linux, macOS paths all supported

---

## Prerequisites

- Python **3.9+**
- Internet access (Monaco Editor is loaded from CDN)

---

## Installation

```bash
cd lwc-org-diff
pip install -r requirements.txt
```

`requirements.txt` installs only two packages:

| Package | Purpose |
|---------|---------|
| `fastapi` | REST API framework |
| `uvicorn[standard]` | ASGI server |

---

## Usage

### Basic

```bash
python lwc_diff.py ./org1/lwc ./org2/lwc
```

Then open **http://localhost:8010** in your browser. (Different default
port from apex-org-diff's 8000, so both tools can run side by side.)

### Options

```bash
python lwc_diff.py --help
```

```
usage: lwc_diff [-h] [--port PORT] [--host HOST] [--no-browser]
                 ORG_A_FOLDER ORG_B_FOLDER

positional arguments:
  ORG_A_FOLDER    Path to the folder containing LWC components from Org A
  ORG_B_FOLDER    Path to the folder containing LWC components from Org B

options:
  --port PORT     Port to run the local web server on (default: 8010)
  --host HOST     Host address to bind (default: 127.0.0.1)
  --no-browser    Do not open the browser automatically after starting
  -h, --help      Show this help message and exit
```

### Examples

```bash
# Compare two local org folders (point at the lwc/ metadata folder, or any
# folder containing it - bundles are found recursively)
python lwc_diff.py ./org1/force-app/main/default/lwc ./org2/force-app/main/default/lwc

# Custom port, no auto-browser
python lwc_diff.py ./org1/lwc ./org2/lwc --port 9010 --no-browser

# Absolute paths on Windows
python lwc_diff.py "C:\sfdx\prod\lwc" "C:\sfdx\sandbox\lwc"
```

---

## Expected Folder Structure

Each folder should contain LWC component bundles - directories whose name
matches a `<name>.js-meta.xml` file directly inside them (the same marker
the Salesforce CLI and Metadata API use).

```
org1/
├── accountCard/
│   ├── accountCard.js
│   ├── accountCard.html
│   ├── accountCard.css
│   └── accountCard.js-meta.xml
├── contactList/
│   ├── contactList.js
│   ├── contactList.html
│   └── contactList.js-meta.xml
└── orderSummary/
    ├── orderSummary.js
    ├── orderSummary.html
    └── orderSummary.js-meta.xml
```

**Nested directories are supported** - point at `force-app/main/default/lwc`,
or any folder above it; bundles are found recursively. `__tests__/` and any
other files inside a bundle are included in the diff too.

> **Note:** Components are matched by **bundle folder name only**
> (case-insensitive), not by their path within the org folder. If two
> bundles in the same org share a name (in different parent folders), only
> the first one found is used - the rest are reported in
> `summary.duplicates` and flagged in the UI.

---

## How the Diff Works

1. **Startup**: Both folders are recursively scanned for bundle directories.
   Every file inside each bundle is read into memory.
2. **File-level status**: for each file (matched by relative path within the
   bundle) - exists in both → compare content → `identical` or `modified`;
   exists only on one side → `only_in_org_a` / `only_in_org_b`.
3. **Component-level status**: `identical` only if the component exists on
   both sides *and* every file in it is identical; otherwise `modified` if
   present on both sides, or `only_in_org_a` / `only_in_org_b` if the whole
   bundle exists on just one side.
4. **Frontend**: on initial load, only metadata (name, status, per-file
   status list) is sent to the browser - not file contents.
5. **On component selection**: the browser fetches
   `/api/components/{name}`, which returns every file in the bundle with
   both orgs' content, and renders a file tab bar.
6. **Monaco DiffEditor**: whichever file tab is active feeds its two content
   strings into `monaco.editor.createDiffEditor()`, using the language mode
   matched to that file's extension.

---

## REST API

### `GET /api/summary`

```json
{
  "total": 6,
  "modified": 2,
  "identical": 2,
  "only_in_org_a": 1,
  "only_in_org_b": 1,
  "org_a_path": "/abs/path/to/org1",
  "org_b_path": "/abs/path/to/org2"
}
```

### `GET /api/components`

Returns metadata for all components, including a per-file status list but
no file content. Supports `status` and `q` query params, same as
apex-org-diff's `/api/classes`.

```json
[
  {
    "name": "contactList",
    "status": "modified",
    "in_org_a": true, "in_org_b": true, "is_identical": false,
    "file_count": 3,
    "diff_stats": { "lines_added": 10, "lines_removed": 3, "lines_changed": 13 },
    "has_error": false,
    "files": [
      { "name": "contactList.html", "status": "modified", "...": "..." },
      { "name": "contactList.js", "status": "modified", "...": "..." },
      { "name": "contactList.js-meta.xml", "status": "identical", "...": "..." }
    ]
  }
]
```

### `GET /api/components/{component_name}`

Returns full detail: every file in the bundle, with content from both orgs.

### `GET /api/components/{component_name}/export`

Downloads a self-contained HTML diff report for the whole bundle (one
section per file), same reasoning as apex-org-diff's export endpoint
(server-rendered so the browser's download handling is reliable).

---

## Project Structure

Lives alongside `apex-org-diff` in this repo, sharing the `samples/` fixture
folder at the repo root.

```
<repo root>/
│
├── samples/
│   ├── create_sample_orgs.py
│   ├── org1/
│   │   ├── classes/         ← used by apex-org-diff
│   │   └── lwc/              ← used by lwc-org-diff
│   └── org2/
│       ├── classes/
│       └── lwc/
│
├── apex-org-diff/
│
└── lwc-org-diff/
    │
    ├── lwc_diff.py            ← Entry point (CLI + server startup)
    │
    ├── backend/
    │   ├── __init__.py
    │   ├── models.py          ← Data models (two levels: component + file)
    │   ├── scanner.py         ← Bundle discovery, file reading, diff index
    │   ├── api.py              ← FastAPI routes
    │   └── export.py           ← Standalone HTML export (no server required)
    │
    ├── frontend/
    │   ├── index.html          ← Single-page app HTML (adds a file-tab bar)
    │   ├── styles.css
    │   └── app.js               ← Monaco DiffEditor integration + file tabs
    │
    ├── scripts/                 ← Manual dev/debug scripts (not pytest)
    │   ├── test_backend.py
    │   └── check_stats.py
    │
    ├── requirements.txt
    └── README.md
```

### Development scripts

```bash
python ../samples/create_sample_orgs.py       # (re)generate the org1 / org2 fixtures (classes + lwc)
python scripts/test_backend.py                # exercises DiffIndex + FastAPI app end-to-end
python scripts/check_stats.py                 # prints component- and file-level diff stats
python lwc_diff.py ../samples/org1/lwc ../samples/org2/lwc   # try it on the fixtures
```

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `ModuleNotFoundError: fastapi` | Run `pip install -r requirements.txt` |
| Port already in use | Use `--port 9010` (or any free port) - default 8010 differs from apex-org-diff's 8000 so both can run at once |
| Monaco editor blank | Check internet connection (Monaco loads from CDN) |
| No components found | Confirm the folder path contains subfolders with a matching `<name>.js-meta.xml` inside |
| Encoding errors | Files are read with `errors='replace'`; non-UTF-8 chars appear as `?` |

---

## License

MIT — free for personal and commercial use.
