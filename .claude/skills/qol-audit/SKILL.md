---
name: qol-audit
description: Run a consistent bug/dead-code/README-drift/cross-tool-consistency review across all three SalesforceQOL tools (apex-org-diff, lwc-org-diff, sf-dependency-graph) in one pass, the way past "fix bugs and improvements from audit" sweeps were done. Use for periodic housekeeping passes across the whole repo, not for reviewing a single in-flight change (use /code-review for that).
---

# Cross-tool audit pass

This repo holds three structurally-parallel tools (own `backend/`,
`frontend/`, `scripts/`, `requirements.txt`, `README.md`). Bugs and drift
tend to show up in one of two ways: a real defect local to one tool, or an
inconsistency where one tool fixed/improved something the other two never
got. Check for both.

## Steps

1. **Confirm scope with the user** if not already clear: all three tools,
   or a subset? Default to all three if they just said "audit" or
   "review the repo." If scope was already given as a skill argument (e.g.
   "sf-dependency-graph only"), don't ask again.

2. **Per-tool correctness pass** — for each tool in scope, run `/code-review`
   scoped to that tool's directory rather than the whole repo, so findings
   stay attributable to one tool at a time. Don't run it once across the
   whole diff/repo — that blurs which tool a finding belongs to and makes
   the summary harder to act on.

   Default to **medium** effort per tool. `high` (and above) fans out into
   several parallel finder agents per tool - each one reads the whole diff
   independently, so cost scales with tool count (a 3-tool `high` audit
   means ~20+ finder agents total, easily 7-figure subagent tokens and
   several minutes of scattered notifications). Only go `high` when the
   user explicitly wants deep/pre-release coverage, or a first `medium`
   pass came back suspiciously clean on a tool with a large recent diff.

   `/code-review` at `high`+ effort runs its finder agents as background
   tasks that each notify independently - there is no guarantee a
   consolidated, deduped report comes back as one message. Do not narrate
   each finder's arrival to the user (that's 7+ notifications per tool,
   21+ for a full three-tool audit) - collect them quietly and fold them
   into the single per-tool write-up in step 5. Two or more finders
   independently reporting the same issue is a good confidence signal, but
   still spot-check the highest-severity claims against the actual
   file/line yourself before reporting them as confirmed - the dedup/verify
   pass you'd normally get from `/code-review` may not have actually run.

3. **README-vs-code drift check**, per tool — READMEs here document exact
   CLI flags, default ports, endpoint response shapes, and project
   structure trees. Diff what the README claims against the actual
   `argparse` setup, route definitions, and directory listing. Flag:
   - CLI options documented but not implemented, or vice versa
   - Documented default port that doesn't match the code
   - Endpoint response examples with fields the code no longer returns (or
     new fields the README doesn't mention)
   - Project-structure trees missing new files or listing deleted ones

4. **Cross-tool consistency check** — skip this step entirely if scope was
   narrowed to a single tool (there's nothing to compare it against).
   Otherwise: these three tools intentionally share patterns (in-memory
   indexing built on a background thread, `503` via a
   readiness gate until the index is built, safe path handling so the API
   can't read outside the configured folders, zero-build CDN frontend,
   `--port`/`--host`/`--no-browser` CLI flags, an `/api/summary` endpoint,
   an export-to-standalone-HTML feature). When a bug fix or improvement
   lands in one tool's version of a shared pattern, check whether the other
   two have the same issue. Concretely, compare:
   - `backend/api.py` across all three for the readiness-gate and path-safety logic
   - Each entry-point `.py`'s `build_parser()` for flag parity
   - Each `backend/export.py` for the same export approach
   - `scripts/test_backend.py` / `scripts/check_stats.py` for parity of what they exercise

5. **Report per tool**, not as one merged list — group findings under
   `apex-org-diff`, `lwc-org-diff`, `sf-dependency-graph`, and a
   `cross-tool` section for anything found by step 4. For each finding,
   note whether it's tool-local or also present in the sibling tools (a
   finding that repeats across all three is worth fixing once and porting,
   not fixing three times independently).

6. Apply fixes only if the user asked for `--fix`-style follow-through (same
   convention as `/code-review --fix`); otherwise just report.
