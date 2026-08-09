public class ContactController {
    public static List<Contact> getContacts(Id accountId) {
        return [SELECT Id, FirstName, LastName, Email FROM Contact WHERE AccountId = :accountId ORDER BY LastName];
    }

    @AuraEnabled
    public static Contact getContactById(Id contactId) {
        return [SELECT Id, FirstName, LastName, Email, Phone FROM Contact WHERE Id = :contactId];
    }
}
