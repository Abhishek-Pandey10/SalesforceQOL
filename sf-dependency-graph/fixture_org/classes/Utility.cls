public class Utility {
    public String formatDate(Date d) {
        String fmt = BaseController.DEFAULT_FORMAT;
        return String.valueOf(d) + ' (' + fmt + ')';
    }
}
