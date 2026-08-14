public class DeadCodeSample {
    public DeadCodeSample() {
    }

    public String usedMethod() {
        return 'called from DeadCodeSampleCaller';
    }

    public String unusedMethod() {
        return 'never called from anywhere in this org';
    }

    public static String testOnlyMethod() {
        return 'called only from AccountControllerTest';
    }

    @AuraEnabled
    public static String getUnusedAuraMethod() {
        return 'exposed to Lightning, no direct Apex/LWC caller';
    }

    @InvocableMethod(label='Unused Invocable')
    public static void unusedInvocableMethod() {
        System.debug('invoked only by a Flow, never from Apex');
    }
}
