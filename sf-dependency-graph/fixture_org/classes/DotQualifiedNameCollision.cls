public class DotQualifiedNameCollision {
    // Never actually called by anything - regression test that calling
    // a DIFFERENT class's same-named method doesn't give this one a
    // phantom self-call.
    public void process() {
        System.debug('should be flagged dead');
    }

    public void caller() {
        DotQualifiedHelper helper = new DotQualifiedHelper();
        helper.process();
    }
}
