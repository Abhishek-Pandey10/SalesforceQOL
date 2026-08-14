@isTest
private class AccountControllerTest {
    @isTest
    static void testGetAccounts() {
        TestDataFactory.createAccount();
        List<Account> results = AccountController.getAccounts();
        System.assert(!results.isEmpty());
    }

    @isTest
    static void testDeadCodeSampleTestOnlyMethod() {
        String result = DeadCodeSample.testOnlyMethod();
        System.assert(result != null);
    }
}
