public class OuterWithNestedCaller {
    private static String helper() {
        return 'formatted by the enclosing type';
    }

    public class NestedNoQualifierCaller {
        public String build() {
            return helper();
        }
    }
}
