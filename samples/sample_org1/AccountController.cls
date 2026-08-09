public class AccountController {
    @AuraEnabled(cacheable=true)
    public static List<Account> getAccounts() {
        return [SELECT Id, Name FROM Account LIMIT 100];
    }

    public static void oldMethod() {
        System.debug('old logic');
    }
}
