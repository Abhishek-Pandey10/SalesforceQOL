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

