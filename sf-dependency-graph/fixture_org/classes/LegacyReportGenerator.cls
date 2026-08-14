public class LegacyReportGenerator {
    public String buildSummary() {
        return 'summary';
    }

    public String buildDetail(Id recordId) {
        return 'detail for ' + recordId;
    }

    private void logGeneration() {
        System.debug('report generated');
    }
}
