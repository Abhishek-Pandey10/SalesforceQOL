---
name: scaffold-tool
description: Scaffold a new self-contained local Salesforce QOL tool in this repo, matching the existing structure and conventions of apex-org-diff, lwc-org-diff, and sf-dependency-graph (FastAPI backend, zero-build CDN frontend, own port, own fixture, README following the established format). Use when asked to add a new tool to this repo, e.g. "add a tool that does X" or "scaffold a new QOL tool."
---

# Scaffold a new SalesforceQOL tool

Before writing any code, get the tool's purpose and one-line pitch from the
user if not already clear (what does it read, what does it show, why is it
its own tool rather than a feature of an existing one) — that pitch becomes
the top of the new README and the row added to the repo root README's table.

## Directory layout to create

Mirror the existing tools exactly (check the newest one,
`sf-dependency-graph`, as the reference if unsure — it's the most evolved):

```
<tool-name>/
├── <tool_name>.py           # Entry point: CLI + server startup
├── backend/
│   ├── __init__.py
│   ├── models.py             # Data models (plain dataclasses, mirror existing style)
│   ├── <parser_or_scanner>.py  # The tool-specific analysis logic — this is the one file
│   │                            # that's genuinely new; everything else is boilerplate
│   ├── api.py                 # FastAPI routes
│   └── export.py              # Standalone HTML export (reuses the live frontend's JS)
├── frontend/
│   ├── index.html             # Single-page app, CDN-loaded deps, no build step
│   ├── styles.css
│   └── app.js
├── scripts/
│   ├── create_fixture_org.py or reuse ../samples/  # see "Fixture data" below
│   ├── test_backend.py        # Manual integration script, not pytest — exercises the
│   │                            # backend end-to-end and prints results
│   └── check_stats.py         # Prints summary stats for a given org/fixture
├── requirements.txt           # fastapi + uvicorn[standard], nothing else unless truly needed
└── README.md                  # Follow the section order below
```

## Conventions to preserve

- **Port**: next multiple of 10 after the highest existing tool (currently
  8000, 8010, 8020 → next is **8030**). Pick it so all tools can run
  simultaneously; document it in the README next to the other two.
- **CLI flags**: `--port`, `--host` (default `127.0.0.1`), `--no-browser`,
  plus whatever positional folder argument(s) the tool needs. Use
  `argparse` with `RawDescriptionHelpFormatter` and an examples epilog, same
  as `apex_diff.py`'s `build_parser()`.
- **Background index build**: don't scan/parse synchronously in `main()` —
  construct the index with `build_immediately=False` and build it on a
  daemon thread so uvicorn starts accepting connections immediately. Gate
  API routes with a `503` readiness check until the build finishes (see
  `backend/api.py` in any existing tool for the pattern).
- **Safe path handling**: the API must not be able to read files outside
  the folder(s) the user pointed it at. Validate/resolve paths at startup
  like `validate_paths()` in `apex_diff.py`.
- **Zero-build frontend**: plain HTML/CSS/JS, dependencies from a CDN
  (Monaco, vis-network, etc. depending on what the tool needs), no
  npm/webpack step.
- **`/api/summary` endpoint**: every tool exposes one; keep the convention
  for consistency with the `launch-tool` skill's health-check step.
- **Export feature**: a standalone-HTML export endpoint that reuses the
  live frontend's rendering code against embedded data, so the export
  works offline with no server. Follow `backend/export.py` in an existing
  tool.

## Fixture data

Decide whether the new tool can reuse the shared `samples/org1` /
`samples/org2` fixtures at the repo root (works if it only needs Apex
classes and/or LWC bundles with *no* required cross-references) or needs
its own generated fixture like `sf-dependency-graph/fixture_org`
(necessary if the tool's value depends on relationships between files that
`samples/` doesn't model — check `samples/create_sample_orgs.py` first
before assuming you need a new one).

## README structure

Match the section order used by the existing three READMEs: title/pitch →
Features → Prerequisites → Installation → Usage (Basic/Options/Examples) →
Expected Folder Structure → How it works → REST API → Project Structure →
Development scripts → Troubleshooting → License. Cross-link it from the
other tools' READMEs ("It's the Nth tool in this repo, alongside...") the
way `lwc-org-diff` and `sf-dependency-graph` link back to their siblings.

## After scaffolding

1. Add a row to the repo root `README.md`'s tool table.
2. Generate/verify the fixture and hand off to the `launch-tool` skill to
   actually start the new tool and confirm `/api/summary` responds before
   calling the scaffold done.
3. Mention in your summary to the user that `qol-audit` is available for a
   later consistency pass once the tool has real logic in it.
