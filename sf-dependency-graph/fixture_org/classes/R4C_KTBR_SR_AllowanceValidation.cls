/***************************************************************************
 * Class Name  : R4C_KTBR_SR_AllowanceValidation
 * Description : KTBR - Allowance Validation (Stock Rotation). No Technical
 *               Intake equivalent — this is SR-specific.
 *
 *               Reads the CSV produced by R4C_KTBR_SR_PICCheck (which, via
 *               the appendColumnsToCSV chain, still carries the
 *               AllowanceMatrixId / StockRotationAllowanceAmt /
 *               SROpenPrdAllowanceAmt columns R4C_KTBR_SR_ProductValidation
 *               attached, plus PICCurrentPrice from the PIC step).
 *
 *               Ports the "Validate Allowance" sufficiency check from
 *               r4c_AG_StockRotationHelper.js (calculateAmmount): for every
 *               active line, the per-line credit value (Return Quantity x
 *               PIC Current Price) is pooled by matched allowance-matrix
 *               record Id, separately per box condition (Box Closed -
 *               Factory Sealed uses Sales_Issue_Stock_Rotation_Allowance_Amt__c
 *               as the ceiling; Outer Box Opened - Product Unsealed uses
 *               Sales_Issue_SR_Open_Prd_Allowance_Amt__c). A line fails when
 *               its bucket's combined pooled value is >= the ceiling — the
 *               JS's comparison is strictly "<=" fails (a tie is a fail),
 *               confirmed at r4c_AG_StockRotationHelper.js:1290/1304.
 *               Allowance amounts are NOT deducted/consumed here — per
 *               StockRotationWiki.html ("Stock Rotation Allowance
 *               Validation"), consumption only happens once the case
 *               reaches RMA Authorized / Pending Approval, which is a
 *               separate downstream process outside this pipeline.
 *
 * REVIEW (SR port — Return Quantity / Box Condition fields): no Apex/SOQL
 * reference to these fields' API names was found anywhere in the available
 * files (only the local JS variable names item.returnQuantity/
 * item.boxCondition). Sales_Issue_Return_Quantity__c and
 * Sales_Issue_Box_Condition__c are best-effort guesses — confirm against
 * the org schema and correct if needed. Box condition values are compared
 * against the same admin-configurable Custom Labels the JS uses
 * (Box_Closed_Factory_Sealed / Outer_Box_Open_Product_Unsealed) rather than
 * hardcoded literals.
 *
 * USAGE:
 *   R4C_KTBR_SR_AllowanceValidation.run('06596326', 5000, 5100);
 *
 * Created By  : Abhishek Pandey
 * Created Date: 18/07/2026
 ***************************************************************************/
public without sharing class R4C_KTBR_SR_AllowanceValidation {

    private static final String CLASS_NAME = 'R4C_KTBR_SR_AllowanceValidation';
    private static final String ALLOWANCE_TOO_HIGH_MSG =
        'Return quantity exceeds the available Stock Rotation allowance for this product.';
    private static final String QTY_INVALID_MSG =
        'Return quantity must be at least 1.';

    private static final List<String> NEW_HEADERS = new List<String>{
        'BoxCondition', 'ReturnQuantity', 'LineCreditValue', 'AllowanceCombinedTotal',
        'AllowanceValidationStatus', 'AllowanceValidationErrorReason'
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

            List<Customer_Sales_Issue_Request_Line__c> activeLines =
                R4C_KTBR_Util.filterActiveLines(lines);
            if (activeLines.isEmpty()) { System.debug('No active lines found.'); return; }

            String picAttachmentName =
                'KTBR_SR_PICCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, picAttachmentName);
            if (previous.isEmpty()) {
                System.debug('No prior pipeline data found. Ensure earlier SR KTBR steps ran first.');
                return;
            }

            List<String> lineOrder = new List<String>();
            for (Customer_Sales_Issue_Request_Line__c line : lines) {
                lineOrder.add(line.Name);
            }

            String closedBoxLabel = Label.Box_Closed_Factory_Sealed;
            String openBoxLabel   = Label.Outer_Box_Open_Product_Unsealed;

            Map<Id, Customer_Sales_Issue_Request_Line__c> boxAndQtyByLineId =
                new Map<Id, Customer_Sales_Issue_Request_Line__c>([
                    SELECT Id, Sales_Issue_Box_Condition__c, Sales_Issue_Return_Quantity__c
                    FROM   Customer_Sales_Issue_Request_Line__c
                    WHERE  Id IN :activeLines
                ]);

            Map<Id, LineAllowanceData> dataByLineId = new Map<Id, LineAllowanceData>();
            Map<String, Decimal> closedTotalsByMatrixId = new Map<String, Decimal>();
            Map<String, Decimal> openTotalsByMatrixId   = new Map<String, Decimal>();
            Map<String, Decimal> ceilingByMatrixId      = new Map<String, Decimal>();
            Map<String, Decimal> openCeilingByMatrixId  = new Map<String, Decimal>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                Map<String, String> row = previous.rows.get(line.Name);
                if (row == null) continue;

                LineAllowanceData data = new LineAllowanceData();
                data.matrixId       = row.get('AllowanceMatrixId');
                data.stockAllowance = parseDecimal(row.get('StockRotationAllowanceAmt'));
                data.openAllowance  = parseDecimal(row.get('SROpenPrdAllowanceAmt'));
                data.picPrice       = parseDecimal(row.get('PICCurrentPrice'));
                Customer_Sales_Issue_Request_Line__c boxAndQty = boxAndQtyByLineId.get(line.Id);
                data.boxCondition   = boxAndQty?.Sales_Issue_Box_Condition__c;
                data.returnQty      = boxAndQty?.Sales_Issue_Return_Quantity__c;
                data.creditValue    = (data.returnQty ?? 0) * (data.picPrice ?? 0);
                dataByLineId.put(line.Id, data);

                if (String.isBlank(data.matrixId)) continue;

                if (data.boxCondition == closedBoxLabel) {
                    closedTotalsByMatrixId.put(data.matrixId,
                        (closedTotalsByMatrixId.get(data.matrixId) ?? 0) + data.creditValue);
                    ceilingByMatrixId.put(data.matrixId, data.stockAllowance);
                } else if (data.boxCondition == openBoxLabel) {
                    openTotalsByMatrixId.put(data.matrixId,
                        (openTotalsByMatrixId.get(data.matrixId) ?? 0) + data.creditValue);
                    openCeilingByMatrixId.put(data.matrixId, data.openAllowance);
                }
            }

            List<Customer_Sales_Issue_Request_Line__c> linesToUpdate =
                new List<Customer_Sales_Issue_Request_Line__c>();
            Map<String, Map<String, String>> newValues = new Map<String, Map<String, String>>();

            for (Customer_Sales_Issue_Request_Line__c line : activeLines) {
                LineAllowanceData data = dataByLineId.get(line.Id);
                String status = 'Pass';
                String reason = '';
                Decimal combinedTotal = 0;

                if (data == null) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'No pipeline data found for line.';
                } else if (data.returnQty == null || data.returnQty < 1) {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = QTY_INVALID_MSG;
                } else if (data.boxCondition == closedBoxLabel) {
                    combinedTotal = closedTotalsByMatrixId.get(data.matrixId) ?? data.creditValue;
                    Decimal ceiling = ceilingByMatrixId.get(data.matrixId) ?? data.stockAllowance ?? 0;
                    if (ceiling <= combinedTotal) {
                        status = R4C_KTBR_Util.DECLINED_STATUS;
                        reason = ALLOWANCE_TOO_HIGH_MSG;
                    }
                } else if (data.boxCondition == openBoxLabel) {
                    combinedTotal = openTotalsByMatrixId.get(data.matrixId) ?? data.creditValue;
                    Decimal ceiling = openCeilingByMatrixId.get(data.matrixId) ?? data.openAllowance ?? 0;
                    if (ceiling <= combinedTotal) {
                        status = R4C_KTBR_Util.DECLINED_STATUS;
                        reason = ALLOWANCE_TOO_HIGH_MSG;
                    }
                } else {
                    status = R4C_KTBR_Util.DECLINED_STATUS;
                    reason = 'Box condition not set for this line.';
                }

                if (status == R4C_KTBR_Util.DECLINED_STATUS) {
                    line.Sales_Issue_Line_Item_Status__c = R4C_KTBR_Util.DECLINED_STATUS;
                    line.Line_item_error_messages__c     = reason;
                    linesToUpdate.add(line);
                }

                newValues.put(line.Name, new Map<String, String>{
                    'BoxCondition'               => data?.boxCondition ?? '',
                    'ReturnQuantity'             => data?.returnQty != null ? String.valueOf(data.returnQty) : '',
                    'LineCreditValue'            => data != null ? String.valueOf(data.creditValue) : '0',
                    'AllowanceCombinedTotal'     => String.valueOf(combinedTotal),
                    'AllowanceValidationStatus'      => status,
                    'AllowanceValidationErrorReason' => reason
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
                'KTBR_SR_AllowanceValidation_' + caseNumber + '_' + lineStart + '_' + lineEnd,
                csvRows
            );

            System.debug('==== ' + CLASS_NAME + ' COMPLETED SUCCESSFULLY ====');

        } catch (Exception ex) {
            R4C_KTBR_Util.logError(CLASS_NAME, 'run', ex);
            System.debug('ERROR: ' + ex.getMessage() + '\n' + ex.getStackTraceString());
        }
    }

    private static Decimal parseDecimal(String val) {
        if (String.isBlank(val)) return 0;
        try {
            return Decimal.valueOf(val.trim());
        } catch (Exception ex) {
            return 0;
        }
    }

    private class LineAllowanceData {
        public String  matrixId;
        public Decimal stockAllowance;
        public Decimal openAllowance;
        public Decimal picPrice;
        public String  boxCondition;
        public Decimal returnQty;
        public Decimal creditValue;
    }
}
