public class ReportAccessGate {
    public Boolean canAccess(Id userId) {
        return checkPermission(userId);
    }

    private Boolean checkPermission(Id userId) {
        return userId != null;
    }

    private Boolean checkLegacyPermission(Id userId) {
        return true;
    }
}
