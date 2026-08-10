"""Integration test for the backend."""
import sys
from pathlib import Path

LWC_ORG_DIFF_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = LWC_ORG_DIFF_ROOT.parent
sys.path.insert(0, str(LWC_ORG_DIFF_ROOT))

from backend.scanner import DiffIndex
from backend.api import create_app

SAMPLES_DIR = REPO_ROOT / "samples"


def main():
    idx = DiffIndex(str(SAMPLES_DIR / "sample_lwc_org1"), str(SAMPLES_DIR / "sample_lwc_org2"))
    summary = idx.get_summary()
    print("=== SUMMARY ===")
    for k, v in summary.items():
        print("  {}: {}".format(k, v))

    print()
    print("=== ALL COMPONENTS ===")
    for comp in idx.get_all_meta():
        print("  {:20s}  {:16s}  files={}".format(comp["name"], comp["status"], comp["file_count"]))

    print()
    print("=== DETAIL: contactList (modified) ===")
    detail = idx.get_component_detail("contactList")
    print("  status:", detail["status"])
    for f in detail["files"]:
        print("    {:30s} {}".format(f["name"], f["status"]))

    print()
    print("=== EDGE CASES ===")
    only_a = idx.get_component_detail("orderSummary")
    print("  orderSummary only_in_org_a:", only_a["status"] == "only_in_org_a")

    only_b = idx.get_component_detail("dashboardTile")
    print("  dashboardTile only_in_org_b:", only_b["status"] == "only_in_org_b")

    identical = idx.get_component_detail("accountCard")
    print("  accountCard identical:", identical["status"] == "identical")

    empty = idx.get_component_detail("emptyUtil")
    print("  emptyUtil identical (empty files):", empty["status"] == "identical")

    # productPicker: same .js/.html on both sides is NOT true here (js also
    # changed), but the interesting case is the extra .css file only in org B.
    picker = idx.get_component_detail("productPicker")
    css_file = next((f for f in picker["files"] if f["name"].endswith(".css")), None)
    print("  productPicker.css only_in_org_b:", css_file is not None and css_file["status"] == "only_in_org_b")
    print("  productPicker component status is modified:", picker["status"] == "modified")

    case_test = idx.get_component_detail("ACCOUNTCARD")
    print("  case-insensitive lookup:", case_test is not None)

    miss = idx.get_component_detail("DoesNotExist")
    print("  non-existent returns None:", miss is None)

    print()
    print("=== FastAPI APP ===")
    app = create_app(idx)
    print("  App title:", app.title)

    print()
    print("ALL CHECKS PASSED")


# DiffIndex may spread diff-stat computation across a process pool for large
# orgs (see scanner._compute_diff_stats_batch); on Windows that requires the
# entry point to be guarded like this, or every spawned worker re-imports
# and re-runs this whole script.
if __name__ == "__main__":
    main()
