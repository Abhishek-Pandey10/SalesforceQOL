public class DeadBranchCaller {
    public void run() {
        if (false) {
            DeadBranchTarget.neverActuallyRuns();
        }
    }
}
