public class NestedWrapperController {
    @AuraEnabled
    public static Wrapper getWrapper() {
        Wrapper w = new Wrapper();
        w.populate();
        return w;
    }

    public class Wrapper {
        @AuraEnabled
        public String name;

        public void populate() {
            name = buildName();
        }

        private String buildName() {
            return 'built';
        }

        private String unusedHelper() {
            return 'never called from anywhere, including within Wrapper itself';
        }
    }
}
