/***************************************************************************
 * Class Name  : R4C_KTBR_SR_BusinessRulesCheck
 * Description : KTBR - Business Rules Check (Stock Rotation).
 *               Reads the CSV produced by R4C_KTBR_SR_AllowanceValidation
 *               and runs the CPN Indicator Check on all active lines.
 *
 *               Unlike Technical Intake, Stock Rotation has no NPR/MRB or
 *               Required-Field-Matrix equivalent: SR's Remedy Type is
 *               always "Credit" (never "NPR-Credit") and its Return Reasons
 *               are never QAN_MRB_PRT, so R4C_KTBR_TI_BusinessRulesCheck's
 *               matrix-driven checks would never fire if reused as-is —
 *               confirmed by grepping every RecordType.DeveloperName branch
 *               R4C_BusinessRule_Service.cls supports against every
 *               getMatrixRecord/getRule call site reachable from the SR
 *               front end (r4c_AG_StockRotationHelper.js,
 *               R4c_AG_LineItemsResultTable.js): the only Sales_Issue_
 *               Matrix__c record type SR queries at the line-item level is
 *               Sales_Issue_NCNR_Matrix, already handled in
 *               R4C_KTBR_SR_ProductValidation (it runs inside the same
 *               getLOEDatesHandler flow as the product status gate on the
 *               front end, so it's grouped with Product Validation here
 *               too, not duplicated in this class).
 *
 *               The CPN Indicator Check (cpncheckindicator(),
 *               R4c_AG_LineItemsResultTable.js) is the one per-line
 *               "required field" rule SR actually has: when the Sold To
 *               CMF's Customer_CPN_Support__c flag is true, every active
 *               line must carry a Customer Part Number.
 *
 * USAGE:
 *   R4C_KTBR_SR_BusinessRulesCheck.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 18/07/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_SR_BusinessRulesCheck {

    private static final String CLASS_NAME    = 'R4C_KTBR_SR_BusinessRulesCheck';
    private static final String CPN_MISSING_MSG =
        'Customer Part Number is required for this Sold To but is missing on the line.';

    private static final List<String> NEW_HEADERS = new List<String>{
        'CPNSupportRequired', 'BusinessRulesStatus', 'BusinessRulesErrorReason'
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

            String allowanceAttachmentName =
                'KTBR_SR_AllowanceValidation_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, allowanceAttachmentName);

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            Boolean cpnSupportRequired = isCPNSupportRequired(ctx);

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues = new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                String status = 'Pass';
                String reason = '';

                if (cpnSupportRequired && String.isBlank(line.Sales_Issue_Customer_Part_Number__c)) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = CPN_MISSING_MSG;
                }

                if (status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = reason;
                    linesToUpdate.add(line);
                }

                newValues.put(line.Name, new Map<String, String>{
                    'CPNSupportRequired'        => String.valueOf(cpnSupportRequired),
                    'BusinessRulesStatus'       => status,
                    'BusinessRulesErrorReason'  => reason
                });
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
                'KTBR_SR_BusinessRulesCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug('==== ' + CLASS_NAME + ' COMPLETED SUCCESSFULLY ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
            System.debug('ERROR: ' + ex.getMessage() + '\n' + ex.getStackTraceString());
        }
    }

    private static Boolean isCPNSupportRequired(R4C_KTBR_Util.CaseContext ctx) {
        try {
            List<Customer_Sales_Issue_Request__c> headers = [
                SELECT Sales_Issue_SoldTo_Customer__r.Customer_CPN_Support__c
                FROM   Customer_Sales_Issue_Request__c
                WHERE  Id = :ctx.headerId
                LIMIT 1
            ];
            return !headers.isEmpty()
                && headers[0].Sales_Issue_SoldTo_Customer__r?.Customer_CPN_Support__c == true;
        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'isCPNSupportRequired', ex);
            return false;
        }
    }
}
