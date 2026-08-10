"""Prints node/edge counts by kind and the top-N nodes by blast-radius size
(total degree) for a given org folder. Manual/debug script, not pytest."""
import sys
from collections import Counter
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOL_ROOT))

from backend.graph_builder import DependencyGraph

DEFAULT_ORG = TOOL_ROOT / "fixture_org"
TOP_N = 10


def main():
    org_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_ORG
    if not org_path.exists():
        print(f"Org folder not found: {org_path}")
        if org_path == DEFAULT_ORG:
            print("Run: python scripts/create_fixture_org.py")
        sys.exit(1)

    graph = DependencyGraph(str(org_path))
    summary = graph.get_summary()

    print("=== SUMMARY ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    print()
    print("=== NODES BY TYPE ===")
    type_counts = Counter(n.type.value for n in graph.nodes.values())
    for type_name, count in sorted(type_counts.items()):
        print(f"  {type_name:16s} {count}")

    print()
    print("=== EDGES BY KIND ===")
    kind_counts = Counter(e.kind for e in graph.edges)
    for kind, count in sorted(kind_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {kind:20s} {count}")

    print()
    print(f"=== TOP {TOP_N} NODES BY BLAST RADIUS (in_degree + out_degree) ===")
    ranked = sorted(graph.nodes.values(), key=lambda n: -(n.in_degree + n.out_degree))
    for node in ranked[:TOP_N]:
        total = node.in_degree + node.out_degree
        print(f"  {node.name:28s} total={total:3d}  used_by={node.in_degree:3d}  depends_on={node.out_degree:3d}  [{node.type.value}]")

    isolated = [n.name for n in graph.nodes.values() if n.in_degree == 0 and n.out_degree == 0]
    if isolated:
        print()
        print(f"=== ISOLATED NODES ({len(isolated)}) ===")
        for name in sorted(isolated):
            print(f"  {name}")


if __name__ == "__main__":
    main()
