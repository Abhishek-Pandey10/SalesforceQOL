public class ReportAccessGateCaller {
    public Boolean run(Id userId) {
        ReportAccessGate gate = new ReportAccessGate();
        return gate.canAccess(userId);
    }
}
