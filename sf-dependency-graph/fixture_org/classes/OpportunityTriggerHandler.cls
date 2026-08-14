public class OpportunityTriggerHandler {
    public static void handleBeforeInsert(List<Opportunity> newOpps) {
        System.debug('before insert: ' + newOpps.size());
    }

    public static void handleBeforeUpdate(List<Opportunity> newOpps) {
        System.debug('before update: ' + newOpps.size());
    }
}
