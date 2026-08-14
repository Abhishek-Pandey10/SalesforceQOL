/***************************************************************************
 * Class Name  : R4C_KTBR_Util
 * Description : Shared utility class for all KTBR unexpected lines
 *               processing step classes.
 *
 * Used by     : R4C_KTBR_TI_DuplicateULTDB, R4C_KTBR_TI_DuplicateULTAPI,
 *               R4C_KTBR_TI_WarrantyEntitlementCheck,
 *               R4C_KTBR_TI_ProductValidation, R4C_KTBR_TI_POHistoryCheck,
 *               R4C_KTBR_TI_PICCheck, R4C_KTBR_TI_BusinessRulesCheck,
 *               R4C_KTBR_SR_POHistoryCheck, R4C_KTBR_SR_ProductValidation,
 *               R4C_KTBR_SR_PICCheck, R4C_KTBR_SR_AllowanceValidation,
 *               R4C_KTBR_SR_BusinessRulesCheck
 *
 * Created By  : Abhishek Pandey
 * Created Date: 17/03/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_Util {

    public static final String  IS_IAO_FLAG     = R4C_Generic_Configurations__c.getValues('isIaoFlag')?.Value__c;
    public static final String  DECLINED_STATUS = 'Unexpected Product - Declined';
    public static final Integer QUERY_PAGE_SIZE = 1000;


    public static List<Customer_Sales_Issue_Request_Line__c> queryLinesInRange(
        String caseNumber, Integer lineStart, Integer lineEnd
    ) {
        return [
            SELECT Id, Name,
                   Sales_Issue_Item__c,
                   Sales_Issue_Item__r.Name,
                   Sales_Issue_Item__r.ICS_WR_Operation_Business_Unit_Code__c,
                   Sales_Issue_Item__r.ICS_WR_Family_Name__c,
                   Sales_Issue_Item__r.Item_Product_Code__c,
                   Sales_Issue_Item__r.ICS_WR_Profit_Center_Code__c,
                   Sales_Issue_Item__r.Item_Market_Name__c,
                   Sales_Issue_Customer_Part_Number__c,
                   Sales_Issue_Prd_Unique_Id__c,
                   Sales_Issue_Line_Item_Status__c,
                   Line_item_error_messages__c,
                   Sales_Issue_CaseNumber__c,
                   Entitlement_SalesOrganization_Code__c,
                   Entitlement_DistributionChannel_Code__c,
                   Sales_Issue_Sold_To_CMF_Name__c
            FROM Customer_Sales_Issue_Request_Line__c
            WHERE Sales_Issue_Cst_Return_Request_Number__r.Sales_Issue_CaseNumber__r.CaseNumber = :caseNumber
            AND Sales_Issue_Auto_Line_Number__c >= :lineStart
            AND Sales_Issue_Auto_Line_Number__c <= :lineEnd
            ORDER BY Sales_Issue_Auto_Line_Number__c ASC
        ];
    }

    public static List<Customer_Sales_Issue_Request_Line__c> filterActiveLines(
        List<Customer_Sales_Issue_Request_Line__c> lines
    ) {
        List<Customer_Sales_Issue_Request_Line__c> active =
            new List<Customer_Sales_Issue_Request_Line__c>();
        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            if (line.Sales_Issue_Line_Item_Status__c != DECLINED_STATUS
                    && String.isNotBlank(line.Sales_Issue_Item__c)) {
                active.add(line);
            }
        }
        return active;
    }

    public static List<Customer_Sales_Issue_Request_Line__c> filterActiveLinesWithULT(
        List<Customer_Sales_Issue_Request_Line__c> lines
    ) {
        List<Customer_Sales_Issue_Request_Line__c> active =
            new List<Customer_Sales_Issue_Request_Line__c>();
        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            System.debug(line.Sales_Issue_Line_Item_Status__c);
            if (line.Sales_Issue_Line_Item_Status__c != DECLINED_STATUS
                    && String.isNotBlank(line.Sales_Issue_Prd_Unique_Id__c)) {
                active.add(line);
                System.debug(active);
            }
        }
        return active;
    }

    public static CaseContext buildCaseContext(String caseNumber) {
        List<Customer_Sales_Issue_Request__c> headers = [
            SELECT Id,
                   Sales_Issue_SoldTo_Customer__c,
                   Sales_Issue_Sales_Organization__c,
                   Sales_Issue_Sales_Organization__r.Customer_Sales_Organization_Code__c,
                   Sales_Issue_Distribution_Channel__c,
                   Sales_Issue_Service_Type__c,
                   Sales_Issue_Remedy_Type__c,
                   Sales_Issue_Distribution_Channel__r.Customer_Distribution_Channel_Code__c,
                   Sales_Issue_Return_Reason__c,
                   Sales_Issue_Return_Reason__r.Name,
                   Sales_Issue_Return_Reason__r.Sales_Issue_Return_Reason_Code__c,
                   Sales_Issue_Remedy_Type__r.Sales_Issue_Remedy_Type_Code__c,
                   Sales_Issue_Service_Type__r.Name,
                   Sales_Issue_Remedy_Type__r.Name,
                   Sales_Issue_SoldTo_Customer__r.Name
            FROM   Customer_Sales_Issue_Request__c
            WHERE  Sales_Issue_CaseNumber__r.CaseNumber = :caseNumber
            LIMIT  1
        ];
        if (headers.isEmpty()) {
            System.debug('No case header found for case: ' + caseNumber);
            return null;
        }

        Customer_Sales_Issue_Request__c h = headers[0];
        CaseContext ctx      = new CaseContext();
        ctx.headerId         = h.Id;
        ctx.salesOrgId       = h.Sales_Issue_Sales_Organization__c;
        ctx.salesOrgCode     = h.Sales_Issue_Sales_Organization__r?.Customer_Sales_Organization_Code__c;
        ctx.distiChannelId   = h.Sales_Issue_Distribution_Channel__c;
        ctx.distiChannelCode = h.Sales_Issue_Distribution_Channel__r?.Customer_Distribution_Channel_Code__c;
        ctx.returnReasonId   = h.Sales_Issue_Return_Reason__c;
        ctx.returnReasonName = h.Sales_Issue_Return_Reason__r?.Name;
        ctx.returnReasonCode = h.Sales_Issue_Return_Reason__r?.Sales_Issue_Return_Reason_Code__c;
        ctx.serviceType      = h.Sales_Issue_Service_Type__r?.Name;
        ctx.serviceTypeId    = h.Sales_Issue_Service_Type__c;
        ctx.remedyTypeId     = h.Sales_Issue_Remedy_Type__c;
        ctx.remedyType       = h.Sales_Issue_Remedy_Type__r?.Name;
        ctx.remedyTypeCode   = h.Sales_Issue_Remedy_Type__r?.Sales_Issue_Remedy_Type_Code__c;
        ctx.soldToCMF        = h.Sales_Issue_SoldTo_Customer__r?.Name;
        return ctx;
    }

    public static Map<Id, Boolean[]> buildULTCPNFlagsMap(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        CaseContext ctx
    ) {
        Map<Id, Boolean[]> result = new Map<Id, Boolean[]>();
        if (lines.isEmpty() || ctx == null) return result;

        Set<String> opIds         = new Set<String>();
        Set<String> families      = new Set<String>();
        Set<String> prodCodes     = new Set<String>();
        Set<String> profitCenters = new Set<String>();
        Set<String> marketNames   = new Set<String>();

        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            String opid       = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String family     = line.Sales_Issue_Item__r?.ICS_WR_Family_Name__c;
            String prodCode   = line.Sales_Issue_Item__r?.Item_Product_Code__c;
            String profitCtr  = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            String marketName = line.Sales_Issue_Item__r?.Item_Market_Name__c;
            if (String.isNotBlank(opid))       opIds.add(opid);
            if (String.isNotBlank(family))     families.add(family);
            if (String.isNotBlank(prodCode))   prodCodes.add(prodCode);
            if (String.isNotBlank(profitCtr))  profitCenters.add(profitCtr);
            if (String.isNotBlank(marketName)) marketNames.add(marketName);
        }
        opIds.add(null);
        families.add(null);
        prodCodes.add(null);
        profitCenters.add(null);
        marketNames.add(null);

        List<Sales_Issue_Matrix__c> matrices = [
            SELECT Id,
                   Sales_Issue_Rule_Prioritization_Number__c,
                   Sales_Issue_Operation_Business_Unit_Code__c,
                   Item_Family_Name__c,
                   Item_Product_Code__c,
                   Item_Market_Name__c,
                   Sales_Issue_Profit_Center__c,
                   Product_Unique_Id_Required_Indicator__c,
                   Sales_Issue_CPN_Support_Indicator__c
            FROM   Sales_Issue_Matrix__c
            WHERE  RecordType.DeveloperName = 'Sales_Issue_Required_Field_Matrix'
            AND    Sales_Issue_Active_Indicator__c = true
            AND    Sales_Issue_Valid_From__c <= TODAY
            AND    Sales_Issue_Valid_To__c   >= TODAY
            AND    Sales_Issue_Service_Type__c           = :ctx.serviceTypeId
            AND    Sales_Issue_Remedy_Type__c            = :ctx.remedyTypeId
            AND    Sales_Issue_Customer_Return_Reason__c = :ctx.returnReasonId
            AND    Sales_Issue_Customer_Sales_Organization__c = :ctx.salesOrgId
            AND    Customer_Disti_Channel__c             = :ctx.distiChannelId
            AND    (
                Item_Family_Name__c IN :families
                OR Sales_Issue_Operation_Business_Unit_Code__c IN :opIds
                OR Item_Product_Code__c IN :prodCodes
                OR Item_Market_Name__c IN :marketNames
                OR Sales_Issue_Profit_Center__c IN :profitCenters
            )
            ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST
            LIMIT 4000
        ];

        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            String opid       = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String family     = line.Sales_Issue_Item__r?.ICS_WR_Family_Name__c;
            String prodCode   = line.Sales_Issue_Item__r?.Item_Product_Code__c;
            String profitCtr  = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            String marketName = line.Sales_Issue_Item__r?.Item_Market_Name__c;

            for (Sales_Issue_Matrix__c m : matrices) {
                Boolean match;
                    Boolean profitMatch = m.Sales_Issue_Profit_Center__c == null
                                          || m.Sales_Issue_Profit_Center__c == profitCtr;
                    Boolean marketMatch = m.Item_Market_Name__c == null
                                          || m.Item_Market_Name__c == marketName;
                    Boolean familyMatch = m.Item_Family_Name__c == null
                                          || m.Item_Family_Name__c == family;
                    match = (profitMatch || marketMatch) && familyMatch;
                if (match) {
                    result.put(line.Id, new Boolean[]{
                        m.Product_Unique_Id_Required_Indicator__c == true,
                        m.Sales_Issue_CPN_Support_Indicator__c == true
                    });
                    break;
                }
            }
            if (!result.containsKey(line.Id)) {
                result.put(line.Id, new Boolean[]{ false, false });
            }
        }
        return result;
    }

    public static Id getCaseId(String caseNumber) {
        List<Case> cases = [SELECT Id FROM Case WHERE CaseNumber = :caseNumber LIMIT 1];
        if (cases.isEmpty()) {
            System.debug('Case not found for number: ' + caseNumber);
            return null;
        }
        return cases[0].Id;
    }

    public static void createCaseAttachment(Id caseId, String fileName, List<String> csvRows) {
        try {
            String   csvBody  = String.join(csvRows, '\n');
            String   fullName = fileName + '.csv';

            ContentVersion cv = new ContentVersion();
            cv.Title          = fullName;
            cv.PathOnClient   = fullName;
            cv.VersionData    = Blob.valueOf(csvBody);
            cv.IsMajorVersion = true;
            insert cv;

            ContentVersion inserted = [
                SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id LIMIT 1
            ];

            ContentDocumentLink cdl = new ContentDocumentLink();
            cdl.ContentDocumentId   = inserted.ContentDocumentId;
            cdl.LinkedEntityId      = caseId;
            cdl.ShareType           = 'V';
            cdl.Visibility          = 'AllUsers';
            insert cdl;

            System.debug('File attached to case: ' + fullName);
        } catch (Exception ex) {
            logError('R4C_KTBR_Util', 'createCaseAttachment', ex);
        }
    }

    public static void logAPIRequest(String apiName, String transactionId, String reqBody) {
        R4C_API_MessageLogAndAttachment.MessageLogWrapper log =
            new R4C_API_MessageLogAndAttachment.MessageLogWrapper();
        log.SourceAPIName = apiName;
        log.transactionId = transactionId;
        log.requestBody   = reqBody;
        R4C_API_MessageLogAndAttachment.insertAsync = false;
        R4C_API_MessageLogAndAttachment.CreateMessageLogRecord(log, false);
    }

    public static void logAPIResponse(
        String apiName, String transactionId, Integer statusCode, String resBody
    ) {
        R4C_API_MessageLogAndAttachment.MessageLogWrapper log =
            new R4C_API_MessageLogAndAttachment.MessageLogWrapper();
        log.SourceAPIName = apiName;
        log.transactionId = transactionId;
        log.StatusCode    = String.valueOf(statusCode);
        log.responseBody  = resBody;
        R4C_API_MessageLogAndAttachment.insertAsync = false;
        R4C_API_MessageLogAndAttachment.CreateMessageLogRecord(log, false);
    }

    public static void logError(String className, String method, Exception ex) {
        System.debug('ERROR in ' + className + '.' + method + ': '
            + ex.getMessage() + '\n' + ex.getStackTraceString());
        new R4C_ErrorRecordService().insertErrorRecord(
            new R4C_ErrorRecordServiceWrapperClass(
                className + '.' + method,
                'Exception during KTBR unexpected lines processing',
                ex,
                'Integration/API error',
                '',
                false
            )
        );
    }

    public static void updateLines(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        String callerMethod
    ) {
        if (lines.isEmpty()) return;
        Database.SaveResult[] results = Database.update(lines, false);
        Integer success = 0, fail = 0;
        for (Database.SaveResult sr : results) {
            if (sr.isSuccess()) {
                success++;
            } else {
                fail++;
                System.debug('DML Error in ' + callerMethod + ': ' + sr.getErrors());
            }
        }
        System.debug(callerMethod + ' — Updated: ' + success + ' | Failed: ' + fail);
    }

    public static HttpRequest buildHttpRequest(String endpoint, String body) {
        System.debug('inside buildHttpRequest');
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('POST');
        req.setHeader('content-type', 'application/json');
        req.setHeader('Accept', 'application/json');
        req.setBody(body);
        req.setTimeout(120000);
        System.debug('exiting buildHttpRequest');
        return req;
    }

    public static String getPOHistoryStartDate(String serviceType) {
        Integer months = -36;
        if (serviceType != null) {
            if (serviceType.containsIgnoreCase('Stock Rotation')) {
                months = -Integer.valueOf(
                    R4C_Generic_Configurations__c.getValues('PO_Search_Stock_Rotation_Months')?.Value__c ?? '36'
                );
            } else if (serviceType.containsIgnoreCase('Technical')) {
                months = -Integer.valueOf(
                    R4C_Generic_Configurations__c.getValues('PO_Search_Technical_Intake_Months')?.Value__c ?? '36'
                );
            } else if (serviceType.containsIgnoreCase('Quality')) {
                months = -Integer.valueOf(
                    R4C_Generic_Configurations__c.getValues('PO_Search_Quality_Intake_Months')?.Value__c ?? '36'
                );
            }
        }
        return String.valueOf(Date.today().addMonths(months)).replace('-', '');
    }

    public static String getPOHistoryEndDate() {
        return String.valueOf(Date.today()).replace('-', '');
    }

    public static String buildPOHistoryFilterString(
        R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper
    ) {
        JSONGenerator jsonGen = JSON.createGenerator(true);
        jsonGen.writeStartObject();
        jsonGen.writeObjectField('$format', 'json');
        String f = '"IP_DELIVERYNOTENBR" = \'\'\'*\'\'\' AND "IP_SALESORDERID" = \'\'\'*\'\'\' '
            + 'AND "IP_PONUMBER" = \'\'\'*\'\'\' '
            + 'AND "IP_CUSTOMERBILLINGDOCUMENTSTARTDT" = \'\'\'*\'\'\' '
            + 'AND "IP_CUSTOMERBILLINGDOCUMENTENDDT" = \'\'\'*\'\'\'';
        f += ' AND "IP_APITYPE" = \'' + reqWrapper.apiType + '\'';
        f += ' AND "IP_CUST_BILLING_TYPE_CD" =(\'\'\'' + reqWrapper.CustomerBillingDocumentTypeCd + '\'\'\')';
        if (!reqWrapper.availableCMFList.isEmpty()) {
            f += ' AND "IP_SOLDTOCUSTOMERID" = (\'\'\''
                + String.join(reqWrapper.availableCMFList, '\'\',\'\'') + '\'\'\')';
        }
        f += ' AND "IP_ITEMVALIDATION" = (\'\'\''
            + String.join(reqWrapper.mmListbyInput, '\'\',\'\'') + '\'\'\')';
        jsonGen.writeObjectField('$filter', f);
        jsonGen.writeObjectField('$select', System.Label.R4C_Req_Hana_Response_Fields);
        jsonGen.writeEndObject();
        return jsonGen.getAsString();
    }

    public static List<List<String>> chunkList(List<String> input, Integer chunkSize) {
        List<List<String>> chunks = new List<List<String>>();
        if (input == null || input.isEmpty()) return chunks;
        List<String> current = new List<String>();
        for (String item : input) {
            current.add(item);
            if (current.size() == chunkSize) {
                chunks.add(current);
                current = new List<String>();
            }
        }
        if (!current.isEmpty()) chunks.add(current);
        return chunks;
    }

    public static List<List<R4C_GetWarrentyAPIReqWrapper>> chunkWarrantyList(
        List<R4C_GetWarrentyAPIReqWrapper> input, Integer chunkSize
    ) {
        List<List<R4C_GetWarrentyAPIReqWrapper>> chunks =
            new List<List<R4C_GetWarrentyAPIReqWrapper>>();
        if (input == null || input.isEmpty()) return chunks;
        List<R4C_GetWarrentyAPIReqWrapper> current = new List<R4C_GetWarrentyAPIReqWrapper>();
        for (R4C_GetWarrentyAPIReqWrapper item : input) {
            current.add(item);
            if (current.size() == chunkSize) {
                chunks.add(current);
                current = new List<R4C_GetWarrentyAPIReqWrapper>();
            }
        }
        if (!current.isEmpty()) chunks.add(current);
        return chunks;
    }

    public static String escapeCSV(String value) {
        if (String.isBlank(value)) return '';
        return '"' + value.replace('"', '""') + '"';
    }

    public class CSVReadResult {
        public List<String>                      headers   = new List<String>();
        public Map<String, Map<String, String>>  rows      = new Map<String, Map<String, String>>();
        public List<String>                      lineOrder = new List<String>();

        public Boolean isEmpty() { return rows.isEmpty(); }
    }

    public static CSVReadResult readPreviousStepCSV(
        Id caseId, String attachmentTitle
    ) {
        CSVReadResult result = new CSVReadResult();
        try {
            List<ContentDocumentLink> cdls = [
                SELECT ContentDocumentId
                FROM   ContentDocumentLink
                WHERE  LinkedEntityId = :caseId
                AND    ContentDocument.Title LIKE :('%' + attachmentTitle + '%')
                ORDER BY SystemModstamp DESC
                LIMIT 1
            ];
            if (cdls.isEmpty()) {
                System.debug('R4C_KTBR_Util.readPreviousStepCSV: no attachment found for "'
                    + attachmentTitle + '"');
                return result;
            }
            List<ContentVersion> cvs = [
                SELECT VersionData
                FROM   ContentVersion
                WHERE  ContentDocumentId = :cdls[0].ContentDocumentId
                AND    IsLatest = true
                LIMIT  1
            ];
            if (cvs.isEmpty()) return result;

            String raw = cvs[0].VersionData.toString();
            List<String> lines = raw.split('\n');
            if (lines.isEmpty()) return result;
            result.headers = parseCSVLine(lines[0].trim());

            for (Integer i = 1; i < lines.size(); i++) {
                String line = lines[i].trim();
                if (String.isBlank(line)) continue;
                List<String> vals = parseCSVLine(line);
                if (vals.isEmpty()) continue;
                String key = unescapeCSVValue(vals[0]);
                if (String.isBlank(key)) continue;
                Map<String, String> row = new Map<String, String>();
                for (Integer j = 0; j < result.headers.size(); j++) {
                    row.put(result.headers[j],
                        j < vals.size() ? unescapeCSVValue(vals[j]) : '');
                }
                result.rows.put(key, row);
                result.lineOrder.add(key);
            }
            System.debug('R4C_KTBR_Util.readPreviousStepCSV: read '
                + result.rows.size() + ' rows from "' + attachmentTitle + '"');
        } catch (Exception ex) {
            logError('R4C_KTBR_Util', 'readPreviousStepCSV', ex);
        }
        return result;
    }

    public static List<String> appendColumnsToCSV(
        CSVReadResult previous,
        List<String> lineOrder,
        List<String> newHeaders,
        Map<String, Map<String, String>> newValues
    ) {
        List<String> csvRows = new List<String>();

        List<String> allHeaders = new List<String>(previous.headers);
        for (String h : newHeaders) {
            if (!allHeaders.contains(h)) allHeaders.add(h);
        }
        csvRows.add(String.join(allHeaders, ','));

        for (String key : lineOrder) {
            Map<String, String> prevRow   = previous.rows.containsKey(key)
                ? previous.rows.get(key) : new Map<String, String>();
            Map<String, String> extraCols = newValues.containsKey(key)
                ? newValues.get(key) : new Map<String, String>();

            List<String> rowValues = new List<String>();
            for (String h : allHeaders) {
                String val = prevRow.containsKey(h)
                    ? prevRow.get(h)
                    : (extraCols.containsKey(h) ? extraCols.get(h) : '');
                rowValues.add(escapeCSV(val));
            }
            csvRows.add(String.join(rowValues, ','));
        }
        return csvRows;
    }

    public static List<String> parseCSVLine(String line) {
        List<String> fields = new List<String>();
        String current = '';
        Boolean inQuotes = false;
        for (Integer i = 0; i < line.length(); i++) {
            String ch = line.substring(i, i + 1);
            if (ch == '"') {
                if (inQuotes && i + 1 < line.length() && line.substring(i + 1, i + 2) == '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch == ',' && !inQuotes) {
                fields.add(current);
                current = '';
            } else {
                current += ch;
            }
        }
        fields.add(current);
        return fields;
    }

    public static String unescapeCSVValue(String value) {
        if (String.isBlank(value)) return '';
        String trimmed = value.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length() >= 2) {
            trimmed = trimmed.substring(1, trimmed.length() - 1);
        }
        trimmed = trimmed.replace('""', '"');
        return trimmed;
    }

    public class CaseContext {
        public Id     headerId;
        public String salesOrgId;
        public String salesOrgCode;
        public String distiChannelId;
        public String distiChannelCode;
        public String returnReasonId;
        public String returnReasonName;
        public String returnReasonCode;
        public Id     serviceTypeId;
        public String serviceType;
        public Id     remedyTypeId;
        public String remedyType;
        public String soldToCMF;
        public String remedyTypeCode;
    }

    public class POHistoryDateSorter
        implements Comparator<R4C_API_POsearch_HANAConsumingClass.responseElements> {
        public Integer compare(
            R4C_API_POsearch_HANAConsumingClass.responseElements a,
            R4C_API_POsearch_HANAConsumingClass.responseElements b
        ) {
            if (a.CustomerBillingDocumentDt == null && b.CustomerBillingDocumentDt == null) return 0;
            if (a.CustomerBillingDocumentDt == null) return 1;
            if (b.CustomerBillingDocumentDt == null) return -1;
            return a.CustomerBillingDocumentDt > b.CustomerBillingDocumentDt ? -1 : 1;
        }
    }
}