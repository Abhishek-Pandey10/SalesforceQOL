public class CommentedOutCaller {
    public void run() {
        // NeverCalledFromComment.ping();
        /* NeverCalledFromComment.ping(); */
        System.debug('nothing real happens here');
    }
}
