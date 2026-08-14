public class IndirectScheduledJob implements MyScheduledInterface {
    public void execute(SchedulableContext ctx) {
        System.debug('run via a custom interface that itself extends Schedulable');
    }
}
