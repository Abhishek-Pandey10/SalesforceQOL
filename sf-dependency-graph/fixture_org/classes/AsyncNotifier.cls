public class AsyncNotifier {
    @future
    public static void notifyAsync(String recordId) {
        System.debug('notifying async for ' + recordId);
    }
}
