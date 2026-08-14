global class NightlyCleanupBatch implements Database.Batchable<sObject>, Database.Stateful, Loggable {
    global Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id FROM Account]);
    }

    global void execute(Database.BatchableContext bc, List<Account> scope) {
    }

    global void finish(Database.BatchableContext bc) {
    }

    public void log(String message) {
        System.debug('[NightlyCleanupBatch] ' + message);
    }
}
