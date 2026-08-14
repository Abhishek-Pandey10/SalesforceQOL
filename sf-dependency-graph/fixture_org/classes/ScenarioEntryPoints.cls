public class ScenarioEntryPoints {
    @AuraEnabled
    public static void wireUpScenarios() {
        new DotQualifiedNameCollision().caller();
        new DuplicatedPolicyCaller().run();
        new DeadCodeSampleCaller().run();
        // Bare (unqualified) form - `new Outer.Inner().method()`
        // chained calls are a documented, narrow parser gap (see
        // apex_parser.py); the bare nested-type name still resolves via
        // the same fluent-chained-call-off-`new` handling every other
        // unqualified `new X().method()` call in this fixture already uses.
        new NestedNoQualifierCaller().build();
    }
}
