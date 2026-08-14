public class NotifierRunner {
    public void alertAll(NotifierIface notifier) {
        notifier.notify('hello');
    }
}
