public class DeadCodeSampleCaller {
    public String run() {
        DeadCodeSample sample = new DeadCodeSample();
        return sample.usedMethod();
    }
}
