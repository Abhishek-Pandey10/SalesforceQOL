public class LegacyRemoteController {
    @RemoteAction
    public static String legacyRemoteMethod(String input) {
        return 'echo: ' + input;
    }
}
