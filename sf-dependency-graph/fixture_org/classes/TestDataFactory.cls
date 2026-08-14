@isTest
public class TestDataFactory {
    public static Account createAccount() {
        Account acct = new Account(Name = 'Test Account');
        insert acct;
        return acct;
    }
}
