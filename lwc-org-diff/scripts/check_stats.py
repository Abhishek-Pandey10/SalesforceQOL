"""Quick check for diff stats and per-file status rollups."""
import sys
from pathlib import Path

LWC_ORG_DIFF_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = LWC_ORG_DIFF_ROOT.parent
sys.path.insert(0, str(LWC_ORG_DIFF_ROOT))

from backend.scanner import DiffIndex

SAMPLES_DIR = REPO_ROOT / "samples"


def main():
    idx = DiffIndex(str(SAMPLES_DIR / "sample_lwc_org1"), str(SAMPLES_DIR / "sample_lwc_org2"))
    components = idx.get_all_meta()
    print("=== COMPONENT-LEVEL DIFF STATS ===")
    for c in components:
        s = c["diff_stats"]
        print("  {:20s}  +{} -{}  status={}  files={}".format(
            c["name"], s["lines_added"], s["lines_removed"], c["status"], c["file_count"]
        ))

    print()
    print("=== FILE-LEVEL BREAKDOWN ===")
    for c in components:
        print(f"  {c['name']}:")
        for f in c["files"]:
            s = f["diff_stats"]
            print("    {:30s} +{} -{}  status={}".format(f["name"], s["lines_added"], s["lines_removed"], f["status"]))


if __name__ == "__main__":
    main()
