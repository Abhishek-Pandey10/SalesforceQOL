/***************************************************************************
 * Class Name  : R4C_KTBR_SR_POHistoryCheck
 * Description : KTBR - PO History Check (Stock Rotation).
 *               First step of the SR KTBR pipeline — creates the initial
 *               CSV that feeds the rest of the pipeline (Product Validation,
 *               PIC Check, Allowance Validation, Business Rules Check).
 *
 *               Stock Rotation has no ULT/warranty-entitlement step ahead of
 *               PO History (unlike Technical Intake), so this is a single
 *               BAG-type HANA PO search keyed on MM + date window only —
 *               there is no VIZID/warranty-key routing or CEP-window billing
 *               date gating here. Matches "most recent invoice wins" (sort
 *               by CustomerBillingDocumentDt desc, take the first match).
 *
 * USAGE :
 *   R4C_KTBR_SR_POHistoryCheck.run(caseNumber, lineStart, lineEnd);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 18/07/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_SR_POHistoryCheck {

    private static final String  CLASS_NAME             = 'R4C_KTBR_SR_POHistoryCheck';
    private static final Integer CHUNK_SIZE              = 600;
    private static final Integer HTTP_SUCCESS_CODE       = 200;
    private static final String  API_TYPE_BAG            = 'BAG';
    private static final String  BILLING_DOC_TYPE_CD     = 'F2';
    private static final String  PO_NOT_FOUND_MSG        = 'PO History Not Found';

    private static final List<String> HEADERS = new List<String>{
        'LineNumber', 'MM', 'BillingDate', 'CustomerPONumber', 'SalesOrderNumber',
        'SalesOrderLineNbr', 'CustomerBillingDocId', 'CustomerItemNbr', 'SoldToCustomerId',
        'BillingQty', 'CurrencyCd', 'BillingDocLineNbr', 'BatchId', 'POUnitPrice',
        'POIsValid', 'POHistoryStatus', 'POHistoryErrorReason'
    };

    public static void run(String caseNumber, Integer lineStart, Integer lineEnd) {
        System.debug('==== ' + CLASS_NAME + ' START | Case: ' + caseNumber
            + ' | Range: ' + lineStart + '-' + lineEnd + ' ====');

        try {
            if (String.isBlank(caseNumber) || lineStart == null || lineEnd == null) {
                System.debug('Invalid input parameters.');
                return;
            }

            List<Customer_Sales_Issue_Request_Line__c> lines =
                R4C_KTBR_Util.queryLinesInRange(caseNumber, lineStart, lineEnd);
            if (lines.isEmpty()) { System.debug('No lines found.'); return; }

            Id caseId = R4C_KTBR_Util.getCaseId(caseNumber);
            if (caseId == null) { System.debug('Case not found.'); return; }

            R4C_KTBR_Util.CaseContext ctx = R4C_KTBR_Util.buildCaseContext(caseNumber);
            if (ctx == null) { System.debug('Could not build case context.'); return; }

            List<Customer_Sales_Issue_Request_Line__c> activeLines =
                R4C_KTBR_Util.filterActiveLines(lines);

            Map<String, POHistoryResult> resultsByLineName = new Map<String, POHistoryResult>();

            if (!activeLines.isEmpty()) {
                String startDate = R4C_KTBR_Util.getPOHistoryStartDate(ctx.serviceType);
                String endDate   = R4C_KTBR_Util.getPOHistoryEndDate();
                List<String> cmfList = buildCMFList(ctx);

                Map<String, List<Customer_Sales_Issue_Request_Line__c>> mmKeyToLines =
                    new Map<String, List<Customer_Sales_Issue_Request_Line__c>>();
                for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                    String mm = line.Sales_Issue_Item__r?.Name;
                    if (String.isBlank(mm)) continue;
                    String key = mm + '_' + startDate + endDate;
                    if (!mmKeyToLines.containsKey(key)) {
                        mmKeyToLines.put(key, new List<Customer_Sales_Issue_Request_Line__c>());
                    }
                    mmKeyToLines.get(key).add(line);
                }

                Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> resp =
                    callAPI(
                        new List<String>(mmKeyToLines.keySet()),
                        BILLING_DOC_TYPE_CD, startDate, endDate, cmfList
                    );

                for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                    String mm = line.Sales_Issue_Item__r?.Name;
                    resultsByLineName.put(line.Name, validateLine(mm, resp));
                }
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            List<String> csvRows = new List<String>();
            csvRows.add(String.join(HEADERS, ','));

            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                POHistoryResult result = resultsByLineName.get(line.Name);

                if (result == null) {
                    csvRows.add(buildCSVRow(line, new POHistoryResult(),
                        line.Sales_Issue_Line_Item_Status__c ?? 'N/A',
                        line.Line_item_error_messages__c ?? ''));
                    continue;
                }

                if (!result.found) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = result.reason;
                    linesToUpdate.add(line);
                } else {
                    applyResultToLine(line, result);
                    linesToUpdate.add(line);
                }

                csvRows.add(buildCSVRow(line, result, result.status, result.reason));
            }

            if (!linesToUpdate.isEmpty()) {
                R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);
                System.debug('Updated ' + linesToUpdate.size() + ' lines.');
            }

            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_SR_POHistoryCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug('==== ' + CLASS_NAME + ' COMPLETED ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
        }
    }

    private static String buildCSVRow(
        Customer_Sales_Issue_Request_Line__c line,
        POHistoryResult r,
        String status,
        String reason
    ) {
        return String.join(new List<String>{
            R4C_KTBR_Util.escapeCSV(line.Name),
            R4C_KTBR_Util.escapeCSV(line.Sales_Issue_Item__r?.Name),
            R4C_KTBR_Util.escapeCSV(r.billingDate),
            R4C_KTBR_Util.escapeCSV(r.customerPONumber),
            R4C_KTBR_Util.escapeCSV(r.salesOrderNumber),
            R4C_KTBR_Util.escapeCSV(r.salesOrderLineNbr),
            R4C_KTBR_Util.escapeCSV(r.customerBillingDocId),
            R4C_KTBR_Util.escapeCSV(r.customerItemNbr),
            R4C_KTBR_Util.escapeCSV(r.soldToCustomerId),
            R4C_KTBR_Util.escapeCSV(r.billingQty),
            R4C_KTBR_Util.escapeCSV(r.currencyCd),
            R4C_KTBR_Util.escapeCSV(r.billingDocLineNbr),
            R4C_KTBR_Util.escapeCSV(r.batchId),
            R4C_KTBR_Util.escapeCSV(r.unitPrice != null ? String.valueOf(r.unitPrice) : ''),
            R4C_KTBR_Util.escapeCSV(r.found ? 'true' : 'false'),
            R4C_KTBR_Util.escapeCSV(status),
            R4C_KTBR_Util.escapeCSV(reason)
        }, ',');
    }

    private static POHistoryResult validateLine(
        String mm,
        Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> respMap
    ) {
        POHistoryResult result = new POHistoryResult();

        if (String.isBlank(mm)) {
            result.found  = false;
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Missing MM.';
            return result;
        }

        List<R4C_API_POsearch_HANAConsumingClass.responseElements> responses = respMap.get(mm);
        if (responses == null || responses.isEmpty()) {
            result.found  = false;
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = PO_NOT_FOUND_MSG + ' for MM: ' + mm;
            return result;
        }

        R4C_API_POsearch_HANAConsumingClass.responseElements best = responses[0];

        Decimal price = 0;
        if (String.isNotBlank(best.SalesOrderLineNetPriceAmt)) {
            try { price = Decimal.valueOf(best.SalesOrderLineNetPriceAmt); } catch (Exception e) {}
        }
        if (String.isNotBlank(best.ContraRevenueAdjustmentRequestlineNetPriceAmt)) {
            try {
                Decimal contra = Decimal.valueOf(best.ContraRevenueAdjustmentRequestlineNetPriceAmt);
                if (contra > 0) price = contra;
            } catch (Exception e) {}
        }

        result.found                = true;
        result.status               = 'Pass';
        result.reason               = '';
        result.billingDate          = best.CustomerBillingDocumentDt != null
            ? String.valueOf(best.CustomerBillingDocumentDt) : '';
        result.customerPONumber     = best.CustomerPurchaseOrderNbr;
        result.salesOrderNumber     = best.SalesOrderId;
        result.salesOrderLineNbr    = best.SalesOrderLineNbr;
        result.customerBillingDocId = best.CustomerBillingDocumentId;
        result.customerItemNbr      = best.CustomerItemNbr;
        result.soldToCustomerId     = best.SoldToCustomerId;
        result.billingQty           = best.BillingQty;
        result.currencyCd           = best.SalesOrderCurrencyCd;
        result.billingDocLineNbr    = best.CustomerBillingDocumentLineNbr;
        result.batchId              = best.BatchId;
        result.unitPrice            = price;
        return result;
    }

    private static void applyResultToLine(
        Customer_Sales_Issue_Request_Line__c line,
        POHistoryResult result
    ) {
        if (String.isNotBlank(result.billingDate)) {
            try {
                line.Sales_Issue_Billing_Date__c = Date.valueOf(result.billingDate.substring(0, 10));
            } catch (Exception e) {}
        }
        if (String.isNotBlank(result.customerPONumber))
            line.Sales_Issue_Cst_PO_Number__c = result.customerPONumber;
        if (String.isNotBlank(result.salesOrderNumber))
            line.Sales_Issue_Sales_Order_Number__c = result.salesOrderNumber;
        if (String.isNotBlank(result.salesOrderLineNbr))
            line.Sales_Issue_Sales_Order_Line_Number__c = result.salesOrderLineNbr;
        if (String.isNotBlank(result.customerBillingDocId))
            line.Sales_Issue_Invoice_Number__c = result.customerBillingDocId;
        if (String.isNotBlank(result.customerItemNbr))
            line.Sales_Issue_Customer_Part_Number__c = result.customerItemNbr;
        if (String.isNotBlank(result.billingQty))
            line.Billing_Quantity__c = Decimal.valueOf(result.billingQty);
        if (String.isNotBlank(result.currencyCd))
            line.Sales_Issue_Currency__c = result.currencyCd;
        if (String.isNotBlank(result.billingDocLineNbr))
            line.Sales_Issue_Line_Item_Invoice_Number__c = result.billingDocLineNbr;
        if (String.isNotBlank(result.batchId))
            line.Sales_Issue_Batch_Id__c = result.batchId;
        if (result.unitPrice != null && result.unitPrice > 0)
            line.Sales_Issue_PO_Price__c = result.unitPrice;
    }

    private static Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> callAPI(
        List<String> mmKeys,
        String billingDocTypeCd,
        String startDate,
        String endDate,
        List<String> cmfList
    ) {
        Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> result =
            new Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>>();
        if (mmKeys.isEmpty()) return result;

        R4C_APIGEE_Settings__mdt settings =
            R4C_APIGEE_Settings__mdt.getInstance('R4C_POHistory_API');
        if (settings == null) {
            System.debug('ERROR: R4C_POHistory_API MDT not found.');
            return result;
        }
        Boolean isIAO   = Boolean.valueOf(R4C_KTBR_Util.IS_IAO_FLAG);
        String endpoint = isIAO ? settings.IAO_Named_Credential__c : settings.Consuming_Class_Name__c;
        if (String.isBlank(endpoint)) {
            System.debug('ERROR: Endpoint blank for PO History API.');
            return result;
        }

        for (List<String> chunk : R4C_KTBR_Util.chunkList(mmKeys, CHUNK_SIZE)) {
            R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper req =
                new R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper();
            req.apiType                       = API_TYPE_BAG;
            req.CustomerBillingDocumentTypeCd = billingDocTypeCd;
            req.startDate                     = startDate;
            req.endDate                       = endDate;
            req.availableCMFList              = cmfList;
            req.mmListbyInput                 = chunk;
            req.poListbyInput                 = new List<String>();
            req.soListbyInput                 = new List<String>();

            try {
                String reqBody = JSON.serialize(req);
                String txId    = R4C_API_MessageLogAndAttachment.generateTransactionId();
                HttpResponse res = new Http().send(R4C_KTBR_Util.buildHttpRequest(endpoint, reqBody));
                Integer statusCode = res.getStatusCode();
                String  resBody    = res.getBody();
                R4C_KTBR_Util.logAPIRequest(CLASS_NAME, txId, reqBody);
                R4C_KTBR_Util.logAPIResponse(CLASS_NAME, txId, statusCode, resBody);

                if (statusCode == HTTP_SUCCESS_CODE && String.isNotBlank(resBody)) {
                    R4C_API_POsearch_HANAConsumingClass.SOResponse wrapper =
                        (R4C_API_POsearch_HANAConsumingClass.SOResponse)
                        JSON.deserialize(resBody, R4C_API_POsearch_HANAConsumingClass.SOResponse.class);
                    if (wrapper?.elements != null) {
                        for (R4C_API_POsearch_HANAConsumingClass.responseElements el : wrapper.elements) {
                            if (String.isBlank(el.ItemId)) continue;
                            if (!result.containsKey(el.ItemId)) {
                                result.put(el.ItemId,
                                    new List<R4C_API_POsearch_HANAConsumingClass.responseElements>());
                            }
                            result.get(el.ItemId).add(el);
                        }
                    }
                } else {
                    System.debug('WARNING: PO History API returned status ' + statusCode);
                }
            } catch (Exception ex) {
                R4C_KTBR_Util.logError(CLASS_NAME, 'callAPI', ex);
            }
        }
        for (String mm : result.keySet()) {
            result.get(mm).sort(new R4C_KTBR_Util.POHistoryDateSorter());
        }
        return result;
    }

    // REVIEW (SR port — buildCMFList): the SR front-end (r4c_AG_LineItemsResultTableUtill.js,
    // poHistoryCheck()) branches on a case/customer-level "isUcdoff" flag whose source object/field
    // isn't present in this file set (same gap TI's own buildCMFList already has, see
    // R4C_KTBR_TI_POHistoryCheck.cls). When isUcdoff is true, the CMF list comes entirely from a
    // different "bagList" source instead of the header's sold_to_cmf_number__c. That branch is not
    // implemented here — only the live (non-ucdoff) path is. Unlike TI's shipped buildCMFList, this
    // uses the concrete "{salesOrgCode}_{distiChannelCode}_{soldToCMF}" format (confirmed directly
    // from the SR JS, Utill.js:574) rather than a PSG-only wildcard format.
    private static List<String> buildCMFList(R4C_KTBR_Util.CaseContext ctx) {
        List<String> cmfList = new List<String>();
        try {
            List<Customer_Sales_Issue_Request__c> headers = [
                SELECT sold_to_cmf_number__c
                FROM Customer_Sales_Issue_Request__c
                WHERE Id = :ctx.headerId
                LIMIT 1
            ];
            if (!headers.isEmpty() && String.isNotBlank(headers[0].sold_to_cmf_number__c)) {
                List<Object> raw = (List<Object>) JSON.deserializeUntyped(headers[0].sold_to_cmf_number__c);
                List<String> bagEntries = new List<String>();
                for (Object o : raw) bagEntries.add(String.valueOf(o));
                cmfList = filterBAGList(bagEntries);
            }
            cmfList.add('99991231T00:00:00.000+000_' + ctx.salesOrgCode + '_'
                + ctx.distiChannelCode + '_' + (ctx.soldToCMF ?? ''));
        } catch (Exception ex) {
            System.debug(CLASS_NAME + ': WARNING — buildCMFList: ' + ex.getMessage());
            cmfList.add('99991231T00:00:00.000+000_' + ctx.salesOrgCode + '_'
                + ctx.distiChannelCode + '_' + (ctx.soldToCMF ?? ''));
        }
        return cmfList;
    }

    private static List<String> filterBAGList(List<String> bagEntries) {
        Map<String, String> latestByKey = new Map<String, String>();
        for (String entry : bagEntries) {
            List<String> parts = entry.split('_');
            if (parts.size() < 4) continue;
            String ts  = parts[0];
            String key = parts[1] + '_' + parts[2] + '_' + parts[3];
            if (!latestByKey.containsKey(key)
                    || ts.compareTo(latestByKey.get(key).substringBefore('_')) > 0) {
                latestByKey.put(key, entry);
            }
        }
        return new List<String>(latestByKey.values());
    }

    private class POHistoryResult {
        public Boolean found                = false;
        public String  status               = 'N/A';
        public String  reason               = '';
        public String  billingDate          = '';
        public String  customerPONumber     = '';
        public String  salesOrderNumber     = '';
        public String  salesOrderLineNbr    = '';
        public String  customerBillingDocId = '';
        public String  customerItemNbr      = '';
        public String  soldToCustomerId     = '';
        public String  billingQty           = '';
        public String  currencyCd           = '';
        public String  billingDocLineNbr    = '';
        public String  batchId              = '';
        public Decimal unitPrice            = 0;
    }
}
