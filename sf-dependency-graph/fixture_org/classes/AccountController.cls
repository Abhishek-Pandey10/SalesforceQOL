public class AccountController extends BaseController {
    @AuraEnabled(cacheable=true)
    public static List<Account> getAccounts() {
        return [SELECT Id, Name FROM Account LIMIT 100];
    }

    @AuraEnabled
    public static Account getAccountDetail(Id accountId) {
        return AccountService.getById(accountId);
    }

    public override void log(String message) {
        System.debug('[AccountController] ' + message);
    }
}
