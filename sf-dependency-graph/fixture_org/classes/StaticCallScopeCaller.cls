public class StaticCallScopeCaller {
    public void useLocalVar() {
        AccountService accountService = new AccountService();
        accountService.log('hi');
    }

    public void callStatic() {
        AccountService.getById(null);
    }
}
