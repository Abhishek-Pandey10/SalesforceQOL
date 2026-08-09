"""Quick check for diff stats and filename casing."""
import sys
sys.path.insert(0, ".")
from backend.scanner import DiffIndex


def main():
    idx = DiffIndex("./samples/sample_org1", "./samples/sample_org2")
    classes = idx.get_all_meta()
    print("=== DIFF STATS IN METADATA ===")
    for c in classes:
        s = c["diff_stats"]
        name   = c["name"]
        status = c["status"]
        added  = s["lines_added"]
        removed = s["lines_removed"]
        print("  {:30s}  +{} -{} status={}".format(name, added, removed, status))

    print()
    print("Casing check - all names should be original case:")
    for c in classes:
        print(" ", c["name"])


# DiffIndex may spread diff-stat computation across a process pool for large
# orgs (see scanner._compute_diff_stats_batch); on Windows that requires the
# entry point to be guarded like this, or every spawned worker re-imports
# and re-runs this whole script.
if __name__ == "__main__":
    main()
