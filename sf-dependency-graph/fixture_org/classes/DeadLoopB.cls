public class DeadLoopB {
    public void pong() {
        DeadLoopA looper = new DeadLoopA();
        looper.ping();
    }
}
