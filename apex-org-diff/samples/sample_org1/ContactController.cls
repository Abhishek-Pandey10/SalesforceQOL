public class ContactController {
    public static List<Contact> getContacts(Id accountId) {
        return [SELECT Id, FirstName, LastName FROM Contact WHERE AccountId = :accountId];
    }
}
