public class AccountService {
    // Shared service - identical in both orgs
    public static Account getById(Id accountId) {
        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];
    }
}
