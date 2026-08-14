public class ChainClassB {
    public void methodTwo() {
        System.debug('methodTwo does not call ChainClassC');
    }

    public void methodThree() {
        ChainClassC c = new ChainClassC();
        c.methodFour();
    }
}
