"""Integration test for the backend."""
import sys
from pathlib import Path

APEX_ORG_DIFF_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = APEX_ORG_DIFF_ROOT.parent
sys.path.insert(0, str(APEX_ORG_DIFF_ROOT))

from backend.scanner import DiffIndex
from backend.api import create_app

SAMPLES_DIR = REPO_ROOT / "samples"


def main():
    # Build index
    idx = DiffIndex(str(SAMPLES_DIR / "org1" / "classes"), str(SAMPLES_DIR / "org2" / "classes"))
    summary = idx.get_summary()
    print("=== SUMMARY ===")
    for k, v in summary.items():
        print("  {}: {}".format(k, v))

    print()
    print("=== ALL CLASSES ===")
    for cls in idx.get_all_meta():
        print("  {:40s}  {}".format(cls["name"], cls["status"]))

    print()
    print("=== DETAIL: accountcontroller.cls ===")
    detail = idx.get_class_detail("AccountController.cls")
    print("  status:", detail["status"])
    print("  org_a exists:", detail["org_a"]["exists"])
    print("  org_b exists:", detail["org_b"]["exists"])
    print("  org_a size:", detail["org_a"]["size_bytes"], "bytes")
    print("  org_b size:", detail["org_b"]["size_bytes"], "bytes")

    print()
    print("=== EDGE CASES ===")
    u = idx.get_class_detail("Utility.cls")
    print("  utility only_in_org_a:", u["status"] == "only_in_org_a",
          "| org_b.exists:", u["org_b"]["exists"])

    n = idx.get_class_detail("NewClass.cls")
    print("  newclass only_in_org_b:", n["status"] == "only_in_org_b",
          "| org_a.exists:", n["org_a"]["exists"])

    svc = idx.get_class_detail("AccountService.cls")
    print("  accountservice identical:", svc["status"] == "identical")

    emp = idx.get_class_detail("EmptyClass.cls")
    print("  emptyclass identical:", emp["status"] == "identical",
          "| size:", emp["org_a"]["size_bytes"])

    case_test = idx.get_class_detail("ACCOUNTCONTROLLER")
    print("  case-insensitive lookup:", case_test is not None)

    miss = idx.get_class_detail("DoesNotExist.cls")
    print("  non-existent returns None:", miss is None)

    # Nested file (in triggers/ subfolder)
    trig = idx.get_class_detail("AccountTrigger.cls")
    print("  nested AccountTrigger only_in_org_a:", trig is not None and trig["status"] == "only_in_org_a")

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
