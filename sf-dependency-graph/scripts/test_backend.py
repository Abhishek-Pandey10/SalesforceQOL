"""Integration test for the backend, run against fixture_org (see
create_fixture_org.py) which - unlike samples/org1 - has real cross-references
so every edge kind the parsers detect can be asserted against."""
import sys
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOL_ROOT))

from backend.graph_builder import DependencyGraph, _read_all
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

    assert summary["apex_classes"] >= 14, "expected at least 14 apex classes"
    assert summary["apex_interfaces"] == 3, (
        "expected exactly 3 interfaces (Loggable, NotifierIface, MyScheduledInterface)"
    )
    assert summary["apex_triggers"] == 2, "expected exactly 2 triggers (AccountTrigger, OpportunityTrigger)"
    assert summary["lwc_components"] == 5, "expected exactly 5 LWC bundles"
    assert summary["test_classes"] == 2, (
        "expected exactly 2 @isTest classes (TestDataFactory, AccountControllerTest) - "
        "LegacyUtilityTest doesn't count, it's a non-@isTest class with one legacy "
        "testMethod-modifier method"
    )

    print()
    print("=== NODES ===")
    for node in sorted(graph.nodes.values(), key=lambda n: n.id):
        print(f"  {node.id:35s} type={node.type.value:16s} in={node.in_degree} out={node.out_degree}")

    print()
    print("=== EXPECTED EDGES ===")

    checks = [
        ("AccountController", "BaseController", "extends"),
        ("AccountService", "Loggable", "implements"),
        # Regression check: NightlyCleanupBatch's implements list also carries
        # Database.Batchable<sObject> and Database.Stateful (generic/namespaced,
        # not in this org) ahead of Loggable - a parser bug used to let those
        # two entries blank out the *whole* list, dropping this edge too.
        ("NightlyCleanupBatch", "Loggable", "implements"),
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
    print("=== TEST-CLASS FILTERING (@isTest / testMethod) ===")

    tdf_id = graph.resolve_id("TestDataFactory")
    act_id = graph.resolve_id("AccountControllerTest")
    lut_id = graph.resolve_id("LegacyUtilityTest")
    assert graph.nodes[tdf_id].is_test, "TestDataFactory should be flagged is_test (@isTest class)"
    assert graph.nodes[act_id].is_test, "AccountControllerTest should be flagged is_test (@isTest class)"
    assert not graph.nodes[lut_id].is_test, (
        "LegacyUtilityTest itself isn't @isTest - only its one testMethod-modifier "
        "method is test-only, the class isn't"
    )
    print("  OK  node-level is_test flags")

    default_graph = graph.get_graph()  # include_test defaults to False
    default_ids = {n["id"] for n in default_graph["nodes"]}
    assert tdf_id not in default_ids, "TestDataFactory should be excluded by default"
    assert act_id not in default_ids, "AccountControllerTest should be excluded by default"
    assert lut_id in default_ids, "LegacyUtilityTest should still appear (the class isn't @isTest)"
    default_edge_pairs = {(e["source"], e["target"]) for e in default_graph["edges"]}
    utility_id = graph.resolve_id("Utility")
    assert (lut_id, utility_id) not in default_edge_pairs, (
        "LegacyUtilityTest -> Utility only exists via a testMethod-flagged method, "
        "so it should be filtered out of the default (non-test) view"
    )
    print(f"  OK  default get_graph() excludes {summary['test_classes']} test class(es) and their edges")

    with_test_graph = graph.get_graph(include_test=True)
    with_test_ids = {n["id"] for n in with_test_graph["nodes"]}
    with_test_edge_pairs = {(e["source"], e["target"]) for e in with_test_graph["edges"]}
    assert tdf_id in with_test_ids and act_id in with_test_ids
    assert (lut_id, utility_id) in with_test_edge_pairs
    print("  OK  include_test=True brings test classes and their edges back")

    account_controller_id = graph.resolve_id("AccountController")
    default_node = next(n for n in default_graph["nodes"] if n["id"] == account_controller_id)
    with_test_node = next(n for n in with_test_graph["nodes"] if n["id"] == account_controller_id)
    assert with_test_node["in_degree"] == default_node["in_degree"] + 1, (
        "AccountController's in_degree should count the AccountControllerTest edge only "
        "when include_test=True - otherwise its degree looks the same with or without "
        "that extra test-only caller"
    )
    print(f"  OK  AccountController in_degree: {default_node['in_degree']} (prod) vs {with_test_node['in_degree']} (with test)")

    br_default = graph.blast_radius("LegacyUtilityTest", depth=1, direction="downstream")
    assert utility_id not in {n["id"] for n in br_default["nodes"]}, (
        "blast_radius should not traverse LegacyUtilityTest's test-only edge by default"
    )
    br_with_test = graph.blast_radius("LegacyUtilityTest", depth=1, direction="downstream", include_test=True)
    assert utility_id in {n["id"] for n in br_with_test["nodes"]}
    print("  OK  blast_radius respects include_test for traversal, not just display")

    br_focus_test_node = graph.blast_radius("AccountControllerTest", depth=1, direction="downstream")
    assert tdf_id in {n["id"] for n in br_focus_test_node["nodes"]}, (
        "focusing on a test node directly should show its real edges even though "
        "include_test defaulted to False - forcing it to False would make its own "
        "blast radius look empty"
    )
    print("  OK  focusing directly on a test node auto-includes test edges")

    # Bug fix: get_edge_detail() used to ignore include_test entirely and
    # always return the raw, unfiltered edge - unlike every other read path
    # above. That let the "load all occurrences" link (which hits this exact
    # method) leak test-only occurrences back in even with the toggle off,
    # and resolve an edge that only exists via a test-only occurrence even
    # though the default (non-test) view says it doesn't exist at all.
    edge_test_only_default = graph.get_edge_detail("LegacyUtilityTest", "Utility")
    assert edge_test_only_default is None, (
        "LegacyUtilityTest -> Utility only exists via a testMethod-flagged occurrence - "
        "get_edge_detail should honor include_test like every other read path and not "
        "resolve it at all by default"
    )
    edge_test_only_included = graph.get_edge_detail("LegacyUtilityTest", "Utility", include_test=True)
    assert edge_test_only_included is not None
    print("  OK  get_edge_detail respects include_test (both existence and occurrence filtering)")

    print()
    print("=== METHOD-LEVEL GRAPH (fixes the class1/class2/class3 false-transitive case) ===")

    a_id = graph.resolve_id("ChainClassA")
    b_id = graph.resolve_id("ChainClassB")
    c_id = graph.resolve_id("ChainClassC")
    method_one_id = f"{a_id}::methodOne!0"
    method_two_id = f"{b_id}::methodTwo!0"
    method_three_id = f"{b_id}::methodThree!0"
    method_four_id = f"{c_id}::methodFour!0"
    for mid in (method_one_id, method_two_id, method_three_id, method_four_id):
        assert mid in graph.nodes, f"expected method node {mid} to be registered"
    print("  OK  method nodes registered for ChainClassA/B/C")

    # The class-level edges alone (A -> B, B -> C) make a 2-hop blast radius
    # from A look like it reaches C - the exact ambiguity the method graph
    # exists to resolve.
    br_class_level = graph.blast_radius("ChainClassA", depth=2, direction="downstream")
    class_level_names = {n["name"] for n in br_class_level["nodes"]}
    assert "ChainClassB" in class_level_names and "ChainClassC" in class_level_names, (
        "sanity check: the class-level graph should still show the 2-hop path to ChainClassC"
    )
    verified_by_id = {n["id"]: n["verified"] for n in br_class_level["nodes"]}
    assert verified_by_id[b_id] is True, "ChainClassA really does call into ChainClassB (methodOne -> methodTwo)"
    assert verified_by_id[c_id] is False, (
        "ChainClassA's only call into ChainClassB is methodOne -> methodTwo, which never "
        "touches ChainClassC - only ChainClassB.methodThree() (never called by ChainClassA) "
        "does, so ChainClassC must be marked unverified, not silently treated as a real dependency"
    )
    print("  OK  blast_radius(ChainClassA) marks ChainClassB verified=True, ChainClassC verified=False")

    # The precise method-level graph shouldn't reach ChainClassC at all -
    # not even present in the result, since no real call chain gets there.
    br_method_level = graph.blast_radius(method_one_id, depth=5, direction="downstream")
    method_level_ids = {n["id"] for n in br_method_level["nodes"]}
    assert method_two_id in method_level_ids
    assert method_four_id not in method_level_ids and c_id not in method_level_ids, (
        "a precise blast radius starting from ChainClassA.methodOne() must never reach "
        "ChainClassC - that call chain doesn't exist"
    )
    print("  OK  method-level blast_radius(ChainClassA::methodOne) never reaches ChainClassC")

    # And from the other side: ChainClassB.methodThree() (not methodOne/methodTwo)
    # is what actually reaches ChainClassC.
    br_method_three = graph.blast_radius(method_three_id, depth=1, direction="downstream")
    assert method_four_id in {n["id"] for n in br_method_three["nodes"]}
    print("  OK  method-level blast_radius(ChainClassB::methodThree) does reach ChainClassC::methodFour")

    chain_a_detail = graph.get_node_detail("ChainClassA")
    assert chain_a_detail is not None and "methods" in chain_a_detail
    assert [m["id"] for m in chain_a_detail["methods"]] == [method_one_id], (
        "get_node_detail() should expose a class's methods for drill-down"
    )
    print("  OK  get_node_detail(ChainClassA) exposes its methods list")

    print()
    print("=== OVERLOAD DISAMBIGUATION ===")

    ot_id = graph.resolve_id("OverloadTarget")
    oc_id = graph.resolve_id("OverloadCaller")
    describe0_id = f"{ot_id}::describe!0"
    describe1_id = f"{ot_id}::describe!1"
    assert describe0_id in graph.nodes and describe1_id in graph.nodes, (
        "describe() and describe(String) should be two separate method nodes, not one"
    )
    print("  OK  describe() and describe(String) registered as distinct method nodes")

    call_with_label_id = f"{oc_id}::callWithLabel!0"
    br_overload = graph.blast_radius(call_with_label_id, depth=1, direction="downstream")
    overload_ids = {n["id"] for n in br_overload["nodes"]}
    assert describe1_id in overload_ids, "callWithLabel() passes 1 arg, should resolve to describe(String)"
    assert describe0_id not in overload_ids, "callWithLabel() should NOT resolve to the zero-arg describe()"
    print("  OK  call site with 1 argument resolves to describe(String), not describe()")

    # Bug fix: `pick(counter<max, true)` is 2 real arguments, but an unspaced
    # `<` immediately after an identifier char (`counter<max`, a common
    # unspaced-comparison style) used to be assumed a never-closing generic
    # open, silently swallowing the rest of the argument list and
    # miscounting this as 1 argument - resolving the call to the WRONG
    # overload instead of failing closed.
    agt_id = graph.resolve_id("ArityGuardTarget")
    agc_id = graph.resolve_id("ArityGuardCaller")
    pick1_id = f"{agt_id}::pick!1"
    pick2_id = f"{agt_id}::pick!2"
    run_arity_id = f"{agc_id}::run!2"
    br_arity = graph.blast_radius(run_arity_id, depth=1, direction="downstream")
    arity_ids = {n["id"] for n in br_arity["nodes"]}
    assert pick2_id in arity_ids, (
        "run()'s `t.pick(counter<max, true)` passes 2 real arguments - must resolve to pick(Integer, Boolean)"
    )
    assert pick1_id not in arity_ids, (
        "the unspaced comparison must not be misread as a generic that swallows the 2nd argument, "
        "silently resolving to the wrong (1-arg) overload instead"
    )
    print("  OK  unspaced comparison in a call argument (`counter<max, true`) still counts as 2 "
          "arguments and resolves to the right overload, not a miscounted/wrong one")

    print()
    print("=== POLYMORPHIC DISPATCH (possible_override edges) ===")

    poly_base_id = graph.resolve_id("PolyBase")
    poly_child_one_id = graph.resolve_id("PolyChildOne")
    poly_child_two_id = graph.resolve_id("PolyChildTwo")
    poly_caller_id = graph.resolve_id("PolyCaller")
    run_method_id = f"{poly_caller_id}::run!1"

    br_poly_class = graph.blast_radius("PolyCaller", depth=1, direction="downstream")
    poly_class_ids = {n["id"] for n in br_poly_class["nodes"]}
    assert poly_base_id in poly_class_ids, "PolyCaller directly calls item.describe() on the declared type PolyBase"
    assert poly_child_one_id in poly_class_ids and poly_child_two_id in poly_class_ids, (
        "PolyCaller.run(PolyBase item) could be handed a PolyChildOne/PolyChildTwo at runtime - "
        "both overrides should show up as possible_override edges, not just the declared type"
    )
    override_kinds = {
        e["target"]: e["kind"] for e in br_poly_class["edges"] if e["source"] == poly_caller_id
    }
    assert override_kinds.get(poly_base_id) == "static_call" or override_kinds.get(poly_base_id), (
        "sanity: direct edge to the declared type should exist"
    )
    assert override_kinds.get(poly_child_one_id) == "possible_override"
    assert override_kinds.get(poly_child_two_id) == "possible_override"
    print("  OK  blast_radius(PolyCaller) includes possible_override edges to both PolyChildOne and PolyChildTwo")

    br_poly_method = graph.blast_radius(run_method_id, depth=1, direction="downstream")
    poly_method_ids = {n["id"] for n in br_poly_method["nodes"]}
    assert f"{poly_child_one_id}::describe!0" in poly_method_ids
    assert f"{poly_child_two_id}::describe!0" in poly_method_ids
    print("  OK  method-level blast_radius(PolyCaller::run) also reaches both overrides")

    # possible_override edges are speculative (the runtime type might not
    # actually be the override), so they shouldn't count toward "verified".
    verified_by_poly_id = {n["id"]: n.get("verified") for n in br_poly_class["nodes"]}
    assert verified_by_poly_id.get(poly_base_id) is True, "the direct call to the declared type is a real chain"
    assert verified_by_poly_id.get(poly_child_one_id) is False, (
        "reachable *only* via a possible_override edge - shouldn't count as a verified real call chain"
    )
    assert verified_by_poly_id.get(poly_child_two_id) is False
    print("  OK  possible_override targets are shown but marked verified=False, not silently trusted")

    print()
    print("=== EXACT-TYPE CALL (chained off `new`) MUST NOT FAN OUT ===")

    exact_poly_id = graph.resolve_id("ExactTypePolyCaller")
    br_exact_poly = graph.blast_radius("ExactTypePolyCaller", depth=1, direction="downstream")
    exact_poly_ids = {n["id"] for n in br_exact_poly["nodes"]}
    assert poly_base_id in exact_poly_ids, "new PolyBase().describe() should still reach PolyBase itself"
    assert poly_child_one_id not in exact_poly_ids and poly_child_two_id not in exact_poly_ids, (
        "a call chained directly off `new PolyBase()` has an exactly-known concrete type (unlike "
        "PolyCaller's call through a declared PolyBase variable/param above) - it must not fan out "
        "possible_override edges to PolyBase's subclasses; there's no runtime-type ambiguity to "
        "speculate about when the object was just constructed right there"
    )
    exact_poly_edge_kinds = {
        e["target"]: e["kind"] for e in br_exact_poly["edges"] if e["source"] == exact_poly_id
    }
    assert exact_poly_edge_kinds.get(poly_base_id) != "possible_override"
    print("  OK  blast_radius(ExactTypePolyCaller) reaches PolyBase only, no possible_override fan-out")

    print()
    print("=== STATIC CALL MISCLASSIFICATION (same-named local var in another method) ===")

    static_scope_id = graph.resolve_id("StaticCallScopeCaller")
    account_service_id = graph.resolve_id("AccountService")
    edge_scope = graph.get_edge_detail("StaticCallScopeCaller", "AccountService")
    assert edge_scope is not None, "expected edge StaticCallScopeCaller -> AccountService not found"
    scope_kinds = {o["kind"] for o in edge_scope["occurrences"]}
    assert "static_call" in scope_kinds, (
        "callStatic()'s literal AccountService.getById(...) is a genuine static call - it must not be "
        "misclassified as instance_call just because useLocalVar(), a *different* method in the same "
        "class, happens to declare a local variable named `accountService` (the conventional Apex/Java "
        "'type name lowercased' pattern). local_type_map must be scoped per-method, not class-wide."
    )
    assert "instance_call" in scope_kinds, (
        "sanity: useLocalVar()'s call through its own `accountService` variable should still resolve"
    )
    print("  OK  StaticCallScopeCaller -> AccountService edge carries both static_call and instance_call, "
          "correctly attributed to the method that actually made each one")

    print()
    print("=== POLYMORPHIC DISPATCH THROUGH AN INTERFACE (possible_implementation edges) ===")

    notifier_iface_id = graph.resolve_id("NotifierIface")
    email_notifier_id = graph.resolve_id("EmailNotifier")
    sms_notifier_id = graph.resolve_id("SmsNotifier")
    notifier_runner_id = graph.resolve_id("NotifierRunner")
    alert_all_method_id = f"{notifier_runner_id}::alertAll!1"

    br_notifier_class = graph.blast_radius("NotifierRunner", depth=1, direction="downstream")
    notifier_class_ids = {n["id"] for n in br_notifier_class["nodes"]}
    assert email_notifier_id in notifier_class_ids and sms_notifier_id in notifier_class_ids, (
        "NotifierRunner.alertAll(NotifierIface notifier) could be handed an EmailNotifier or "
        "SmsNotifier at runtime - neither is ever `new`'d anywhere in this fixture, so the "
        "*only* way either becomes reachable at all is the possible_implementation fan-out"
    )
    notifier_kinds = {
        e["target"]: e["kind"] for e in br_notifier_class["edges"] if e["source"] == notifier_runner_id
    }
    assert notifier_kinds.get(email_notifier_id) == "possible_implementation"
    assert notifier_kinds.get(sms_notifier_id) == "possible_implementation"
    print("  OK  blast_radius(NotifierRunner) includes possible_implementation edges to both EmailNotifier and SmsNotifier")

    br_notifier_method = graph.blast_radius(alert_all_method_id, depth=1, direction="downstream")
    notifier_method_ids = {n["id"] for n in br_notifier_method["nodes"]}
    assert f"{email_notifier_id}::notify!1" in notifier_method_ids
    assert f"{sms_notifier_id}::notify!1" in notifier_method_ids
    print("  OK  method-level blast_radius(NotifierRunner::alertAll) also reaches both implementers' notify()")

    # possible_implementation edges are speculative, same as possible_override -
    # shouldn't count toward "verified".
    verified_by_notifier_id = {n["id"]: n.get("verified") for n in br_notifier_class["nodes"]}
    assert verified_by_notifier_id.get(email_notifier_id) is False, (
        "reachable *only* via a possible_implementation edge - shouldn't count as a verified real call chain"
    )
    assert verified_by_notifier_id.get(sms_notifier_id) is False
    print("  OK  possible_implementation targets are shown but marked verified=False, not silently trusted")

    print()
    print("=== FLUENT CALL CHAINED DIRECTLY OFF `new` ===")

    report_builder_id = graph.resolve_id("ReportBuilder")
    report_runner_id = graph.resolve_id("ReportRunner")
    edge = graph.get_edge_detail("ReportRunner", "ReportBuilder")
    assert edge is not None, "expected edge ReportRunner -> ReportBuilder not found"
    edge_kinds = {o["kind"] for o in edge["occurrences"]}
    assert "instantiation" in edge_kinds, "sanity: the `new ReportBuilder()` itself should still be recorded"
    assert "instance_call" in edge_kinds, (
        "new ReportBuilder().build() chains a call directly off the constructor - that call "
        "(not just the instantiation) must be recorded too"
    )
    print("  OK  ReportRunner -> ReportBuilder edge carries both instantiation and instance_call occurrences")

    run_id = f"{report_runner_id}::run!0"
    build_id = f"{report_builder_id}::build!0"
    br_fluent = graph.blast_radius(run_id, depth=1, direction="downstream")
    assert build_id in {n["id"] for n in br_fluent["nodes"]}, (
        "method-level blast_radius(ReportRunner::run) should reach ReportBuilder::build() "
        "even though it's called directly off `new`, never assigned to a variable"
    )
    print("  OK  method-level blast_radius(ReportRunner::run) reaches ReportBuilder::build()")

    print()
    print("=== MULTI-VARIABLE DECLARATION (`Utility first, second;`) ===")

    multi_decl_id = graph.resolve_id("MultiDeclCaller")
    utility_id_for_multi = graph.resolve_id("Utility")
    edge_multi = graph.get_edge_detail("MultiDeclCaller", "Utility")
    assert edge_multi is not None, "expected edge MultiDeclCaller -> Utility not found"
    multi_kinds = {o["kind"] for o in edge_multi["occurrences"]}
    assert "instance_call" in multi_kinds, (
        "`second` is the *second* name in `Utility first, second;` - only `first` used to be "
        "mapped to Utility, so second.formatDate(...) was silently unresolvable"
    )
    print("  OK  MultiDeclCaller -> Utility edge carries an instance_call via the second declared name")

    print()
    print("=== SAME-CLASS CALLS (bare / this. / same-typed variable) ===")

    # Bug fix: apex_parser only ever resolved an identifier against the
    # *other*-classes symbol table - a call to a method on the enclosing
    # class itself, written without a receiver (`checkPermission(x)`, the
    # overwhelmingly common Apex style for a private helper) or with an
    # explicit `this.` qualifier, produced no occurrence at all, at any
    # level. That made a perfectly-live helper read as unreachable dead code
    # whenever nothing *outside* its own class happened to call it too.

    rag_id = graph.resolve_id("ReportAccessGate")
    edge_self_call = graph.get_edge_detail("ReportAccessGate", "ReportAccessGate")
    assert edge_self_call is None, (
        "a same-class call must not create a class-level self-loop edge - only "
        "the finer-grained method-level edge below should exist for it"
    )
    can_access_id = f"{rag_id}::canAccess!1"
    check_permission_id = f"{rag_id}::checkPermission!1"
    br_self_call = graph.blast_radius(can_access_id, depth=1, direction="downstream")
    assert check_permission_id in {n["id"] for n in br_self_call["nodes"]}, (
        "canAccess()'s bare `checkPermission(userId)` call (no receiver) must resolve "
        "to a real method-level edge onto this class's own checkPermission()"
    )
    print("  OK  bare same-class call (ReportAccessGate.canAccess -> checkPermission) "
          "resolves to a method-level edge, with no class-level self-loop")

    tqc_id = graph.resolve_id("ThisQualifiedCaller")
    run_this_id = f"{tqc_id}::run!0"
    helper_this_id = f"{tqc_id}::helper!0"
    br_this_call = graph.blast_radius(run_this_id, depth=1, direction="downstream")
    assert helper_this_id in {n["id"] for n in br_this_call["nodes"]}, (
        "run()'s `this.helper()` call must resolve to a method-level edge onto "
        "this class's own helper(), same as the bare (no `this.`) form"
    )
    print("  OK  explicit this.-qualified same-class call resolves to a method-level edge")

    stvc_id = graph.resolve_id("SelfTypedVariableCaller")
    run_var_id = f"{stvc_id}::run!0"
    helper_var_id = f"{stvc_id}::helper!0"
    br_var_call = graph.blast_radius(run_var_id, depth=1, direction="downstream")
    assert helper_var_id in {n["id"] for n in br_var_call["nodes"]}, (
        "run()'s call through `other`, a local variable declared as this class's "
        "own type (SelfTypedVariableCaller), must also resolve to a method-level edge"
    )
    print("  OK  call through a same-type-declared local variable resolves to a method-level edge")

    # Bug fix: `helper.process()` (a call on a DIFFERENT class) and a bare
    # same-class call to THIS class's own process() are indistinguishable
    # once you strip whitespace - both are just "process" immediately
    # followed by "(". The bare-call heuristic used to only check whether
    # the receiver resolved to a known type/variable, never whether the
    # identifier itself was immediately preceded by a `.` - so whenever the
    # calling class also happened to declare its own same-named method, the
    # call was misattributed as a phantom same-class self-call, hiding the
    # real callee's dead-ness.
    dqc_id = graph.resolve_id("DotQualifiedNameCollision")
    dqh_id = graph.resolve_id("DotQualifiedHelper")
    collision_process_id = f"{dqc_id}::process!0"
    helper_process_id = f"{dqh_id}::process!0"
    dead_code_collision = graph.get_dead_code()
    collision_dead_ids = {item["id"] for item in dead_code_collision["dead"]}
    assert collision_process_id in collision_dead_ids, (
        "DotQualifiedNameCollision.process() is never really called by anything - calling "
        "DotQualifiedHelper.process() (a different class) must not give it a phantom self-call"
    )
    assert helper_process_id not in collision_dead_ids, (
        "sanity: DotQualifiedHelper.process() IS genuinely called from caller() and must not be dead"
    )
    assert graph.get_edge_detail("DotQualifiedNameCollision", "DotQualifiedNameCollision") is None, (
        "no phantom class-level self-loop either"
    )
    print("  OK  a call on a DIFFERENT class whose method name collides with the caller's own "
          "method name does not create a phantom same-class self-call")

    # Same root cause, the `super.` case: only `this.` was special-cased as
    # an explicit same-class qualifier, so `super.handle()` fell through to
    # the same bare-call heuristic and misread itself as a same-class call.
    scc_id = graph.resolve_id("SuperCallChild")
    super_handle_id = f"{scc_id}::handle!0"
    assert super_handle_id in collision_dead_ids, (
        "SuperCallChild.handle() is never really called by anything - super.handle() inside its "
        "own override body must not give it a phantom self-loop that makes it look used"
    )
    print("  OK  super.method() does not create a phantom self-call on the overriding method either")

    # Bug fix (parsing, not reachability): `super.handle()` used to be
    # invisible to the parser entirely (only "this." was special-cased as an
    # explicit same-class qualifier; "super" matched neither a declared
    # local/field nor an org type, so it fell through every branch with no
    # occurrence emitted at any level) - the edge below proves that's fixed:
    # SuperCallChild.handle()'s super.handle() resolves to a real method-
    # level edge onto SuperCallBase's own handle(), independent of whether
    # SuperCallChild.handle() itself is ever reached.
    scb_id = graph.resolve_id("SuperCallBase")
    base_handle_id = f"{scb_id}::handle!0"
    br_super_call = graph.blast_radius(super_handle_id, depth=1, direction="downstream")
    assert base_handle_id in {n["id"] for n in br_super_call["nodes"]}, (
        "SuperCallChild.handle()'s `super.handle()` call must resolve to a method-level edge "
        "onto SuperCallBase's own handle()"
    )
    print("  OK  super.method() resolves to a real method-level edge onto the base class's own method")

    # Reachability, separate from the edge existing: SuperCallBase.handle()'s
    # *only* caller is SuperCallChild.handle(), which is itself dead (nothing
    # calls the override - see above) - so the super-call chain as a whole is
    # unreachable from anything live, and SuperCallBase.handle() is now
    # correctly swept into `dead` too, not just its direct caller. Before
    # mark-and-sweep reachability, a direct textual caller was enough to look
    # "used" regardless of whether that caller itself was ever reached.
    assert base_handle_id in collision_dead_ids, (
        "SuperCallBase.handle()'s only caller (the override) is itself unreachable - the whole "
        "super-call chain is dead and must be flagged, not just SuperCallChild.handle()"
    )
    base_handle_item = next(item for item in dead_code_collision["dead"] if item["id"] == base_handle_id)
    assert base_handle_item["only_reachable_from_dead_code"] is True
    print("  OK  SuperCallBase.handle() is correctly swept into `dead` too - its only caller "
          "(the override) is itself unreachable, despite the super.handle() edge being real")

    # Bug fix: a nested type calling its ENCLOSING type's method with no
    # qualifier at all (`helper()` instead of `Outer.helper()`) - legal Apex,
    # since a nested class can access its enclosing type's static members
    # unqualified. self_method_names was scoped only to the type actually
    # being scanned, so from inside the nested type's own isolated scan this
    # matched nothing (not a declared local, not an org type, not one of the
    # nested type's own methods) and vanished with no occurrence at any
    # level - OuterWithNestedCaller.helper() used to read as dead despite
    # being called on every NestedNoQualifierCaller.build().
    owner_id = graph.resolve_id("OuterWithNestedCaller")
    helper_bare_id = f"{owner_id}::helper!0"
    nested_id = graph.resolve_id("OuterWithNestedCaller.NestedNoQualifierCaller")
    assert nested_id is not None, "the nested NestedNoQualifierCaller class should be its own node"
    build_id = f"{nested_id}::build!0"
    dead_code_nested = graph.get_dead_code()
    nested_dead_ids = {item["id"] for item in dead_code_nested["dead"]}
    assert helper_bare_id not in nested_dead_ids, (
        "OuterWithNestedCaller.helper() IS genuinely called, unqualified, from its nested "
        "NestedNoQualifierCaller.build() - must not read as dead"
    )
    br_nested_call = graph.blast_radius(build_id, depth=1, direction="downstream")
    assert helper_bare_id in {n["id"] for n in br_nested_call["nodes"]}, (
        "NestedNoQualifierCaller.build()'s bare `helper()` call must resolve to a method-level "
        "edge onto the enclosing OuterWithNestedCaller's own helper()"
    )
    print("  OK  a nested type's bare call to its enclosing type's method resolves to a "
          "real method-level edge")

    print()
    print("=== DEAD CODE DETECTION ===")

    dead_code = graph.get_dead_code(include_entry_points=True)
    dead_ids = {item["id"] for item in dead_code["dead"]}
    test_only_ids = {item["id"] for item in dead_code["test_only"]}
    excluded_reasons = {item["id"]: item["reason"] for item in dead_code["entry_points_excluded"]}

    sample_id = graph.resolve_id("DeadCodeSample")
    used_method_id = f"{sample_id}::usedMethod!0"
    unused_method_id = f"{sample_id}::unusedMethod!0"
    test_only_method_id = f"{sample_id}::testOnlyMethod!0"
    ctor_id = f"{sample_id}::DeadCodeSample!0"
    aura_method_id = f"{sample_id}::getUnusedAuraMethod!0"
    invocable_method_id = f"{sample_id}::unusedInvocableMethod!0"

    assert unused_method_id in dead_ids, "unusedMethod() has no callers anywhere - should be flagged dead"
    assert used_method_id not in dead_ids and used_method_id not in test_only_ids, (
        "usedMethod() is called from DeadCodeSampleCaller.run() - must not appear in either bucket"
    )
    assert test_only_method_id in test_only_ids and test_only_method_id not in dead_ids, (
        "testOnlyMethod() is called only from AccountControllerTest - should land in test_only, not dead"
    )
    print("  OK  usedMethod/unusedMethod/testOnlyMethod land in the right bucket (or none)")

    # Constructors are no longer force-excluded as entry points: `new X(...)`
    # resolves to a real method-level edge onto the specific constructor
    # overload, so DeadCodeSample()'s in_degree is genuine signal (from
    # DeadCodeSampleCaller.run()'s `new DeadCodeSample()`), same as any
    # other method's - not an annotation/platform-callback exclusion.
    assert excluded_reasons.get(ctor_id) is None, (
        f"the constructor isn't a known-entry-point exclusion anymore; got reason={excluded_reasons.get(ctor_id)!r}"
    )
    assert ctor_id not in dead_ids and ctor_id not in test_only_ids, (
        "DeadCodeSample() IS genuinely called via `new DeadCodeSample()` in "
        "DeadCodeSampleCaller.run() - must not appear in either bucket"
    )
    print("  OK  constructor resolves a real in-degree via `new X()` (not flagged dead)")

    assert excluded_reasons.get(aura_method_id) == "@AuraEnabled"
    assert excluded_reasons.get(invocable_method_id) == "@InvocableMethod"
    assert aura_method_id not in dead_ids and invocable_method_id not in dead_ids
    print("  OK  @AuraEnabled / @InvocableMethod methods excluded as entry points, not flagged dead")

    # NightlyCleanupBatch's start/execute/finish are unused Batchable
    # callback stubs, all declared `global` (required for a `global class`) -
    # that modifier check runs before the platform-interface check (see
    # graph_builder's precedence), so their reason is "global modifier",
    # not "Batchable.*". Still a correct exclusion either way.
    nightly_id = graph.resolve_id("NightlyCleanupBatch")
    for method_name, arity in (("start", 1), ("execute", 2), ("finish", 1)):
        mid = f"{nightly_id}::{method_name}!{arity}"
        assert excluded_reasons.get(mid) == "global modifier", (
            f"expected {mid} excluded as 'global modifier', got {excluded_reasons.get(mid)!r}"
        )
        assert mid not in dead_ids
    print("  OK  NightlyCleanupBatch's global Batchable start/execute/finish excluded (global modifier)")

    # ScheduledCleanupJob.execute() is plain `public`, not `global`, and
    # carries no annotation - the only thing that excludes it is the
    # Schedulable-interface check itself, so this is what actually proves
    # _platform_entry_reason works (NightlyCleanupBatch's `global` methods
    # above don't reach that code path at all).
    scheduled_id = graph.resolve_id("ScheduledCleanupJob")
    scheduled_execute_id = f"{scheduled_id}::execute!1"
    assert excluded_reasons.get(scheduled_execute_id) == "Schedulable.execute", (
        f"expected {scheduled_execute_id} excluded as 'Schedulable.execute', "
        f"got {excluded_reasons.get(scheduled_execute_id)!r}"
    )
    assert scheduled_execute_id not in dead_ids
    print("  OK  ScheduledCleanupJob.execute() excluded via the Schedulable-interface check")

    # Type.forName('ReflectivelyInstantiated') should resolve to a real
    # class-level edge - but that only proves the *class* gets instantiated,
    # not that any of its methods are ever called, so identify() should
    # still show up as dead.
    dyn_edge = graph.get_edge_detail("ReflectionFactory", "ReflectivelyInstantiated")
    assert dyn_edge is not None, "Type.forName('ReflectivelyInstantiated') should resolve to a real edge"
    assert dyn_edge["kind"] == "dynamic_instantiation"
    identify_id = f"{graph.resolve_id('ReflectivelyInstantiated')}::identify!0"
    assert identify_id in dead_ids, (
        "reachable via Type.forName proves the class gets instantiated, not that identify() is "
        "ever called - it should still be flagged dead"
    )
    print("  OK  Type.forName('ReflectivelyInstantiated') resolves to a dynamic_instantiation edge, "
          "and identify() is still flagged dead despite the class being reflectively reachable")

    print()
    print("=== MORE ENTRY POINTS (REST, webservice, arity-aware platform check) ===")

    dead_code_2 = graph.get_dead_code(include_entry_points=True)
    excluded_2 = {i["id"]: i["reason"] for i in dead_code_2["entry_points_excluded"]}
    dead_2 = {i["id"] for i in dead_code_2["dead"]}

    rest_id = graph.resolve_id("LegacyOrderRestResource")
    get_order_id = f"{rest_id}::getOrder!0"
    create_order_id = f"{rest_id}::createOrder!0"
    assert excluded_2.get(get_order_id) == "@HttpGet", (
        f"expected {get_order_id} excluded as '@HttpGet' (the more specific annotation should win "
        f"over the generic 'global modifier' check - see _ENTRY_POINT_CHECKS order), "
        f"got {excluded_2.get(get_order_id)!r}"
    )
    assert excluded_2.get(create_order_id) == "@HttpPost"
    print("  OK  @HttpGet/@HttpPost REST endpoints excluded, with the specific annotation as the reason")

    ws_id = graph.resolve_id("LegacyWebServiceProvider")
    ws_method_id = f"{ws_id}::legacySoapMethod!1"
    assert excluded_2.get(ws_method_id) == "webservice modifier", (
        "a `webservice` method's own signature buffer never contains the literal word 'global' "
        "(only the class declaration does, a separate buffer this per-method scan never sees) - "
        f"without its own check this was a real false-positive gap, got {excluded_2.get(ws_method_id)!r}"
    )
    print("  OK  legacy `webservice` modifier excluded on its own (not piggybacking on 'global')")

    qwdo_id = graph.resolve_id("QueueableWithDeadOverload")
    real_execute_id = f"{qwdo_id}::execute!1"
    dead_overload_id = f"{qwdo_id}::execute!2"
    assert excluded_2.get(real_execute_id) == "Queueable.execute", (
        f"expected the real execute(QueueableContext) (arity 1) excluded as the platform callback, "
        f"got {excluded_2.get(real_execute_id)!r}"
    )
    assert dead_overload_id in dead_2, (
        "execute(String, Boolean) (arity 2) is a same-named but unrelated overload of the real "
        "Queueable.execute(QueueableContext) (arity 1) - the platform-interface exclusion must be "
        "arity-aware, not name-only, or this genuinely dead overload gets a free pass it doesn't earn"
    )
    print("  OK  platform-interface exclusion is arity-aware: real execute(QueueableContext) excluded, "
          "unrelated execute(String,Boolean) overload still correctly flagged dead")

    # Bug fix: method nodes are keyed by name+arity, not full signature, so
    # ReversedOrderQueueable's two `execute` overloads (String vs
    # QueueableContext, both arity 1) collapse onto ONE method node - which
    # occurrence's info won used to depend purely on declaration order
    # (whichever span graph_builder saw first). The real platform callback
    # is declared SECOND here; regardless of order, the merged node must
    # still end up excluded as a known entry point.
    roq_id = graph.resolve_id("ReversedOrderQueueable")
    roq_execute_id = f"{roq_id}::execute!1"
    assert excluded_2.get(roq_execute_id) == "Queueable.execute", (
        "the real execute(QueueableContext) exists among the colliding same-arity declarations - "
        f"the merged node must be excluded regardless of which was declared first, got "
        f"{excluded_2.get(roq_execute_id)!r}"
    )
    assert roq_execute_id not in dead_2
    print("  OK  platform-entry-point exclusion applies to a same-arity overload collision "
          "regardless of which colliding declaration came first")

    # Bug fix: a duplicate-named class (e.g. a stray backup copy, or two org
    # exports merged into one folder) used to have its own method-loop
    # skipped entirely via an early `continue` - so a method that exists
    # ONLY in the duplicate file (not also declared, under the same
    # name+arity, in the first occurrence) never got a node at all: not
    # flagged dead, not flagged alive, simply absent from the graph. Keeping
    # the first occurrence's class-level identity is still the deliberate
    # policy; only the "duplicate's own methods vanish" part was the bug.
    assert "DuplicatedPolicy" in graph.summary.duplicate_names
    dup_id = graph.resolve_id("DuplicatedPolicy")
    dup_first_id = f"{dup_id}::firstOccurrenceMethod!0"
    dup_second_id = f"{dup_id}::secondOccurrenceOnlyMethod!0"
    assert dup_second_id in graph.nodes, (
        "secondOccurrenceOnlyMethod() exists only in the duplicate-named file's own body - "
        "it must still get a method node under the shared class node, not vanish"
    )
    dead_code_dup = graph.get_dead_code()
    dup_dead_ids = {item["id"] for item in dead_code_dup["dead"]}
    assert dup_second_id in dup_dead_ids, (
        "nothing calls secondOccurrenceOnlyMethod() - now that it has a node at all, it should "
        "correctly show up as a real dead-code candidate"
    )
    assert dup_first_id not in dup_dead_ids, (
        "sanity: firstOccurrenceMethod() IS genuinely called from DuplicatedPolicyCaller"
    )
    print("  OK  a duplicate-named class's own unique methods still get their own nodes and are "
          "correctly analyzed for dead code, instead of silently vanishing")

    # get_dead_code() does real reachability now (see graph_builder.
    # _compute_method_reachability, called via get_dead_code) - a
    # mark-and-sweep from live entry points, not just a local in_degree==0
    # check. DeadLoopA.ping() and DeadLoopB.pong() (create_fixture_org.py
    # item 10) call only each other and nothing else in the org calls
    # either one - each has local in_degree=1 (from the other), which used
    # to be enough to look "used"; neither is reachable from any live root,
    # so both are now correctly flagged dead. This is the exact fixture the
    # README used to cite as "the cleanest possible demonstration" of the
    # local-check gap - now the demonstration that the gap is closed.
    loop_a_id = graph.resolve_id("DeadLoopA")
    loop_b_id = graph.resolve_id("DeadLoopB")
    loop_ping_id = f"{loop_a_id}::ping!0"
    loop_pong_id = f"{loop_b_id}::pong!0"
    dead_code_loop = graph.get_dead_code()
    loop_dead_ids = {item["id"] for item in dead_code_loop["dead"]}
    assert loop_ping_id in loop_dead_ids and loop_pong_id in loop_dead_ids, (
        "a mutually-referential dead pair, unreachable from anything live, must now be caught "
        "by mark-and-sweep reachability even though each has local in_degree=1 from the other"
    )
    print("  OK  a mutually-referential dead pair (DeadLoopA/DeadLoopB) is correctly flagged dead "
          "by mark-and-sweep reachability, despite nonzero local in_degree at both nodes")

    # create_fixture_org.py item 9: OrphanedLegacyCaller.run() has no caller
    # anywhere (correctly dead under the old local check too) and calls
    # OrphanedLegacyTarget.doWork() - which used to read as "used" purely
    # because it had *a* direct caller, even though that caller is itself
    # unreachable from anything live. Reachability must now sweep across
    # the class boundary and catch doWork() too.
    orphan_caller_id = graph.resolve_id("OrphanedLegacyCaller")
    orphan_target_id = graph.resolve_id("OrphanedLegacyTarget")
    orphan_run_id = f"{orphan_caller_id}::run!0"
    orphan_dowork_id = f"{orphan_target_id}::doWork!0"
    dead_code_orphan = graph.get_dead_code()
    orphan_dead_ids = {item["id"] for item in dead_code_orphan["dead"]}
    assert orphan_run_id in orphan_dead_ids, "nothing calls OrphanedLegacyCaller.run() - dead under any check"
    assert orphan_dowork_id in orphan_dead_ids, (
        "OrphanedLegacyTarget.doWork()'s only caller is itself dead code (OrphanedLegacyCaller.run()) "
        "- the whole two-class chain is unreachable from anything live and must be flagged dead, "
        "not just the top of the chain"
    )
    dowork_item = next(item for item in dead_code_orphan["dead"] if item["id"] == orphan_dowork_id)
    assert dowork_item["only_reachable_from_dead_code"] is True, (
        "doWork() does have a direct (local) caller - it's only unreachable transitively, through "
        "that caller's own dead-ness - the API should surface that distinction"
    )
    print("  OK  a dead chain across a class boundary (OrphanedLegacyCaller -> OrphanedLegacyTarget) "
          "is fully caught, not just its top-of-chain caller")

    # Pass 1.6: a class implementing a CUSTOM interface that itself
    # `extends Schedulable` (rather than naming Schedulable directly) must
    # still be recognized as a platform entry point - see
    # graph_builder._transitive_interface_names and README "Known
    # limitations". Without walking implements -> extends transitively,
    # IndirectScheduledJob.execute() would incorrectly show up as dead.
    dead_code_indirect = graph.get_dead_code(include_entry_points=True)
    indirect_id = graph.resolve_id("IndirectScheduledJob")
    indirect_execute_id = f"{indirect_id}::execute!1"
    indirect_dead_ids = {item["id"] for item in dead_code_indirect["dead"]}
    indirect_excluded = {item["id"]: item["reason"] for item in dead_code_indirect["entry_points_excluded"]}
    assert indirect_execute_id not in indirect_dead_ids, (
        "IndirectScheduledJob.execute() is a real Schedulable callback, reached only through a "
        "custom interface (MyScheduledInterface) that itself extends Schedulable - must not be "
        "flagged dead just because Schedulable isn't named in the class's own implements clause"
    )
    assert indirect_excluded.get(indirect_execute_id) == "Schedulable.execute", (
        f"expected {indirect_execute_id} excluded as 'Schedulable.execute' via the indirect "
        f"interface walk, got {indirect_excluded.get(indirect_execute_id)!r}"
    )
    print("  OK  a class implementing a custom interface that itself extends Schedulable is "
          "recognized as a platform entry point via the transitive implements->extends walk")

    print()
    print("=== NESTED CLASSES (a class declared inside another class) ===")

    # Bug fix: find_method_spans only ever captured methods at brace-depth 1
    # (directly inside the file's one registered type), and only one type
    # per file was registered at all - a nested class (the extremely common
    # @AuraEnabled-controller-returning-an-inner-Wrapper pattern) was
    # entirely invisible: no node, no methods, not flagged dead, not shown
    # as used, just absent from the graph.

    wrapper_id = graph.resolve_id("NestedWrapperController.Wrapper")
    assert wrapper_id is not None, "the nested Wrapper class should be its own node"
    assert graph.resolve_id("Wrapper") == wrapper_id, (
        "the bare name should also resolve to the nested type (the common in-file / "
        "same-outer-class reference), alongside the qualified form"
    )
    wrapper_node = graph.nodes[wrapper_id]
    assert wrapper_node.parent_id == graph.resolve_id("NestedWrapperController"), (
        "a nested type's parent_id should point at its enclosing class"
    )
    print("  OK  NestedWrapperController.Wrapper is its own node, resolvable by bare or qualified name")

    populate_id = f"{wrapper_id}::populate!0"
    build_name_id = f"{wrapper_id}::buildName!0"
    unused_helper_id = f"{wrapper_id}::unusedHelper!0"
    for mid in (populate_id, build_name_id, unused_helper_id):
        assert mid in graph.nodes, f"expected method node {mid} to be registered on the nested type"
    print("  OK  Wrapper's own methods (populate/buildName/unusedHelper) are registered on IT, not the outer class")

    # Same-class-call resolution must work *within* a nested type too:
    # populate() calls buildName() with no qualifier, both declared on Wrapper.
    br_wrapper_self_call = graph.blast_radius(populate_id, depth=1, direction="downstream")
    assert build_name_id in {n["id"] for n in br_wrapper_self_call["nodes"]}, (
        "populate()'s bare buildName() call should resolve to a method-level edge "
        "onto Wrapper's own buildName(), the same same-class-call machinery used "
        "for a top-level type's own methods"
    )
    print("  OK  same-class call resolution works within a nested type (Wrapper.populate -> Wrapper.buildName)")

    # The outer class's own scan must not also pick up (and misattribute)
    # references that live inside the nested type's body - no class-level
    # self-loop, and no edge from the outer class to itself for content that
    # actually belongs to Wrapper.
    outer_id = graph.resolve_id("NestedWrapperController")
    assert graph.get_edge_detail("NestedWrapperController", "NestedWrapperController") is None
    outer_wrapper_edge = graph.get_edge_detail("NestedWrapperController", "NestedWrapperController.Wrapper")
    assert outer_wrapper_edge is not None, "the outer class's own getWrapper() does reference Wrapper directly"
    print("  OK  outer class's scan doesn't leak Wrapper's own internal references onto itself")

    # Cross-file references, both forms - a real false-positive source until
    # `new Outer.Inner()` and `Outer.Inner` (as a bare type, e.g. a return
    # type) were fixed: the qualified form used to wrongly emit an edge onto
    # the *outer* class instead of the nested one.
    ext_id = graph.resolve_id("NestedWrapperExternalCaller")
    assert graph.get_edge_detail("NestedWrapperExternalCaller", "NestedWrapperController.Wrapper") is not None, (
        "NestedWrapperExternalCaller references Wrapper both as a qualified return "
        "type/`new Outer.Inner()` and as a bare return type/`new Inner()` - both must "
        "resolve to a real edge onto Wrapper"
    )
    ext_outer_edge = graph.get_edge_detail("NestedWrapperExternalCaller", "NestedWrapperController")
    assert ext_outer_edge is None, (
        "NestedWrapperExternalCaller never references the outer NestedWrapperController "
        "class itself - only its nested Wrapper - so no edge to the outer class should exist "
        "(this was the actual bug: `new Outer.Inner()` used to wrongly instantiate Outer, and "
        "a bare `Outer.Inner` return type used to wrongly read as a field access on Outer)"
    )
    print("  OK  cross-file bare and qualified references to a nested type both resolve correctly, "
          "with no spurious edge onto the outer class")

    # Dead-code detection must isolate the nested type's own dead method
    # correctly - not attribute it to the outer class, not miss it entirely.
    nested_dead_code = graph.get_dead_code()
    nested_dead_ids = {item["id"] for item in nested_dead_code["dead"]}
    assert unused_helper_id in nested_dead_ids, (
        "Wrapper.unusedHelper() has no callers anywhere (not even from within Wrapper "
        "itself) - should be flagged dead, attributed to Wrapper, not the outer class"
    )
    assert populate_id not in nested_dead_ids and build_name_id not in nested_dead_ids
    print("  OK  dead-code detection correctly isolates Wrapper.unusedHelper() as Wrapper's own dead method")

    # Same-named nested types declared in two *unrelated* files (AlphaContainer.Info
    # vs BetaContainer.Info) - bug fix regression: the bare name's global symbol-table
    # entry is first-occurrence-wins, so without graph_builder.py's per-file
    # `file_symbol_table` override, whichever file lost that race would have its own
    # bare `Info`/`new Info()` misresolve onto the OTHER class's Info node entirely
    # (a wrong edge, not just a missing one). Each container's build() must resolve
    # to its OWN nested Info regardless of file scan order.
    alpha_info_id = graph.resolve_id("AlphaContainer.Info")
    beta_info_id = graph.resolve_id("BetaContainer.Info")
    assert alpha_info_id is not None and beta_info_id is not None and alpha_info_id != beta_info_id
    alpha_edge = graph.get_edge_detail("AlphaContainer", "AlphaContainer.Info")
    beta_edge = graph.get_edge_detail("BetaContainer", "BetaContainer.Info")
    assert alpha_edge is not None, "AlphaContainer.build() should resolve its bare `Info` to its OWN nested Info"
    assert beta_edge is not None, "BetaContainer.build() should resolve its bare `Info` to its OWN nested Info"
    assert graph.get_edge_detail("AlphaContainer", "BetaContainer.Info") is None, (
        "AlphaContainer must never wire onto BetaContainer's Info just because it lost "
        "the global first-occurrence-wins race for the bare name 'Info'"
    )
    assert graph.get_edge_detail("BetaContainer", "AlphaContainer.Info") is None, (
        "BetaContainer must never wire onto AlphaContainer's Info just because it lost "
        "the global first-occurrence-wins race for the bare name 'Info'"
    )
    print("  OK  same-named nested types in unrelated files (AlphaContainer.Info / BetaContainer.Info) "
          "each resolve their own bare reference to themselves, not to each other")

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
    print("=== _read_all PRESERVES INPUT ORDER (deterministic duplicate-type resolution) ===")

    # Bug fix: _read_all used to build its result dict by iterating `done`,
    # a set of completed Futures - set iteration order depends on Future
    # hash/completion timing, not the order paths were given. _build's Pass 1
    # relies on this function's return order to decide which of two
    # duplicate-named Apex files becomes the canonical node ("first
    # occurrence wins"), so that choice used to be able to differ between
    # separate runs of the tool against the exact same unchanged folder.
    read_all_paths = [
        FIXTURE_ORG / "classes" / "AccountController.cls",
        FIXTURE_ORG / "classes" / "Utility.cls",
        FIXTURE_ORG / "classes" / "EmailService.cls",
        FIXTURE_ORG / "classes" / "ContactController.cls",
    ]
    read_all_result = _read_all(read_all_paths)
    assert list(read_all_result.keys()) == read_all_paths, (
        "_read_all should return content keyed in the same order its paths argument was given, "
        "regardless of which thread happened to finish reading first"
    )
    print("  OK  _read_all's result dict preserves the input paths' order")

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
