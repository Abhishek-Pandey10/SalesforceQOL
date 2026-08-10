"""Integration test for the backend, run against fixture_org (see
create_fixture_org.py) which - unlike samples/org1 - has real cross-references
so every edge kind the parsers detect can be asserted against."""
import sys
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOL_ROOT))

from backend.graph_builder import DependencyGraph
from backend.api import create_app

FIXTURE_ORG = TOOL_ROOT / "fixture_org"


def main():
    if not FIXTURE_ORG.exists():
        print("fixture_org/ not found - run: python scripts/create_fixture_org.py")
        sys.exit(1)

    graph = DependencyGraph(str(FIXTURE_ORG))
    summary = graph.get_summary()

    print("=== SUMMARY ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    assert summary["apex_classes"] >= 7, "expected at least 7 apex classes"
    assert summary["apex_interfaces"] == 1, "expected exactly 1 interface (Loggable)"
    assert summary["apex_triggers"] == 1, "expected exactly 1 trigger (AccountTrigger)"
    assert summary["lwc_components"] == 4, "expected exactly 4 LWC bundles"

    print()
    print("=== NODES ===")
    for node in sorted(graph.nodes.values(), key=lambda n: n.id):
        print(f"  {node.id:35s} type={node.type.value:16s} in={node.in_degree} out={node.out_degree}")

    print()
    print("=== EXPECTED EDGES ===")

    checks = [
        ("AccountController", "BaseController", "extends"),
        ("AccountService", "Loggable", "implements"),
        ("AccountController", "AccountService", "static_call"),
        ("ContactController", "AccountService", None),  # mixed kinds, just assert it exists
        ("Utility", "BaseController", "field_access"),
        ("AccountTrigger", "AccountTriggerHandler", "static_call"),
        ("AccountTriggerHandler", "Utility", None),
    ]
    for source, target, expected_kind in checks:
        edge = graph.get_edge_detail(source, target)
        assert edge is not None, f"expected edge {source} -> {target} not found"
        if expected_kind:
            assert edge["kind"] == expected_kind, (
                f"{source} -> {target}: expected dominant kind {expected_kind!r}, got {edge['kind']!r}"
            )
        print(f"  OK  {source:22s} -> {target:22s} kind={edge['kind']} occurrences={edge['occurrence_count']}")

    # LWC edges
    lwc_checks = [
        ("accountCard", "AccountController", "apex_wire"),
        ("contactList", "ContactController", "apex_imperative"),
        ("orderSummary", "AccountController", "apex_unused_import"),
        ("dashboardPage", "accountCard", "composition"),
        ("dashboardPage", "contactList", "composition"),
    ]
    for source, target, expected_kind in lwc_checks:
        edge = graph.get_edge_detail(source, target)
        assert edge is not None, f"expected edge {source} -> {target} not found"
        assert edge["kind"] == expected_kind, (
            f"{source} -> {target}: expected dominant kind {expected_kind!r}, got {edge['kind']!r}"
        )
        print(f"  OK  {source:22s} -> {target:22s} kind={edge['kind']}")

    # isolated node
    email_id = graph.resolve_id("EmailService")
    assert email_id is not None
    email_node = graph.nodes[email_id]
    assert email_node.in_degree == 0 and email_node.out_degree == 0, "EmailService should be isolated"
    print("  OK  EmailService is isolated (in=0 out=0)")

    print()
    print("=== BLAST RADIUS: AccountService, depth=1, upstream ===")
    br = graph.blast_radius("AccountService", depth=1, direction="upstream")
    upstream_names = sorted(n["name"] for n in br["nodes"] if n["direction"] == "upstream")
    print("  1-hop upstream:", upstream_names)
    assert "AccountController" in upstream_names
    assert "ContactController" in upstream_names
    assert "EmailService" not in upstream_names

    print()
    print("=== BLAST RADIUS: AccountController, depth=None (all), both ===")
    br_all = graph.blast_radius("AccountController", depth=None, direction="both")
    names_all = sorted(n["name"] for n in br_all["nodes"])
    print("  connected component:", names_all)
    assert "AccountTrigger" in names_all, "AccountTrigger reaches AccountController transitively via handler+services"

    print()
    print("=== Edge detail (full occurrence list) ===")
    detail = graph.get_edge_detail("ContactController", "AccountService")
    assert detail is not None
    print(f"  ContactController -> AccountService: {detail['occurrence_count']} occurrence(s)")
    for occ in detail["occurrences"]:
        print(f"    {occ['file']}:{occ['line']} [{occ['kind']}] {occ['snippet']!r}")

    print()
    print("=== Case-insensitive / not-found lookups ===")
    assert graph.get_node_detail("accountcontroller") is not None, "case-insensitive lookup should work"
    assert graph.get_node_detail("DoesNotExist") is None, "unknown node should return None"
    print("  OK")

    print()
    print("=== FastAPI APP ===")
    app = create_app(graph)
    print("  App title:", app.title)

    print()
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
