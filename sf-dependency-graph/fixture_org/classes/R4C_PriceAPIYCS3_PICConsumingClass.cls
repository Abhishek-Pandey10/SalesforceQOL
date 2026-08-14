/*************************************************************************************************
Class Name  : R4C_PriceAPIYCS3_PICConsumingClass
Test Class  : R4C_PriceAPIYCS3_PICConsuming_Test
Created Date:  11/23/2022 
Description : This class used to get Price for MM's on Line item level from PIC-API. - YCS3 New PIC API
Modification Log :
* Developer                 Date                    Description             User Story
* --------------------------------------------------------------------------------------------
* Popcornapps               Jan 06 2023
***********************************************************************************************/
public with sharing class R4C_PriceAPIYCS3_PICConsumingClass{

    //Endpoint to which we will be making the callout
    private static final String BLANK_SPACE = ' ';
    private static Integer noOfCalls;
    private static Integer lineItemsPerCall;
    private static Integer templineItemsPerCall;
    private static Integer extraLineItems;
    public static string isIAOFlag = R4C_Generic_Configurations__c.getValues('isIaoFlag').Value__c;
    @TestVisible
    private static String continuationLabel;

    @TestVisible
    private static String continuationState;

    public static map<Integer, String> getNoOfCallsJsonMap(String picReqWraperString, PricingAPIYCS3ReqWrapper picReqWrapper){
        map<Integer, String> NoOfCallsJsonMap = new  map<Integer, String>();
        R4C_Generic_Configurations__c cs = R4C_Generic_Configurations__c.getValues('MM_List_Size');       
        Integer mmidsListsize = Integer.valueof(cs?.Value__c);
        Integer offset = 0;
        Integer mmListSize = picReqWrapper.MMList.size();

        if(mmListSize <= mmidsListsize){
            noOfCalls = 1;
            lineItemsPerCall = mmidsListsize;
            templineItemsPerCall = mmidsListsize;
            extraLineItems  = 0;
        }else{
            noOfCalls = 3;
            lineItemsPerCall = mmListSize/noOfCalls;
            templineItemsPerCall = lineItemsPerCall;
            extraLineItems = math.mod(mmListSize,noOfCalls);
        }

        for(Integer count = 0; count < noOfCalls; count++){
            Integer limitSize = lineItemsPerCall;
            if(extraLineItems != 0 && count == noOfCalls-1){
                limitSize = lineItemsPerCall+extraLineItems; 
            }
            List<String> setOfLineItmeToGo = new List<String>();
            while (offset < picReqWrapper.MMList.size() && offset < limitSize){
                setOfLineItmeToGo.add(picReqWrapper.MMList[offset]);
                offset++;
            }

            lineItemsPerCall = templineItemsPerCall+offset;

            String commaSeparatedMMs = '\'' + String.join(setOfLineItmeToGo, '\',\'') + '\''; 
            String filterAttrString = '(("MMList" in ('+ commaSeparatedMMs+ ')  ';
            filterAttrString += getFilterString(picReqWrapper);

            //Now Build the filered JSON request
            JSONGenerator jsonGen = JSON.createGenerator(true);
            jsonGen.writeStartObject();
            jsonGen.writeObjectField('$format', 'json');

            jsonGen.writeObjectField('$filter',filterAttrString);
            jsonGen.writeEndObject();

            String jsonString = jsonGen.getAsString();
            NoOfCallsJsonMap.put(count,jsonString);
        }
        return NoOfCallsJsonMap;
    }

    public static String getFilterString(PricingAPIYCS3ReqWrapper picReqWrapper){
        String filterAttrString = '';

        List<String> salesOrgLst = new List<String>();
        //Replacing last 2 characters of Sales Org to '01' as PIC API is returning price details only for AM01, AP01, etc.
        for(String SalesOrgObj : picReqWrapper.SalesOrgidList){
            String SalesOrg = SalesOrgObj;
            if(SalesOrg.startsWith('AM')) { //Replacing AM22 for all AM related SalesOrg values - AM22 L.E changes
                SalesOrg = 'AM22';
            }
            else if(!SalesOrg.endsWith('01')) {
                String SalesOrgRegExp = '.{2}$';
                String SalesOrgReplacement = '01';
                SalesOrg = SalesOrg.replaceFirst(SalesOrgRegExp, SalesOrgReplacement);
             }
            salesOrgLst.add(SalesOrg);
        }

        if(!salesOrgLst.isEmpty()){
               String commaSeparatedSalesOrg = '\'' + String.join(salesOrgLst, '\',\'') + '\''; 
        filterAttrString += 'and ("SalesOrgidList" in ('+ commaSeparatedSalesOrg + '))) ';
        }
        if(String.isBlank(picReqWrapper.CMF) == false) {
            filterAttrString += 'and ("CMF" = '+'\''+ picReqWrapper.CMF + '\'' +')) ';
        }
        return filterAttrString;
    }
    @AuraEnabled(continuation=true cacheable=true)
    public static Object invokeInitialRequest(String picReqWraperString) {
        //Instantiate the Continaution class
        //Also, pass the timeout when instantiation

        Continuation con = new Continuation(120);
        R4C_APIGEE_Settings__mdt integrationSetting;
        String CONTINUATION_ERROR = R4C_Generic_Configurations__c.getValues('CONTINUATION_ERROR')?.Value__c;
        String EMPTY_REQUEST_PARAMS =R4C_Generic_Configurations__c.getValues('EMPTY_REQUEST_PARAMS')?.Value__c;
        try{   

            PricingAPIYCS3ReqWrapper picReqWrapper = new PricingAPIYCS3ReqWrapper();
            picReqWrapper  =  (PricingAPIYCS3ReqWrapper)System.JSON.deserialize(picReqWraperString, PricingAPIYCS3ReqWrapper.class);

            if(String.isBlank(picReqWraperString) || ( picReqWrapper?.MMList?.isEmpty() ) ){
                throw new AuraHandledException(CONTINUATION_ERROR+EMPTY_REQUEST_PARAMS);
            }
            if(Boolean.valueOf(isIAOFlag)){
                integrationSetting = R4C_APIGEE_Settings__mdt.getInstance('zfs_zsdpPriceSearch_PIC'); 
            }
            else {
                 integrationSetting = R4C_APIGEE_Settings__mdt.getInstance('YCS3PriceSearch_PIC');
            }         
            map<Integer, String> noOfCallsJsonMap = getNoOfCallsJsonMap( picReqWraperString,picReqWrapper);
            String reqJsonStrings ='';
            for(Integer key : noOfCallsJsonMap.keySet())
            {
                String jsonString = noOfCallsJsonMap.get(key);
                reqJsonStrings += jsonString;
                String accessToken ;
                //this is the callback method
                con.continuationMethod='continuationCallback';
                system.debug('132'+jsonString);
                //Create the request
                HttpRequest req = new HttpRequest();
                req.setMethod('POST');
                req.setEndpoint(integrationSetting.Consuming_Class_Name__c);
                req.setHeader('content-type', 'application/json');
                req.setHeader('Accept', 'application/json');
                req.setBody(jsonString);
                con.addHttpRequest(req);
                system.debug('132req'+req);
                //added for test coverage..
                if(test.isRunningTest()){
                    continuationLabel = con.addHttpRequest(req);
                }
            }
            String transactionId = R4C_API_MessageLogAndAttachment.generateTransactionId();

            R4C_API_MessageLogAndAttachment.MessageLogWrapper msgLogWrpr = new R4C_API_MessageLogAndAttachment.MessageLogWrapper();
            msgLogWrpr.SourceAPIName = 'PIC API'; // earlier value PIC YCS3 API
            msgLogWrpr.requestBody = reqJsonStrings;
            msgLogWrpr.transactionId = transactionId;
            R4C_API_MessageLogAndAttachment.insertAsync=true;
            R4C_API_MessageLogAndAttachment.CreateMessageLogRecord(msgLogWrpr,true);
            con.state = transactionId;
        }
        catch(exception ex){
            R4C_ErrorRecordServiceWrapperClass err = new R4C_ErrorRecordServiceWrapperClass( 'R4C_PriceAPIYCS3_PICConsumingClass.invokeInitialRequest','Exception Occured',ex,'Integration/API error','',true);           
            R4C_ErrorRecordService errorRec = new R4C_ErrorRecordService();
            errorRec.insertErrorRecord(err);
            //throw new AuraHandledException(CONTINUATION_ERROR + ex.getMessage() );
            return new R4C_API_Callout_ResponseHandler().failure('R4C_PriceAPIYCS3_PICConsumingClass.invokeInitialRequest',ex,CONTINUATION_ERROR);
        }

        return con;
    }

    // Callback method
    @AuraEnabled(cacheable=true)
    public static Object continuationCallback(List<String> labels,Object state) {

        String CONTACT_ADMIN_INFO = R4C_Generic_Configurations__c.getValues('CONTACT_ADMIN_INFO')?.Value__c;
        String CONTINUATION_ERROR = R4C_Generic_Configurations__c.getValues('CONTINUATION_ERROR')?.Value__c;
        String HTTP_REQUEST_ERROR = R4C_Generic_Configurations__c.getValues('HTTP_REQUEST_ERROR')?.Value__c;

        List<creditPriceElementsYCS3> finalResponse = new List<creditPriceElementsYCS3>();
        try{
            String transactionId = (String) state;
            String consolidatedResponse = '';
            Integer finalStatusCode = 200;
            for(Integer i=0;i<labels.size();i++){

                HttpResponse response = Continuation.getResponse(labels[i]);
                System.debug('177'+response);
                Integer statusCode = response.getstatusCode();

                if(statusCode != 200) {
                    finalStatusCode = statusCode;
                }

                if(i > 0) {
                    consolidatedResponse += ',\n';
                }
                consolidatedResponse += '{"callout":' + (i+1) + ',"statusCode":' + statusCode + ',"body":' + response.getBody() + '}';

                R4C_API_MessageLogAndAttachment.MessageLogWrapper msgLogWrpr = new R4C_API_MessageLogAndAttachment.MessageLogWrapper();
                msgLogWrpr.SourceAPIName = 'PIC API'; //earlier value PIC YCS3 API
                msgLogWrpr.StatusCode = String.valueOf(statusCode);
                msgLogWrpr.transactionId = transactionId;
                msgLogWrpr.responseBody = consolidatedResponse;
                R4C_API_MessageLogAndAttachment.insertAsync=true;
                R4C_API_MessageLogAndAttachment.CreateMessageLogRecord(msgLogWrpr,true);

                if (statusCode == 200) {
                    lineItemResponseYCS3 responseData = (lineItemResponseYCS3) System.JSON.deserialize(response.getBody(), lineItemResponseYCS3.class);                   
                     System.debug('182'+responseData);
                    finalResponse.addAll(responseData.elements);

                } else if(statusCode >= 2000) {                   
                    throw new AuraHandledException(CONTINUATION_ERROR+CONTACT_ADMIN_INFO);
                } else {                   
                    throw new AuraHandledException(HTTP_REQUEST_ERROR+CONTACT_ADMIN_INFO);
                }             
            }
        }
        catch(exception ex){
            R4C_ErrorRecordServiceWrapperClass err = new R4C_ErrorRecordServiceWrapperClass( 'R4C_PriceAPIYCS3_PICConsumingClass.continuationCallback','Exception Occured',ex,'Integration/API error','',True);           
            R4C_ErrorRecordService errorRec = new R4C_ErrorRecordService();
            errorRec.insertErrorRecord(err);
            //throw new AuraHandledException(CONTACT_ADMIN_INFO+':'+ex.getMessage());
            return new R4C_API_Callout_ResponseHandler().failure('R4C_PriceAPIYCS3_PICConsumingClass.continuationCallback',ex,CONTACT_ADMIN_INFO);
        }
        return new R4C_API_Callout_ResponseHandler().success(JSON.serialize(finalResponse));
        //return  JSON.serialize(finalResponse);
    }
    public class lineItemResponseYCS3 {
        public string name {get;set;}
        public list<creditPriceElementsYCS3> elements {get;set;}

    }
    public class creditPriceElementsYCS3 {
        public string MM {get;set;}
        public string YMSTwoSalesOrg {get;set;}
        public string ZSDPSalesOrg {get;set;}
        public string CustomerSoldToId {get;set;}
        public string CustomerName {get;set;}
        public string CurrentPrice {get;set;}
        public string PriceCondition {get;set;}
        public string ValidFromDate {get;set;}
        public string ValidToDate {get;set;}
    }

    public class PricingAPIYCS3ReqWrapper{
        @AuraEnabled
        public List<String> MMList;
        @AuraEnabled
        public String CMF;
        @AuraEnabled
        public List<String> SalesOrgidList;
        public PricingAPIYCS3ReqWrapper(){
            MMList = new List<String>();
            SalesOrgidList = new List<String>();
            CMF='';
        }
    }
}