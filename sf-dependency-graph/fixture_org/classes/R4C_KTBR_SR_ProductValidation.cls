/***************************************************************************
 * Class Name  : R4C_KTBR_SR_ProductValidation
 * Description : KTBR - Product Validation (Stock Rotation).
 *               Reads the CSV produced by R4C_KTBR_SR_POHistoryCheck, runs
 *               three validations in sequence on all active lines, appends
 *               result columns:
 *                 1) Disti Channel Product Status gate (letter code for
 *                    non-IAO orgs / numeric code for IAO orgs), including the
 *                    End-of-Life (EN / numeric "45") LOE+PCN date math and
 *                    the Spec Code / Custom-To-Order / HPC hard stops.
 *                 2) NCNR Matrix check (Sales_Issue_Matrix__c, RecordType
 *                    'Sales_Issue_NCNR_Matrix' — same matrix + matching
 *                    logic already used by R4C_BusinessRule_Service.getNCNRMatrix).
 *                 3) Stock Rotation Allowance record existence lookup — the
 *                    matched record's amounts are carried on the CSV for
 *                    R4C_KTBR_SR_AllowanceValidation to do the sufficiency
 *                    math against, mirroring how the front end resolves the
 *                    allowance record once here and reuses it later.
 *
 * REVIEW (SR port — Stock Rotation Allowance Matrix schema): the exact
 * object/field API names behind the "Stock Rotation Allowance Matrix" list
 * view referenced in StockRotationWiki.html are not present in any file
 * available at authoring time. Following the established convention in this
 * org — every other "X Matrix" (Required Field, NPR Rule, NCNR, Return
 * Location, Approval, MRB, ...) is a RecordType on the single
 * Sales_Issue_Matrix__c object, not a separate object — this class assumes
 * Stock Rotation Allowance is likewise a RecordType on Sales_Issue_Matrix__c
 * ('Sales_Issue_Stock_Rotation_Allowance_Matrix'), reusing the same filter
 * fields already confirmed on that object for Required Field Matrix
 * (Sales_Issue_Customer_Sales_Organization__c, Customer_Disti_Channel__c,
 * Sales_Issue_Customer_Return_Reason__c, Sales_Issue_Active_Indicator__c,
 * Sales_Issue_Valid_From__c/Sales_Issue_Valid_To__c) plus the 3 field names
 * confirmed directly from r4c_AG_StockRotationHelper.js (Sales_Issue_Stock_
 * Rotation_Allowance_Amt__c, Sales_Issue_SR_Open_Prd_Allowance_Amt__c,
 * Sales_Issue_Stock_Rotation_Category__c). The MM-level match field (MM__c)
 * is a best-effort guess — confirm against the org schema and correct if
 * needed. The Sold-To match tier mentioned in the wiki has no identifiable
 * field on this object and is not applied here.
 *
 * USAGE:
 *   R4C_KTBR_SR_ProductValidation.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 18/07/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_SR_ProductValidation {

    private static final String CLASS_NAME = 'R4C_KTBR_SR_ProductValidation';

    private static final String RT_NCNR_MATRIX      = 'Sales_Issue_NCNR_Matrix';
    private static final String RT_SR_ALLOWANCE     = 'Sales_Issue_Stock_Rotation_Allowance_Matrix';

    private static final String STATUS_PRE_ACTIVE       = '15';
    private static final String STATUS_NOT_IMPLEMENTED  = '05';
    private static final String STATUS_EOL_LETTER       = 'EN';
    private static final String STATUS_EOL_NUMERIC       = '45';
    private static final Set<String> STATUS_PASSTHROUGH_LETTER = new Set<String>{ 'AC', 'RS' };
    private static final String STATUS_PASSTHROUGH_NUMERIC     = '35';
    private static final Integer EOL_MIN_GAP_DAYS        = 120;
    private static final Integer LAST_RETURN_GRACE_DAYS  = 30;

    // REVIEW (SR port): exact API name of the object behind Sales_Issue_Item__r is not
    // resolvable from the available files (JS refers to it only via the local variable name
    // "objMMIDBUHierarchy"). This is only needed for the Disti_Channel_Product_Statuses__r
    // child subquery, which SOQL requires be issued directly against its parent object.
    private static final String PRODUCT_OBJECT_API_NAME = 'ICS_WR_MM_ID_BU_Hierarchy__c';

    private static final List<String> NEW_HEADERS = new List<String>{
        'ProductStatusCode', 'ProductStatusDescription', 'PCNDate', 'IsNCNR',
        'AllowanceMatrixId', 'AllowanceCategory',
        'StockRotationAllowanceAmt', 'SROpenPrdAllowanceAmt',
        'ProductValidationStatus', 'ProductValidationErrorReason'
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

            String poAttachmentName =
                'KTBR_SR_POHistoryCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, poAttachmentName);

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            Boolean isIAO = Boolean.valueOf(R4C_KTBR_Util.IS_IAO_FLAG);

            Map<Id, ItemInfo> itemInfoByLineId = buildItemInfoMap(activeLines, isIAO);
            Map<Id, Boolean>  ncnrFlagByLineId = runNCNRMatrix(activeLines, itemInfoByLineId);
            Map<Id, AllowanceMatch> allowanceByLineId =
                runAllowanceMatrixLookup(activeLines, ctx, isIAO);

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues = new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                ItemInfo item = itemInfoByLineId.get(line.Id);
                ProductStatusResult psResult = evaluateProductStatus(item, isIAO);

                String status = 'Pass';
                String reason = '';
                Boolean isNcnr = ncnrFlagByLineId.get(line.Id) == true;
                AllowanceMatch allowance = allowanceByLineId.get(line.Id);

                if (psResult.hardStop) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = psResult.error;
                } else if (isNcnr) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'Record is NCNR';
                } else if (allowance == null) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'No Stock Rotation allowance record found for MM: '
                        + line.Sales_Issue_Item__r?.Name;
                } else if (allowance.stockRotationAllowanceAmt == null
                        || allowance.stockRotationAllowanceAmt <= 0) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'Stock Rotation allowance amount not available for MM: '
                        + line.Sales_Issue_Item__r?.Name;
                }

                if (status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = reason;
                    linesToUpdate.add(line);
                }

                newValues.put(line.Name, buildNewValueMap(item, psResult, isNcnr, allowance, status, reason));
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
                'KTBR_SR_ProductValidation_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug('==== ' + CLASS_NAME + ' COMPLETED SUCCESSFULLY ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
            System.debug('ERROR: ' + ex.getMessage() + '\n' + ex.getStackTraceString());
        }
    }

    private static Map<String, String> buildNewValueMap(
        ItemInfo item,
        ProductStatusResult psResult,
        Boolean isNcnr,
        AllowanceMatch allowance,
        String status,
        String reason
    ) {
        return new Map<String, String>{
            'ProductStatusCode'         => item?.statusCodeForDisplay ?? '',
            'ProductStatusDescription'  => item?.statusDescription   ?? '',
            'PCNDate'                   => psResult.pcnDate != null ? String.valueOf(psResult.pcnDate) : '',
            'IsNCNR'                    => String.valueOf(isNcnr),
            'AllowanceMatrixId'         => allowance != null ? String.valueOf(allowance.matrixId) : '',
            'AllowanceCategory'         => allowance?.categoryName ?? '',
            'StockRotationAllowanceAmt' => allowance?.stockRotationAllowanceAmt != null
                ? String.valueOf(allowance.stockRotationAllowanceAmt) : '0',
            'SROpenPrdAllowanceAmt'     => allowance?.srOpenPrdAllowanceAmt != null
                ? String.valueOf(allowance.srOpenPrdAllowanceAmt) : '0',
            'ProductValidationStatus'      => status,
            'ProductValidationErrorReason' => reason
        };
    }

    // ---------------------------------------------------------------------
    // 1) Disti Channel Product Status gate + EOL date math + Spec Type gate
    // ---------------------------------------------------------------------

    private static ProductStatusResult evaluateProductStatus(ItemInfo item, Boolean isIAO) {
        ProductStatusResult r = new ProductStatusResult();
        if (item == null) {
            r.hardStop = true;
            r.error    = 'No valid product status were found';
            return r;
        }

        String code = isIAO ? item.statusCodeNumeric : item.statusCodeLetter;

        if (String.isBlank(code)) {
            r.hardStop = true;
            r.error    = 'No valid product status were found';
            return r;
        }
        if (code == STATUS_PRE_ACTIVE) {
            r.hardStop = true;
            r.error    = 'Current status is 15 (Pre-Active)';
            return r;
        }
        if (code == STATUS_NOT_IMPLEMENTED) {
            r.hardStop = true;
            r.error    = 'Current status is 05 (Not Implemented)';
            return r;
        }

        Boolean isEOL = isIAO ? (code == STATUS_EOL_NUMERIC) : (code == STATUS_EOL_LETTER);
        if (isEOL) {
            return evaluateEndOfLife(item, isIAO, r);
        }

        Boolean isPassthrough = isIAO
            ? (code == STATUS_PASSTHROUGH_NUMERIC)
            : STATUS_PASSTHROUGH_LETTER.contains(code);
        if (isPassthrough) {
            return evaluateSpecType(item, isIAO, r);
        }

        Boolean isAllowed = isIAO
            ? isCodeAllowed(code, Label.Agent_Allowed_Product_Status_IAO)
            : isCodeAllowed(code, Label.Agent_Allowed_Product_Status);

        if (!isAllowed) {
            r.hardStop = true;
            r.error    = 'Current status is ' + code;
            return r;
        }
        return evaluateSpecType(item, isIAO, r);
    }

    private static Boolean isCodeAllowed(String code, String labelValue) {
        if (String.isBlank(labelValue)) return false;
        for (String allowed : labelValue.split(';')) {
            if (allowed.trim() == code) return true;
        }
        return false;
    }

    private static ProductStatusResult evaluateEndOfLife(ItemInfo item, Boolean isIAO, ProductStatusResult r) {
        if (item.lastOrderEntryDate == null || item.pcnDate == null) {
            r.hardStop = true;
            r.error    = Label.LOE_and_PCN_not_available_Message;
            return r;
        }

        Date loe = item.lastOrderEntryDate;
        Date pcn = item.pcnDate;
        loe = (loe >= pcn.addDays(EOL_MIN_GAP_DAYS)) ? pcn : pcn.addDays(EOL_MIN_GAP_DAYS);

        Date lastReturn = item.lastReturnDate;
        if (lastReturn == null) {
            lastReturn = loe.addDays(LAST_RETURN_GRACE_DAYS);
        }
        if (lastReturn < Date.today()) {
            r.hardStop = true;
            r.error    = Label.Past_Return_Date;
            return r;
        }
        r.pcnDate = lastReturn;
        return evaluateSpecType(item, isIAO, r);
    }

    private static ProductStatusResult evaluateSpecType(ItemInfo item, Boolean isIAO, ProductStatusResult r) {
        if (item.specCode == Label.Spec_Code_Message) {
            r.hardStop = true;
            r.error    = Label.Spec_Type_Q_message;
            r.pcnDate  = null;
            return r;
        }
        if (item.custProductToOrder == Label.Cust_Product_To_Order_msg) {
            r.hardStop = true;
            r.error    = appendReason(r.error, Label.CTO);
            return r;
        }
        if (!isIAO) {
            Boolean familyBlocked = String.isNotBlank(item.familyName)
                && String.isNotBlank(Label.ICS_WR_Family_Name_Msg)
                && item.familyName.startsWith(Label.ICS_WR_Family_Name_Msg);
            Boolean sbsBlocked = String.isNotBlank(item.sbsName)
                && (item.sbsName == Label.WR_SBS_Name_Equals_CTO
                    || item.sbsName == Label.WR_SBS_Name_Equals_CLOUDBLOCK);
            if (familyBlocked || sbsBlocked) {
                r.hardStop = true;
                r.error    = appendReason(r.error, Label.HPC);
                return r;
            }
        }
        r.hardStop = false;
        if (r.pcnDate == null) r.pcnDate = item.lastReturnDate;
        return r;
    }

    private static String appendReason(String existing, String addition) {
        if (String.isBlank(addition)) return existing;
        return String.isBlank(existing) ? addition : (existing + '; ' + addition);
    }

    // ---------------------------------------------------------------------
    // 2) NCNR Matrix check
    // ---------------------------------------------------------------------

    private static Map<Id, Boolean> runNCNRMatrix(
        List<Customer_Sales_Issue_Request_Line__c> activeLines,
        Map<Id, ItemInfo> itemInfoByLineId
    ) {
        Map<Id, Boolean> result = new Map<Id, Boolean>();
        if (Label.NCNR_Check != 'true' || activeLines.isEmpty()) return result;

        Set<String> statusCodes  = new Set<String>();
        Set<String> customIndics = new Set<String>();
        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            ItemInfo item = itemInfoByLineId.get(line.Id);
            if (item == null) continue;
            if (String.isNotBlank(item.statusCodeNumeric)) statusCodes.add(item.statusCodeNumeric);
            if (String.isNotBlank(item.customIndicator))   customIndics.add(item.customIndicator);
        }
        if (statusCodes.isEmpty() && customIndics.isEmpty()) return result;
        customIndics.add(null);

        List<Sales_Issue_Matrix__c> ncnrMatrices = [
            SELECT Id, Product_Status_Code__c, Item_Custom_Indicator__c, NCNR_Flag__c
            FROM   Sales_Issue_Matrix__c
            WHERE  RecordType.DeveloperName = :RT_NCNR_MATRIX
            AND    (Product_Status_Code__c IN :statusCodes
                    OR Item_Custom_Indicator__c IN :customIndics
                    OR Item_Custom_Indicator__c = null)
            AND    Order_Confirmation_Flag__c = true
            AND    NCNR_Flag__c = true
            LIMIT 4000
        ];
        if (ncnrMatrices.isEmpty()) return result;

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            ItemInfo item = itemInfoByLineId.get(line.Id);
            if (item == null) continue;
            for (Sales_Issue_Matrix__c m : ncnrMatrices) {
                Boolean matched =
                    (item.statusCodeNumeric == m.Product_Status_Code__c
                        && m.Item_Custom_Indicator__c == item.customIndicator)
                    || (item.statusCodeNumeric == m.Product_Status_Code__c
                        && m.Item_Custom_Indicator__c == null)
                    || (m.Product_Status_Code__c == null
                        && m.Item_Custom_Indicator__c == item.customIndicator);
                if (matched) {
                    result.put(line.Id, true);
                    break;
                }
            }
        }
        return result;
    }

    // ---------------------------------------------------------------------
    // 3) Stock Rotation Allowance record existence lookup
    // ---------------------------------------------------------------------

    private static Map<Id, AllowanceMatch> runAllowanceMatrixLookup(
        List<Customer_Sales_Issue_Request_Line__c> activeLines,
        R4C_KTBR_Util.CaseContext ctx,
        Boolean isIAO
    ) {
        Map<Id, AllowanceMatch> result = new Map<Id, AllowanceMatch>();
        if (activeLines.isEmpty() || ctx == null) return result;

        Set<String> mmSet          = new Set<String>();
        Set<String> opIds          = new Set<String>();
        Set<String> profitCenters  = new Set<String>();
        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            String mm = line.Sales_Issue_Item__r?.Name;
            String opid = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String profitCtr = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;
            if (String.isNotBlank(mm))        mmSet.add(mm);
            if (String.isNotBlank(opid))       opIds.add(opid);
            if (String.isNotBlank(profitCtr))  profitCenters.add(profitCtr);
        }
        mmSet.add(null); opIds.add(null); profitCenters.add(null);

        List<Sales_Issue_Matrix__c> matrices = [
            SELECT Id, MM__c,
                   Sales_Issue_Operation_Business_Unit_Code__c,
                   Sales_Issue_Profit_Center__c,
                   Sales_Issue_Stock_Rotation_Category__c,
                   Sales_Issue_Stock_Rotation_Category__r.Name,
                   Sales_Issue_Stock_Rotation_Allowance_Amt__c,
                   Sales_Issue_SR_Open_Prd_Allowance_Amt__c
            FROM   Sales_Issue_Matrix__c
            WHERE  RecordType.DeveloperName = :RT_SR_ALLOWANCE
            AND    Sales_Issue_Active_Indicator__c = true
            AND    Sales_Issue_Valid_From__c <= TODAY
            AND    Sales_Issue_Valid_To__c   >= TODAY
            AND    Sales_Issue_Customer_Sales_Organization__c = :ctx.salesOrgId
            AND    Customer_Disti_Channel__c             = :ctx.distiChannelId
            AND    Sales_Issue_Customer_Return_Reason__c = :ctx.returnReasonId
            AND    (Sales_Issue_Stock_Rotation_Allowance_Amt__c > 0
                    OR Sales_Issue_SR_Open_Prd_Allowance_Amt__c > 0)
            AND    (
                MM__c IN :mmSet
                OR Sales_Issue_Operation_Business_Unit_Code__c IN :opIds
                OR Sales_Issue_Profit_Center__c IN :profitCenters
            )
            LIMIT 4000
        ];
        if (matrices.isEmpty()) return result;

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            String mm        = line.Sales_Issue_Item__r?.Name;
            String opid      = line.Sales_Issue_Item__r?.ICS_WR_Operation_Business_Unit_Code__c;
            String profitCtr = line.Sales_Issue_Item__r?.ICS_WR_Profit_Center_Code__c;

            Sales_Issue_Matrix__c matched;
            for (Sales_Issue_Matrix__c m : matrices) {
                if (String.isNotBlank(mm) && m.MM__c == mm) { matched = m; break; }
            }
            if (matched == null) {
                for (Sales_Issue_Matrix__c m : matrices) {
                    if (String.isNotBlank(m.MM__c)) continue;
                    Boolean opMatch     = isIAO ? false : (String.isNotBlank(opid) && m.Sales_Issue_Operation_Business_Unit_Code__c == opid);
                    Boolean profitMatch = isIAO ? (String.isNotBlank(profitCtr) && m.Sales_Issue_Profit_Center__c == profitCtr) : false;
                    if (opMatch || profitMatch) { matched = m; break; }
                }
            }
            if (matched == null) continue;

            AllowanceMatch am = new AllowanceMatch();
            am.matrixId                    = matched.Id;
            am.categoryName                = matched.Sales_Issue_Stock_Rotation_Category__r?.Name;
            am.stockRotationAllowanceAmt   = matched.Sales_Issue_Stock_Rotation_Allowance_Amt__c;
            am.srOpenPrdAllowanceAmt       = matched.Sales_Issue_SR_Open_Prd_Allowance_Amt__c;
            result.put(line.Id, am);
        }
        return result;
    }

    // ---------------------------------------------------------------------
    // Item master data lookup (Disti Channel Product Status + EOL/spec fields)
    // ---------------------------------------------------------------------

    private static Map<Id, ItemInfo> buildItemInfoMap(
        List<Customer_Sales_Issue_Request_Line__c> activeLines,
        Boolean isIAO
    ) {
        Map<Id, ItemInfo> result = new Map<Id, ItemInfo>();
        if (activeLines.isEmpty()) return result;

        Set<Id> lineIds = new Set<Id>();
        Set<Id> itemIds = new Set<Id>();
        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            lineIds.add(line.Id);
            if (line.Sales_Issue_Item__c != null) itemIds.add(line.Sales_Issue_Item__c);
        }

        Map<Id, Customer_Sales_Issue_Request_Line__c> extraFields =
            new Map<Id, Customer_Sales_Issue_Request_Line__c>([
                SELECT Id,
                       Sales_Issue_Item__r.Item_Spec_Code__c,
                       Sales_Issue_Item__r.Item_Cust_Product_To_Order__c,
                       Sales_Issue_Item__r.ICS_WR_SBS_Name__c,
                       Sales_Issue_Item__r.Item_Last_Order_Entry_Date__c,
                       Sales_Issue_Item__r.Item_PCN_date__c,
                       Sales_Issue_Item__r.Item_Last_Return_Dates__c,
                       Sales_Issue_Item__r.Item_Custom_Indicator__c
                FROM   Customer_Sales_Issue_Request_Line__c
                WHERE  Id IN :lineIds
            ]);

        Map<Id, SObject> statusByItemId = new Map<Id, SObject>();
        if (!itemIds.isEmpty()) {
            try {
                String q = 'SELECT Id, ' +
                    '(SELECT Sales_Issue_Disti_Channel_prd_Status_Cd__c, ' +
                    'Sales_Issue_Channel_StatusCode_Numeric__c, ' +
                    'Disti_Channel_Product_Status_Description__c ' +
                    'FROM Disti_Channel_Product_Statuses__r ' +
                    'ORDER BY CreatedDate DESC LIMIT 1) ' +
                    'FROM ' + PRODUCT_OBJECT_API_NAME + ' WHERE Id IN :itemIds';
                for (SObject rec : Database.query(q)) {
                    statusByItemId.put(rec.Id, rec);
                }
            } catch (Exception ex) {
                R4C_KTBR_Util.logError(CLASS_NAME, 'buildItemInfoMap.statusQuery', ex);
            }
        }

        for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
            Customer_Sales_Issue_Request_Line__c extra = extraFields.get(line.Id);
            ItemInfo info = new ItemInfo();
            info.familyName          = line.Sales_Issue_Item__r?.ICS_WR_Family_Name__c;
            info.specCode            = extra?.Sales_Issue_Item__r?.Item_Spec_Code__c;
            info.custProductToOrder  = extra?.Sales_Issue_Item__r?.Item_Cust_Product_To_Order__c;
            info.sbsName             = extra?.Sales_Issue_Item__r?.ICS_WR_SBS_Name__c;
            info.lastOrderEntryDate  = extra?.Sales_Issue_Item__r?.Item_Last_Order_Entry_Date__c;
            info.pcnDate             = extra?.Sales_Issue_Item__r?.Item_PCN_date__c;
            info.lastReturnDate      = extra?.Sales_Issue_Item__r?.Item_Last_Return_Dates__c;
            info.customIndicator     = extra?.Sales_Issue_Item__r?.Item_Custom_Indicator__c;

            if (line.Sales_Issue_Item__c != null && statusByItemId.containsKey(line.Sales_Issue_Item__c)) {
                SObject statusRec = statusByItemId.get(line.Sales_Issue_Item__c);
                List<SObject> children = statusRec.getSObjects('Disti_Channel_Product_Statuses__r');
                if (children != null && !children.isEmpty()) {
                    SObject s = children[0];
                    info.statusCodeLetter  = (String) s.get('Sales_Issue_Disti_Channel_prd_Status_Cd__c');
                    info.statusCodeNumeric = (String) s.get('Sales_Issue_Channel_StatusCode_Numeric__c');
                    info.statusDescription = (String) s.get('Disti_Channel_Product_Status_Description__c');
                }
            }
            info.statusCodeForDisplay = isIAO ? info.statusCodeNumeric : info.statusCodeLetter;

            result.put(line.Id, info);
        }
        return result;
    }

    private class ItemInfo {
        public String familyName;
        public String sbsName;
        public String specCode;
        public String custProductToOrder;
        public String customIndicator;
        public Date   lastOrderEntryDate;
        public Date   pcnDate;
        public Date   lastReturnDate;
        public String statusCodeLetter;
        public String statusCodeNumeric;
        public String statusDescription;
        public String statusCodeForDisplay;
    }

    private class ProductStatusResult {
        public Boolean hardStop = false;
        public String  error    = '';
        public Date    pcnDate;
    }

    private class AllowanceMatch {
        public Id      matrixId;
        public String  categoryName;
        public Decimal stockRotationAllowanceAmt;
        public Decimal srOpenPrdAllowanceAmt;
    }
}
