public class ArityGuardTarget {
    // Never actually called - regression test that the miscounted call
    // below doesn't wrongly resolve here.
    public String pick(Integer a) {
        return 'wrong arm - should never be reached';
    }

    public String pick(Integer a, Boolean flag) {
        return 'right arm - genuinely called with 2 arguments';
    }
}
