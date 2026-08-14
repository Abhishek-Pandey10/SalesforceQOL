---
name: launch-tool
description: Set up and start one of this repo's local Salesforce QOL tools (apex-org-diff, lwc-org-diff, sf-dependency-graph) for manual testing in a browser - installs deps if missing, (re)generates fixture data, and launches the tool's dev server against fixtures or user-given org folders. Use when asked to run, launch, start, try out, demo, or smoke-test one of these tools, or to verify a change works end-to-end.
---

# Launch a SalesforceQOL tool

This repo has three independent, self-contained tools, each with its own
entry point, port, and fixture data. Pick the right one from context (which
tool's code was just touched, or what the user names) before doing anything
else.

| Tool | Entry point | Default port | Fixture source |
|---|---|---|---|
| apex-org-diff | `apex_diff.py ORG_A ORG_B` | 8000 | `../samples/org1/classes`, `../samples/org2/classes` |
| lwc-org-diff | `lwc_diff.py ORG_A ORG_B` | 8010 | `../samples/org1/lwc`, `../samples/org2/lwc` |
| sf-dependency-graph | `sf_dependency_graph.py ORG_FOLDER [--focus NAME]` | 8020 | `fixture_org/` (own fixture, not shared `samples/`) |

## Steps

1. **cd into the tool's directory** (`apex-org-diff/`, `lwc-org-diff/`, or
   `sf-dependency-graph/`) — each has its own `requirements.txt` and expects
   to be run from there so `backend` resolves as a local package.

2. **Install deps if needed**: `pip install -r requirements.txt`. Only worth
   doing if a fresh `ModuleNotFoundError: fastapi` shows up — don't
   reinstall on every launch.

3. **Make sure fixture data exists**:
   - apex-org-diff / lwc-org-diff share `../samples/` (one level up from the
     tool dir, at the repo root). If `samples/org1` or `samples/org2` is
     missing, generate it — from inside the tool dir (per step 1):
     `python ../samples/create_sample_orgs.py`.
   - sf-dependency-graph ships its own fixture. If `fixture_org/` is
     missing, generate it: `python scripts/create_fixture_org.py`.
   - If the user gave a real org folder path instead, use that directly and
     skip fixture generation.

4. **Launch with `--no-browser`** and run it in the background — this
   agent's environment has no real browser to auto-open, and a blocking
   `uvicorn.run()` call would hang the session:
   ```bash
   # apex-org-diff
   python apex_diff.py ../samples/org1/classes ../samples/org2/classes --no-browser

   # lwc-org-diff
   python lwc_diff.py ../samples/org1/lwc ../samples/org2/lwc --no-browser

   # sf-dependency-graph
   python sf_dependency_graph.py fixture_org --no-browser
   ```
   Use `--port` to avoid collisions if a previous instance is still bound to
   the default port (check the startup log for "Address already in use").

5. **Verify it's actually serving**, don't just trust the process started —
   hit `GET /api/summary` (all three tools expose it) and confirm it
   returns real counts, not a 503 (index still building) or a connection
   error:
   ```bash
   curl -s http://127.0.0.1:8000/api/summary   # adjust port per tool
   ```
   For a genuine visual check (not just the API), use the `run` skill's
   browser-driving flow once the server is confirmed up.

6. **Tell the user the URL** and what fixture/org it's pointed at, so they
   can open it themselves if they'd rather look than have it screenshotted.

7. When done, stop the background server rather than leaving it running
   silently across turns.

## Gotchas specific to this repo

- All three tools build their in-memory index in a background thread at
  startup — `/api/summary` (and every other route) returns `503` until
  `is_ready()` flips true. A 503 right after launch is expected for a
  couple hundred ms, not a bug.
- Ports are 8000 / 8010 / 8020 by convention specifically so all three can
  run **simultaneously** without clashing — don't default to killing one to
  start another unless the user asks.
- All three tools write a debug export straight to disk on startup,
  bypassing the browser entirely — if the API looks right but the UI
  doesn't, that file is a fast way to tell whether the bug is in the
  scan/export logic or downstream in the frontend. **Location differs
  per tool**: `apex-org-diff` (`ApexDiffOutput.html`) and `lwc-org-diff`
  (`LwcDiffOutput.html`) write to their own project root; `sf-dependency-graph`
  (`DependencyGraphOutput.html`) writes to the OS temp dir instead
  (`tempfile.gettempdir()`), deliberately, so it doesn't show up in `git
  status` — don't go looking for it next to `sf_dependency_graph.py`.
