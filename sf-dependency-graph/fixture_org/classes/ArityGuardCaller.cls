public class ArityGuardCaller {
    public String run(Integer counter, Integer max) {
        ArityGuardTarget t = new ArityGuardTarget();
        return t.pick(counter<max, true);
    }
}
