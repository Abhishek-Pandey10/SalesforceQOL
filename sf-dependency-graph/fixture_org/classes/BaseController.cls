public virtual class BaseController {
    protected static final String DEFAULT_FORMAT = 'yyyy-MM-dd';

    public virtual void log(String message) {
        System.debug(message);
    }
}
