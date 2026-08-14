// =====================================================================================
// COMBINED REFERENCE FILE — NOT DEPLOYABLE AS-IS
// Concatenation of the KTBR Technical Intake pipeline classes + shared util, in
// pipeline execution order (Util first, since every step below depends on it).
// Each section is separated by a banner comment giving the original file name.
// =====================================================================================


// =====================================================================================
// FILE: R4C_KTBR_Util.cls
// =====================================================================================

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


// =====================================================================================
// FILE: R4C_KTBR_TI_DuplicateULTDB.cls
// =====================================================================================

/***************************************************************************
 * Class Name  : R4C_KTBR_TI_DuplicateULTDB
 * Description : KTBR Duplicate ULT Check against Salesforce DB lines and
 *               sublines. Creates the initial CSV that feeds the pipeline —
 *               every subsequent step reads this file and appends columns.
 *
 * USAGE : R4C_KTBR_TI_DuplicateULTDB.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 17/03/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_TI_DuplicateULTDB {

    private static final String CLASS_NAME = 'R4C_KTBR_TI_DuplicateULTDB';

    public static void run(String caseNumber, Integer lineStart, Integer lineEnd) {
        System.debug('==== ' + CLASS_NAME + ' START | Case: ' + caseNumber
            + ' | Range: ' + lineStart + '-' + lineEnd + ' ====');

        try {
            List<Customer_Sales_Issue_Request_Line__c> lines =
                R4C_KTBR_Util.queryLinesInRange(caseNumber, lineStart, lineEnd);
            if (lines.isEmpty()) { System.debug('No lines found in range.'); return; }

            Id caseId = R4C_KTBR_Util.getCaseId(caseNumber);
            System.debug('step 2.');
            R4C_KTBR_Util.CaseContext ctx = R4C_KTBR_Util.buildCaseContext(caseNumber);
            Map<Id, Boolean[]> ultCpnFlags = R4C_KTBR_Util.buildULTCPNFlagsMap(lines, ctx);
            if (caseId == null) return;
            System.debug('step 3.');
            System.debug('line :' + lines);

            List<String> ultList = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                if (line.Sales_Issue_Line_Item_Status__c != R4C_KTBR_Util.DECLINED_STATUS
                        && String.isNotBlank(line.Sales_Issue_Prd_Unique_Id__c)) {
                    ultList.add(line.Sales_Issue_Prd_Unique_Id__c.toUpperCase());
                }
                System.debug('Status: ' + line.Sales_Issue_Prd_Unique_Id__c);
            }
            System.debug('step 4.');
            if (ultList.isEmpty()) { return; }
            System.debug('step 5.');

            R4C_AG_POSearch_Controller.duplicateULTWrapper dataWrapper =
                R4C_AG_POSearch_Controller.getCaseWithUlt(ultList, null, (String) caseId);

            List<Customer_Sales_Issue_Request_Line__c>    sfLines    =
                dataWrapper?.lines    ?? new List<Customer_Sales_Issue_Request_Line__c>();
            List<Customer_Sales_Issue_Request_Subline__c> sfSublines =
                dataWrapper?.sublines ?? new List<Customer_Sales_Issue_Request_Subline__c>();

            Map<Id, List<String>> caseIdToULTsMap = new Map<Id, List<String>>();
            List<SObject> allRecords = new List<SObject>();
            allRecords.addAll((List<SObject>) sfLines);
            allRecords.addAll((List<SObject>) sfSublines);

            for (Customer_Sales_Issue_Request_Line__c sfLine : sfLines) {
                String ult      = (sfLine.Sales_Issue_Prd_Unique_Id__c ?? '').toUpperCase();
                Id     sfCaseId = sfLine.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
                if (String.isBlank(ult) || sfCaseId == null) continue;
                if (!caseIdToULTsMap.containsKey(sfCaseId))
                    caseIdToULTsMap.put(sfCaseId, new List<String>());
                caseIdToULTsMap.get(sfCaseId).add(ult);
            }

            for (Customer_Sales_Issue_Request_Subline__c sfSub : sfSublines) {
                String ult      = (sfSub.Sales_Issue_Serial_Number__c ?? '').toUpperCase();
                Id     sfCaseId = sfSub.Sales_Issue_Line_Number__r
                    ?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
                String lineUlt  = (sfSub.Sales_Issue_Line_Number__r
                    ?.Sales_Issue_Prd_Unique_Id__c ?? '').toUpperCase();
                if (String.isBlank(ult) || sfCaseId == null || ult == lineUlt) continue;
                if (!caseIdToULTsMap.containsKey(sfCaseId))
                    caseIdToULTsMap.put(sfCaseId, new List<String>());
                caseIdToULTsMap.get(sfCaseId).add(ult);
            }

            Set<String>          processedULTCasePairs = new Set<String>();
            Map<String, String>  SFULTCaseNumbersMap   = new Map<String, String>();
            Set<String>          duplicateULTs         = new Set<String>();

            for (SObject obj : allRecords) {
                String ult;
                Id     sfCaseId;
                String sfCaseNum;

                if (obj instanceof Customer_Sales_Issue_Request_Line__c) {
                    Customer_Sales_Issue_Request_Line__c sfLine =
                        (Customer_Sales_Issue_Request_Line__c) obj;
                    ult       = (sfLine.Sales_Issue_Prd_Unique_Id__c ?? '').toUpperCase();
                    sfCaseId  = sfLine.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
                    sfCaseNum = sfLine.Sales_Issue_Cst_Return_Request_Number__r
                        ?.Sales_Issue_CaseNumber__r?.CaseNumber;
                } else if (obj instanceof Customer_Sales_Issue_Request_Subline__c) {
                    Customer_Sales_Issue_Request_Subline__c sfSub =
                        (Customer_Sales_Issue_Request_Subline__c) obj;
                    ult       = (sfSub.Sales_Issue_Serial_Number__c ?? '').toUpperCase();
                    sfCaseId  = sfSub.Sales_Issue_Line_Number__r
                        ?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
                    sfCaseNum = sfSub.Sales_Issue_Line_Number__r
                        ?.Sales_Issue_Cst_Return_Request_Number__r
                        ?.Sales_Issue_CaseNumber__r?.CaseNumber;
                    String lineUlt = (sfSub.Sales_Issue_Line_Number__r
                        ?.Sales_Issue_Prd_Unique_Id__c ?? '').toUpperCase();
                    if (String.isNotBlank(lineUlt) && lineUlt == ult) continue;
                } else {
                    continue;
                }

                if (String.isBlank(ult) || sfCaseId == null || String.isBlank(sfCaseNum)) continue;
                if (!caseIdToULTsMap.containsKey(sfCaseId)) continue;

                List<String> ultsInCase = caseIdToULTsMap.get(sfCaseId);
                Integer ultCount = 0;
                for (String u : ultsInCase) { if (u == ult) ultCount++; }

                if (ultCount == 1 && sfCaseId == caseId) continue;

                if (ultCount > 1 || sfCaseId != caseId) {
                    String pairKey = ult + '_' + sfCaseNum;
                    if (processedULTCasePairs.contains(pairKey)) continue;
                    processedULTCasePairs.add(pairKey);
                    if (SFULTCaseNumbersMap.containsKey(ult)) {
                        SFULTCaseNumbersMap.put(ult, SFULTCaseNumbersMap.get(ult) + ', ' + sfCaseNum);
                    } else {
                        SFULTCaseNumbersMap.put(ult, sfCaseNum);
                    }
                    duplicateULTs.add(ult);
                }
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            List<String> csvRows = new List<String>();
            csvRows.add('LineNumber,MM,ULT,Status,DuplicateCaseNumbers,IsULTRequired,IsCPNRequired');

            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                String  ult      = (line.Sales_Issue_Prd_Unique_Id__c ?? '').toUpperCase();
                String  status   = 'Pass';
                String  dupCases = '';
                Boolean[] flags  = ultCpnFlags.get(line.Id);
                Boolean ultReq   = flags != null && flags[0];
                Boolean cpnReq   = flags != null && flags[1];

                if (String.isNotBlank(ult) && duplicateULTs.contains(ult)) {
                    dupCases = SFULTCaseNumbersMap.get(ult);
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     =
                        'Duplicate ULT - Case(s): ' + (String.isNotBlank(dupCases) ? dupCases : '');
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    linesToUpdate.add(line);
                }

                csvRows.add(
                    R4C_KTBR_Util.escapeCSV(line.Name)                           + ',' +
                    R4C_KTBR_Util.escapeCSV(line.Sales_Issue_Item__r?.Name)       + ',' +
                    R4C_KTBR_Util.escapeCSV(line.Sales_Issue_Prd_Unique_Id__c)    + ',' +
                    R4C_KTBR_Util.escapeCSV(status)                               + ',' +
                    R4C_KTBR_Util.escapeCSV(dupCases)                             + ',' +
                    R4C_KTBR_Util.escapeCSV(String.valueOf(ultReq))               + ',' +
                    R4C_KTBR_Util.escapeCSV(String.valueOf(cpnReq))
                );
            }

            R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);

            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_TI_DuplicateULT_DB_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug(CLASS_NAME + ' complete. Declined: '
                + linesToUpdate.size() + ' | Total: ' + lines.size());

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
        }
    }
}


// =====================================================================================
// FILE: R4C_KTBR_TI_DuplicateULTAPI.cls
// =====================================================================================

/***************************************************************************
 * Class Name  : R4C_KTBR_TI_DuplicateULTAPI
 * Description : Duplicate ULT Check against Entitlement API.
 *               Reads the CSV produced by R4C_KTBR_TI_DuplicateULTDB,
 *               appends API-check columns, and writes a new CSV.
 *
 * USAGE : R4C_KTBR_TI_DuplicateULTAPI.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 17/03/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_TI_DuplicateULTAPI {

    private static final String  CLASS_NAME = 'R4C_KTBR_TI_DuplicateULTAPI';
    private static final Integer CHUNK_SIZE = 1000;

    private static final List<String> NEW_HEADERS = new List<String>{
        'APIStatus', 'APIErrorReason', 'APICaseNumbers'
    };

    public static void run(String caseNumber, Integer lineStart, Integer lineEnd) {
        System.debug('==== ' + CLASS_NAME + ' START | Case: ' + caseNumber
            + ' | Range: ' + lineStart + '-' + lineEnd + ' ====');
        try {
            List<Customer_Sales_Issue_Request_Line__c> lines =
                R4C_KTBR_Util.queryLinesInRange(caseNumber, lineStart, lineEnd);
            if (lines.isEmpty()) { System.debug('No lines found in range.'); return; }

            Id caseId = R4C_KTBR_Util.getCaseId(caseNumber);
            if (caseId == null) return;

            String dbAttachmentName =
                'KTBR_TI_DuplicateULT_DB_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, dbAttachmentName);

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            List<Customer_Sales_Issue_Request_Line__c> activeLines =
                R4C_KTBR_Util.filterActiveLinesWithULT(lines);
            if (activeLines.isEmpty()) {
                System.debug('No active ULTs to check.');
                List<String> csvRows = R4C_KTBR_Util.appendColumnsToCSV(
                    previous, lineOrder,
                    NEW_HEADERS,
                    new Map<String, Map<String, String>>()
                );
                R4C_KTBR_Util.createCaseAttachment(
                    caseId,
                    'KTBR_TI_DuplicateULT_API_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                    csvRows
                );
                return;
            }

            List<String> ultList = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                ultList.add(line.Sales_Issue_Prd_Unique_Id__c);
            }

            R4C_APIGEE_Settings__mdt integrationSetting =
                R4C_APIGEE_Settings__mdt.getInstance('EntitlementAPI_DuplicateULTCheck');
            String endpoint = Boolean.valueOf(R4C_KTBR_Util.IS_IAO_FLAG)
                ? 'callout:R4C_EH_API_DuplicateULTCheckIAO'
                : integrationSetting.Consuming_Class_Name__c;

            Set<String>         duplicateULTs      = new Set<String>();
            Set<String>         scrappedULTs       = new Set<String>();
            Set<String>         lostWarehouseULTs  = new Set<String>();
            Set<String>         lostTransitULTs    = new Set<String>();
            Map<String, String> ultToCaseNumberMap = new Map<String, String>();

            for (List<String> chunk : R4C_KTBR_Util.chunkList(ultList, CHUNK_SIZE)) {
                String filterJson    = R4C_EntAPI_UltDuplicateConsumingClass.getFilterString(chunk);
                String transactionId = R4C_API_MessageLogAndAttachment.generateTransactionId();
                R4C_KTBR_Util.logAPIRequest(CLASS_NAME, transactionId, filterJson);
                try {
                    HttpResponse res        = new Http().send(
                        R4C_KTBR_Util.buildHttpRequest(endpoint, filterJson));
                    Integer     statusCode  = res.getStatusCode();
                    String      resBody     = res.getBody();
                    R4C_KTBR_Util.logAPIResponse(CLASS_NAME, transactionId, statusCode, resBody);

                    if (statusCode == 200 && String.isNotBlank(resBody)) {
                        R4C_EntAPI_UltDuplicateConsumingClass.ResponseWrapper parsed =
                            (R4C_EntAPI_UltDuplicateConsumingClass.ResponseWrapper)
                            JSON.deserialize(resBody,
                                R4C_EntAPI_UltDuplicateConsumingClass.ResponseWrapper.class);
                        if (parsed?.elements != null) {
                            for (R4C_EntAPI_UltDuplicateConsumingClass.Elements el
                                    : parsed.elements) {
                                if (el.Duplicate_ULT    == 'true') duplicateULTs.add(el.PRODUCT_UNIQUE_ID);
                                if (el.ULT_SCRAPPED     == 'true') scrappedULTs.add(el.PRODUCT_UNIQUE_ID);
                                if (el.Lost_In_Warehouse == 'true') lostWarehouseULTs.add(el.PRODUCT_UNIQUE_ID);
                                if (el.Lost_In_Transit   == 'true') lostTransitULTs.add(el.PRODUCT_UNIQUE_ID);
                                if (String.isNotBlank(el.PRODUCT_UNIQUE_ID)) {
                                    String intakeRMA  = el.CUSTOMER_RETURN_CASE_NBR_INTAKE  ?? '';
                                    String receiptRMA = el.CUSTOMER_RETURN_CASE_NBR_RECEIPT ?? '';
                                    String caseNums   =
                                        (String.isNotBlank(intakeRMA) && String.isNotBlank(receiptRMA))
                                            ? (intakeRMA == receiptRMA ? intakeRMA : intakeRMA + ', ' + receiptRMA)
                                            : (String.isNotBlank(intakeRMA) ? intakeRMA : receiptRMA);
                                    if (String.isNotBlank(caseNums)) {
                                        if (ultToCaseNumberMap.containsKey(el.PRODUCT_UNIQUE_ID)) {
                                            ultToCaseNumberMap.put(el.PRODUCT_UNIQUE_ID,
                                                ultToCaseNumberMap.get(el.PRODUCT_UNIQUE_ID)
                                                + ', ' + caseNums);
                                        } else {
                                            ultToCaseNumberMap.put(el.PRODUCT_UNIQUE_ID, caseNums);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (Exception ex) {
                    R4C_KTBR_Util.logError(CLASS_NAME, 'run.chunk', ex);
                }
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();

            Map<String, Map<String, String>> newValues =
                new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                String ult      = line.Sales_Issue_Prd_Unique_Id__c;
                String apiStatus = 'Pass';
                String reason    = '';
                String caseNums  = ultToCaseNumberMap.get(ult) ?? '';

                if (duplicateULTs.contains(ult)) {
                    reason    = 'Duplicate ULT';
                    apiStatus = R4C_KTBR_Util.DECLINED_STATUS;
                } else if (scrappedULTs.contains(ult)) {
                    reason    = 'ULT Scrapped';
                    apiStatus = R4C_KTBR_Util.DECLINED_STATUS;
                } else if (lostWarehouseULTs.contains(ult)) {
                    reason    = 'Lost In Warehouse';
                    apiStatus = R4C_KTBR_Util.DECLINED_STATUS;
                } else if (lostTransitULTs.contains(ult)) {
                    reason    = 'Lost In Transit';
                    apiStatus = R4C_KTBR_Util.DECLINED_STATUS;
                }

                if (apiStatus == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = reason
                        + (String.isNotBlank(caseNums) ? ' - Case(s): ' + caseNums : '');
                    linesToUpdate.add(line);
                }

                newValues.put(line.Name, new Map<String, String>{
                    'APIStatus'      => apiStatus,
                    'APIErrorReason' => reason,
                    'APICaseNumbers' => caseNums
                });
            }

            R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);

            List<String> csvRows = R4C_KTBR_Util.appendColumnsToCSV(
                previous, lineOrder, NEW_HEADERS, newValues
            );

            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_TI_DuplicateULT_API_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug(CLASS_NAME + ' complete. Declined: '
                + linesToUpdate.size() + ' | Total: ' + activeLines.size());

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
        }
    }
}


// =====================================================================================
// FILE: R4C_KTBR_TI_WarrantyEntitlementCheck.cls
// =====================================================================================

/***************************************************************************
 * Class Name  : R4C_KTBR_TI_WarrantyEntitlementCheck
 * Description : KTBR - Warranty Entitlement Check.
 *               Reads the CSV produced by R4C_KTBR_TI_DuplicateULTAPI,
 *               appends warranty columns, and writes a new CSV.
 *
 * USAGE : R4C_KTBR_TI_WarrantyEntitlementCheck.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 09/04/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_TI_WarrantyEntitlementCheck {

    private static final String  CLASS_NAME           = 'R4C_KTBR_TI_WarrantyEntitlementCheck';
    private static final Integer CHUNK_SIZE            = 200;
    private static final String  COMP_TYPE_S           = 'S';
    private static final Integer HTTP_TIMEOUT_MS       = 120000;
    private static final Integer HTTP_SUCCESS_CODE     = 200;
    private static List<String>  cachedAcceptedStatuses;
    private static List<String>  cachedDeclinedSrcTypes;
    private static Set<String>   cachedVizHardDeclineCodes;
    private static final String  SERVICE_CODE_TECHNICAL = '801';
    private static final String  SERVICE_CODE_QUALITY   = '805';
    private static final String  SERVICE_CODE_DEFAULT   = '804';

    private static final List<String> NEW_HEADERS = new List<String>{
        'WarrantyTypeCode', 'ProdUniqueIdStatusCode', 'VizIdStatusCode',
        'CreditPeriodCount', 'CEPEndDate', 'IsInWarranty',
        'ReplacementMM', 'OldMM',
        'BaseWarrantyStartDate', 'ExtendedWarrantyStartDate', 'ExtendedWarrantyEndDate',
        'ServiceContractNumber', 'EntitlementCMFSalesOrgCode', 'EntitlementCMFDistiChannelCode',
        'DeliveryNoteNumber', 'EnttlSoldToPartyId',
        'WarrantyStatus', 'WarrantyErrorReason'
    };

    @TestVisible public static Boolean MOCK_API      = false;
    @TestVisible public static String  MOCK_RESPONSE =
        '[{"ProdUniqueId":"U5694CP306793","ProdUniqueIdTypeCode":"ULT","WarrantyTypeCode":"1",'
        + '"ProdUniqueIdStatusCode":"ACT","VizIdStatusCode":"","ComponentTypeCode":"H",'
        + '"SourceSystemName":"ACT","BaseWarrantyStartDate":"2026-01-01","CreditPeriodCount":"730",'
        + '"WarrantyMaterialId":"","ErrorCode":null,"VizId":""}]';


    private static List<String> getAcceptedStatuses() {
        if (cachedAcceptedStatuses == null) {
            String val = R4C_Generic_Configurations__c.getValues('valid_warranty_status_code') != null
                ? R4C_Generic_Configurations__c.getValues('valid_warranty_status_code').Value__c
                : null;
            cachedAcceptedStatuses = String.isNotBlank(val)
                ? val.split(',') : new List<String>{ 'ACT' };
        }
        return cachedAcceptedStatuses;
    }

    private static List<String> getDeclinedSrcTypes() {
        if (cachedDeclinedSrcTypes == null) {
            String val = R4C_Generic_Configurations__c.getValues('invalid_warrenty_viz_types') != null
                ? R4C_Generic_Configurations__c.getValues('invalid_warrenty_viz_types').Value__c
                : null;
            cachedDeclinedSrcTypes = String.isNotBlank(val)
                ? val.split(',') : new List<String>{ 'CAN', 'MCN', 'ECN' };
        }
        return cachedDeclinedSrcTypes;
    }

    private static Set<String> getVizHardDeclineCodes() {
        if (cachedVizHardDeclineCodes == null) {
            String val = R4C_Generic_Configurations__c.getValues('invalid_warrenty_viz_code') != null
                ? R4C_Generic_Configurations__c.getValues('invalid_warrenty_viz_code').Value__c
                : null;
            cachedVizHardDeclineCodes = String.isNotBlank(val)
                ? new Set<String>(val.split(','))
                : new Set<String>{ 'PC', 'CME', 'INV', 'PIN', 'SIN' };
        }
        return cachedVizHardDeclineCodes;
    }


    public static void run(String caseNumber, Integer lineStart, Integer lineEnd) {
        System.debug('==== ' + CLASS_NAME + ' START | Case: ' + caseNumber
            + ' | Range: ' + lineStart + '-' + lineEnd + ' ====');

        try {
            if (String.isBlank(caseNumber) || lineStart == null || lineEnd == null) return;

            List<Customer_Sales_Issue_Request_Line__c> lines =
                R4C_KTBR_Util.queryLinesInRange(caseNumber, lineStart, lineEnd);
            if (lines.isEmpty()) return;
            System.debug('Found ' + lines.size() + ' lines in range.');

            Id caseId = R4C_KTBR_Util.getCaseId(caseNumber);
            if (caseId == null) return;

            R4C_KTBR_Util.CaseContext ctx = R4C_KTBR_Util.buildCaseContext(caseNumber);
            if (ctx == null) return;

            String apiAttachmentName =
                'KTBR_TI_DuplicateULT_API_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, apiAttachmentName);

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            List<Customer_Sales_Issue_Request_Line__c> activeLines =
                R4C_KTBR_Util.filterActiveLinesWithULT(lines);
            List<Customer_Sales_Issue_Request_Line__c> linesWithoutULT =
                new List<Customer_Sales_Issue_Request_Line__c>();
            for (Customer_Sales_Issue_Request_Line__c line :
                    R4C_KTBR_Util.filterActiveLines(lines)) {
                if (String.isBlank(line.Sales_Issue_Prd_Unique_Id__c)) {
                    linesWithoutULT.add(line);
                }
            }

            if (activeLines.isEmpty() && linesWithoutULT.isEmpty()) return;

            String queryNumber = generateQueryNumber(ctx);

            R4C_APIGEE_Settings__mdt integrationSetting =
                R4C_APIGEE_Settings__mdt.getInstance('EntitlementAPI_GetWarrentyDetails');
            if (integrationSetting == null) return;
            String endpoint = Boolean.valueOf(R4C_KTBR_Util.IS_IAO_FLAG)
                ? integrationSetting.IAO_Named_Credential__c
                : integrationSetting.Consuming_Class_Name__c;
            if (String.isBlank(endpoint)) return;

            Map<String, R4C_GetWarrentyAPIResponseWrapper> ultToResp =
                new Map<String, R4C_GetWarrentyAPIResponseWrapper>();

            if (!activeLines.isEmpty()) {
                List<R4C_GetWarrentyAPIReqWrapper> allReqs =
                    buildWarrantyRequestList(activeLines, ctx, queryNumber, caseNumber);
                processApiChunks(
                    R4C_KTBR_Util.chunkWarrantyList(allReqs, CHUNK_SIZE),
                    endpoint, ultToResp
                );
            }

            Map<String, R4C_GetWarrentyAPIResponseWrapper> mmToResp =
                new Map<String, R4C_GetWarrentyAPIResponseWrapper>();

            if (!linesWithoutULT.isEmpty()) {
                List<R4C_GetWarrentyAPIReqWrapper> mmReqs =
                    buildWarrantyRequestListWithoutULT(linesWithoutULT, ctx, queryNumber, caseNumber);
                for (List<R4C_GetWarrentyAPIReqWrapper> chunk :
                        R4C_KTBR_Util.chunkWarrantyList(mmReqs, CHUNK_SIZE)) {
                    try {
                        String reqBody = JSON.serialize(chunk);
                        String txId    = R4C_API_MessageLogAndAttachment.generateTransactionId();
                        HttpResponse res = new Http().send(
                            R4C_KTBR_Util.buildHttpRequest(endpoint, reqBody));
                        Integer statusCode   = res.getStatusCode();
                        String  responseBody = res.getBody();
                        R4C_KTBR_Util.logAPIRequest(CLASS_NAME, txId, reqBody);
                        R4C_KTBR_Util.logAPIResponse(CLASS_NAME, txId, statusCode, responseBody);
                        if (statusCode == HTTP_SUCCESS_CODE && String.isNotBlank(responseBody)) {
                            List<R4C_GetWarrentyAPIResponseWrapper> resps =
                                (List<R4C_GetWarrentyAPIResponseWrapper>)
                                JSON.deserialize(responseBody,
                                    List<R4C_GetWarrentyAPIResponseWrapper>.class);
                            for (R4C_GetWarrentyAPIResponseWrapper r : resps) {
                                if (String.isNotBlank(r.MaterialId)) {
                                    mmToResp.put(r.MaterialId, r);
                                }
                            }
                        }
                    } catch (Exception ex) {
                        R4C_KTBR_Util.logError(CLASS_NAME, 'run.mmChunk', ex);
                    }
                }
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues =
                new Map<String, Map<String, String>>();

            List<String> mmReplRows = new List<String>();
            mmReplRows.add('LineNumber,OldMM,NewMM,ULT');
            Boolean hasMMRepl = false;

            Date today = Date.today();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                WarrantyCheckResult result = processLineWarrantyCheck(line, ultToResp, today);
                if (result.status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = result.reason;
                    linesToUpdate.add(line);
                }
                if (String.isNotBlank(result.replacementMM)) {
                    mmReplRows.add(
                        R4C_KTBR_Util.escapeCSV(line.Name)                         + ',' +
                        R4C_KTBR_Util.escapeCSV(line.Sales_Issue_Item__r?.Name)     + ',' +
                        R4C_KTBR_Util.escapeCSV(result.replacementMM)               + ',' +
                        R4C_KTBR_Util.escapeCSV(line.Sales_Issue_Prd_Unique_Id__c ?? '')
                    );
                    hasMMRepl = true;
                }
                newValues.put(line.Name, buildWarrantyNewValueMap(result));
            }

            for (Customer_Sales_Issue_Request_Line__c line : linesWithoutULT) {
                String mm     = line.Sales_Issue_Item__r?.Name ?? '';
                WarrantyCheckResult result = processMMOnlyWarrantyCheck(mm, mmToResp, today);
                if (result.status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = result.reason;
                    linesToUpdate.add(line);
                }
                newValues.put(line.Name, buildWarrantyNewValueMap(result));
            }

            if (!linesToUpdate.isEmpty()) {
                R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);
                System.debug('Updated ' + linesToUpdate.size() + ' lines.');
            }

            List<String> csvRows = R4C_KTBR_Util.appendColumnsToCSV(
                previous, lineOrder, NEW_HEADERS, newValues
            );
            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_TI_WarrantyEntitlementCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            if (hasMMRepl) {
                R4C_KTBR_Util.createCaseAttachment(
                    caseId,
                    'KTBR_TI_MMReplacementMap_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                    mmReplRows
                );
                System.debug('Created MM Replacement map attachment.');
            }

            System.debug('==== ' + CLASS_NAME + ' COMPLETED SUCCESSFULLY ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
            System.debug('ERROR: ' + ex.getMessage() + '\n' + ex.getStackTraceString());
        }
    }


    private static Map<String, String> buildWarrantyNewValueMap(WarrantyCheckResult result) {
        return new Map<String, String>{
            'WarrantyTypeCode'               => result.warrantyTypeCode,
            'ProdUniqueIdStatusCode'         => result.statusCode,
            'VizIdStatusCode'                => result.vizIdStatusCode,
            'CreditPeriodCount'              => result.creditPeriodCount,
            'CEPEndDate'                     => result.cepEndDate,
            'IsInWarranty'                   => result.isInWarranty,
            'ReplacementMM'                  => result.replacementMM,
            'OldMM'                          => result.oldMM,
            'BaseWarrantyStartDate'          => result.baseWarrantyStartDate,
            'ExtendedWarrantyStartDate'      => result.extendedWarrantyStartDate,
            'ExtendedWarrantyEndDate'        => result.extendedWarrantyEndDate,
            'ServiceContractNumber'          => result.serviceContractNumber,
            'EntitlementCMFSalesOrgCode'     => result.entitlementCMFSalesOrgCode,
            'EntitlementCMFDistiChannelCode' => result.entitlementCMFDistiChannelCode,
            'DeliveryNoteNumber'             => result.deliveryNoteNumber,
            'EnttlSoldToPartyId'             => result.enttlSoldToPartyId,
            'WarrantyStatus'                 => result.status,
            'WarrantyErrorReason'            => result.reason
        };
    }

    private static String generateQueryNumber(R4C_KTBR_Util.CaseContext ctx) {
        String queryNumber = Datetime.now().format('yyyyMMddHHmmss')
            + (ctx.soldToCMF ?? '')
            + String.valueOf(Math.abs(Crypto.getRandomInteger()));
        return queryNumber.left(31);
    }

    private static void processApiChunks(
        List<List<R4C_GetWarrentyAPIReqWrapper>> chunks,
        String endpoint,
        Map<String, R4C_GetWarrentyAPIResponseWrapper> ultToResp
    ) {
        for (List<R4C_GetWarrentyAPIReqWrapper> chunk : chunks) {
            try {
                String reqBody = JSON.serialize(chunk);
                String txId    = R4C_API_MessageLogAndAttachment.generateTransactionId();
                System.debug('Processing chunk with ' + chunk.size() + ' items. TxId: ' + txId);

                Integer statusCode;
                String  responseBody;
                if (MOCK_API) {
                    statusCode   = 200;
                    responseBody = MOCK_RESPONSE;
                } else {
                    HttpRequest  req = R4C_KTBR_Util.buildHttpRequest(endpoint, reqBody);
                    HttpResponse res = new Http().send(req);
                    statusCode   = res.getStatusCode();
                    responseBody = res.getBody();
                }
                R4C_KTBR_Util.logAPIRequest(CLASS_NAME, txId, reqBody);
                R4C_KTBR_Util.logAPIResponse(CLASS_NAME, txId, statusCode, responseBody);
                System.debug('API Response Status: ' + statusCode);

                if (statusCode == HTTP_SUCCESS_CODE && String.isNotBlank(responseBody)) {
                    List<R4C_GetWarrentyAPIResponseWrapper> resps =
                        (List<R4C_GetWarrentyAPIResponseWrapper>)
                        JSON.deserialize(responseBody,
                            List<R4C_GetWarrentyAPIResponseWrapper>.class);

                    for (R4C_GetWarrentyAPIResponseWrapper r : resps) {
                        if (r.ProdUniqueIdTypeCode == 'PPIN' && String.isNotBlank(r.VizId)) {
                            r.ProdUniqueIdTypeCode = 'VISID';
                            String origUlt = r.ProdUniqueId;
                            r.ProdUniqueId = r.VizId;
                            r.VizId        = origUlt;
                        }
                        if (String.isNotBlank(r.ProdUniqueId) && r.WarrantyTypeCode != '2') {
                            ultToResp.put(r.ProdUniqueId, r);
                        }
                    }
                } else if (statusCode != HTTP_SUCCESS_CODE) {
                    System.debug('API returned status code: ' + statusCode
                        + ' Response: ' + responseBody);
                }
            } catch (Exception ex) {
                R4C_KTBR_Util.logError(CLASS_NAME, 'processApiChunks', ex);
            }
        }
    }

    private static WarrantyCheckResult processLineWarrantyCheck(
        Customer_Sales_Issue_Request_Line__c line,
        Map<String, R4C_GetWarrentyAPIResponseWrapper> ultToResp,
        Date today
    ) {
        WarrantyCheckResult result = new WarrantyCheckResult();
        String ult = line.Sales_Issue_Prd_Unique_Id__c ?? '';
        R4C_GetWarrentyAPIResponseWrapper r = ultToResp.get(ult);

        if (r == null) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'No warranty entitlement response';
            return result;
        }

        result.warrantyTypeCode  = r.WarrantyTypeCode  ?? '';
        result.statusCode        = r.ProdUniqueIdStatusCode ?? '';
        result.creditPeriodCount = r.CreditPeriodCount ?? '';
        String vizStatus         = r.VizIdStatusCode   ?? '';
        result.vizIdStatusCode   = vizStatus;
        result.baseWarrantyStartDate       = r.BaseWarrantyStartDate       ?? '';
        result.extendedWarrantyStartDate   = r.ExtendedWarrantyStartDate   ?? '';
        result.extendedWarrantyEndDate     = r.ExtendedWarrantyEndDate     ?? '';
        result.serviceContractNumber       = r.ServiceContractNumber       ?? '';
        result.entitlementCMFSalesOrgCode  = r.EntitlementCMFSalesOrganizationCode ?? '';
        result.entitlementCMFDistiChannelCode = r.EntitlementCMFDistributionChannelCode ?? '';
        result.deliveryNoteNumber          = r.DeliveryNoteNumber  ?? '';
        result.enttlSoldToPartyId          = r.EnttlSoldToPartyId  ?? '';

        Boolean isCompS      = r.ComponentTypeCode == COMP_TYPE_S;
        Boolean hasError     = r.ErrorCode != null && r.ErrorCode != 0;
        Boolean srcDeclined  = String.isNotBlank(r.SourceSystemName)
            && getDeclinedSrcTypes().contains(r.SourceSystemName.trim().toUpperCase());
        Boolean notActive    = String.isNotBlank(result.statusCode)
            && !getAcceptedStatuses().contains(result.statusCode.trim().toUpperCase());
        Boolean vizHardDecline = String.isNotBlank(vizStatus)
            && getVizHardDeclineCodes().contains(vizStatus.trim().toUpperCase());

        Boolean cepExpired = false;
        if (!isCompS && !hasError && !srcDeclined && !notActive && !vizHardDecline
                && String.isNotBlank(r.BaseWarrantyStartDate)
                && String.isNotBlank(result.creditPeriodCount)) {
            try {
                String rawDate  = r.BaseWarrantyStartDate.trim();
                Date   baseStart;
                if (rawDate.length() >= 10 && rawDate.substring(4, 5) == '-') {
                    baseStart = Date.valueOf(rawDate.left(10));
                } else {
                    List<String> parts = rawDate.split('/');
                    baseStart = Date.newInstance(
                        Integer.valueOf(parts[2].left(4)),
                        Integer.valueOf(parts[0]),
                        Integer.valueOf(parts[1])
                    );
                }
                Integer cepDays = Integer.valueOf(result.creditPeriodCount);
                Date    cepEnd  = baseStart.addDays(cepDays);
                result.cepEndDate   = String.valueOf(cepEnd);
                cepExpired          = today > cepEnd;
                result.isInWarranty = (!cepExpired && cepDays != 0) ? 'true' : 'false';
            } catch (Exception ex) {
                result.reason = 'CEP date calculation failed: ' + ex.getMessage();
                result.status = R4C_KTBR_Util.DECLINED_STATUS;
                return result;
            }
        }

        Boolean noCEP = String.isBlank(result.creditPeriodCount)
            || result.creditPeriodCount == '0';

        if (isCompS) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Component type S — not eligible';
        } else if (hasError) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Warranty API error code: ' + r.ErrorCode;
        } else if (srcDeclined) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Source system status: ' + r.SourceSystemName;
        } else if (notActive) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'ULT status not ACT: ' + result.statusCode;
        } else if (vizHardDecline) {
            // REVIEW (KTBR audit — VizId soft-stop, open design question): the source-of-truth
            // UI treats a matching VizIdStatusCode as a soft stop (isSoftStop = true) — a flag
            // for agent review, NOT a hard exclusion. There's no UI here to surface that flag,
            // so this was made a hard decline instead. Possible alternative that keeps the
            // line active for agent review instead of silently excluding it (needs a business
            // decision before applying):
            // result.status = 'VizId Status - Manual Review Required';
            // result.reason = 'VizId status code requires investigation: ' + vizStatus;
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'VizId status code requires investigation: ' + vizStatus;
        } else if (noCEP) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'No CEP days — credit eligibility expired';
        } else if (cepExpired) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'CEP expired. End date: ' + result.cepEndDate;
        }

        if (String.isNotBlank(r.WarrantyMaterialId)
                && r.WarrantyMaterialId != line.Sales_Issue_Item__r?.Name) {
            result.replacementMM = r.WarrantyMaterialId;
            result.oldMM         = line.Sales_Issue_Item__r?.Name;
        }

        return result;
    }

    private static WarrantyCheckResult processMMOnlyWarrantyCheck(
        String mm,
        Map<String, R4C_GetWarrentyAPIResponseWrapper> mmToResp,
        Date today
    ) {
        WarrantyCheckResult result = new WarrantyCheckResult();
        R4C_GetWarrentyAPIResponseWrapper r = mmToResp.get(mm);

        if (r == null) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'No warranty entitlement response for MM';
            return result;
        }

        result.warrantyTypeCode  = r.WarrantyTypeCode          ?? '';
        result.statusCode        = r.ProdUniqueIdStatusCode     ?? '';
        result.vizIdStatusCode   = r.VizIdStatusCode            ?? '';
        result.creditPeriodCount = r.CreditPeriodCount          ?? '';
        result.baseWarrantyStartDate       = r.BaseWarrantyStartDate       ?? '';
        result.extendedWarrantyStartDate   = r.ExtendedWarrantyStartDate   ?? '';
        result.extendedWarrantyEndDate     = r.ExtendedWarrantyEndDate     ?? '';
        result.serviceContractNumber       = r.ServiceContractNumber       ?? '';
        result.entitlementCMFSalesOrgCode  = r.EntitlementCMFSalesOrganizationCode  ?? '';
        result.entitlementCMFDistiChannelCode = r.EntitlementCMFDistributionChannelCode ?? '';
        result.deliveryNoteNumber          = r.DeliveryNoteNumber  ?? '';
        result.enttlSoldToPartyId          = r.EnttlSoldToPartyId  ?? '';

        if (String.isNotBlank(r.WarrantyMaterialId) && r.WarrantyMaterialId != mm) {
            result.replacementMM = r.WarrantyMaterialId;
            result.oldMM         = mm;
        }

        Boolean isCompS     = r.ComponentTypeCode == COMP_TYPE_S;
        Boolean hasError    = r.ErrorCode != null && r.ErrorCode != 0;
        Boolean srcDeclined = String.isNotBlank(r.SourceSystemName)
            && getDeclinedSrcTypes().contains(r.SourceSystemName.trim().toUpperCase());
        Boolean vizHardDecline = String.isNotBlank(result.vizIdStatusCode)
            && getVizHardDeclineCodes().contains(result.vizIdStatusCode.trim().toUpperCase());

        Boolean isCEPDaysValidValue = false;
        if (!isCompS && !hasError && !srcDeclined && !vizHardDecline
                && String.isNotBlank(result.creditPeriodCount)) {
            try {
                Integer cepDays = Integer.valueOf(result.creditPeriodCount);
                isCEPDaysValidValue = cepDays != 0;
                if (isCEPDaysValidValue) {
                    Date windowStart    = today.addDays(-cepDays);
                    result.cepEndDate   = String.valueOf(windowStart); // rolling start
                    result.isInWarranty = 'true';
                }
            } catch (Exception ex) {
                result.reason = 'CEP calculation failed: ' + ex.getMessage();
                result.status = R4C_KTBR_Util.DECLINED_STATUS;
                return result;
            }
        }

        if (isCompS) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Component type S — not eligible';
        } else if (hasError) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Warranty API error code: ' + r.ErrorCode;
        } else if (srcDeclined) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Source system status: ' + r.SourceSystemName;
        } else if (vizHardDecline) {
            // REVIEW (KTBR audit — VizId soft-stop, same open question as the ULT path above).
            // Possible alternative, needs a business decision before applying:
            // result.status = 'VizId Status - Manual Review Required';
            // result.reason = 'VizId status code requires investigation: ' + result.vizIdStatusCode;
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'VizId status code requires investigation: ' + result.vizIdStatusCode;
        } else if (!isCEPDaysValidValue) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'No CEP days — credit eligibility expired';
        }

        return result;
    }

    private static List<R4C_GetWarrentyAPIReqWrapper> buildWarrantyRequestList(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        R4C_KTBR_Util.CaseContext ctx,
        String queryNumber,
        String caseNumber
    ) {
        String svcCode = SERVICE_CODE_DEFAULT;
        if (ctx.serviceType != null) {
            if (ctx.serviceType.containsIgnoreCase('Technical'))  svcCode = SERVICE_CODE_TECHNICAL;
            else if (ctx.serviceType.containsIgnoreCase('Quality')) svcCode = SERVICE_CODE_QUALITY;
        }
        String  checkDateString = Datetime.now().format('MM/dd/yyyy');
        List<R4C_GetWarrentyAPIReqWrapper> reqs = new List<R4C_GetWarrentyAPIReqWrapper>();

        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            if (String.isBlank(line.Sales_Issue_Prd_Unique_Id__c)) continue;
            String  rawUlt          = line.Sales_Issue_Prd_Unique_Id__c;
            String  ult             = rawUlt.isNumeric() ? rawUlt : rawUlt.trim().toUpperCase();
            Boolean hasNonWordChar  = !Pattern.matches('[a-zA-Z0-9_]+', ult);
            String  excludeCatts    = (ult.length() > 25 || hasNonWordChar) ? 'Y' : 'N';

            R4C_GetWarrentyAPIReqWrapper w = new R4C_GetWarrentyAPIReqWrapper();
            w.QueryNumber              = queryNumber;
            w.CustomerReturnCaseNumber = caseNumber;
            w.ProdUniqueId             = ult;
            w.MaterialId               = line.Sales_Issue_Item__r?.Name ?? '';
            w.SalesOrganizationCode    = ctx.salesOrgCode;
            w.DistributionChannelCode  = ctx.distiChannelCode;
            w.CaseSoldToPartyId        = ctx.soldToCMF;
            w.ServiceTypeCode          = svcCode;
            w.ReturnReasonCode         = ctx.returnReasonCode;
            w.RemedyTypeCode           = ctx.remedyTypeCode;
            w.EntitlementCheckDate     = checkDateString;
            w.ExcludeCattsIndicator    = excludeCatts;
            w.ProductFamily            = line.Sales_Issue_Item__r?.ICS_WR_Family_Name__c ?? '';
            w.ProductCode              = line.Sales_Issue_Item__r?.Item_Product_Code__c  ?? '';
                w.ProfitCenterCode = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c ?? '';
                w.ItemMarketName   = line.Sales_Issue_Item__r?.Item_Market_Name__c          ?? '';
            reqs.add(w);
        }
        return reqs;
    }

    private static List<R4C_GetWarrentyAPIReqWrapper> buildWarrantyRequestListWithoutULT(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        R4C_KTBR_Util.CaseContext ctx,
        String queryNumber,
        String caseNumber
    ) {
        String svcCode = SERVICE_CODE_DEFAULT;
        if (ctx.serviceType != null) {
            String st = ctx.serviceType.toLowerCase();
            if (st.contains('technical'))  svcCode = SERVICE_CODE_TECHNICAL;
            else if (st.contains('quality')) svcCode = SERVICE_CODE_QUALITY;
        }
        String  checkDateString = Datetime.now().format('MM/dd/yyyy');
        List<R4C_GetWarrentyAPIReqWrapper> reqs = new List<R4C_GetWarrentyAPIReqWrapper>();

        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            if (String.isBlank(line.Sales_Issue_Item__c)) continue;
            R4C_GetWarrentyAPIReqWrapper w = new R4C_GetWarrentyAPIReqWrapper();
            w.QueryNumber              = queryNumber;
            w.CustomerReturnCaseNumber = caseNumber;
            w.ProdUniqueId             = '';
            w.MaterialId               = line.Sales_Issue_Item__r?.Name;
            w.SalesOrganizationCode    = ctx.salesOrgCode;
            w.DistributionChannelCode  = ctx.distiChannelCode;
            w.CaseSoldToPartyId        = ctx.soldToCMF;
            w.ServiceTypeCode          = svcCode;
            w.ReturnReasonCode         = ctx.returnReasonCode;
            w.RemedyTypeCode           = ctx.remedyTypeCode;
            w.EntitlementCheckDate     = checkDateString;
            w.ExcludeCattsIndicator    = 'N';
            if (line.Sales_Issue_Item__r != null) {
                w.ProductFamily = line.Sales_Issue_Item__r.ICS_WR_Family_Name__c  != null
                    ? line.Sales_Issue_Item__r.ICS_WR_Family_Name__c  : '';
                w.ProductCode   = line.Sales_Issue_Item__r.Item_Product_Code__c   != null
                    ? line.Sales_Issue_Item__r.Item_Product_Code__c   : '';
                    w.ProfitCenterCode = line.Sales_Issue_Item__r.ICS_WR_Profit_Center_Code__c != null
                        ? line.Sales_Issue_Item__r.ICS_WR_Profit_Center_Code__c : '';
                    w.ItemMarketName   = line.Sales_Issue_Item__r.Item_Market_Name__c != null
                        ? line.Sales_Issue_Item__r.Item_Market_Name__c : '';
            }
            reqs.add(w);
        }
        return reqs;
    }

    private class WarrantyCheckResult {
        public String status                    = 'Pass';
        public String reason                    = '';
        public String warrantyTypeCode          = '';
        public String statusCode                = '';
        public String vizIdStatusCode           = '';
        public String creditPeriodCount         = '';
        public String cepEndDate                = '';
        public String isInWarranty              = 'false';
        public String replacementMM             = '';
        public String oldMM                     = '';
        public String baseWarrantyStartDate     = '';
        public String extendedWarrantyStartDate = '';
        public String extendedWarrantyEndDate   = '';
        public String serviceContractNumber     = '';
        public String entitlementCMFSalesOrgCode    = '';
        public String entitlementCMFDistiChannelCode = '';
        public String deliveryNoteNumber        = '';
        public String enttlSoldToPartyId        = '';
    }
}


// =====================================================================================
// FILE: R4C_KTBR_TI_POHistoryCheck.cls
// =====================================================================================

/***************************************************************************
 * Class Name  : R4C_KTBR_TI_POHistoryCheck
 * Description : KTBR - PO History Check.
 *               Reads the warranty CSV from R4C_KTBR_TI_WarrantyEntitlementCheck,
 *               appends PO history columns, and writes a new CSV.
 *
 * USAGE :
 *   R4C_KTBR_TI_POHistoryCheck.run(caseNumber, lineStart, lineEnd);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 9/05/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_TI_POHistoryCheck {

    private static final String  CLASS_NAME        = 'R4C_KTBR_TI_POHistoryCheck';
    private static final Integer CHUNK_SIZE         = 600;
    private static final Integer HTTP_SUCCESS_CODE  = 200;
    private static final String  API_TYPE_BAG       = 'BAG';
    private static final String  API_TYPE_VIZID     = 'VIZID';
    private static final String  BILLING_DOC_ZF2    = 'ZF2';
    private static final String  BILLING_DOC_ZF2ZFV = 'ZF2,ZFV';
    private static final String  CPU_POH_REJECTION  =
        R4C_Generic_Configurations__c.getValues('CPU_POH_Rejection')?.Value__c
        ?? 'CPU_POH_Rejection';

    private static final List<String> NEW_HEADERS = new List<String>{
        'BillingDate', 'CustomerPONumber', 'SalesOrderNumber', 'SalesOrderLineNbr',
        'CustomerBillingDocId', 'CustomerItemNbr', 'SoldToCustomerId',
        'BillingQty', 'CurrencyCd', 'BillingDocLineNbr', 'BatchId',
        'POUnitPrice', 'POIsValid', 'POHistoryStatus', 'POHistoryErrorReason'
    };

    public static void run(
        String caseNumber,
        Integer lineStart,
        Integer lineEnd
    ) {
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
            if (activeLines.isEmpty()) { System.debug('No active lines.'); return; }

            String warrantyAttachmentName =
                'KTBR_TI_WarrantyEntitlementCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, warrantyAttachmentName);

            if (previous.isEmpty()) {
                System.debug('No warranty data found. Ensure warranty entitlement step was executed.');
                return;
            }

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            Map<String, WarrantyInfo> warrantyInfoMap = buildWarrantyInfoMap(previous.rows);

            Map<Id, Boolean[]> matrixFlags = R4C_KTBR_Util.buildULTCPNFlagsMap(activeLines, ctx);

            String startDate = getPOHistoryStartDate(ctx.serviceType);
            String endDate   = getPOHistoryEndDate();

            List<Customer_Sales_Issue_Request_Line__c> bagLines   =
                new List<Customer_Sales_Issue_Request_Line__c>();
            List<Customer_Sales_Issue_Request_Line__c> vizidLines =
                new List<Customer_Sales_Issue_Request_Line__c>();
            List<Customer_Sales_Issue_Request_Line__c> noUltLines =
                new List<Customer_Sales_Issue_Request_Line__c>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                WarrantyInfo w = warrantyInfoMap.get(line.Name);
                if (w == null || !w.hasULT) {
                    noUltLines.add(line);
                } else if (w.isVISID) {
                    vizidLines.add(line);
                } else {
                    bagLines.add(line);
                }
            }
            System.debug('BAG=' + bagLines.size()
                + ' | VIZID=' + vizidLines.size()
                + ' | NoULT=' + noUltLines.size());

            Boolean hasEW = false;
            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                WarrantyInfo w = warrantyInfoMap.get(line.Name);
                if (w != null && w.warrantyTypeCode == '2') { hasEW = true; break; }
            }
            String billingDocTypeCd = hasEW ? BILLING_DOC_ZF2ZFV : BILLING_DOC_ZF2;
            List<String> cmfList    = buildCMFList(ctx);

            Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> bagResp =
                new Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>>();
            if (!bagLines.isEmpty()) {
                bagResp = callAPI(buildBagMMKeys(bagLines, warrantyInfoMap),
                    API_TYPE_BAG, billingDocTypeCd, startDate, endDate, cmfList);
            }

            Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> vizidResp =
                new Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>>();
            if (!vizidLines.isEmpty()) {
                vizidResp = callAPI(buildVizidMMKeys(vizidLines, warrantyInfoMap),
                    API_TYPE_VIZID, billingDocTypeCd, startDate, endDate,
                    new List<String>());
            }

            Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> noUltResp =
                new Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>>();
            if (!noUltLines.isEmpty()) {
                noUltResp = callAPI(buildNoUltMMKeys(noUltLines, warrantyInfoMap),
                    API_TYPE_BAG, billingDocTypeCd, startDate, endDate, cmfList);
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues =
                new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                WarrantyInfo wInfo  = warrantyInfoMap.get(line.Name);
                Boolean isCPNReq   = matrixFlags.containsKey(line.Id)
                    && matrixFlags.get(line.Id)[1];

                Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> respMap;
                if (wInfo != null && wInfo.hasULT && wInfo.isVISID) {
                    respMap = vizidResp;
                } else if (wInfo != null && wInfo.hasULT) {
                    respMap = bagResp;
                } else {
                    respMap = noUltResp;
                }

                POHistoryResult result = validateLine(line, respMap, isCPNReq, wInfo);

                if (result.status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = (wInfo != null && wInfo.isVISID)
                        ? CPU_POH_REJECTION
                        : R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c = result.reason;
                } else {
                    applyResultToLine(line, result);
                }

                linesToUpdate.add(line);
                newValues.put(line.Name, buildPONewValueMap(result));
            }

            if (!linesToUpdate.isEmpty()) {
                R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);
                System.debug('Updated ' + linesToUpdate.size() + ' lines.');
            }

            List<String> csvRows = R4C_KTBR_Util.appendColumnsToCSV(
                previous, lineOrder, NEW_HEADERS, newValues
            );
            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_TI_POHistoryCheck_' + caseNumber + '_L' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug('==== ' + CLASS_NAME + ' COMPLETED ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
        }
    }


    private static Map<String, String> buildPONewValueMap(POHistoryResult r) {
        return new Map<String, String>{
            'BillingDate'           => r.billingDate,
            'CustomerPONumber'      => r.customerPONumber,
            'SalesOrderNumber'      => r.salesOrderNumber,
            'SalesOrderLineNbr'     => r.salesOrderLineNbr,
            'CustomerBillingDocId'  => r.customerBillingDocId,
            'CustomerItemNbr'       => r.customerItemNbr,
            'SoldToCustomerId'      => r.soldToCustomerId,
            'BillingQty'            => r.billingQty,
            'CurrencyCd'            => r.currencyCd,
            'BillingDocLineNbr'     => r.billingDocLineNbr,
            'BatchId'               => r.batchId,
            'POUnitPrice'           => r.unitPrice != null ? String.valueOf(r.unitPrice) : '0',
            'POIsValid'             => r.isValid ? 'true' : 'false',
            'POHistoryStatus'       => r.status,
            'POHistoryErrorReason'  => r.reason
        };
    }


    private static Map<String, WarrantyInfo> buildWarrantyInfoMap(
        Map<String, Map<String, String>> csvRows
    ) {
        Map<String, WarrantyInfo> result = new Map<String, WarrantyInfo>();
        for (String lineNumber : csvRows.keySet()) {
            Map<String, String> row = csvRows.get(lineNumber);
            WarrantyInfo info = new WarrantyInfo();
            info.lineNumber                  = lineNumber;
            info.mm                          = row.get('MM')                          ?? '';
            info.ult                         = row.get('ULT')                         ?? '';
            info.warrantyTypeCode            = row.get('WarrantyTypeCode')             ?? '';
            info.statusCode                  = row.get('ProdUniqueIdStatusCode')       ?? '';
            info.vizIdStatusCode             = row.get('VizIdStatusCode')              ?? '';
            info.creditPeriodCount           = row.get('CreditPeriodCount')            ?? '';
            info.cepEndDate                  = row.get('CEPEndDate')                   ?? '';
            info.isInWarranty                = row.get('IsInWarranty')                 ?? '';
            info.status                      = row.get('WarrantyStatus')               ?? '';
            info.errorReason                 = row.get('WarrantyErrorReason')          ?? '';
            info.oldMM                       = row.get('OldMM')                        ?? '';
            info.baseWarrantyStartDate       = row.get('BaseWarrantyStartDate')        ?? '';
            info.extendedWarrantyStartDate   = row.get('ExtendedWarrantyStartDate')    ?? '';
            info.extendedWarrantyEndDate     = row.get('ExtendedWarrantyEndDate')      ?? '';
            info.serviceContractNumber       = row.get('ServiceContractNumber')        ?? '';
            info.entitlementCMFSalesOrgCode  = row.get('EntitlementCMFSalesOrgCode')   ?? '';
            info.entitlementCMFDistiChannelCode = row.get('EntitlementCMFDistiChannelCode') ?? '';
            info.deliveryNoteNumber          = row.get('DeliveryNoteNumber')           ?? '';
            info.enttlSoldToPartyId          = row.get('EnttlSoldToPartyId')           ?? '';
            info.creditEligibilityEndDate    = row.get('CEPEndDate')                   ?? '';
            info.hasULT         = String.isNotBlank(info.ult);
            info.isUnderCEPDays = info.isInWarranty == 'true';
            info.isVISID        = info.vizIdStatusCode?.toUpperCase() == 'VISID';
            result.put(lineNumber, info);
        }
        return result;
    }


    private static Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> callAPI(
        List<String> mmKeys,
        String apiType,
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
        String endpoint = isIAO
            ? settings.IAO_Named_Credential__c
            : settings.Consuming_Class_Name__c;
        if (String.isBlank(endpoint)) {
            System.debug('ERROR: Endpoint blank for ' + apiType);
            return result;
        }

        for (List<String> chunk : R4C_KTBR_Util.chunkList(mmKeys, CHUNK_SIZE)) {
            R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper req =
                new R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper();
            req.apiType                       = apiType;
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
                HttpResponse res = new Http().send(
                    R4C_KTBR_Util.buildHttpRequest(endpoint, reqBody));
                Integer statusCode = res.getStatusCode();
                String  resBody    = res.getBody();
                R4C_KTBR_Util.logAPIRequest(CLASS_NAME, txId, reqBody);
                R4C_KTBR_Util.logAPIResponse(CLASS_NAME, txId, statusCode, resBody);

                if (statusCode == HTTP_SUCCESS_CODE && String.isNotBlank(resBody)) {
                    R4C_API_POsearch_HANAConsumingClass.SOResponse wrapper =
                        (R4C_API_POsearch_HANAConsumingClass.SOResponse)
                        JSON.deserialize(resBody,
                            R4C_API_POsearch_HANAConsumingClass.SOResponse.class);
                    if (wrapper?.elements != null) {
                        for (R4C_API_POsearch_HANAConsumingClass.responseElements el
                                : wrapper.elements) {
                            if (String.isNotBlank(el.ItemId)) {
                                if (!result.containsKey(el.ItemId)) {
                                    result.put(el.ItemId,
                                        new List<R4C_API_POsearch_HANAConsumingClass.responseElements>());
                                }
                                result.get(el.ItemId).add(el);
                            }
                        }
                    }
                } else {
                    System.debug('WARNING: ' + apiType + ' API returned status ' + statusCode);
                }
            } catch (Exception ex) {
                R4C_KTBR_Util.logError(CLASS_NAME, 'callAPI.' + apiType, ex);
            }
        }
        for (String mm : result.keySet()) {
            result.get(mm).sort(new R4C_KTBR_Util.POHistoryDateSorter());
        }
        return result;
    }

    private static POHistoryResult validateLine(
        Customer_Sales_Issue_Request_Line__c line,
        Map<String, List<R4C_API_POsearch_HANAConsumingClass.responseElements>> respMap,
        Boolean isCPNRequired,
        WarrantyInfo wInfo
    ) {
        POHistoryResult result = new POHistoryResult();
        String mm = line.Sales_Issue_Item__r?.Name;

        if (String.isBlank(mm)) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Missing MM.';
            return result;
        }

        List<R4C_API_POsearch_HANAConsumingClass.responseElements> responses = respMap.get(mm);
        if ((responses == null || responses.isEmpty())
                && wInfo != null && String.isNotBlank(wInfo.oldMM)) {
            responses = respMap.get(wInfo.oldMM);
        }
        if (responses == null || responses.isEmpty()) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'No PO history data found for MM: ' + mm;
            return result;
        }

        R4C_API_POsearch_HANAConsumingClass.responseElements best =
            findMatchingResponse(responses, wInfo);
        if (best == null) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'PO history date window mismatch for MM: ' + mm;
            return result;
        }

        if (wInfo == null || !wInfo.hasULT || wInfo.isUnderCEPDays) {
            if (best.CustomerBillingDocumentDt != null
                    && String.isNotBlank(wInfo?.creditEligibilityEndDate)) {
                try {
                    Date billingDt = best.CustomerBillingDocumentDt;
                    Date cepEnd    = Date.valueOf(wInfo.creditEligibilityEndDate.left(10));
                    if (billingDt > Date.today() || billingDt < cepEnd) {
                        result.status = R4C_KTBR_Util.DECLINED_STATUS;
                        result.reason = 'Billing date outside CEP window for MM: ' + mm;
                        return result;
                    }
                } catch (Exception e) {
                    System.debug(CLASS_NAME + ': WARNING — CEP date parse failed: ' + e.getMessage());
                }
            }
        }

        if (isCPNRequired
                && String.isBlank(line.Sales_Issue_Customer_Part_Number__c)
                && String.isBlank(best.CustomerItemNbr)) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'CPN required but missing on line and PO history.';
            return result;
        }

        Decimal price = 0;
        if (String.isNotBlank(best.SalesOrderLineNetPriceAmt)) {
            try { price = Decimal.valueOf(best.SalesOrderLineNetPriceAmt); } catch (Exception e) {}
        }
        if (String.isNotBlank(best.ContraRevenueAdjustmentRequestlineNetPriceAmt)) {
            try {
                Decimal contra = Decimal.valueOf(
                    best.ContraRevenueAdjustmentRequestlineNetPriceAmt);
                if (contra > 0) price = contra;
            } catch (Exception e) {}
        }
        if (price == 0) {
            result.status = R4C_KTBR_Util.DECLINED_STATUS;
            result.reason = 'Unit price is zero in PO history.';
            return result;
        }

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
        result.isValid              = true;
        return result;
    }

    private static R4C_API_POsearch_HANAConsumingClass.responseElements findMatchingResponse(
        List<R4C_API_POsearch_HANAConsumingClass.responseElements> responses,
        WarrantyInfo wInfo
    ) {
        if (responses == null || responses.isEmpty()) return null;
        if (wInfo == null) return responses[0];

        for (R4C_API_POsearch_HANAConsumingClass.responseElements resp : responses) {
            Boolean matched = false;

            if (wInfo.isVISID) {
                String expected =
                    processDate(wInfo.baseWarrantyStartDate) + '_'
                    + processDate(wInfo.creditEligibilityEndDate) + '_'
                    + (String.isBlank(wInfo.deliveryNoteNumber) ? ''
                        : wInfo.deliveryNoteNumber.leftPad(10, '0'));
                String actual =
                    (resp.ItemEffectiveStartDt ?? '') + '_'
                    + (resp.ItemEffectiveEndDt  ?? '') + '_'
                    + (String.isBlank(resp.DeliveryNoteNbr) ? ''
                        : resp.DeliveryNoteNbr.leftPad(10, '0'));
                matched = (expected == actual);

            } else if (!wInfo.hasULT) {
                String todayStr  = processDate(String.valueOf(Date.today()));
                String creditStr = String.isNotBlank(wInfo.creditEligibilityEndDate)
                    ? processDate(wInfo.creditEligibilityEndDate) : todayStr;
                String expected  = processPoHistoryDates(creditStr, todayStr);
                String actual    = (resp.ItemEffectiveStartDt ?? '') + (resp.ItemEffectiveEndDt ?? '');
                matched = (expected == actual);

            } else if (wInfo.warrantyTypeCode == '2') {
                String expected = processPoHistoryDates(
                    wInfo.extendedWarrantyStartDate, wInfo.extendedWarrantyEndDate);
                String actual   = (resp.ItemEffectiveStartDt ?? '') + (resp.ItemEffectiveEndDt ?? '');
                matched = (expected == actual)
                    && (resp.SalesOrderId == wInfo.serviceContractNumber);

            } else {
                String expected = processPoHistoryDates(
                    wInfo.baseWarrantyStartDate, wInfo.creditEligibilityEndDate);
                String actual   = (resp.ItemEffectiveStartDt ?? '') + (resp.ItemEffectiveEndDt ?? '');
                matched = (expected == actual);
            }

            if (matched) return resp;
        }
        return null;
    }

    private static void applyResultToLine(
        Customer_Sales_Issue_Request_Line__c line,
        POHistoryResult result
    ) {
        if (String.isNotBlank(result.billingDate)) {
            try {
                line.Sales_Issue_Billing_Date__c =
                    Date.valueOf(result.billingDate.substring(0, 10));
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

    // REVIEW (KTBR audit — buildCMFList gap, high impact, two separate problems):
    //
    // 1) Missing branch entirely. The source-of-truth JS branches on a case/customer-level
    //    flag ("isUcdoff", set by a parent component not present in this file set — likely
    //    derived from an Account/Customer/CMF field per ticket TWC777-2688 "CIM EOL - PO
    //    History API Changes"). When that flag is true, the CMF list comes from a completely
    //    different source (a "bagList" with a "9999-{soldToCMF}" entry appended) instead of
    //    the sold_to_cmf_number__c-derived list built below. This method has no equivalent
    //    branch at all — confirmed with the team that this flag can be true or false per case,
    //    so this isn't a dead path.
    //
    // 2) Wrong format on the branch that IS implemented. Confirmed with the team that
    //    isPsgCase is always false in this org, so the JS's live (non-PSG) fallback format is
    //    the concrete "{salesOrgCode}_{distiChannelCode}_{soldToCMF}" — not the wildcard
    //    "****_**_{soldToCMF}" format used below, which is the PSG-only variant that should
    //    never apply here.
    //
    // Proposed fix sketch (needs the actual isUcdoff source identified before applying):
    // private static List<String> buildCMFList(R4C_KTBR_Util.CaseContext ctx, Boolean isUcdoff) {
    //     List<String> cmfList = new List<String>();
    //     if (isUcdoff) {
    //         // TODO: source this the same way the JS's "bagList" is sourced, not from
    //         // sold_to_cmf_number__c.
    //         cmfList.add('9999-' + (ctx.soldToCMF ?? ''));
    //         return cmfList;
    //     }
    //     try {
    //         List<Customer_Sales_Issue_Request__c> headers = [
    //             SELECT sold_to_cmf_number__c
    //             FROM Customer_Sales_Issue_Request__c
    //             WHERE Id = :ctx.headerId LIMIT 1
    //         ];
    //         if (!headers.isEmpty() && String.isNotBlank(headers[0].sold_to_cmf_number__c)) {
    //             List<Object> raw = (List<Object>)
    //                 JSON.deserializeUntyped(headers[0].sold_to_cmf_number__c);
    //             List<String> bagEntries = new List<String>();
    //             for (Object o : raw) bagEntries.add(String.valueOf(o));
    //             cmfList = filterBAGList(bagEntries);
    //         }
    //         cmfList.add('99991231T00:00:00.000+000_' + ctx.salesOrgCode + '_'
    //             + ctx.distiChannelCode + '_' + (ctx.soldToCMF ?? ''));
    //     } catch (Exception ex) {
    //         System.debug(CLASS_NAME + ': WARNING — buildCMFList: ' + ex.getMessage());
    //         cmfList.add('99991231T00:00:00.000+000_' + ctx.salesOrgCode + '_'
    //             + ctx.distiChannelCode + '_' + (ctx.soldToCMF ?? ''));
    //     }
    //     return cmfList;
    // }
    private static List<String> buildCMFList(R4C_KTBR_Util.CaseContext ctx) {
        List<String> cmfList = new List<String>();
        try {
            List<Customer_Sales_Issue_Request__c> headers = [
                SELECT sold_to_cmf_number__c
                FROM Customer_Sales_Issue_Request__c
                WHERE Id = :ctx.headerId LIMIT 1
            ];
            if (!headers.isEmpty() && String.isNotBlank(headers[0].sold_to_cmf_number__c)) {
                List<Object> raw = (List<Object>)
                    JSON.deserializeUntyped(headers[0].sold_to_cmf_number__c);
                List<String> bagEntries = new List<String>();
                for (Object o : raw) bagEntries.add(String.valueOf(o));
                cmfList = filterBAGList(bagEntries);
            }
            cmfList.add('99991231T00:00:00.000+000_****_**_' + (ctx.soldToCMF ?? ''));
        } catch (Exception ex) {
            System.debug(CLASS_NAME + ': WARNING — buildCMFList: ' + ex.getMessage());
            cmfList.add('99991231T00:00:00.000+000_****_**_' + (ctx.soldToCMF ?? ''));
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

    private static List<String> buildBagMMKeys(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        Map<String, WarrantyInfo> wMap
    ) {
        Set<String> keys = new Set<String>();
        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            String mm = line.Sales_Issue_Item__r?.Name;
            if (String.isBlank(mm)) continue;
            WarrantyInfo w = wMap.get(line.Name);
            if (w == null) continue;
            String key;
            if (w.warrantyTypeCode == '2') {
                String dates = processPoHistoryDates(
                    w.extendedWarrantyStartDate, w.extendedWarrantyEndDate);
                key = mm + '_' + dates + '_' + (w.serviceContractNumber ?? '');
            } else {
                String dates = processPoHistoryDates(
                    w.baseWarrantyStartDate, w.creditEligibilityEndDate);
                key = mm + '_' + dates + '_********';
            }
            keys.add(key);
            if (String.isNotBlank(w.oldMM)) {
                String oldKey;
                if (w.warrantyTypeCode == '2') {
                    String dates = processPoHistoryDates(
                        w.extendedWarrantyStartDate, w.extendedWarrantyEndDate);
                    oldKey = w.oldMM + '_' + dates + '_' + (w.serviceContractNumber ?? '');
                } else {
                    String dates = processPoHistoryDates(
                        w.baseWarrantyStartDate, w.creditEligibilityEndDate);
                    oldKey = w.oldMM + '_' + dates + '_********';
                }
                keys.add(oldKey);
            }
        }
        return new List<String>(keys);
    }

    private static List<String> buildVizidMMKeys(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        Map<String, WarrantyInfo> wMap
    ) {
        Set<String> keys = new Set<String>();
        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            String mm = line.Sales_Issue_Item__r?.Name;
            if (String.isBlank(mm)) continue;
            WarrantyInfo w = wMap.get(line.Name);
            if (w == null) continue;
            String startStr  = processDate(w.baseWarrantyStartDate);
            String endStr    = processDate(w.creditEligibilityEndDate);
            String delivery  = String.isBlank(w.deliveryNoteNumber) ? ''
                : w.deliveryNoteNumber.leftPad(10, '0');
            String soldTo    = String.isBlank(w.enttlSoldToPartyId) ? ''
                : w.enttlSoldToPartyId.leftPad(10, '0');
            String key = mm + '_' + startStr + '_' + endStr + '_'
                + (w.entitlementCMFSalesOrgCode    ?? '') + '_'
                + (w.entitlementCMFDistiChannelCode ?? '') + '_'
                + delivery + '_' + soldTo;
            keys.add(key);
            if (String.isNotBlank(w.oldMM)) {
                keys.add(w.oldMM + '_' + startStr + '_' + endStr + '_'
                    + (w.entitlementCMFSalesOrgCode    ?? '') + '_'
                    + (w.entitlementCMFDistiChannelCode ?? '') + '_'
                    + delivery + '_' + soldTo);
            }
        }
        return new List<String>(keys);
    }

    private static List<String> buildNoUltMMKeys(
        List<Customer_Sales_Issue_Request_Line__c> lines,
        Map<String, WarrantyInfo> wMap
    ) {
        Set<String> keys    = new Set<String>();
        String todayStr     = processDate(String.valueOf(Date.today()));
        for (Customer_Sales_Issue_Request_Line__c line : lines) {
            String mm = line.Sales_Issue_Item__r?.Name;
            if (String.isBlank(mm)) continue;
            WarrantyInfo w   = wMap.get(line.Name);
            String creditStr = (w != null && String.isNotBlank(w.creditEligibilityEndDate))
                ? processDate(w.creditEligibilityEndDate) : todayStr;
            String key = mm + '_' + processPoHistoryDates(creditStr, todayStr) + '_**********';
            keys.add(key);
            if (w != null && String.isNotBlank(w.oldMM)) {
                keys.add(w.oldMM + '_' + processPoHistoryDates(creditStr, todayStr) + '_**********');
            }
        }
        return new List<String>(keys);
    }

    private static String processDate(String dateInput) {
        if (String.isBlank(dateInput)) return '';
        try {
            Date d  = Date.valueOf(dateInput.left(10));
            String m  = String.valueOf(d.month()).leftPad(2, '0');
            String dy = String.valueOf(d.day()).leftPad(2, '0');
            return String.valueOf(d.year()) + m + dy;
        } catch (Exception ex) {
            System.debug(CLASS_NAME + ': WARNING — processDate: ' + dateInput);
            return '';
        }
    }

    private static String processDate(Date d) {
        if (d == null) return '';
        return processDate(String.valueOf(d));
    }

    private static String processPoHistoryDates(String date1, String date2) {
        return processDate(date1) + processDate(date2);
    }

    private static String processPoHistoryDates(Date date1, String date2) {
        return processDate(date1) + processDate(date2);
    }

    private static String getPOHistoryStartDate(String serviceType) {
        Integer months = -36;
        if (serviceType != null) {
            if (serviceType.containsIgnoreCase('Stock Rotation'))
                months = -Integer.valueOf(getConfig('PO_Search_Stock_Rotation_Months', '36'));
            else if (serviceType.containsIgnoreCase('Technical'))
                months = -Integer.valueOf(getConfig('PO_Search_Technical_Intake_Months', '36'));
            else if (serviceType.containsIgnoreCase('Quality'))
                months = -Integer.valueOf(getConfig('PO_Search_Quality_Intake_Months', '36'));
            else if (serviceType.containsIgnoreCase('Exception'))
                months = -Integer.valueOf(getConfig('PO_Search_Exception_Intake_Months', '36'));
            else if (serviceType.containsIgnoreCase('Admin'))
                months = -Integer.valueOf(getConfig('PO_Search_Admin_Intake_Months', '36'));
        }
        return processDate(Date.today().addMonths(months));
    }

    private static String getPOHistoryEndDate() {
        return processDate(Date.today());
    }

    private static String getConfig(String name, String defaultVal) {
        R4C_Generic_Configurations__c cfg = R4C_Generic_Configurations__c.getValues(name);
        return (cfg != null && String.isNotBlank(cfg.Value__c)) ? cfg.Value__c : defaultVal;
    }

    private class WarrantyInfo {
        public String  lineNumber;
        public String  mm;
        public String  ult;
        public String  warrantyTypeCode;
        public String  statusCode;
        public String  vizIdStatusCode;
        public String  creditPeriodCount;
        public String  cepEndDate;
        public String  isInWarranty;
        public String  status;
        public String  errorReason;
        public Boolean hasULT;
        public Boolean isUnderCEPDays;
        public Boolean isVISID;
        public String  baseWarrantyStartDate;
        public String  creditEligibilityEndDate;
        public String  extendedWarrantyStartDate;
        public String  extendedWarrantyEndDate;
        public String  serviceContractNumber;
        public String  entitlementCMFSalesOrgCode;
        public String  entitlementCMFDistiChannelCode;
        public String  deliveryNoteNumber;
        public String  enttlSoldToPartyId;
        public String  oldMM;
    }

    private class POHistoryResult {
        public String  status               = 'Pass';
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
        public Boolean isValid              = false;
    }
}


// =====================================================================================
// FILE: R4C_KTBR_TI_PICCheck.cls
// =====================================================================================

/*******************************************************************************
* Class Name   : R4C_KTBR_TI_PICCheck
* Description  : KTBR Technical Intake Credit Price Validation.
*                Reads the CSV produced by R4C_KTBR_TI_POHistoryCheck,
*                fetches credit price for each active line's MM from the
*                PIC API, appends columns, and writes a new CSV.
*
* USAGE   :   R4C_KTBR_TI_PICCheck.run('06596326', 1, 1000);
*
* Created By   : Abhishek Pandey
* Created Date : 27/04/2026
*******************************************************************************/

public without sharing class R4C_KTBR_TI_PICCheck {

    private static final String  CLASS_NAME          = 'R4C_KTBR_TI_PICCheck';
    private static final Integer CHUNK_SIZE           = 1000;
    private static final String  PRICE_NOT_FOUND_MSG  = 'Price Not Found - Manual Review Required';
    private static final String  PRICE_ZERO_MSG       = 'Price Zero - Manual Price Override Required';

    private static final List<String> NEW_HEADERS = new List<String>{
        'PICCurrentPrice', 'PICPriceCondition', 'PICValidFromDate', 'PICValidToDate',
        'PICStatus', 'PICNotes'
    };

    public static void run(String caseNumber, Integer lineStart, Integer lineEnd) {
        System.debug('==== ' + CLASS_NAME + ' START | Case: ' + caseNumber
            + ' | Range: ' + lineStart + '-' + lineEnd + ' ====');
        try {
            List<Customer_Sales_Issue_Request_Line__c> lines =
                R4C_KTBR_Util.queryLinesInRange(caseNumber, lineStart, lineEnd);
            if (lines.isEmpty()) {
                System.debug(CLASS_NAME + ': No lines found in range. Exiting.');
                return;
            }

            Id caseId = R4C_KTBR_Util.getCaseId(caseNumber);
            if (caseId == null) return;

            R4C_KTBR_Util.CaseContext ctx = R4C_KTBR_Util.buildCaseContext(caseNumber);
            if (ctx == null) {
                System.debug(CLASS_NAME + ': Could not build case context.');
                return;
            }

            List<Customer_Sales_Issue_Request_Line__c> activeLines =
                R4C_KTBR_Util.filterActiveLines(lines);
            if (activeLines.isEmpty()) {
                System.debug(CLASS_NAME + ': No active lines to process.');
                return;
            }

            String poAttachmentName =
                'KTBR_TI_POHistoryCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, poAttachmentName);

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            Set<String> mmSet = new Set<String>();
            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                if (String.isNotBlank(line.Sales_Issue_Item__r?.Name)) {
                    mmSet.add(line.Sales_Issue_Item__r.Name);
                }
            }

            List<String> mmList = new List<String>(mmSet);

            Boolean isIAO = Boolean.valueOf(R4C_KTBR_Util.IS_IAO_FLAG);
            R4C_APIGEE_Settings__mdt integrationSetting = isIAO
                ? R4C_APIGEE_Settings__mdt.getInstance('zfs_zsdpPriceSearch_PIC')
                : R4C_APIGEE_Settings__mdt.getInstance('YCS3PriceSearch_PIC');

            List<String> normalisedSalesOrgs = normaliseSalesOrgs(
                new List<String>{ ctx.salesOrgCode }
            );

            List<R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3> allPrices =
                callPICInChunks(
                    mmList, ctx.soldToCMF, normalisedSalesOrgs,
                    integrationSetting.Consuming_Class_Name__c
                );

            Map<String, R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3> mmToPriceMap =
                buildMmToPriceMap(allPrices);

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues =
                new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3 priceEl =
                    mmToPriceMap.get(line.Sales_Issue_Item__r?.Name?.trim());

                String status;
                String notes = '';

                if (priceEl == null || String.isBlank(priceEl.CurrentPrice)) {
                    status = PRICE_NOT_FOUND_MSG;
                    notes = 'Agent must enter price and reason manually before submission.';
                    line.Line_item_error_messages__c =
                        appendError(line.Line_item_error_messages__c, status);

                } else if (priceEl.CurrentPrice == '0' || priceEl.CurrentPrice == '0.00') {
                    status = PRICE_ZERO_MSG;
                    notes = 'Agent must enter override price and reason before submission.';
                    line.Line_item_error_messages__c =
                        appendError(line.Line_item_error_messages__c, status);

                } else {
                    status = 'Pass';
                    Decimal parsedPrice = parsePrice(priceEl.CurrentPrice);
                    if (ctx.distiChannelCode == '01') {
                        line.Sales_Issue_PO_Price__c = parsedPrice;
                    } else {
                        line.Sales_Issue_Disti_Price__c = parsedPrice;
                    }
                    line.Sales_Issue_Pricing_Condition_Type__c = priceEl.PriceCondition;
                    line.Sales_Issue_Pricing_Date__c           = Date.today();
                }

                linesToUpdate.add(line);

                newValues.put(line.Name, new Map<String, String>{
                    'PICCurrentPrice'   => priceEl?.CurrentPrice   ?? '',
                    'PICPriceCondition' => priceEl?.PriceCondition ?? '',
                    'PICValidFromDate'  => priceEl?.ValidFromDate  ?? '',
                    'PICValidToDate'    => priceEl?.ValidToDate    ?? '',
                    'PICStatus'         => status,
                    'PICNotes'          => notes
                });
            }

            R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);

            List<String> csvRows = R4C_KTBR_Util.appendColumnsToCSV(
                previous, lineOrder, NEW_HEADERS, newValues
            );
            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_TI_PICCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug(CLASS_NAME + ' complete. Lines processed: '
                + linesToUpdate.size() + ' / ' + activeLines.size());

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
        }
    }

    private static List<R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3> callPICInChunks(
        List<String> mmList,
        String       cmf,
        List<String> normalisedSalesOrgs,
        String       endpoint
    ) {
        List<R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3> allPrices =
            new List<R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3>();

        for (List<String> mmChunk : R4C_KTBR_Util.chunkList(mmList, CHUNK_SIZE)) {
            String reqBody       = buildPICRequestBody(mmChunk, cmf, normalisedSalesOrgs);
            String transactionId = R4C_API_MessageLogAndAttachment.generateTransactionId();
            try {
                HttpResponse res = new Http().send(
                    R4C_KTBR_Util.buildHttpRequest(endpoint, reqBody));
                Integer statusCode = res.getStatusCode();
                String  resBody    = res.getBody();
                R4C_KTBR_Util.logAPIRequest(CLASS_NAME, transactionId, reqBody);
                R4C_KTBR_Util.logAPIResponse(CLASS_NAME, transactionId, statusCode, resBody);
                if (statusCode == 200 && String.isNotBlank(resBody)) {
                    R4C_PriceAPIYCS3_PICConsumingClass.lineItemResponseYCS3 parsed =
                        (R4C_PriceAPIYCS3_PICConsumingClass.lineItemResponseYCS3)
                        JSON.deserialize(resBody,
                            R4C_PriceAPIYCS3_PICConsumingClass.lineItemResponseYCS3.class);
                    if (parsed?.elements != null) allPrices.addAll(parsed.elements);
                } else {
                    System.debug(CLASS_NAME + ': PIC API chunk returned status '
                        + statusCode + ' for ' + mmChunk.size() + ' MMs.');
                }
            } catch (Exception ex) {
                R4C_KTBR_Util.logError(CLASS_NAME, 'callPICInChunks', ex);
            }
        }

        return allPrices;
    }

    private static String buildPICRequestBody(
        List<String> mmChunk,
        String       cmf,
        List<String> normalisedSalesOrgs
    ) {
        String commaSepMMs = '\'' + String.join(mmChunk, '\',\'') + '\'';
        String filterStr   = '(("MMList" in (' + commaSepMMs + ')) ';
        if (!normalisedSalesOrgs.isEmpty()) {
            String commaSepOrgs = '\'' + String.join(normalisedSalesOrgs, '\',\'') + '\'';
            filterStr += 'and ("SalesOrgidList" in (' + commaSepOrgs + '))) ';
        }
        if (String.isNotBlank(cmf)) {
            filterStr += 'and ("CMF" = \'' + cmf + '\')) ';
        }

        JSONGenerator jsonGen = JSON.createGenerator(true);
        jsonGen.writeStartObject();
        jsonGen.writeObjectField('$format', 'json');
        jsonGen.writeObjectField('$filter', filterStr);
        jsonGen.writeEndObject();
        return jsonGen.getAsString();
    }

    private static Map<String, R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3>
    buildMmToPriceMap(
        List<R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3> allPrices
    ) {
        Map<String, R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3> result =
            new Map<String, R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3>();
        Date today = Date.today();
        for (R4C_PriceAPIYCS3_PICConsumingClass.creditPriceElementsYCS3 el : allPrices) {
            if (String.isBlank(el.MM)) continue;
            if (!isDateValid(el.ValidFromDate, el.ValidToDate, today)) continue;
            String key = el.MM.trim();
            if (!result.containsKey(key)) result.put(key, el);
        }

        return result;
    }

    private static Boolean isDateValid(String validFromStr, String validToStr, Date today) {
        try {
            Boolean fromOk = true;
            Boolean toOk   = true;
            if (String.isNotBlank(validFromStr)) {
                Date fromDate = Date.valueOf(validFromStr.trim());
                fromOk = today > fromDate;
            }
            if (String.isNotBlank(validToStr)) {
                Date toDate = Date.valueOf(validToStr.trim());
                toOk = today < toDate;
            }

            return fromOk && toOk;
        } catch (Exception ex) {
            System.debug(CLASS_NAME + ': Could not parse price dates: '
                + validFromStr + ' / ' + validToStr + ' - ' + ex.getMessage());
            return true;
        }
    }

    private static List<String> normaliseSalesOrgs(List<String> rawOrgs) {
        List<String> normalised = new List<String>();
        for (String org : rawOrgs) {
            if (String.isBlank(org)) continue;
            if (org.startsWith('AM')) {
                normalised.add('AM22');
            } else if (!org.endsWith('01')) {
                normalised.add(org.replaceFirst('.{2}$', '01'));
            } else {
                normalised.add(org);
            }
        }

        return normalised;
    }

    private static Decimal parsePrice(String priceStr) {
        try {
            return String.isNotBlank(priceStr) ? Decimal.valueOf(priceStr.trim()) : 0;
        } catch (Exception ex) {
            System.debug(CLASS_NAME + ': Could not parse price: ' + priceStr);
            return 0;
        }
    }

    private static String appendError(String existing, String newMsg) {
        if (String.isBlank(existing)) return newMsg;
        return existing + '; ' + newMsg;
    }

}


// =====================================================================================
// FILE: R4C_KTBR_TI_BusinessRulesCheck.cls
// =====================================================================================

/***************************************************************************
 * Class Name  : R4C_KTBR_TI_BusinessRulesCheck
 * Description : KTBR - Business Rules Check (Technical Intake).
 *               Reads the CSV produced by R4C_KTBR_TI_PICCheck, runs three
 *               business rule validations in sequence on all non-declined
 *               lines, appends result columns.
 *
 * USAGE:
 *   R4C_KTBR_TI_BusinessRulesCheck.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 09/05/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_TI_BusinessRulesCheck {

    private static final String CLASS_NAME        = 'R4C_KTBR_TI_BusinessRulesCheck';
    private static final String RT_REQUIRED_FIELD = 'Sales_Issue_Required_Field_Matrix';
    private static final String RT_NPR_RULE       = 'Sales_Issue_NPR_Rule_Matrix';
    private static final String REMEDY_NPR_CREDIT = 'NPR-Credit';
    private static final String RETURN_REASON_QAN_MRB = 'QAN_MRB_PRT';

    private static final List<String> NEW_HEADERS = new List<String>{
        'IsUltRequired', 'IsCPNRequired', 'IsMMRequired',
        'NPRCheck', 'MRBCheck',
        'BusinessRulesStatus', 'BusinessRulesErrorReason'
    };


    public static void run(String caseNumber, Integer lineStart, Integer lineEnd) {
        System.debug('==== ' + CLASS_NAME + ' START | Case: ' + caseNumber
            + ' | Range: ' + lineStart + '-' + lineEnd + ' ====');
        try {
            if (String.isBlank(caseNumber) || lineStart == null || lineEnd == null) {
                System.debug('ERROR: Invalid input parameters'); return;
            }

            List<Customer_Sales_Issue_Request_Line__c> lines =
                R4C_KTBR_Util.queryLinesInRange(caseNumber, lineStart, lineEnd);
            if (lines.isEmpty()) { System.debug('No lines found in range.'); return; }

            Id caseId = R4C_KTBR_Util.getCaseId(caseNumber);
            if (caseId == null) return;

            R4C_KTBR_Util.CaseContext ctx = R4C_KTBR_Util.buildCaseContext(caseNumber);
            if (ctx == null) { System.debug('ERROR: Could not build case context.'); return; }

            List<Customer_Sales_Issue_Request_Line__c> activeLines =
                R4C_KTBR_Util.filterActiveLines(lines);
            if (activeLines.isEmpty()) { System.debug('No active lines found.'); return; }
            System.debug('Active lines: ' + activeLines.size());

            String picAttachmentName =
                'KTBR_TI_PICCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, picAttachmentName);

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            Boolean isNPRCredit = ctx.remedyType != null
                && ctx.remedyType.equalsIgnoreCase(REMEDY_NPR_CREDIT);
            Boolean isQANMRB    = ctx.returnReasonCode != null
                && ctx.returnReasonCode.equalsIgnoreCase(RETURN_REASON_QAN_MRB);

            Map<Id, BusinessRuleFlags> flagsMap =
                runRequiredFieldMatrix(activeLines, ctx);

            Map<Id, String> nprResultMap = new Map<Id, String>();
            if (isNPRCredit) {
                nprResultMap = runNPRMatrix(activeLines, ctx);
            }

            Set<Id> mrbValidLines = new Set<Id>();
            if (isQANMRB) {
                for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                    mrbValidLines.add(line.Id);
                }
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues =
                new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                BusinessRuleFlags flags   = flagsMap.get(line.Id);
                String nprResult          = nprResultMap.get(line.Id);
                Boolean mrbValid          = isQANMRB && mrbValidLines.contains(line.Id);

                String status = 'Pass';
                String reason = '';

                if (flags != null && flags.isMMRequired
                        && String.isBlank(line.Sales_Issue_Item__c)) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'MM is required but missing for this product type';
                }

                if (status != R4C_KTBR_Util.DECLINED_STATUS
                        && isNPRCredit && nprResult == 'BLOCKED') {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'NPR COD Not Eligible — no matching NPR rule';
                }

                if (status != R4C_KTBR_Util.DECLINED_STATUS
                        && isQANMRB && !mrbValid) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'MRB/QAN validation failed';
                }

                if (status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = reason;
                    linesToUpdate.add(line);
                }

                newValues.put(line.Name, buildBRNewValueMap(
                    flags, nprResult, mrbValid,
                    isNPRCredit, isQANMRB,
                    status, reason
                ));
            }

            if (!linesToUpdate.isEmpty()) {
                R4C_KTBR_Util.updateLines(linesToUpdate, CLASS_NAME);
                System.debug('Updated ' + linesToUpdate.size() + ' lines.');
            }

            List<String> csvRows = R4C_KTBR_Util.appendColumnsToCSV(
                previous, lineOrder, NEW_HEADERS, newValues
            );
            R4C_KTBR_Util.createCaseAttachment(
                caseId,
                'KTBR_TI_BusinessRulesCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug('==== ' + CLASS_NAME + ' COMPLETED SUCCESSFULLY ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
            System.debug('ERROR: ' + ex.getMessage() + '\n' + ex.getStackTraceString());
        }
    }

    private static Map<String, String> buildBRNewValueMap(
        BusinessRuleFlags flags,
        String nprResult,
        Boolean mrbValid,
        Boolean isNPRCase,
        Boolean isQANMRBCase,
        String status,
        String reason
    ) {
        String isUltReq = flags != null ? String.valueOf(flags.isUltRequired)  : 'false';
        String isCPNReq = flags != null ? String.valueOf(flags.isCPNRequired)  : 'false';
        String isMMReq  = flags != null ? String.valueOf(flags.isMMRequired)   : 'false';
        String nprCol   = isNPRCase     ? (nprResult ?? 'N/A')                 : 'N/A';
        String mrbCol   = isQANMRBCase  ? String.valueOf(mrbValid)             : 'N/A';

        return new Map<String, String>{
            'IsUltRequired'            => isUltReq,
            'IsCPNRequired'            => isCPNReq,
            'IsMMRequired'             => isMMReq,
            'NPRCheck'                 => nprCol,
            'MRBCheck'                 => mrbCol,
            'BusinessRulesStatus'      => status,
            'BusinessRulesErrorReason' => reason
        };
    }

    private static Map<Id, BusinessRuleFlags> runRequiredFieldMatrix(
        List<Customer_Sales_Issue_Request_Line__c> activeLines,
        R4C_KTBR_Util.CaseContext ctx
    ) {
        Map<Id, BusinessRuleFlags> result = new Map<Id, BusinessRuleFlags>();
        if (activeLines.isEmpty() || ctx == null) return result;

        Set<String> opIds       = new Set<String>();
        Set<String> families    = new Set<String>();
        Set<String> prodCodes   = new Set<String>();
        Set<String> profitCtrs  = new Set<String>();
        Set<String> marketNames = new Set<String>();

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            String opid      = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String family    = line.Sales_Issue_Item__r?.ICS_WR_Family_Name__c;
            String prodCode  = line.Sales_Issue_Item__r?.Item_Product_Code__c;
            String profitCtr = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            String mktName   = line.Sales_Issue_Item__r?.Item_Market_Name__c;
            if (String.isNotBlank(opid))      opIds.add(opid);
            if (String.isNotBlank(family))    families.add(family);
            if (String.isNotBlank(prodCode))  prodCodes.add(prodCode);
            if (String.isNotBlank(profitCtr)) profitCtrs.add(profitCtr);
            if (String.isNotBlank(mktName))   marketNames.add(mktName);
        }
        opIds.add(null); families.add(null); prodCodes.add(null);
        profitCtrs.add(null); marketNames.add(null);

        List<Sales_Issue_Matrix__c> matrices = [
            SELECT Id,
                   Sales_Issue_Rule_Prioritization_Number__c,
                   Sales_Issue_Operation_Business_Unit_Code__c,
                   Item_Family_Name__c,
                   Item_Product_Code__c,
                   Item_Market_Name__c,
                   Sales_Issue_Profit_Center__c,
                   Product_Unique_Id_Required_Indicator__c,
                   Sales_Issue_CPN_Support_Indicator__c,
                   Item_Required_Indicator__c
            FROM   Sales_Issue_Matrix__c
            WHERE  RecordType.DeveloperName = :RT_REQUIRED_FIELD
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
                OR Sales_Issue_Profit_Center__c IN :profitCtrs
            )
            ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST
            LIMIT 4000
        ];

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            String opid      = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String family    = line.Sales_Issue_Item__r?.ICS_WR_Family_Name__c;
            String prodCode  = line.Sales_Issue_Item__r?.Item_Product_Code__c;
            String profitCtr = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            String mktName   = line.Sales_Issue_Item__r?.Item_Market_Name__c;

            BusinessRuleFlags flags = new BusinessRuleFlags();

            for (Sales_Issue_Matrix__c m : matrices) {
                Boolean matched;
                    Boolean profitMatch = m.Sales_Issue_Profit_Center__c == null
                        || m.Sales_Issue_Profit_Center__c == profitCtr;
                    Boolean mktMatch    = m.Item_Market_Name__c == null
                        || m.Item_Market_Name__c == mktName;
                    Boolean famMatch    = m.Item_Family_Name__c == null
                        || m.Item_Family_Name__c == family;
                    matched = (profitMatch || mktMatch) && famMatch;
                if (matched) {
                    flags.isUltRequired = m.Product_Unique_Id_Required_Indicator__c == true;
                    flags.isCPNRequired = m.Sales_Issue_CPN_Support_Indicator__c    == true;
                    flags.isMMRequired  = m.Item_Required_Indicator__c              == true;
                    flags.ruleMatched   = true;
                    break;
                }
            }
            result.put(line.Id, flags);
        }
        return result;
    }

    private static Map<Id, String> runNPRMatrix(
        List<Customer_Sales_Issue_Request_Line__c> activeLines,
        R4C_KTBR_Util.CaseContext ctx
    ) {
        Map<Id, String> result = new Map<Id, String>();
        if (activeLines.isEmpty() || ctx == null) return result;

        Set<String> opIds       = new Set<String>();
        Set<String> mmIds       = new Set<String>();
        Set<String> profitCtrs  = new Set<String>();
        Set<String> marketNames = new Set<String>();

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            String opid     = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String mm       = line.Sales_Issue_Item__r?.Name;
            String profitCtr= line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            String mktName  = line.Sales_Issue_Item__r?.Item_Market_Name__c;
            if (String.isNotBlank(opid))      opIds.add(opid);
            if (String.isNotBlank(mm))        mmIds.add(mm);
            if (String.isNotBlank(profitCtr)) profitCtrs.add(profitCtr);
            if (String.isNotBlank(mktName))   marketNames.add(mktName);
        }
        opIds.add(null); mmIds.add(null); profitCtrs.add(null); marketNames.add(null);

        List<Sales_Issue_Matrix__c> nprMatrices = [
            SELECT Id,
                   Sales_Issue_Operation_Business_Unit_Code__c,
                   Item_Market_Name__c,
                   Sales_Issue_Profit_Center__c,
                   Sales_Issue_Item__c,
                   Sales_Issue_Item__r.Name
            FROM   Sales_Issue_Matrix__c
            WHERE  RecordType.DeveloperName = :RT_NPR_RULE
            AND    Sales_Issue_Active_Indicator__c = true
            AND    Sales_Issue_Valid_From__c <= TODAY
            AND    Sales_Issue_Valid_To__c   >= TODAY
            AND    Sales_Issue_Customer_Sales_Organization__c = :ctx.salesOrgId
            AND    Customer_Disti_Channel__c                  = :ctx.distiChannelId
            AND    Sales_Issue_Customer_Return_Reason__c      = :ctx.returnReasonId
            AND    (
                Sales_Issue_Operation_Business_Unit_Code__c IN :opIds
                OR Item_Market_Name__c IN :marketNames
                OR Sales_Issue_Profit_Center__c IN :profitCtrs
                OR Sales_Issue_Item__c IN :mmIds
            )
            LIMIT 4000
        ];

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            String opid     = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String mm       = line.Sales_Issue_Item__r?.Name;
            String profitCtr= line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            String mktName  = line.Sales_Issue_Item__r?.Item_Market_Name__c;

            List<Sales_Issue_Matrix__c> pass1 = new List<Sales_Issue_Matrix__c>();
            for (Sales_Issue_Matrix__c m : nprMatrices) {
                String matrixMM = m.Sales_Issue_Item__r?.Name;
                Boolean mmMatch = m.Sales_Issue_Item__c == null
                    || (String.isBlank(mm) && String.isBlank(matrixMM))
                    || mm == matrixMM;

                Boolean primaryMatch;
                    Boolean profitMatch = m.Sales_Issue_Profit_Center__c == null
                        || (String.isBlank(profitCtr)
                            && String.isBlank(m.Sales_Issue_Profit_Center__c))
                        || m.Sales_Issue_Profit_Center__c == profitCtr;
                    Boolean mktMatch    = m.Item_Market_Name__c == null
                        || (String.isBlank(mktName)
                            && String.isBlank(m.Item_Market_Name__c))
                        || m.Item_Market_Name__c == mktName;
                    primaryMatch = profitMatch || mktMatch;
                if (primaryMatch && mmMatch) pass1.add(m);
            }

            Boolean blocked;
            if (!pass1.isEmpty()) {
                blocked = false;
            } else {
                List<Sales_Issue_Matrix__c> pass2 = new List<Sales_Issue_Matrix__c>();
                for (Sales_Issue_Matrix__c m : nprMatrices) {
                    String matrixMM = m.Sales_Issue_Item__r?.Name;
                    Boolean mmMatch = m.Sales_Issue_Item__c == null
                        || (String.isBlank(mm) && String.isBlank(matrixMM))
                        || mm == matrixMM;

                    Boolean noOrgFilter;
                        noOrgFilter = String.isBlank(m.Item_Market_Name__c)
                            || String.isBlank(m.Sales_Issue_Profit_Center__c);
                    if (noOrgFilter && mmMatch) pass2.add(m);
                }
                blocked = pass2.isEmpty();
            }

            result.put(line.Id, blocked ? 'BLOCKED' : 'PASS');
        }
        return result;
    }

    public class BusinessRuleFlags {
        public Boolean isUltRequired = false;
        public Boolean isCPNRequired = false;
        public Boolean isMMRequired  = false;
        public Boolean ruleMatched   = false;
    }
}
