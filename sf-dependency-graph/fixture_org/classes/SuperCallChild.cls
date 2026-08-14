public class SuperCallChild extends SuperCallBase {
    // Never actually called by anything - regression test that
    // super.handle() doesn't give this a phantom self-loop.
    public override void handle() {
        super.handle();
        System.debug('child handling');
    }
}
