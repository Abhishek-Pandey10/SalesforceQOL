public class ReversedOrderQueueable implements Queueable {
    // Declared FIRST, but this is NOT the real platform callback (same
    // arity, different parameter type).
    public void execute(String reason) {
        System.debug('dead overload, declared before the real callback: ' + reason);
    }

    // The real platform callback, declared SECOND.
    public void execute(QueueableContext qc) {
        System.debug('real Queueable callback');
    }
}
