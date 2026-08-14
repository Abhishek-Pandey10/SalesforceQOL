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
