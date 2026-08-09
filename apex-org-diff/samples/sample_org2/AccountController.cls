public class AccountController {
    @AuraEnabled(cacheable=true)
    public static List<Account> getAccounts() {
        return [SELECT Id, Name, Type FROM Account LIMIT 200];
    }

    public static void newMethod() {
        System.debug('new logic added in sandbox');
        System.debug('additional line');
    }

    @AuraEnabled
    public static Account createAccount(String name) {
        Account a = new Account(Name = name);
        insert a;
        return a;
    }
}
