public class OverloadCaller {
    public String callWithLabel() {
        OverloadTarget t = new OverloadTarget();
        return t.describe('hello');
    }
}
