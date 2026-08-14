public class DeadBranchTarget {
    public static void neverActuallyRuns() {
        System.debug('unreachable in practice, but this parser cannot tell');
    }
}
