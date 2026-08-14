public class ScheduledCleanupJob implements Schedulable {
    public void execute(SchedulableContext sc) {
        System.debug('scheduled run');
    }
}
