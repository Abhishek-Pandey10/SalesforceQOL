# Apex Org Diff

A lightweight, local **Salesforce Apex class comparison tool** that reads two org folders and displays differences using **Monaco Editor's DiffEditor** in a browser-based UI.

---

## Features

- **Side-by-side Monaco DiffEditor** with line-level highlighting
- **Status detection**: Modified · Identical · Only in Org A · Only in Org B
- **Sidebar filters** with live counts per status
- **Real-time search** across class names
- **Sortable class list**: modified classes shown first
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
# Clone or copy the apex-org-diff folder, then:
cd apex-org-diff

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
python apex_diff.py ./org1 ./org2
```

Then open **http://localhost:8000** in your browser.

### Options

```bash
python apex_diff.py --help
```

```
usage: apex_diff [-h] [--port PORT] [--host HOST] [--no-browser]
                 ORG_A_FOLDER ORG_B_FOLDER

positional arguments:
  ORG_A_FOLDER    Path to the folder containing Apex classes from Org A
  ORG_B_FOLDER    Path to the folder containing Apex classes from Org B

options:
  --port PORT     Port to run the local web server on (default: 8000)
  --host HOST     Host address to bind (default: 127.0.0.1)
  --no-browser    Do not open the browser automatically after starting
  -h, --help      Show this help message and exit
```

### Examples

```bash
# Compare two local org folders
python apex_diff.py ./org1 ./org2

# Custom port, no auto-browser
python apex_diff.py ./org1 ./org2 --port 9000 --no-browser

# Absolute paths on Windows
python apex_diff.py "C:\sfdx\prod\classes" "C:\sfdx\sandbox\classes"

# Absolute paths on macOS/Linux
python apex_diff.py /home/user/prod/force-app/main/default/classes \
                   /home/user/sandbox/force-app/main/default/classes
```

---

## Expected Folder Structure

Each folder should contain Salesforce Apex `.cls` files.

```
org1/
├── AccountController.cls
├── AccountService.cls
├── ContactController.cls
└── Utility.cls

org2/
├── AccountController.cls    ← modified
├── AccountService.cls       ← identical
├── ContactController.cls    ← modified
└── NewClass.cls             ← only in Org B
```

**Nested directories are supported.** The tool recursively scans both folders.

```
org1/
├── controllers/
│   └── AccountController.cls
├── services/
│   └── AccountService.cls
└── utils/
    └── Utility.cls
```

> **Note:** Files are matched by **filename only** (case-insensitive), not by their directory path within the org folder.
> If two files in the same org have the same filename (in different subdirectories), only the first one found is used.

---

## How the Diff Works

1. **Startup**: Both folders are recursively scanned for `.cls` files. All files are read into memory and indexed by lowercased filename.
2. **Status detection**:
   - A file exists in both folders → compare content byte-for-byte → `identical` or `modified`
   - A file exists only in Org A → `only_in_org_a`
   - A file exists only in Org B → `only_in_org_b`
3. **Frontend**: On initial load, only metadata (name + status) is sent to the browser — no file contents.
4. **On class selection**: The browser fetches `/api/classes/{class_name}` which returns the content of both versions.
5. **Monaco DiffEditor**: The two content strings are fed into `monaco.editor.createDiffEditor()` which renders them side-by-side with standard diff highlighting.

### Language Highlighting

Monaco Editor does not ship a dedicated **Salesforce Apex** grammar. The tool registers a custom `apex` language ID using Monaco's language registration API. The Java tokenizer is used as the closest match, which covers:

- Class/method declarations
- Annotations (`@AuraEnabled`, `@isTest`, etc.)
- Access modifiers
- Generics (`List<Account>`)
- String literals and comments

SOQL queries appear as string literals — acceptable for a text-based diff viewer.

---

## REST API

### `GET /api/summary`

Returns high-level statistics.

```json
{
  "total": 25,
  "modified": 8,
  "identical": 12,
  "only_in_org_a": 3,
  "only_in_org_b": 2,
  "org_a_path": "/abs/path/to/org1",
  "org_b_path": "/abs/path/to/org2"
}
```

### `GET /api/classes`

Returns metadata for all Apex classes. Supports optional query parameters:

| Param | Values | Description |
|-------|--------|-------------|
| `status` | `modified`, `identical`, `only_in_org_a`, `only_in_org_b` | Filter by status |
| `q` | any string | Case-insensitive substring search on class name |

```json
[
  { "name": "accountcontroller.cls", "status": "modified",      "in_org_a": true,  "in_org_b": true,  "is_identical": false },
  { "name": "accountservice.cls",    "status": "identical",     "in_org_a": true,  "in_org_b": true,  "is_identical": true  },
  { "name": "utility.cls",           "status": "only_in_org_a", "in_org_a": true,  "in_org_b": false, "is_identical": false },
  { "name": "newclass.cls",          "status": "only_in_org_b", "in_org_a": false, "in_org_b": true,  "is_identical": false }
]
```

### `GET /api/classes/{class_name}`

Returns full detail including file contents.

```json
{
  "name": "accountcontroller.cls",
  "status": "modified",
  "org_a": {
    "exists": true,
    "content": "public class AccountController {\n    ...\n}",
    "size_bytes": 2048,
    "error": null
  },
  "org_b": {
    "exists": true,
    "content": "public class AccountController {\n    ...\n    // new method\n}",
    "size_bytes": 2190,
    "error": null
  }
}
```

---

## Project Structure

`apex-org-diff` lives as one tool inside a shared parent repo. `samples/` sits one
level up, at the repo root, so it can be reused by other QOL scripts — not just
this tool.

```
<repo root>/
│
├── samples/                ← Shared fixture orgs, used by any QOL script
│   ├── create_sample_orgs.py
│   ├── sample_org1/
│   └── sample_org2/
│
└── apex-org-diff/
    │
    ├── apex_diff.py          ← Entry point (CLI + server startup)
    │
    ├── backend/
    │   ├── __init__.py
    │   ├── models.py         ← Data models (ClassStatus, ApexClassMeta, etc.)
    │   ├── scanner.py        ← File scanning & in-memory diff index
    │   ├── api.py            ← FastAPI routes
    │   └── export.py         ← Standalone HTML export (no server required)
    │
    ├── frontend/
    │   ├── index.html        ← Single-page app HTML
    │   ├── styles.css        ← Dark developer UI styles
    │   └── app.js            ← Monaco DiffEditor integration + sidebar logic
    │
    ├── scripts/               ← Manual dev/debug scripts (not pytest)
    │   ├── test_backend.py
    │   └── check_stats.py
    │
    ├── requirements.txt
    └── README.md
```

### Development scripts

`scripts/test_backend.py` and `scripts/check_stats.py` locate `samples/` and the
`backend` package relative to their own file path, so they can be run from any
working directory:

```bash
python ../samples/create_sample_orgs.py   # (re)generate the sample_org1 / sample_org2 fixtures
python scripts/test_backend.py            # exercises DiffIndex + FastAPI app end-to-end, prints results
python scripts/check_stats.py             # prints diff line-stats for the sample orgs
python apex_diff.py ../samples/sample_org1 ../samples/sample_org2   # try the tool on the fixtures
```

---

## Adding Future Apex-Specific Comparison Features

The `scanner.py` module is designed for easy extension. The key extension point is the `DiffIndex._build()` method.

### Example: Ignore whitespace-only changes

```python
# In scanner.py, modify _resolve_status():
import re

def _normalise_apex(content: str) -> str:
    """Strip comments and normalise whitespace."""
    # Remove block comments
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    # Remove line comments
    content = re.sub(r'//[^\n]*', '', content)
    # Normalise whitespace
    return ' '.join(content.split())

# Then in _build():
identical = in_a and in_b and (
    _normalise_apex(a_content.content) == _normalise_apex(b_content.content)
)
```

### Example: Detect added/removed methods

```python
import re

def _extract_method_names(content: str) -> set[str]:
    """Extract Apex method signatures (simplified)."""
    pattern = r'(?:public|private|protected|global)\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\('
    return set(re.findall(pattern, content))

# In DiffIndex._build(), after computing status:
if status == ClassStatus.MODIFIED:
    methods_a = _extract_method_names(a_content.content)
    methods_b = _extract_method_names(b_content.content)
    added_methods   = methods_b - methods_a
    removed_methods = methods_a - methods_b
    # Store on the detail object or emit a log
```

### Example: Surface SOQL changes

```python
import re

def _extract_soql(content: str) -> list[str]:
    """Extract SOQL queries from Apex content."""
    return re.findall(r'\[\s*SELECT\b.*?\]', content, re.IGNORECASE | re.DOTALL)
```

### Architecture guidance

- All file-level analysis logic belongs in `scanner.py`
- Add new fields to `ApexClassDetail` in `models.py`
- Expose new data through `api.py` without breaking existing endpoints
- The Monaco frontend requires no changes for textual enhancements

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `ModuleNotFoundError: fastapi` | Run `pip install -r requirements.txt` |
| Port already in use | Use `--port 9000` (or any free port) |
| Monaco editor blank | Check internet connection (Monaco loads from CDN) |
| Files not appearing | Confirm folder paths exist and contain `.cls` files |
| Encoding errors | Files are read with `errors='replace'`; non-UTF-8 chars appear as `?` |
| Very large files | Monaco handles large files; the diff may be slow for 10k+ line files |

---

## License

MIT — free for personal and commercial use.
