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

