public class AccountService implements Loggable {
    public static Account getById(Id accountId) {
        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];
    }

    public void log(String message) {
        Utility helper = new Utility();
        System.debug(helper.formatDate(Date.today()) + ': ' + message);
    }

    public static Boolean isLoggable(Object obj) {
        return obj instanceof Loggable;
    }
}
