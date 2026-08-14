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
