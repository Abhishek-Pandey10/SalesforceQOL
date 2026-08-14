public class OverloadTarget {
    public String describe() {
        return 'no args';
    }

    public String describe(String label) {
        return 'with label: ' + label;
    }

    // A third overload nobody calls - dead-code detection should flag just
    // this one (arity 2), not the other two live overloads of the same name.
    public String describe(String label, Boolean verbose) {
        return verbose ? ('verbose: ' + label) : label;
    }
}
