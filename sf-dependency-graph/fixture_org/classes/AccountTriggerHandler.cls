public class AccountTriggerHandler {
    public static void handleBeforeInsert(List<Account> newAccounts) {
        Utility helper = new Utility();
        for (Account acct : newAccounts) {
            System.debug(helper.formatDate(Date.today()));
        }
    }
}
