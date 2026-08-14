/******************************************************************************************************************************************
Class Name  : R4C_API_POsearch_HANAConsumingClass
Test Class  : R4C_API_POsearch_APIConsumingClass_Test
Created Date: 05/08/2022 
Description : This class helps to get line itmes n po from hana PO
Last Modified by : Manohar
Last Modified date : 20/02/2025
Modification Log :
* Developer                 Date                    Description             User Story
* --------------------------------------------------------------------------------------------
* Popcornapps               05/08/2022                               
***********************************************************************************************/
public with sharing class R4C_API_POsearch_HANAConsumingClass {
    private static final String BLANK_SPACE = ' ';//This variable is to set the blank space in Header
    private static String filterAttrString;//This variable is for Payload         
    @TestVisible
    private static String continuationLabel;//Declared this variable for Test coverage
    @TestVisible
    private static String continuationState;//Declared this variable for Test coverage
    private static String startDateVar;
    private static String endDateVar;
    private static String selectedFields = '';
    //TWC4621-5129 Adding IAO Toogle for PO API's
    public static final String isIAOFlag = R4C_Generic_Configurations__c.getValues('isIaoFlag').Value__c;

    /*
* Method : invokeInitialRequest
* Description : The Method that fires the continuation
* @param : String srequestwrapper
* @return: Object
*/
    @AuraEnabled(continuation=true cacheable=true)
    public static Object invokeInitialRequest(String srequestwrapper) {
        // Creating the continuation with a 120s timeout
        final Continuation con = new Continuation(120);
        final String conError = R4C_Generic_Configurations__c.getValues('CONTINUATION_ERROR')?.Value__c;
        final String emptyParams =R4C_Generic_Configurations__c.getValues('EMPTY_REQUEST_PARAMS')?.Value__c;
        try {
            System.debug(srequestwrapper);
            R4C_APIGEE_Settings__mdt integrationSetting = new R4C_APIGEE_Settings__mdt();
            PoSearchRequestWrapper reqWrapper = new PoSearchRequestWrapper();
            reqWrapper = (PoSearchRequestWrapper)System.JSON.deserialize(srequestwrapper, PoSearchRequestWrapper.class);
            if(String.isEmpty(srequestwrapper) || String.isEmpty(reqWrapper.apiType) ) {
                throw new AuraHandledException(conError+emptyParams);
            }
            integrationSetting = returnIntegrationSettingName(reqWrapper, srequestwrapper);
            if(!Boolean.valueOf(isIAOFlag)) { //TWC4621-5129
                if(reqWrapper.apiType == 'SEARCH') {
                    selectedFields = System.Label.R4C_POSearch_Response_Fields;
                } else {
                    selectedFields = System.Label.R4C_Req_Hana_Response_Fields;
                }
            }
            LineitemReqs req1 = new LineitemReqs();
            req1.mmOffset = 0;
            req1.poOffset = 0;
            req1.soOffset = 0;
            req1 = reqslistSize(req1, reqWrapper);
            String reqJsonStrings ='';
            for(Integer count = 0; count < req1.noOfCalls; count++) {
                String jsonString ='';
                Integer limitSize = req1.requestsperCall;
                if(req1.extrarequests != 0 && count == req1.noOfCalls-1) {
                    limitSize = req1.requestsperCall+req1.extrarequests; 
                }
                //Creating the callout request
                final HttpRequest req = new HttpRequest();
                if(!Boolean.valueOf(isIAOFlag)) { //TWC4621-5129
                    filterAttrString = '';
                    filterAttrString = prepareReqString(reqWrapper, req1, limitSize);             
                    final JSONGenerator jsonGen = JSON.createGenerator(true);
                    jsonGen.writeStartObject();
                    jsonGen.writeObjectField('$format', 'json');
                    jsonGen.writeObjectField('$filter',filterAttrString);
                    jsonGen.writeObjectField('$select',selectedFields);
                    jsonGen.writeEndObject();
                    jsonString = jsonGen.getAsString();
                    req.setBody(jsonString);
                    reqJsonStrings += jsonString;
                }
                if(Boolean.valueOf(isIAOFlag)) { //TWC4621-5129
                    IAOPOHReqWrapper iaoReq = prepareIAOReqPayload(reqWrapper, req1, limitSize);
                    system.debug('83'+iaoReq);
                    system.debug('84'+JSON.serialize(iaoReq));
                    req.setBody(JSON.serialize(iaoReq));
                    reqJsonStrings += JSON.serialize(iaoReq);
                }
                String accessToken ;
                con.continuationMethod='continuationCallback';
                req.setMethod('POST');
                //Manohar - TWC4621-5129 To Support PO API's for Both IAO and R4C Start
                if(Boolean.valueOf(isIAOFlag)) {
                    req.setEndpoint(integrationSetting.IAO_Named_Credential__c);
                }else {
                    req.setEndpoint(integrationSetting.Consuming_Class_Name__c);
                }
                //Manohar - TWC4621-5129 To Support PO API's for Both IAO and R4C End
                req.setHeader('content-type', 'application/json');
                req.setHeader('Accept', 'application/json');
                con.addHttpRequest(req);
                //added for test coverage..
                if(test.isRunningTest()) {
                    continuationLabel = con.addHttpRequest(req);
                }               
            }
            //code added for storing API request and response details - start
            String transactionId = R4C_API_MessageLogAndAttachment.generateTransactionId();

            R4C_API_MessageLogAndAttachment.MessageLogWrapper msgLogWrpr = new R4C_API_MessageLogAndAttachment.MessageLogWrapper();
            msgLogWrpr.SourceAPIName = 'PO History Search';
            msgLogWrpr.requestBody = reqJsonStrings;
            msgLogWrpr.transactionId = transactionId;
            R4C_API_MessageLogAndAttachment.insertAsync=true;
            R4C_API_MessageLogAndAttachment.CreateMessageLogRecord(msgLogWrpr,true);
            con.state = transactionId;
            //code added for storing API request and response details - end
        }
        catch(AuraHandledException ex) {
            R4C_AG_ErrorRecordHandler.errorRecord_Method('R4C_API_POsearch_HANAConsumingClass.invokeInitialRequest',ex.getMessage(),ex,True);
            //throw new AuraHandledException(ex.getStackTraceString() + ex.getLineNumber()  );
            return new R4C_API_Callout_ResponseHandler().failure('R4C_API_POsearch_HANAConsumingClass.invokeInitialRequest',ex,conError);

        }
        return con;
    }

    /*
* Method : continuationCallback
* Description : The function that processes the continuation callback
* @param : List<String> labels,Object state
* @return : Object
*/
    @AuraEnabled(cacheable=true)
    public static Object continuationCallback(List<String> labels,Object state) {
        final String contactAdmin = R4C_Generic_Configurations__c.getValues('CONTACT_ADMIN_INFO')?.Value__c;
        final String conError = R4C_Generic_Configurations__c.getValues('CONTINUATION_ERROR')?.Value__c;
        final String httpError = R4C_Generic_Configurations__c.getValues('HTTP_REQUEST_ERROR')?.Value__c;
        SOResponse finalResponse = new SOResponse();     
        List<responseElements> requiredElementsObj = new  List<responseElements>();
        String errorBody='';
        try {
            String transactionId = (String) state;
            String consolidatedResponse = '';
            Integer finalStatusCode = 200;
            for(Integer i=0;i<labels.size();i++) {
                // Get the response
                final HttpResponse response = Continuation.getResponse(labels[i]);
                system.debug('139'+response);
                SOResponse responseData = new SOResponse();
                system.debug('141'+response.getstatusCode());

                Integer statusCode = response.getstatusCode();
                finalResponse.StatusCode = statusCode;

                if(statusCode != 200) {
                    finalStatusCode = statusCode;
                }

                if(i > 0) {
                    consolidatedResponse += ',\n';
                }
                consolidatedResponse += '{"callout":' + (i+1) + ',"statusCode":' + statusCode + ',"body":' + response.getBody() + '}';

                R4C_API_MessageLogAndAttachment.MessageLogWrapper msgLogWrpr = new R4C_API_MessageLogAndAttachment.MessageLogWrapper();
                msgLogWrpr.SourceAPIName = 'PO History Search';
                msgLogWrpr.transactionId = transactionId;
                msgLogWrpr.StatusCode = String.valueOf(finalStatusCode);
                msgLogWrpr.responseBody = consolidatedResponse;
                R4C_API_MessageLogAndAttachment.insertAsync = true;
                R4C_API_MessageLogAndAttachment.CreateMessageLogRecord(msgLogWrpr, true);

                if (response.getstatusCode() == 200) {
                    system.debug('144'+response.getBody());
                    responseData = (SOResponse) System.JSON.deserialize(response.getBody(), SOResponse.class);
                    requiredElementsObj.addAll(responseData.elements);
                    finalResponse.isSuccess = true ;   
                }
                else if(response.getstatusCode() == 2004) {
                    errorBody=response.getBody();
                    finalResponse.isSuccess = false ;
                    //throw new AuraHandledException('PO Search failed: Please refine the search criteria');
                    throw new AuraHandledException(conError+contactAdmin );
                }
                else if(response.getstatusCode() >= 2000) {
                    errorBody=response.getBody();
                    finalResponse.isSuccess = false ;
                    throw new AuraHandledException(conError+contactAdmin );
                }
                else {
                    errorBody=response.getBody();
                    finalResponse.isSuccess = false ;
                    // Handle standard HTTP request errors
                    throw new AuraHandledException(httpError+contactAdmin);
                }
            }

            //R4C_API_MessageLogAndAttachment.CreateMessageLogForContinuation(labels);
            finalResponse.elements = requiredElementsObj;
        }       
        catch(AuraHandledException ex) {
            R4C_AG_ErrorRecordHandler.errorRecord_Method('R4C_API_POsearch_HANAConsumingClass.continuationCallback',ex.getMessage(),ex,True);
            //throw new AuraHandledException(contactAdmin+ex+' : ' + ex.getStackTraceString() + ex.getLineNumber()+' => '+errorBody);
            return new R4C_API_Callout_ResponseHandler().failure('R4C_API_POsearch_HANAConsumingClass.continuationCallback',ex,contactAdmin);
        }       
        //return  finalResponse;
        return new R4C_API_Callout_ResponseHandler().success(finalResponse);
    }

    /**
* Method : returnIntegrationSettingName
* @Author : Accellor
* Description : fetching the Integration Name
* @param : PoSearchRequestWrapper reqstWrapper
* @param : String sreqstWrapper
* @return: R4C_APIGEE_Settings__mdt
*/

    public static R4C_APIGEE_Settings__mdt returnIntegrationSettingName(PoSearchRequestWrapper reqstWrapper, String sreqstWrapper) {
        if(String.isEmpty(sreqstWrapper) ) {
            final String conError = R4C_Generic_Configurations__c.getValues('CONTINUATION_ERROR')?.Value__c;
            final String emptyParams =R4C_Generic_Configurations__c.getValues('EMPTY_REQUEST_PARAMS')?.Value__c;
            throw new AuraHandledException(conError+emptyParams);
            // break the flow here if input String empty
        }
        R4C_APIGEE_Settings__mdt intgerationName = new R4C_APIGEE_Settings__mdt();
        intgerationName = R4C_APIGEE_Settings__mdt.getInstance('R4C_POHistory_API');// this metadata have API related info
        return intgerationName;
    }

    /**
* Method : reqslistSize
* @Author : Accellor
* @param : R4C_API_POsearch_HANAConsumingClass.LineitemReqs req2
* @param : R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper
* @return : LineitemReqs (Wrapper)
*/

    private static LineitemReqs reqslistSize(R4C_API_POsearch_HANAConsumingClass.LineitemReqs req2, R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper) {
        final Integer polistSize = reqWrapper?.poListbyInput.size();
        final Integer mmlistSize = reqWrapper?.mmListbyInput.size();
        final Integer solistSize = reqWrapper?.soListbyInput.size();
        LineitemReqs req8 = new LineitemReqs();
        Integer listSize;
        if(polistSize >= mmlistSize && polistSize >= solistSize) {
            listSize = polistSize;
            req8 = noofReqs(req2, listSize);
        }
        else if(mmlistSize >= polistSize && mmlistSize >= solistSize) {
            listSize = mmlistSize;
            req8 = noofReqs(req2, listSize);
        }
        else if(solistSize >= polistSize && solistSize >= mmlistSize) {
            listSize = solistSize;
            req8 = noofReqs(req2, listSize);
        }
        return req8;
    }
    /**
* Method :  noofReqs
* @param :  R4C_API_POsearch_HANAConsumingClass.LineitemReqs req2
* @param :  R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper
* @return:  LineitemReqs
*/   
    private static LineitemReqs noofReqs(LineitemReqs req3, Integer listSize) {

        final R4C_Generic_Configurations__c genCons = R4C_Generic_Configurations__c.getValues('PO_Search_Con_Limit');
        final Integer contListsize = Integer.valueof(genCons?.Value__c);

        if(listSize <= contListsize) {
            req3.noOfCalls = 1;
            req3.requestsperCall = contListsize;
            req3.tempreqperCall = contListsize;
            req3.extrarequests  = 0;
        }
        else {
            req3.noOfCalls = 3;
            req3.requestsperCall = listSize/req3.noOfCalls;
            req3.tempreqperCall = req3.requestsperCall;
            req3.extrarequests = math.mod(listSize,req3.noOfCalls);
        }
        return req3;
    }


    /**
* @Author : Accellor
* Method  : returnFilterAttrStr
* Description : Added to optimize the code.
* @param : R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper requestWrappr
* @param : R4C_API_POsearch_HANAConsumingClass.LineitemReqs request4
* @param : Integer limitDataSize
* @return: String
*/
    private static String prepareReqString(R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper,R4C_API_POsearch_HANAConsumingClass.LineitemReqs req4, Integer limitSize) {

        if(checkPoSOMMEmptyCondition(reqWrapper)) {
            if(reqWrapper.poListbyInput.size() >= reqWrapper.mmListbyInput.size() && reqWrapper.poListbyInput.size() >= reqWrapper.soListbyInput.size()) {
                filterAttrString = getrequestpolist(reqWrapper, req4, limitSize);
            }
            else if(reqWrapper.mmListbyInput.size() >= reqWrapper.poListbyInput.size() && reqWrapper.mmListbyInput.size() >= reqWrapper.soListbyInput.size()) {
                filterAttrString = getrequestmmlist(reqWrapper, req4, limitSize);
            }
            else if(reqWrapper.soListbyInput.size() >= reqWrapper.poListbyInput.size() && reqWrapper.soListbyInput.size() >= reqWrapper.mmListbyInput.size()) {
                filterAttrString = getrequestsolist(reqWrapper, req4, limitSize);
            }
        }
        return filterAttrString;
    }
    //TWC4621-5129
    private static IAOPOHReqWrapper prepareIAOReqPayload(R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper requestWrapper, R4C_API_POsearch_HANAConsumingClass.LineitemReqs lineItemReq, Integer maxResultsPerRequest) {
    IAOPOHReqWrapper iaoReqPayload = new IAOPOHReqWrapper();
    if (checkPoSOMMEmptyCondition(requestWrapper)) {
        List<String> recordsToProcess = new List<String>();
        if (String.isNotBlank(requestWrapper.startDate) && String.isNotBlank(requestWrapper.endDate)) {
            startDateVar = requestWrapper.startDate.remove('-');
            endDateVar = requestWrapper.endDate.remove('-');
        }else {
            getDateBasedOnServiceType(requestWrapper);
        }
        iaoReqPayload.IP_APITYPE = requestWrapper.apiType;
        iaoReqPayload.IP_DELIVERYNOTENBR = new List<String>();
        iaoReqPayload.IP_SALESORDERID = new List<String>();
        iaoReqPayload.IP_SOLDTOCUSTOMERID = (requestWrapper?.availableCMFList != null) ? requestWrapper.availableCMFList : new List<String>();
        iaoReqPayload.IP_CUST_BILLING_TYPE_CD = (String.isNotBlank(requestWrapper.CustomerBillingDocumentTypeCd))
                                                ? requestWrapper.CustomerBillingDocumentTypeCd.split(',') : new List<String>();
        iaoReqPayload.IP_ITEMVALIDATION = new List<String>();
        iaoReqPayload.IP_CUSTOMERBILLINGDOCUMENTSTARTDT = startDateVar;
        iaoReqPayload.IP_CUSTOMERBILLINGDOCUMENTENDDT = endDateVar;
        if(requestWrapper.apiType == 'SEARCH') {
            iaoReqPayload.IP_ResponseFields = System.Label.R4C_POSearch_Response_Fields.split(',');
        } else {
            iaoReqPayload.IP_ResponseFields = System.Label.R4C_Req_Hana_Response_Fields.split(',');
        }
        if (requestWrapper.poListbyInput.size() >= requestWrapper.mmListbyInput.size() && requestWrapper.poListbyInput.size() >= requestWrapper.soListbyInput.size()) {
            // Process PO list
            recordsToProcess = extractItemsForRequest(requestWrapper.poListbyInput, lineItemReq.poOffset, maxResultsPerRequest);
            lineItemReq.requestsPerCall = lineItemReq.tempreqPerCall + lineItemReq.poOffset;
            iaoReqPayload.IP_PONUMBER = recordsToProcess;
        } else if (requestWrapper.mmListbyInput.size() >= requestWrapper.poListbyInput.size() && requestWrapper.mmListbyInput.size() >= requestWrapper.soListbyInput.size()) {
            // Process MM list
            recordsToProcess = extractItemsForRequest(requestWrapper.mmListbyInput, lineItemReq.mmOffset, maxResultsPerRequest);
            lineItemReq.requestsPerCall = lineItemReq.tempreqPerCall + lineItemReq.mmOffset;
            iaoReqPayload.IP_ITEMVALIDATION = recordsToProcess;
            iaoReqPayload.IP_CUSTOMERBILLINGDOCUMENTSTARTDT = ''; 
            iaoReqPayload.IP_CUSTOMERBILLINGDOCUMENTENDDT = '';
        } else {
            // Process SO list
            recordsToProcess = extractItemsForRequest(requestWrapper.soListbyInput, lineItemReq.soOffset, maxResultsPerRequest);
            lineItemReq.requestsPerCall = lineItemReq.tempreqPerCall + lineItemReq.soOffset;
            iaoReqPayload.IP_SALESORDERID = recordsToProcess;
        }
    }

    return iaoReqPayload;
}

private static List<String> extractItemsForRequest(List<String> inputList, Integer offset, Integer maxResultsPerRequest) {
    List<String> resultItems = new List<String>();
    while (offset < inputList.size() && offset < maxResultsPerRequest) {
        resultItems.add(inputList[offset]);
        offset++;
    }
    return resultItems;
}

    /**
* Method :  checkPoSOMMEmptyCondition
* Description : check PO MM Empty condition
* @param :  R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper
* @return:  Boolean
*/ 

    private static Boolean checkPoSOMMEmptyCondition(PoSearchRequestWrapper reqWrapper) {
        return !reqWrapper.poListbyInput.isEmpty() || !reqWrapper.soListbyInput.isEmpty() || !reqWrapper.mmListbyInput.isEmpty();
    }
    /**
* Method :  getrequestpolist
* @param :  PoSearchRequestWrapper reqWrapper
* @param :  R4C_API_POsearch_HANAConsumingClass.LineitemReqs req5
* @param :  Integer limitSize
* @return:  String
*/ 
    private static String getrequestpolist(PoSearchRequestWrapper reqWrapper, LineitemReqs req5, Integer limitSize) {
        system.debug('271'+reqWrapper.availableCMFList);
        final List<String> setpotoGo = new List<String>();
        while (req5.poOffset < reqWrapper.poListbyInput.size() && req5.poOffset < limitSize) {
            setpotoGo.add(reqWrapper.poListbyInput[req5.poOffset]);
            req5.poOffset++;
        }
        req5.requestsperCall = req5.tempreqperCall+req5.poOffset;

        filterAttrString += '\"IP_DELIVERYNOTENBR\" =  \'\'\'*\'\'\' AND \"IP_SALESORDERID\" = \'\'\'*\'\'\'';

        filterAttrString += ' AND \"IP_APITYPE\" = \'' +reqWrapper.apiType + '\'';

        filterAttrString += ' AND \"IP_CUST_BILLING_TYPE_CD\" =(\'\'\''+reqWrapper.CustomerBillingDocumentTypeCd+'\'\'\')';
        if(!setpotoGo.isEmpty()) {
            final String commasepPOs = '\'\'\'' + String.join(setpotoGo, '\'\',\'\'') + '\'\'\'';
            filterAttrString += ' AND \"IP_PONUMBER\" = ( ' +commasepPOs+')';
        }
        if(!reqWrapper.availableCMFList.isEmpty()) {
            final String commasepCMFs = '\'\'\'' + String.join(reqWrapper.availableCMFList, '\'\',\'\'') + '\'\'\'';
            filterAttrString += 'AND \"IP_SOLDTOCUSTOMERID\" = ('+ commasepCMFs+')';
        }
        filterAttrString += ' AND \"IP_ITEMVALIDATION\" = \'\'\'*\'\'\'';
        final String datefilterStr = getDateFilter( reqWrapper);
        filterAttrString += datefilterStr;

        return filterAttrString; 
    }

    /**
* @Author : Accellor
* Method  : getrequestmmlist
* @param  : PoSearchRequestWrapper reqstWrapper
* @param  : R4C_API_POsearch_HANAConsumingClass.LineitemReqs req6
* @param  : Integer limitSize
* @return : String filterAttrString
*/
    private static String getrequestmmlist(PoSearchRequestWrapper reqWrapper, R4C_API_POsearch_HANAConsumingClass.LineitemReqs req6, Integer limitSize) {     
        final List<String> setmmtoGo = new List<String>();
        while (req6.mmOffset < reqWrapper.mmListbyInput.size() && req6.mmOffset < limitSize) {
            setmmtoGo.add(reqWrapper.mmListbyInput[req6.mmOffset]);
            req6.mmOffset++;
        }
        req6.requestsperCall = req6.tempreqperCall+req6.mmOffset;

        filterAttrString += '\"IP_DELIVERYNOTENBR\" =  \'\'\'*\'\'\' AND \"IP_SALESORDERID\" = \'\'\'*\'\'\' AND \"IP_PONUMBER\" = \'\'\'*\'\'\' AND \"IP_CUSTOMERBILLINGDOCUMENTSTARTDT\" = \'\'\'*\'\'\' AND \"IP_CUSTOMERBILLINGDOCUMENTENDDT\" = \'\'\'*\'\'\'';

        filterAttrString += ' AND \"IP_APITYPE\" = \'' +reqWrapper.apiType + '\'';

        filterAttrString += ' AND \"IP_CUST_BILLING_TYPE_CD\" =(\'\'\''+reqWrapper.CustomerBillingDocumentTypeCd+'\'\'\')';

        if(!reqWrapper.availableCMFList.isEmpty()) {
            final String commasepCMFs = '\'\'\'' + String.join(reqWrapper.availableCMFList, '\'\',\'\'') + '\'\'\'';
            filterAttrString += 'AND \"IP_SOLDTOCUSTOMERID\" = ('+ commasepCMFs+')';
        } else{
            filterAttrString += ' AND \"IP_SOLDTOCUSTOMERID\" = \'\'\'*\'\'\'';
        }

        final String commasepMMs = '\'\'\'' + String.join(setmmtoGo, '\'\',\'\'') + '\'\'\'';
        filterAttrString += ' AND \"IP_ITEMVALIDATION\" = ( ' +commasepMMs+')';

        return filterAttrString;
    }
    /**
* Method :  getrequestsolist
* @param :  PoSearchRequestWrapper reqWrapper
* @param :  R4C_API_POsearch_HANAConsumingClass.LineitemReqs req7
* @param :  Integer limitSize
* @return:  String
*/
    private static String getrequestsolist(PoSearchRequestWrapper reqWrapper, LineitemReqs req7, Integer limitSize) {

        final List<String> setsotoGo = new List<String>();
        while (req7.soOffset < reqWrapper.soListbyInput.size() && req7.soOffset < limitSize) {
            setsotoGo.add(reqWrapper.soListbyInput[req7.soOffset]);
            req7.soOffset++;
        }
        req7.requestsperCall = req7.tempreqperCall+req7.soOffset;

        filterAttrString += '\"IP_DELIVERYNOTENBR\" =  \'\'\'*\'\'\' AND \"IP_PONUMBER\" = \'\'\'*\'\'\'';

        filterAttrString += ' AND \"IP_APITYPE\" = \'' +reqWrapper.apiType + '\'';

        filterAttrString += ' AND \"IP_CUST_BILLING_TYPE_CD\" =(\'\'\''+reqWrapper.CustomerBillingDocumentTypeCd+'\'\'\')';
        if(!setsotoGo.isEmpty()) {
            final String commasepSOs = '\'\'\'' + String.join(setsotoGo, '\'\',\'\'') + '\'\'\'';
            filterAttrString += ' AND \"IP_SALESORDERID\" = ( ' +commasepSOs+')';
        }
        if(!reqWrapper.availableCMFList.isEmpty()) {
            final String commasepCMFs = '\'\'\'' + String.join(reqWrapper.availableCMFList, '\'\',\'\'') + '\'\'\'';
            filterAttrString += 'AND \"IP_SOLDTOCUSTOMERID\" = ('+ commasepCMFs+')';
        }
        filterAttrString += ' AND \"IP_ITEMVALIDATION\" = \'\'\'*\'\'\'';
        final String datefilterStr = getDateFilter( reqWrapper);
        filterAttrString += datefilterStr;

        return filterAttrString;
    }

    /*
* Method  : getDateFilter
* Description : logic for passing dates in a payload
* @param  : R4C_API_POsearch_HANAConsumingClass.poSearchRequestWrapper reqWrapper
* @return : String
*/
    public static String getDateFilter(PoSearchRequestWrapper reqWrapper) {
        String datefilterStr ='';
        if(String.isNotBlank(reqWrapper.startDate) && String.isNotBlank(reqWrapper.endDate)) {
            startDateVar = String.valueOf(reqWrapper.startDate).remove('-');
            endDateVar = String.valueOf(reqWrapper.endDate).remove('-');
        }
        else {
            getDateBasedOnServiceType(reqWrapper);
        }
        if(!reqWrapper.poListbyInput.isEmpty() ||
           !reqWrapper.mmListbyInput.isEmpty() ||
           !reqWrapper.soListbyInput.isEmpty()) {
               //datefilterStr += ' AND' +' \"IP_CUSTOMERBILLINGDOCUMENTSTARTDT\" >= \'' +startDateVar + '\'';
               //datefilterStr += ' AND' +' \"IP_CUSTOMERBILLINGDOCUMENTENDDT\" <= \'' +endDateVar + '\'';
               datefilterStr += ' AND \"IP_CUSTOMERBILLINGDOCUMENTSTARTDT\" =(\''+startDateVar+'\')';
               datefilterStr += ' AND \"IP_CUSTOMERBILLINGDOCUMENTENDDT\" =(\''+endDateVar+'\')';
           }
        return datefilterStr;
    }
    /**
* Method :  getDateBasedOnServiceType
* Description : check start date and end date is null or not , if null add the dates based on service type
* @param :  R4C_API_POsearch_HANAConsumingClass.PoSearchRequestWrapper reqWrapper
* @return:  Boolean
*/ 
    static void getDateBasedOnServiceType(poSearchRequestWrapper reqWrapper) {
        if(reqWrapper.serviceType == 'Stock Rotation') {
            final R4C_Generic_Configurations__c genCons = R4C_Generic_Configurations__c.getValues('PO_Search_Stock_Rotation_Months');
            final Integer srMonths = Integer.valueof(genCons?.Value__c);
            startDateVar = String.valueOf(Date.Today().addMonths(srMonths)).remove('-');
            endDateVar = String.valueOf(Date.Today()).remove('-');
        }
        else if(reqWrapper.serviceType == 'Technical' || reqWrapper.serviceType == 'Miscellaneous') {
            final R4C_Generic_Configurations__c genCons = R4C_Generic_Configurations__c.getValues('PO_Search_Technical_Intake_Months');
            final Integer tiMonths = Integer.valueof(genCons?.Value__c);
            startDateVar = String.valueOf(Date.Today().addMonths(tiMonths)).remove('-');
            endDateVar = String.valueOf(Date.Today()).remove('-');
        }
        else if(reqWrapper.serviceType == 'Quality') {
            final R4C_Generic_Configurations__c genCons = R4C_Generic_Configurations__c.getValues('PO_Search_Quality_Intake_Months');
            final Integer qualityMonths = Integer.valueof(genCons?.Value__c);
            startDateVar = String.valueOf(Date.Today().addMonths(qualityMonths)).remove('-');
            endDateVar = String.valueOf(Date.Today()).remove('-');
        }
        else if(reqWrapper.serviceType == 'Admin') {
            final R4C_Generic_Configurations__c genCons = R4C_Generic_Configurations__c.getValues('PO_Search_Admin_Intake_Months');
            final Integer adminMonths = Integer.valueof(genCons?.Value__c);
            startDateVar = String.valueOf(Date.Today().addMonths(adminMonths)).remove('-');
            endDateVar = String.valueOf(Date.Today()).remove('-');
        }
        else if(reqWrapper.serviceType == 'Exception') {
            final R4C_Generic_Configurations__c genCons = R4C_Generic_Configurations__c.getValues('PO_Search_Exception_Intake_Months');
            final Integer exceptionMonths = Integer.valueof(genCons?.Value__c);
            startDateVar = String.valueOf(Date.Today().addMonths(exceptionMonths)).remove('-');
            endDateVar = String.valueOf(Date.Today()).remove('-'); 
        }
    }


    //Po Search request wrapper..
    public class PoSearchRequestWrapper {
        /* available CMF List */
        @auraEnabled
        public List<String> availableCMFList {get;set;} //List of Strings of available CMF for the current contact
        /* PO List By Input */
        @auraEnabled
        public List<String> poListbyInput {get;set;} //List of PO's that are entered by agent/customer
        /** MM List */
        @auraEnabled
        public List<String> mmListbyInput {get;set;} //List of MM's that are entered by agent/customer
        /* SO List By Input  */
        @auraEnabled
        public List<String> soListbyInput {get;set;} //List of SO's that are entered by agent/customer
        /* Start Date */
        @auraEnabled
        public String startDate {get;set;} //Start Date which was entered by agent/customer
        /* End Date */
        @auraEnabled
        public String endDate {get;set;} //End Date which was entered by agent/customer
        /* service type */
        @auraEnabled
        public String serviceType {get;set;} //Available Servicetype for the current contact
        /** Customer Billing Document */
        @auraEnabled
        public String CustomerBillingDocumentTypeCd {get;set;} //CustomerBillingDocumentTypeCd based on EW lines
        /** API Type*/
        @auraEnabled
        public String apiType {get;set;} //Whether to get BAG response or VISID response
        public PoSearchRequestWrapper() {
            availableCMFList = new List<String>();
            poListbyInput = new List<String>();
            mmListbyInput = new List<String>();
            soListbyInput = new List<String>();
        }
    }
    /* Po Search Response Wrapper */
    public class SOResponse {
        @auraEnabled
        public list<responseElements> elements {get;set;} // store the values of API responce
        @auraEnabled
        public Boolean isSuccess {get;set;} // store the value of success responce
        @auraEnabled
        public Integer StatusCode{get;set;}
    }
    //This wrapper class is used to store the response from API
    public class responseElements {
        @AuraEnabled
        public string SalesOrderId {get;set;} // store the value of SalesOrderNumber from the response
        @AuraEnabled
        public string SalesOrderLineNbr {get;set;} // store the value of SalesOrderNumberLineNumber from the response
        @AuraEnabled
        public string CustomerPurchaseOrderNbr {get;set;} // store the value of CustomerPurchaseOrderNbr from the response
        @AuraEnabled
        public string SoldToCustomerId {get;set;} //store the value of SalesOrderReasonCd from the response
        @AuraEnabled
        public string ItemId {get;set;} // store the value of ItemId from the response
        @AuraEnabled
        public string CustomerItemNbr {get;set;} // store the value of CustomerItemNbr from the response
        @AuraEnabled
        public string CustomerBillingDocumentId {get;set;} //store the value of CustomerBillingDocumentId from the response
        @AuraEnabled
        public date CustomerBillingDocumentDt {get;set;} //store the value of CustomerBillingDocumentDt from the response
        @AuraEnabled
        public string CustomerBillingDocumentTypeCd {get;set;} //store the value of CustomerBillingDocumentTypeCd from the response
        @AuraEnabled
        public string DeliveryNoteNbr {get;set;} //store the value of DeliveryNoteNbr from the response
        @AuraEnabled
        public string BillingQty {get;set;} //store the value of BillingQty from the response
        @AuraEnabled
        public string SalesOrderLineNetPriceAmt {get;set;} //store the value of SalesOrderLineNetPriceAmt from the response
        @AuraEnabled
        public string SalesOrderCurrencyCd {get;set;} //store the value of SalesOrderCurrencyCd from the response
        @AuraEnabled
        public string CustomerBillingDocumentLineNbr {get;set;} //store the value of CustomerBillingDocumentLineNbr from the response       
        // Added By Hassan
        @AuraEnabled
        public string SalesOrganizationCd {get;set;}
        @AuraEnabled
        public string DistributionChannelCustomerCd {get;set;}
        //TWC4621-2173 - Use ContraRevenueAdjustmentRequestlineNetPriceAmt instead of SalesOrderLineNetPriceAmt
        @AuraEnabled
        public string ContraRevenueAdjustmentRequestlineNetPriceAmt {get;set;} //store the value of ContraRevenueAdjustmentRequestlineNetPriceAmt from the response
        //Start -- Manohar --TWC4621-3489
        @AuraEnabled
        public string BagNbr {get;set;}
        @AuraEnabled
        public string ItemEffectiveStartDt {get;set;}
        @AuraEnabled
        public string ItemEffectiveEndDt {get;set;}
        //End -- Manohar --TWC4621-3489
        @AuraEnabled
        /** BatchId */   
        public String BatchId {get;set;}
        @AuraEnabled
        /** NCNR Flag IAO */   
        public String NcnrFlag {get;set;}
    } 
    public class LineitemReqs {
        private Integer poOffset {get;set;} //store the value of PO offset, which is used to calculate the no of calls in a continuation
        private Integer soOffset {get;set;} //store the value of SO offset, which is used to calculate the no of calls in a continuation
        private Integer mmOffset {get;set;} //store the value of MM offset, which is used to calculate the no of calls in a continuation
        private Integer requestsperCall {get;set;} //store the value of requestsperCall, which is used to calculate the no of calls in a continuation
        private Integer tempreqperCall {get;set;} //store the value of tempreqperCall, which is used to calculate the no of calls in a continuation
        private Integer noOfCalls {get;set;} //store the value of noOfCalls, which is used to calculate the no of calls in a continuation
        private Integer extrarequests {get;set;} //store the value of extrarequests, which is used to calculate the no of calls in a continuation

    }

    public class IAOPOHReqWrapper {
        public List<String> IP_DELIVERYNOTENBR { get; set; }
        public List<String> IP_SALESORDERID { get; set; }
        public String IP_APITYPE { get; set; }
        public List<String> IP_SOLDTOCUSTOMERID { get; set; }
        public List<String> IP_PONUMBER { get; set; }
        public List<String> IP_CUST_BILLING_TYPE_CD { get; set; }
        public List<String> IP_ITEMVALIDATION { get; set; }
        public String IP_CUSTOMERBILLINGDOCUMENTSTARTDT { get; set; }
        public String IP_CUSTOMERBILLINGDOCUMENTENDDT { get; set; }
        public List<String> IP_ResponseFields { get; set; }
        public IAOPOHReqWrapper() {
            IP_DELIVERYNOTENBR = new List<String>();
            IP_SALESORDERID = new List<String>();
            IP_SOLDTOCUSTOMERID = new List<String>();
            IP_PONUMBER = new List<String>();
            IP_CUST_BILLING_TYPE_CD = new List<String>();
            IP_PONUMBER = new List<String>();
            IP_ResponseFields = new List<String>();
        }
    }
}