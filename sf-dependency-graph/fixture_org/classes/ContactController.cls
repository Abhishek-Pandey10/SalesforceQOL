public class ContactController {
    public static List<Contact> getContacts(Id accountId) {
        return [SELECT Id, FirstName, LastName FROM Contact WHERE AccountId = :accountId];
    }

    public static Contact getPrimaryContact(Id accountId) {
        AccountService svc = new AccountService();
        Account acct = AccountService.getById(accountId);
        return acct != null ? getFirstContact(accountId) : null;
    }

    private static Contact getFirstContact(Id accountId) {
        List<Contact> contacts = getContacts(accountId);
        return contacts.isEmpty() ? null : contacts[0];
    }
}
