
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

