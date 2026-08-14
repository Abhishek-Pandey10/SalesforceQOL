public class EmailNotifier implements NotifierIface {
    public void notify(String message) {
        System.debug('email: ' + message);
    }
}
