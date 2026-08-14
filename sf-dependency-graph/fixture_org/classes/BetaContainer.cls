public class BetaContainer {
    public Info build() {
        Info i = new Info();
        i.label = 'beta';
        return i;
    }

    public class Info {
        public String label;
    }
}
