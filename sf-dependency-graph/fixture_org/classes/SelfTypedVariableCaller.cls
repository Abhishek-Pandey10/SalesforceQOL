public class SelfTypedVariableCaller {
    public String run() {
        SelfTypedVariableCaller other = new SelfTypedVariableCaller();
        return other.helper();
    }

    public String helper() {
        return 'helped via a same-type variable';
    }
}
