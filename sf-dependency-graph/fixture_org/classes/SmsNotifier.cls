public class SmsNotifier implements NotifierIface {
    public void notify(String message) {
        System.debug('sms: ' + message);
    }
}
