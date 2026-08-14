public class MultiDeclCaller {
    public void run() {
        Utility first, second;
        second = new Utility();
        second.formatDate(Date.today());
    }
}
