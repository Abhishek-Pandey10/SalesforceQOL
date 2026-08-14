public class LegacyUtilityTest {
    static testMethod void testFormatDate() {
        Utility helper = new Utility();
        System.assert(helper.formatDate(Date.today()) != null);
    }
}
