public class ReflectionFactory {
    public Object build() {
        Type t = Type.forName('ReflectivelyInstantiated');
        return t.newInstance();
    }
}
