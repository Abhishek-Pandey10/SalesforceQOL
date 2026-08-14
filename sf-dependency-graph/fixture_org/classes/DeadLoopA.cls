public class DeadLoopA {
    public void ping() {
        DeadLoopB looper = new DeadLoopB();
        looper.pong();
    }
}
