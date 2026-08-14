public class ThisQualifiedCaller {
    public String run() {
        return this.helper();
    }

    private String helper() {
        return 'helped';
    }
}
