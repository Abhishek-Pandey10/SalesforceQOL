public class QueueableWithDeadOverload implements Queueable {
    public void execute(QueueableContext qc) {
        System.debug('real Queueable callback');
    }

    // Same name as the platform callback, but arity 2 (not 1 like the
    // real Queueable.execute(QueueableContext)) - a plain unrelated
    // helper that happens to be named `execute` too, and nobody ever
    // calls it.
    public void execute(String reason, Boolean flag) {
        System.debug('dead overload: ' + reason);
    }
}
