public class DuplicatedPolicy {
    // Exists ONLY in this duplicate-named file.
    public void secondOccurrenceOnlyMethod() {
        System.debug('should be flagged dead, not silently invisible');
    }
}
