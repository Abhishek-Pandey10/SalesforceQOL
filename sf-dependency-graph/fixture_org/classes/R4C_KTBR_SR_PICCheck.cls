/*******************************************************************************
* Class Name   : R4C_KTBR_SR_PICCheck
* Description  : KTBR Stock Rotation Credit Price Validation.
*                Reads the CSV produced by R4C_KTBR_SR_ProductValidation,
*                fetches credit price for each active line's MM from the
*                same PIC API used by Technical Intake, appends columns, and
*                writes a new CSV.
*
*                Field split (Sales_Issue_PO_Price__c vs Sales_Issue_Disti_
*                Price__c by disti channel code) and the valid-date window
*                check are reused as-is from R4C_KTBR_TI_PICCheck — nothing
*                in the SR front end (r4c_AG_StockRotationHelper.js,
*                getCreditPriceHandler) suggests a different field split for
*                the automated pipeline.
*
*                Zero/low price handling differs from TI: the SR front end
*                treats CurrentPrice < 1 (not just an exact "0"/"0.00" match)
*                as a manual-review note rather than a hard stop — this
*                mirrors R4C_KTBR_TI_PICCheck's own behavior of never setting
*                Sales_Issue_Line_Item_Status__c to Declined for price
*                issues, just flagging PICStatus/PICNotes for the agent.
*
* USAGE   :   R4C_KTBR_SR_PICCheck.run('06596326', 1, 1000);
*
* Created By   : Abhishek Pandey
* Created Date : 18/07/2026
*******************************************************************************/

public without sharing class R4C_KTBR_SR_PICCheck {

    private static final String  CLASS_NAME          = 'R4C_KTBR_SR_PICCheck';
    private static final Integer CHUNK_SIZE           = 1000;
    private static final Decimal PRICE_ZERO_THRESHOLD = 1;
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

            String productValidationAttachmentName =
                'KTBR_SR_ProductValidation_' + caseNumber + '_' + lineStart + '_' + lineEnd;
            R4C_KTBR_Util.CSVReadResult previous =
                R4C_KTBR_Util.readPreviousStepCSV(caseId, productValidationAttachmentName);

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
                Decimal parsedPrice = parsePrice(priceEl?.CurrentPrice);

                if (priceEl == null || String.isBlank(priceEl.CurrentPrice)) {
                    status = PRICE_NOT_FOUND_MSG;
                    notes = 'Agent must enter price and reason manually before submission.';
                    line.Line_item_error_messages__c =
                        appendError(line.Line_item_error_messages__c, status);

                } else if (parsedPrice < PRICE_ZERO_THRESHOLD) {
                    status = PRICE_ZERO_MSG;
                    notes = 'Agent must enter override price and reason before submission.';
                    line.Line_item_error_messages__c =
                        appendError(line.Line_item_error_messages__c, status);

                } else {
                    status = 'Pass';
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
                'KTBR_SR_PICCheck_' + caseNumber + '_' + lineStart + '_' + lineEnd,
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
