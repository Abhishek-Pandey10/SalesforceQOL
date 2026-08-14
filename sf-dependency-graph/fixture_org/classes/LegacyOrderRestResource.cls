@RestResource(urlMapping='/legacyOrders/*')
global class LegacyOrderRestResource {
    @HttpGet
    global static String getOrder() {
        return 'order';
    }

    @HttpPost
    global static void createOrder() {
        System.debug('creating order');
    }
}
