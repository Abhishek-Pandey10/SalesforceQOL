/*************************************************************************************************
Class Name          : R4C_BusinessRule_Service
Test Class          : R4C_BusinessRule_ServiceTest
Description         : Service class to use when calling bueinsess rules based on recordtype
Parent Component    : R4c_AG_ViewSummary
Dependent Class     : R4C_POSearchUtil, R4C_ViewSummaryUtil, R4C_EmailService_Selector, R4C_CollectionDetails_Util, R4C_CaseAssignmentEngine, R4C_AG_CollectionDetails_Controller
Last Modified By    : Syed Ahmed
Last Modified Date  : 2024-06-19
Modification Log    :
* Developer                 Date                    Description             User Story
* --------------------------------------------------------------------------------------------
* Popcornapps               Aug 10 2023
***********************************************************************************************/
public without sharing class R4C_BusinessRule_Service {


    //Toggle For IAO - SAIRAM
    public static final Boolean isIAOFlag = Boolean.valueOf(R4C_Generic_Configurations__c.getValues('isIaoFlag').Value__c);

    public static void processBusinessRulesPlatformEventTrigger(List<R4C_Business_Rules_Insert_Event__e> events){
        Integer toInsertCount=0;
        Integer toDeleteCount=0;
        Integer priorityNumber=0;
        String recordTypeId='';
        try{
            List<Sales_Issue_Matrix__c> toInsertRecords=new List<Sales_Issue_Matrix__c>();
            List<Sales_Issue_Matrix__c> toDeleteRecords=new List<Sales_Issue_Matrix__c>();
            for (R4C_Business_Rules_Insert_Event__e event : events) {
                if(event.To_Insert_Matrix_Record_Data__c!=null){
                    Sales_Issue_Matrix__c recordData=(Sales_Issue_Matrix__c) JSON.deserialize(event.To_Insert_Matrix_Record_Data__c,Sales_Issue_Matrix__c.class);
                    System.debug('recordData '+recordData.Sales_Issue_Remedy_Type__c );
                    priorityNumber=(Integer)recordData.Sales_Issue_Rule_Prioritization_Number__c;
                    recordTypeId=recordData.RecordTypeId;
                    toInsertRecords.add(recordData);
                }
                if(event.To_Delete_Matrix_Record_Id__c!=null){
                    // toDeleteRecords.add(new Sales_Issue_Matrix__c(Id=event.To_Delete_Matrix_Record_Id__c));
                }
                if(event.Rule_Priority_Number__c!=null){
                    publishEventToDelete(event);
                  /*  List<Id> matrixRecordIdList= (List<Id>) JSON.deserialize(event.To_Delete_Matrix_Record_Data__c,List<Id>.class);
                    System.debug('matrixRecordIdList===>'+matrixRecordIdList);
                    List<Sales_Issue_Matrix__c> matrixRecordstoDelete = [Select Id from Sales_Issue_Matrix__c where Id IN:matrixRecordIdList];
                    toDeleteRecords.addall(matrixRecordstoDelete);
                    System.debug('matrixRecordIdList===>'+toDeleteRecords);*/
                }
            }
            toInsertCount=toInsertRecords.size();
            System.debug('toInsertRecords '+toInsertRecords);
            if(toInsertRecords.size()>0){
                SObjectAccessDecision securityDecision = Security.stripInaccessible(AccessType.CREATABLE, toInsertRecords);
                if(securityDecision.getRemovedFields().size() > 0) {
                    System.debug('Removed flds--> '+securityDecision.getRemovedFields());
                    throw new ObjectAccessException('Fields inaccessible exception '+ securityDecision.getRemovedFields());
                }
                insert securityDecision.getRecords();       
            }
            /*toDeleteCount=toDeleteRecords.size();
            System.debug('toDeleteCount '+toDeleteCount);
            if(toDeleteRecords.size()>0){
                System.debug('matrixRecordIdList Size====>'+toDeleteRecords.Size());
                delete as USER toDeleteRecords;
                Database.emptyRecycleBin(toDeleteRecords);
                System.debug('matrixRecordIdList Size====>'+toDeleteRecords.Size());
            }*/
        }catch(Exception e){
            System.debug('Error=> '+e.getMessage());
            R4C_API_MatricUpdateInbound.createErrorLog(e,'Insert Request => '+toInsertCount+', Delete Request => '+toDeleteCount+', Rule => '+priorityNumber+', RecordTypeId '+recordTypeId);
        } 
    }

    Private static void publishEventToDelete(R4C_Business_Rules_Insert_Event__e event) {

        try{

            List<Sales_Issue_Matrix__c> toDeleteRecords=[SELECT id FROM Sales_Issue_Matrix__c WHERE Sales_Issue_Rule_Prioritization_Number__c=:event.Rule_Priority_Number__c AND RecordTypeId=:event.Matrix_Record_Type_ID__c
                                                         AND CreatedDate<=:event.Rule_Changed_On__c LIMIT 5001];
            System.debug('Delete QueryCount '+toDeleteRecords.size());
            if(toDeleteRecords.Size()==5001) {
                toDeleteRecords.remove(5000);
                delete as USER toDeleteRecords;
                Database.emptyRecycleBin(toDeleteRecords);
                R4C_Business_Rules_Insert_Event__e eventToInsert = new R4C_Business_Rules_Insert_Event__e();
                eventToInsert.Matrix_Record_Type_ID__c = event.Matrix_Record_Type_ID__c;
                eventToInsert.Rule_Changed_On__c = event.Rule_Changed_On__c;
                eventToInsert.Rule_Priority_Number__c = event.Rule_Priority_Number__c;
                EventBus.publish(eventToInsert);
            }else if(!toDeleteRecords.isEmpty()){
                delete toDeleteRecords;
                Database.emptyRecycleBin(toDeleteRecords);
            }
        }catch(Exception e){}
    }

    /* MATRIX FIELDS */
    /*private final static String MATRIX_FIELDS {set;get {
        if(MATRIX_FIELDS==null) { //Adding Sales_Issue_Return_Location_Plant__r.Location_Plant_Code__c for Malaysia Domestic changes - Samuel
            String fields='Id,CreatedBy.Name,Name,Sales_Issue_Rule_Prioritization_Number__c,Product_Unique_Id_Required_Indicator__c,Item_Required_Indicator__c,Sales_Issue_CPN_Support_Indicator__c,Sales_Issue_Queue__c,Sales_Issue_Agent_Owner__c, ';
            fields+=' Sales_Issue_Customer_CMF__c,Sales_Issue_Customer_CMF__r.Name,Sales_Issue_Customer_Sales_Organization__c,Sales_Issue_Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c,Customer_Disti_Channel__c,Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c, ';
            fields+=' Sales_Issue_Operation_Business_Unit_Code__c,Item_Product_Code__c,Item_Family_Name__c,Sales_Issue_Pending_Indicator__c, ';
            fields+=' Sales_Issue_Service_Type__c,Sales_Issue_Service_Type__r.Sales_Issue_Service_Type_Code__c,Sales_Issue_Remedy_Type__r.Sales_Issue_Remedy_Type_Code__c,Sales_Issue_Remedy_Type__c,Sales_Issue_Customer_Return_Reason__c,';
            fields+=' Sales_Issue_Customer_Return_Reason__r.Sales_Issue_Return_Reason_Code__c,Location_SoldTo_Country__r.Location_Two_Digit_Country_Code__c,Location_SoldTo_Country__c, ';
            fields+=' Sales_Issue_Freight_Payment_Type__c,Sales_Issue_Freight_Payment_Type__r.Name,Location_Country__c,Location_Country__r.Name,Location_Geography__c,Location_Geography__r.Name, ';
            fields+=' Sales_Issue_Return_Location_Plant__c,Sales_Issue_Return_Location_Plant__r.Name,Sales_Issue_Return_Location_Plant__r.Location_Plant_Code__c,Sales_Issue_Item__c,Sales_Issue_Item__r.Name,Sales_Issue_Status__c, ';
            fields+=' Sales_Issue_Inbnd_Shipment_InCo_Term__r.Name,Sales_Issue_Inbnd_Shipment_InCo_Term__c,Sales_Issue_Outbnd_Shipment_InCo_Term__r.Name,Sales_Issue_Outbnd_Shipment_InCo_Term__c,Sales_Issue_Received_Condition__c,Sales_Issue_Received_Condition__r.Name, ';
            fields+=' Sales_Issue_Exceeds_Price__c,Sales_Issue_Exceeds_Quantity__c,Approver_Name__c,Sales_Issue_Approver_Email__c,Sales_Issue_Approver_WWID__c,Sales_Issue_Delegate_Approver_Name__c,Sales_Issue_Delegate_Approver_WWID__c,Sales_Issue_Delegate_Approver_Email__c,Sales_Issue_Delegate_Approve_Valid_From__c,Sales_Issue_Delegate_Approve_Valid_To__c, ';
            fields+=' Sales_Issue_Valid_From__c,Sales_Issue_Valid_To__c,Sales_Issue_MRB_Reference_Number__c';
            MATRIX_FIELDS=fields;
        }
        return MATRIX_FIELDS;
    }}*/
     /**
     * @Author : Accellor
     * Method  : getStringValue
     * Description : Added as part of code optimization.
     * @param   : Map<String,Object> requestMap
     * @param   : String key
     * @return  : List<String> -listItem
    */
    private static List<String> getStringValue(Map<String,Object> requestMap,String key) {
        List<String> listItem= new List<String>();
        if(requestMap.containsKey(key)) {
            String value = (string) requestMap.get(key);
            if(string.isNotBlank(value) && value!=null){
                listItem = new List<String>{value};
            }

        }
        return listItem;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : returnStringTypeValues
    * @param       : List<String> stringTypeValues
    * @return      : List<String>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<String> returnStringTypeValues(List<String> stringTypeValues) {
        List<String> stringTypeVal = new list<String>();
        if(stringTypeValues!=null && stringTypeValues.size()!=0) {
            stringTypeVal = stringTypeValues;
        }
        stringTypeVal.add(null);
        return stringTypeVal;
    }

    static List<Sales_Issue_Matrix__c> ruleProcessPart1(String recordType,string requestData){
        List<Sales_Issue_Matrix__c> saleIssueMatrix = new List<Sales_Issue_Matrix__c>();
        switch on recordType {
            when 'Sales_Issue_Required_Field_Matrix' {
                saleIssueMatrix = salesIssueRequiredFieldFMatrixRT(requestData);
            }
            //TWC4621-1681 - adding support for sales issue return location matri
            when 'Sales_Issue_Return_Location_Matrix' {

                Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);

                Boolean Sales_Issue_Bonded_Zone_Indicator= (Boolean) requestMap.get( 'Sales_Issue_Bonded_Zone_Indicator__c'  );
                List<String> Sales_Issue_Service_Type = getStringValue(requestMap,'Sales_Issue_Service_Type__c');
                List<String> Sales_Issue_Remedy_Type = getStringValue(requestMap,'Sales_Issue_Remedy_Type__c');
                List<String> Sales_Issue_Customer_CMF = getStringValue(requestMap,'Sales_Issue_Customer_CMF__c');
                List<String> Customer_Sales_Organization_Code = getStringValue(requestMap,'Customer_Sales_Organization_Code__c');
                List<String> Customer_Country = getStringValue(requestMap,'Location_Country__c');
                List<String> Location_Plant_Type = getStringValue(requestMap,'Location_Plant_Type__c');
                List<String> Location_Geography = getStringValue(requestMap,'Location_Geography__c');
                saleIssueMatrix = getReturnLocactionMatrix(Sales_Issue_Bonded_Zone_Indicator,Sales_Issue_Service_Type,Sales_Issue_Remedy_Type,Sales_Issue_Customer_CMF,Customer_Sales_Organization_Code,
                Customer_Country,Location_Plant_Type,Location_Geography);
            }
            //TWC4621-1683 - adding support for Sales Issue Freight Determination Matrix
            when 'Sales_Issue_Freight_Determination_Matrix' {
                Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);
                List<String> Sales_Issue_Service_Type = getStringValue(requestMap,'Sales_Issue_Service_Type__c');
                List<String> Sales_Issue_Remedy_Type=getStringValue(requestMap,'Sales_Issue_Remedy_Type__c');
                List<String> Sales_Issue_Customer_Return_Reason = getStringValue(requestMap,'Sales_Issue_Customer_Return_Reason__c');
                List<String> Location_Geography = getStringValue(requestMap,'Location_Geography__c');
                List<String> Customer_Country = getStringValue(requestMap,'Location_Country__c');
                saleIssueMatrix=getFreightDeterminationMatrix(Sales_Issue_Service_Type,Sales_Issue_Remedy_Type,Sales_Issue_Customer_Return_Reason,Customer_Country,Location_Geography);
            }
            //TWC4621-1884 -- adding support for NPR
            when 'Sales_Issue_NPR_Rule_Matrix' {
                saleIssueMatrix=salesIssueNPRRuleMatrix(requestData);
            }
            //adding support for inco term
            when 'Sales_Issue_InCo_Term_Matrix' {
                    Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);
                    List<String> Sales_Issue_Service_Type = getStringValue(requestMap,'Sales_Issue_Service_Type__c');
                    List<String> Sales_Issue_Remedy_Type=getStringValue(requestMap,'Sales_Issue_Remedy_Type__c');
                    List<String> Sales_Issue_Customer_Return_Reason = getStringValue(requestMap,'Sales_Issue_Customer_Return_Reason__c');
                    List<String> Location_Geography = getStringValue(requestMap,'Location_Geography__c');
                    List<String> Customer_Country = getStringValue(requestMap,'Location_Country__c');
                    saleIssueMatrix = getincoTermMatrix(Sales_Issue_Service_Type,Sales_Issue_Remedy_Type,
                    Sales_Issue_Customer_Return_Reason,Customer_Country,Location_Geography);
            }
        }
        return saleIssueMatrix;
    }
    static List<Sales_Issue_Matrix__c> ruleProcessPart2(String recordType,string requestData){
        List<Sales_Issue_Matrix__c> saleIssueMatrix = new List<Sales_Issue_Matrix__c>();
        switch on recordType {
            //TWC1909- addin support for approval matrix
            when 'Sales_Issue_Approval_Matrix' {

                Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);

                List<String> Sales_Issue_Service_Type = getStringValue(requestMap,'Sales_Issue_Service_Type__c');
                List<String> Sales_Issue_Remedy_Type= getStringValue(requestMap,'Sales_Issue_Remedy_Type__c');
                List<String> Sales_Issue_Customer_Return_Reason = getStringValue(requestMap,'Sales_Issue_Customer_Return_Reason__c');
                List<String> Sales_Issue_Customer_CMF = getStringValue(requestMap,'Sales_Issue_Customer_CMF__c');
                List<String> Sales_Issue_Customer_Sales_Organization = getStringValue(requestMap,'Sales_Issue_Customer_Sales_Organization__c');
                List<String> Customer_Disti_Channel = getStringValue(requestMap,'Customer_Disti_Channel__c');
                List<String> Sales_Issue_Operation_Business_Unit_Code = getStringValue(requestMap,'Sales_Issue_Operation_Business_Unit_Code__c');

                Decimal Sales_Issue_Exceeds_Price =Decimal.valueOf((String) requestMap.get('Sales_Issue_Exceeds_Price__c'));
                saleIssueMatrix = getApprovalMatrix(Sales_Issue_Service_Type,Sales_Issue_Remedy_Type,Sales_Issue_Customer_Return_Reason,
                Sales_Issue_Customer_CMF,Sales_Issue_Customer_Sales_Organization,Customer_Disti_Channel,Sales_Issue_Exceeds_Price,Sales_Issue_Operation_Business_Unit_Code);
            }
            //TWC4621-2372 -- adding support for MRB matrix
            when 'Sales_Issue_MRB_Matrix' {
                saleIssueMatrix=salesIssueMRBRuleMatrix(requestData);
            }
            //adding support for case rounting matrix
            when 'Sales_Issue_Geography_To_Queue_Map'{
                Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);
                List<Object> Sales_Issue_Customer_CMF_List = (List<Object>) requestMap.get( 'Sales_Issue_Customer_CMF__c'   );
                List<Object> Location_Geography_List = (List<Object>) requestMap.get(     'Location_Geography__c'  );

                List<String> Sales_Issue_Customer_CMF =new List<String>();
                List<String> Location_Geography =new List<String>();
                for (object o : Sales_Issue_Customer_CMF_List) {
                    Sales_Issue_Customer_CMF.add((String) o);
                }
                for (object o : Location_Geography_List) {
                    Location_Geography.add((String) o);
                }

                saleIssueMatrix=getCaseRoutingMatrix(Sales_Issue_Customer_CMF,Location_Geography);
            }
            //adding support for case pending matrix
            when 'Sales_Issue_Pending_Matrix'{
                saleIssueMatrix=getPendingMatrix(requestData);
            }
            when 'Sales_Issue_NCNR_Matrix' {
                saleIssueMatrix=getNCNRMatrix(requestData);
            }
        }
        return saleIssueMatrix;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getRule
    * @Description : Called From r4c_AG_TechnicalIntakeHelper,  r4c_AG_ViewSummary Lwc
    * @param       : String recordType
    * @param       : string requestData
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    @AuraEnabled
    public static List<Sales_Issue_Matrix__c> getRule(String recordType,string requestData) {

        List<Sales_Issue_Matrix__c> saleIssueMatrix = new List<Sales_Issue_Matrix__c>();
        try {
            saleIssueMatrix.addAll(ruleProcessPart1(recordType,requestData));
            saleIssueMatrix.addAll(ruleProcessPart2(recordType,requestData));
            System.debug('getCpuTime-- '+ System.Limits.getCpuTime() + '-- '+system.Limits.getLimitCpuTime()+
            'getDMLRows-- '+System.Limits.getDMLRows() + '-- '+System.Limits.getLimitDMLRows() +
            'getDmlStatements-- '+ System.Limits.getDmlStatements() + '-- '+System.Limits.getLimitDmlStatements()+
            'getHeapSize-- '+System.Limits.getHeapSize()+ '-- '+ System.Limits.getLimitHeapSize());
        }
        catch(StringException e) {
            throw new AuraHandledException(e.getMessage());
        }
        return saleIssueMatrix;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : salesIssueRequiredFieldFMatrixRT
    * @Description :
    * @param       : String requestData
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> salesIssueRequiredFieldFMatrixRT(String requestData) {
        Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);
        List<String> Sales_Issue_Customer_CMF=getStringValue(requestMap,'Sales_Issue_Customer_CMF__c');

        List<String> Sales_Issue_Service_Type=getStringValue(requestMap,'Sales_Issue_Service_Type__c');
        List<String> Customer_Sales_Organization_Code=getStringValue(requestMap,'Customer_Sales_Organization_Code__c');
        List<String> Sales_Issue_Remedy_Type=getStringValue(requestMap,'Sales_Issue_Remedy_Type__c');
        List<String> Customer_Distribution_Channel_Code =getStringValue(requestMap,'Customer_Distribution_Channel_Code__c');
        List<String> Sales_Issue_Customer_Return_Reason = getStringValue(requestMap,'Sales_Issue_Customer_Return_Reason__c');
        List<String>  Customer_Country =getStringValue(requestMap,'Location_SoldTo_Country__c'); 

        List<Object> Item_Product_Code = (List<Object>) requestMap?.get( 'Item_Product_Code__c'   );
        List<Object> Item_Family_Name = (List<Object>) requestMap?.get(     'Item_Family_Name__c'  );
        List<Object> Sales_Issue_Operation_Business_Unit_Code = (List<Object>) requestMap.get(     'Sales_Issue_Operation_Business_Unit_Code__c' );
        //SaiRam - adding profit center and item market name to replace OPID for IAO
        List<Object> Item_Market_Name = (List<Object>) requestMap.get('Item_Market_Name__c');
        List<Object> Sales_Issue_Profit_Center = (List<Object>) requestMap.get('Sales_Issue_Profit_Center__c');


        List<String> Sales_Issue_Operation_Business_Unit_CodeList = new List<String>();
        List<String> Item_Family_NameList = new List<String>();
        List<String> Item_Product_CodeList = new List<String>();
        List<String> Item_Market_NameList = new List<String>();
        List<String> Profit_Centre_CodeList = new List<String>();

        if (isIAOFlag) {
            for (object itemMarketNm : Item_Market_Name) {
                Item_Market_NameList.add((String) itemMarketNm);
            }
            for (object profitCentre : Sales_Issue_Profit_Center) {
                Profit_Centre_CodeList.add((String) profitCentre);
            }
        }else {
            for (object o : Sales_Issue_Operation_Business_Unit_Code) {
                Sales_Issue_Operation_Business_Unit_CodeList.add((String) o);
            }
            for (object o : Item_Product_Code) {
                Item_Product_CodeList.add((String) o);
            }
        }

        for (object o : Item_Family_Name) {
            Item_Family_NameList.add((String) o);
        }


        return getRequiredFieldMatrix(Sales_Issue_Service_Type,Sales_Issue_Remedy_Type,Sales_Issue_Customer_Return_Reason,
        Sales_Issue_Customer_CMF,Customer_Sales_Organization_Code,Customer_Distribution_Channel_Code,
        Sales_Issue_Operation_Business_Unit_CodeList,Item_Product_CodeList,Item_Family_NameList,Customer_Country,Item_Market_NameList,Profit_Centre_CodeList);
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : salesIssueNPRRuleMatrix
    * @Description :
    * @param       : String requestData
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> salesIssueNPRRuleMatrix(String requestData) {
        Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);
        List<String> Sales_Issue_Customer_CMF=getStringValue(requestMap,'Sales_Issue_Customer_CMF__c');
        List<String> Customer_Sales_Organization_Code=getStringValue(requestMap,'Customer_Sales_Organization_Code__c');
        List<String> Customer_Distribution_Channel_Code =getStringValue(requestMap,'Customer_Distribution_Channel_Code__c');
        List<String> Sales_Issue_Customer_Return_Reason = getStringValue(requestMap,'Sales_Issue_Customer_Return_Reason__c');
        List<String> Customer_Country = getStringValue(requestMap,'Location_Country__c');

        List<Object> Sales_Issue_Operation_Business_Unit_Code =  (requestMap.containsKey('Sales_Issue_Operation_Business_Unit_Code__c'))?(List<Object>) requestMap.get('Sales_Issue_Operation_Business_Unit_Code__c' ):new List<Object>();
        List<Object> Sales_Issue_Item = (requestMap.containsKey('Sales_Issue_Item__c'))?(List<Object>) requestMap.get('Sales_Issue_Item__c' ):new List<Object>();

        //SaiRam - adding profit center and item market name to replace OPID for IAO
        List<Object> Item_Market_Name = (requestMap.containsKey('Item_Market_Name__c'))?(List<Object>) requestMap.get('Item_Market_Name__c' ):new List<Object>(); 
        List<Object> Sales_Issue_Profit_Center = (requestMap.containsKey('Sales_Issue_Profit_Center__c'))?(List<Object>) requestMap.get('Sales_Issue_Profit_Center__c' ):new List<Object>();

        List<String> Sales_Issue_Operation_Business_Unit_CodeList = new List<String>();
        List<String> Item_Market_Name_List = new List<String>();
        List<String> Sales_Issue_Profit_Center_List = new List<String>();

        for (object o : Sales_Issue_Operation_Business_Unit_Code) {
            Sales_Issue_Operation_Business_Unit_CodeList.add((String) o);
        }
        List<String> Sales_Issue_ItemList = new List<String>();
        for (object o : Sales_Issue_Item) {
            Sales_Issue_ItemList.add((String) o);
        }
        for (object o : Item_Market_Name) {
            Item_Market_Name_List.add((String) o);
        }
        for (object o : Sales_Issue_Profit_Center) {
            Sales_Issue_Profit_Center_List.add((String) o);
        }
        return getNoProductReturnMatrix(Sales_Issue_Customer_CMF,Customer_Sales_Organization_Code,Customer_Distribution_Channel_Code,Sales_Issue_ItemList,Sales_Issue_Operation_Business_Unit_CodeList,
        Sales_Issue_Customer_Return_Reason,Customer_Country,Item_Market_Name_List,Sales_Issue_Profit_Center_List);
    }



    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : salesIssueMRBRuleMatrix
    * @Description : TWC4621-2372 -- helper method for MRB Matrix
    * @param       : String requestData
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> salesIssueMRBRuleMatrix(String requestData) {
        Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);
        List<Object> Sales_Issue_Item = (requestMap.containsKey('Sales_Issue_Item__c'))?(List<Object>) requestMap.get('Sales_Issue_Item__c' ):new List<Object>();
        List<String> Sales_Issue_ItemList = new List<String>();
        for (object o : Sales_Issue_Item) {
            Sales_Issue_ItemList.add((String) o);
        }
        return getMRBMatrix(Sales_Issue_ItemList);//splitted into different method to avoid cyclomatic issues
    }


    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getReturnLocactionMatrix
    * @param       : Boolean bondStatus
    * @param       : List<String> serviceTypes
    * @param       : List<String> remedyTypes
    * @param       : List<String> cmfIds
    * @param       : List<String> salesOrgs
    * @param       : List<String> locationCountrys,List<String> plantTypes
    * @param       : List<String> geos
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getReturnLocactionMatrix(Boolean bondStatus,List<String> serviceTypes,List<String> remedyTypes,
    List<String> cmfIds,List<String> salesOrgs,List<String> locationCountrys,List<String> plantTypes,List<String> geos) {
        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();
        List<String> excludePlantLocations = new List<String>{'Not Applicable', R4C_Generic_Configurations__c.getValues('Default_Plant_Location_For_NPR_AND_FAC').value__c};
        final List<String> serviceTypeList = returnStringTypeValues(serviceTypes);
        final List<String> remedyTypeList = returnStringTypeValues(remedyTypes);
        final List<String> cmfIdList = returnStringTypeValues(cmfIds);
        final List<String> salesOrgList = returnStringTypeValues(salesOrgs);
        final List<String> locationCountryList = returnStringTypeValues(locationCountrys);
        final List<String> geographyList = returnStringTypeValues(geos);
        final List<String> plantTypeList=returnStringTypeValues(plantTypes);   
        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Return_Location_Plant__c,Sales_Issue_Return_Location_Plant__r.Name,Sales_Issue_Return_Location_Plant__r.Location_Plant_Code__c ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_Return_Location_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND Sales_Issue_Return_Location_Plant__c!=null AND Sales_Issue_Return_Location_Plant__r.Name NOT IN :excludePlantLocations AND Sales_Issue_Bonded_Zone_Indicator__c =: bondStatus AND ';

        List<String> andConditionList =new List<String>();
        /*  Values that will be allways there
        *   "ServiceTypeCode": "803;805;802;806 ",
            "RemedyTypeCode": "CR ",
            "CustomerId": "541714",
            "SalesOrganizationCode": "AM03",
            "SoldToCountryCode": "AR",
            "Geography": "ASMO",
            "BondedZoneIndicator":false
        */

        //andConditionList.add( ' Sales_Issue_Bonded_Zone_Indicator__c =:bondStatus ');

        andConditionList.add(' Sales_Issue_Service_Type__c IN: serviceTypeList ');
        andConditionList.add(' Sales_Issue_Remedy_Type__c IN: remedyTypeList ');
        andConditionList.add(' Sales_Issue_Customer_CMF__c IN: cmfIdList ');
        andConditionList.add(' Sales_Issue_Customer_Sales_Organization__c IN: salesOrgList ');
        andConditionList.add(' Location_Country__c IN: locationCountryList ');
        andConditionList.add(' Location_Geography__c IN: geographyList ');
     //   andConditionList.add( ' ( Sales_Issue_Collection_Site_Id__r.Sales_Issue_Collection_Site_Id__c IN: CollectionSiteIdList  OR Sales_Issue_Collection_Site_Id__c=null ) ' );


        if(plantTypeList.isEmpty() == false) {
            andConditionList.add(' Sales_Issue_Return_Location_Plant__r.Location_Plant_Type__c IN:plantTypeList ');
        }

        query+=  String.join(andConditionList, 'AND');

        //adding limits
        query+='WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';
            returnResult= database.query(query);

        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getRequiredFieldMatrix
    * @param       : List<String> serviceTypes
    * @param       : List<String> remedyTypes
    * @param       : List<String> returnreasons
    * @param       : List<String> cmfIds
    * @param       : List<String> salesOrgs
    * @param       : List<String> distributionChannels
    * @param       : List<String> opIds
    * @param       : List<String> prodCodes
    * @param       : List<String> prodFamilys
    * @param       : List<String> soldToCountrys
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getRequiredFieldMatrix(List<String> serviceTypes,List<String> remedyTypes,List<String> returnreasons,
    List<String> cmfIds,List<String> salesOrgs,List<String> distributionChannels,List<String> opIds,List<String> prodCodes,List<String> prodFamilys,List<String> soldToCountrys,List<String> profitCentreCodes,List<String> itemMarketNames) {
        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();
        final List<String> serviceTypeList=returnStringTypeValues(serviceTypes);
        final List<String> remedyTypeList=returnStringTypeValues(remedyTypes);
        final List<String> returnreasonList=returnStringTypeValues(returnreasons);

        final List<String> cmfIdList=returnStringTypeValues(cmfIds);
        final List<String> salesOrgList=returnStringTypeValues(salesOrgs);
        final List<String> distributionChannelList=returnStringTypeValues(distributionChannels);
        final List<String> opIdList=returnStringTypeValues(opIds);
        final List<String> prodCodeList=returnStringTypeValues(prodCodes);
        final List<String> soldToCountryList=returnStringTypeValues(soldToCountrys);
        final List<String> prodFamilyList=returnStringTypeValues(prodFamilys);

        final List<String> itemMarketList = returnStringTypeValues(itemMarketNames);
        final List<String> profitCentrecodeList = returnStringTypeValues(profitCentreCodes);

        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Operation_Business_Unit_Code__c,Item_Market_Name__c,Sales_Issue_Profit_Center__c,Item_Family_Name__c,Item_Product_Code__c,Product_Unique_Id_Required_Indicator__c,Sales_Issue_CPN_Support_Indicator__c,Item_Required_Indicator__c ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_Required_Field_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND ';

        List<String> andConditionList =new List<String>();
        /*  Values that will be allways there
        *   Service Type
        *   Remedy Type
        *   Return Reason
        *   CMF ID
        *   Sales Organization
        *   Distribution Channel
        */
        andConditionList.add(' Sales_Issue_Service_Type__c IN: serviceTypeList ');
        andConditionList.add(' Sales_Issue_Remedy_Type__c IN: remedyTypeList ');
        andConditionList.add(' Sales_Issue_Customer_Return_Reason__c IN: returnreasonList ');
        andConditionList.add(' Sales_Issue_Customer_CMF__c IN: cmfIdList ');
        andConditionList.add(' Sales_Issue_Customer_Sales_Organization__c IN: salesOrgList ');
        andConditionList.add(' Customer_Disti_Channel__c IN: distributionChannelList ');
        andConditionList.add(' Location_SoldTo_Country__c IN: soldToCountryList ');
        /*  Values that are optional

        *   Operation Business Unit Code
        *   Product Code
        *   Product Family Name
        *   SoldTo Customer Country
        */

        List<String> orConditionList=new List<String>();

        /*Non Ids*/
        /*if(opIdList.isEmpty() == false) {
            orConditionList.add( ' ( Sales_Issue_Operation_Business_Unit_Code__c IN: opIdList OR Sales_Issue_Operation_Business_Unit_Code__c=null )  ' );
        }
        else {
            orConditionList.add( ' (  Sales_Issue_Operation_Business_Unit_Code__c=null )  ' );
        }
        if(prodCodeList.isEmpty() == false) {
            orConditionList.add( ' ( Item_Product_Code__c IN: prodCodeList OR Item_Product_Code__c=null ) ' );
        }
        else {
            orConditionList.add( ' ( Item_Product_Code__c=null ) ' );
        }
        if(prodFamilyList.size()>0) {
            orConditionList.add( ' ( Item_Family_Name__c IN: prodFamilyList OR Item_Family_Name__c=null ) ' );
        }
        else {
            orConditionList.add( ' ( Item_Family_Name__c=null ) ' );
        }*/
        if(!isIAOFlag) {
            orConditionList.add(' Item_Product_Code__c IN: prodCodeList ');
            orConditionList.add(' Sales_Issue_Operation_Business_Unit_Code__c IN: opIdList ');
        }else {
            orConditionList.add(' Item_Market_Name__c IN: itemMarketList ');
            orConditionList.add(' Sales_Issue_Profit_Center__c IN:profitCentrecodeList  ');
        }
        orConditionList.add(' Item_Family_Name__c IN: prodFamilyList ');
        query+=  String.join(andConditionList, 'AND');

        if(orConditionList.size()>0) {
            query+=' AND ';
            query+= ' ( '+String.join(orConditionList, 'OR')+' ) ';
        } 
        //adding limits
        query+='WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';
       system.debug('476-- '+query);
            returnResult= database.query(query);
        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getFreightDeterminationMatrix
    * @param       : List<String> serviceTypes
    * @param       : List<String> remedyTypes
    * @param       : List<String> returnreasons
    * @param       : List<String> locationCountrys
    * @param       : List<String> geos
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getFreightDeterminationMatrix(List<String> serviceTypes,List<String> remedyTypes,List<String> returnreasons,
    List<String> locationCountrys,List<String> geos) {
        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();

        final List<String> serviceTypeList = returnStringTypeValues(serviceTypes);
        final List<String> remedyTypeList = returnStringTypeValues(remedyTypes);
        final List<String> returnreasonList = returnStringTypeValues(returnreasons);
        final List<String> locationCountryList = returnStringTypeValues(locationCountrys);
        final List<String> geographyList = returnStringTypeValues(geos);
        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Freight_Payment_Type__c,Sales_Issue_Freight_Payment_Type__r.Name,Sales_Issue_Freight_Payment_Type__r.Id ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_Freight_Determination_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND ';     
        List<String> andConditionList =new List<String>();
        /*  Values that will be allways there
        *   Service Type
        *   Remedy Type
        *   Return Reason
        *   Country
        *   Geo
        */
        andConditionList.add(' Sales_Issue_Service_Type__c IN: serviceTypeList ');
        andConditionList.add(' Sales_Issue_Remedy_Type__c IN: remedyTypeList ');
        andConditionList.add(' Sales_Issue_Customer_Return_Reason__c IN: returnreasonList ');
        andConditionList.add(' Location_Country__c IN: locationCountryList ');
        andConditionList.add(' Location_Geography__c IN: geographyList ');
        query+=  String.join(andConditionList, 'AND');     
        //adding limits
        query+=' WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';
            returnResult= database.query(query);
        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getNoProductReturnMatrix
    * @param       : List<String> cmfIds
    * @param       : List<String> salesOrgs
    * @param       : List<String> distributionChannels
    * @param       : List<String> mmids,List<String> opIds
    * @param       : List<String> returnreasons
    * @param       : List<String> locationCountrys
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getNoProductReturnMatrix(List<String> cmfIds,List<String> salesOrgs,List<String> distributionChannels,
    List<String> mmids,List<String> opIds,List<String> returnreasons,List<String> locationCountrys,List<String> itemMarketNames,List<String> profitCentrecodes) {

        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();
        final List<String> cmfIdList = returnStringTypeValues(cmfIds);
        final List<String> salesOrgList = returnStringTypeValues(salesOrgs);
        final List<String> distributionChannelList = returnStringTypeValues(distributionChannels);
        final List<String> mmidList = returnStringTypeValues(mmids);
        final List<String> opIdList = returnStringTypeValues(opIds);
        final List<String> returnreasonList = returnStringTypeValues(returnreasons);
        final List<String> locationCountryList = returnStringTypeValues(locationCountrys);
        final List<String> profitCentreCodeList = returnStringTypeValues(profitCentrecodes);
        final List<String> itemMarketNameList = returnStringTypeValues(itemMarketNames);


        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Operation_Business_Unit_Code__c,Item_Market_Name__c,Sales_Issue_Profit_Center__c,Sales_Issue_Item__c,Sales_Issue_Item__r.Name ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_NPR_Rule_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND ';
        List<String> andConditionList = new List<String>();
        List<String> orConditionList=new List<String>();
        andConditionList.add(' Sales_Issue_Customer_CMF__c IN: cmfIdList ');
        andConditionList.add(' Sales_Issue_Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c IN: salesOrgList ');
        andConditionList.add(' Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c IN: distributionChannelList ');
        andConditionList.add(' Sales_Issue_Item__r.Name IN: mmidList ');
        andConditionList.add(' Sales_Issue_Customer_Return_Reason__c IN: returnreasonList ');
        andConditionList.add(' Location_Country__c IN: locationCountryList '); 

        if (isIAOFlag) {
            orConditionList.add(' Sales_Issue_Profit_Center__c IN: profitCentreCodeList ');
            orConditionList.add(' Item_Market_Name__c IN: itemMarketNameList ');
        }else {
            andConditionList.add(' Sales_Issue_Operation_Business_Unit_Code__c IN: opIdList ');
        }
        query+=  String.join(andConditionList, 'AND');

        if(orConditionList.size()>0) {
            query+=' AND ';
            query+= ' ( '+String.join(orConditionList, 'OR')+' ) ';
        } 
        //adding limits
        query+='WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';     
            returnResult= database.query(query);
        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getincoTermMatrix
    * @param       : List<String> serviceTypes
    * @param       : List<String> remedyTypes
    * @param       : List<String> returnreasons
    * @param       : List<String> locationCountrys
    * @param       : List<String> geos
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getincoTermMatrix(List<String> serviceTypes,List<String> remedyTypes,List<String> returnreasons,
    List<String> locationCountrys,List<String> geos) {
        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();

        final List<String> serviceTypeList = returnStringTypeValues(serviceTypes);
        final List<String> remedyTypeList = returnStringTypeValues(remedyTypes);
        final List<String> returnreasonList = returnStringTypeValues(returnreasons);
        final List<String> locationCountryList = returnStringTypeValues(locationCountrys);
        final List<String> geographyList = returnStringTypeValues(geos);

        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Inbnd_Shipment_InCo_Term__c,Sales_Issue_Inbnd_Shipment_InCo_Term__r.Name,Sales_Issue_Inbnd_Shipment_InCo_Term__r.Id ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_InCo_Term_Matrix\'  AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND ';

        List<String> andConditionList =new List<String>();
        /*  Values that will be allways there
        *   Service Type
        *   Remedy Type
        *   Return Reason
        *   Country
        *   Geo
        */
        andConditionList.add(' Sales_Issue_Service_Type__c IN: serviceTypeList ');
        andConditionList.add(' Sales_Issue_Remedy_Type__c IN: remedyTypeList ');
        andConditionList.add(' Sales_Issue_Customer_Return_Reason__c IN: returnreasonList ');
        andConditionList.add(' Location_Country__c IN: locationCountryList ');
        andConditionList.add(' Location_Geography__c IN: geographyList ');

        query+=  String.join(andConditionList, 'AND');

        //adding limits
        query+=' WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';

        returnResult= database.query(query);

        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getApprovalMatrix
    * @param       : List<String> serviceTypes
    * @param       : List<String> remedyTypes
    * @param       : List<String> returnreasons
    * @param       : List<String> cmfs
    * @param       : List<String> salesOrg
    * @param       : List<String> distiChannels
    * @param       : Decimal price
    * @param       : List<String> OperationBusinessUnitCode
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getApprovalMatrix(List<String> serviceTypes,List<String> remedyTypes,List<String> returnreasons,
    List<String> cmfs,List<String> salesOrg,List<String> distiChannels,Decimal price,List<String> OperationBusinessUnitCode) {

        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();

        final List<String> serviceTypeList = returnStringTypeValues(serviceTypes);
        final List<String> remedyTypeList = returnStringTypeValues(remedyTypes);
        final List<String> returnreasonList = returnStringTypeValues(returnreasons);
        final List<String> cmfList = returnStringTypeValues(cmfs);
        final List<String> salesOrgList = returnStringTypeValues(salesOrg);
        final List<String> distiChannelList = returnStringTypeValues(distiChannels);     
        final List<String> OperationBusinessUnitCodeList = returnStringTypeValues(OperationBusinessUnitCode);
        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Exceeds_Quantity__c,Sales_Issue_Approver_Email__c,';
        query+='Sales_Issue_Delegate_Approver_Email__c,Sales_Issue_Delegate_Approve_Valid_From__c,Sales_Issue_Delegate_Approve_Valid_To__c,Approver_Name__c ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_Approval_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND Sales_Issue_Exceeds_Quantity__c>=0 AND Sales_Issue_Exceeds_Price__c <=:price AND ';

        List<String> andConditionList =new List<String>();
        /*  Values that will be allways there
        *   Service Type
        *   Remedy Type
        *   Return Reason
        *   
        */
        andConditionList.add(' Sales_Issue_Service_Type__c IN: serviceTypeList ');
        andConditionList.add(' Sales_Issue_Remedy_Type__c IN: remedyTypeList ');
        andConditionList.add(' Sales_Issue_Customer_Return_Reason__c IN: returnreasonList ');
        andConditionList.add(' Sales_Issue_Customer_CMF__c IN: cmfList ');
        andConditionList.add(' Sales_Issue_Customer_Sales_Organization__c IN: salesOrgList ');
        andConditionList.add(' Customer_Disti_Channel__c IN: distiChannels ');   
        query+=  String.join(andConditionList, 'AND');

        //adding limits
        query+=' WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';
            returnResult= database.query(query);
        return returnResult;

    }

    //TWC4621-2372 -- helper method for MRB Matrix
    private static List<Sales_Issue_Matrix__c> getMRBMatrix(List<String> mmIds) {
        List<Sales_Issue_Matrix__c> returnResult = new List<Sales_Issue_Matrix__c>();
        //final List<String> mmidList = returnStringTypeValues(mmIds);
        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Item__c,Sales_Issue_Item__r.Name,Sales_Issue_MRB_Reference_Number__c,Sales_Issue_Valid_To__c,Sales_Issue_Valid_From__c ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_MRB_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND  ';

        List<String> andConditionList = new List<String>();
        andConditionList.add( ' ( Sales_Issue_Item__r.Name IN: mmIds ) ' );   
        query+=  String.join(andConditionList, 'AND');
        //adding limits
        query+='WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';

            returnResult= database.query(query);

        return returnResult;
    }

    //TWC4621-2372 -- helper method for Case Rounting
    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getCaseRoutingMatrix
    * @param       : List<String> cmfs
    * @param       : List<String> geos
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getCaseRoutingMatrix(List<String> cmfs,List<String> geos ) {
        List<Sales_Issue_Matrix__c> returnResult = new List<Sales_Issue_Matrix__c>();

        final List<String> cmfList = returnStringTypeValues(cmfs);
        final List<String> geographyList = returnStringTypeValues(geos);

        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Customer_CMF__c,Location_Geography__c,Sales_Issue_Queue__c,Sales_Issue_Agent_Owner__c ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_Geography_To_Queue_Map\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND  ';

        List<String> andConditionList = new List<String>();
        andConditionList.add(' Sales_Issue_Customer_CMF__c IN: cmfList ');
        andConditionList.add(' Location_Geography__c IN: geographyList ');
        query+=  String.join(andConditionList, 'AND');
        //adding limits
        query+='WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';

            returnResult= database.query(query);

        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getPendingMatrix
    * @param       : string requestData
    * @return      : List<Sales_Issue_Matrix__c>
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getPendingMatrix(string requestData){
        List<Sales_Issue_Matrix__c> returnResult=new List<Sales_Issue_Matrix__c>();
        Map<String, Object> requestMap = (Map<String, Object>) JSON.deserializeUntyped(requestData);     
        List<String> serviceTypeList = returnStringTypeValues(getStringValue(requestMap,'Sales_Issue_Service_Type__c'));
        List<String> remedyTypeList= returnStringTypeValues(getStringValue(requestMap,'Sales_Issue_Remedy_Type__c'));
        List<String> salesOrgList = returnStringTypeValues(getStringValue(requestMap,'Sales_Issue_Customer_Sales_Organization__c'));
        List<String> returnreasonList = returnStringTypeValues(getStringValue(requestMap,'Sales_Issue_Customer_Return_Reason__c'));
        List<String> cmfList = returnStringTypeValues(getStringValue(requestMap,'Sales_Issue_Customer_CMF__c'));
        List<String> plantLocationList = returnStringTypeValues(getStringValue(requestMap,'Sales_Issue_Return_Location_Plant__c'));
        List<Object> Item_Product_Code = (List<Object>) requestMap.get( 'Item_Product_Code__c'   );
        List<Object> Sales_Issue_Received_Condition = (List<Object>) requestMap.get(     'Sales_Issue_Received_Condition__c'  );
        List<Object> Sales_Issue_Operation_Business_Unit_Code = (List<Object>) requestMap.get(     'Sales_Issue_Operation_Business_Unit_Code__c'  );

        List<Object> Item_Market_Name = (List<Object>) requestMap.get('Item_Market_Name__c');
        List<Object> Sales_Issue_Profit_Center = (List<Object>) requestMap.get('Sales_Issue_Profit_Center__c');


        List<String> productCodeList =new List<String>();
        List<String> recivedConditionList =new List<String>();
        List<String> operationBusinessUnitCodeList =new List<String>();

        //SaiRam - Added profit centre and Item market name to replace OPID as part of IAO - TWC4621-5330
        List<String> profitCentreCodeList = new List<String>();
        List<String> ItemMarketList = new List<String>();


        if(Item_Product_Code!=null){
            for (object o : Item_Product_Code) {
                productCodeList.add((String) o);
            }
        }
        productCodeList.add(null);
        if(Sales_Issue_Received_Condition!=null){
            for (object o : Sales_Issue_Received_Condition) {
                recivedConditionList.add((String) o);
            }
        }
        recivedConditionList.add(null);

        if(Sales_Issue_Operation_Business_Unit_Code!=null){
            for (object o : Sales_Issue_Operation_Business_Unit_Code) {
                operationBusinessUnitCodeList.add((String) o);
            }
        }
        operationBusinessUnitCodeList.add(null);

        if(Item_Market_Name!=null){
            for (object itemMarketName : Item_Market_Name) {
                ItemMarketList.add((String) itemMarketName);
            }
        }
        ItemMarketList.add(null);
        if(Sales_Issue_Profit_Center!=null){
            for (object profitCentre: Sales_Issue_Profit_Center) {
                profitCentreCodeList.add((String) profitCentre);
            }
        }
        profitCentreCodeList.add(null);
        String query='SELECT Id,Sales_Issue_Rule_Prioritization_Number__c,Sales_Issue_Pending_Indicator__c,Sales_Issue_Received_Condition__c,Item_Product_Code__c,Sales_Issue_Operation_Business_Unit_Code__c,Item_Market_Name__c,Sales_Issue_Profit_Center__c,';
        query+='Sales_Issue_Customer_Sales_Organization__c,Sales_Issue_Service_Type__c,Sales_Issue_Remedy_Type__c,Sales_Issue_Customer_Return_Reason__c,Sales_Issue_Customer_CMF__c,Customer_Disti_Channel__c,Sales_Issue_Return_Location_Plant__c ';
        query+=' FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName=\'Sales_Issue_Pending_Matrix\' AND Sales_Issue_Active_Indicator__c=true AND Sales_Issue_Valid_From__c <= TODAY AND Sales_Issue_Valid_To__c >=TODAY AND ';

        List<String> andConditionList =new List<String>();
        List<String> orConditionList=new List<String>();
        /*  Values that will be allways there
        *   Service Type
        *   Remedy Type
        *   Return Reason
        *   
        */
        andConditionList.add(' Sales_Issue_Service_Type__c IN: serviceTypeList ');
        andConditionList.add(' Sales_Issue_Remedy_Type__c IN: remedyTypeList ');
        andConditionList.add(' Sales_Issue_Customer_Sales_Organization__c IN: salesOrgList ');
        andConditionList.add(' Sales_Issue_Customer_Return_Reason__c IN: returnreasonList ');
        andConditionList.add(' Sales_Issue_Customer_CMF__c IN: cmfList ');
        andConditionList.add(' Sales_Issue_Return_Location_Plant__c IN: plantLocationList ');
        if(!isIAOFlag) {
            andConditionList.add(' Item_Product_Code__c IN: productCodeList ');
            andConditionList.add(' Sales_Issue_Operation_Business_Unit_Code__c IN: operationBusinessUnitCodeList ');
        }else {
            orConditionList.add(' Sales_Issue_Profit_Center__c IN: profitCentreCodeList ');
            orConditionList.add(' Item_Market_Name__c IN: ItemMarketList ');
        }   
        andConditionList.add(' Sales_Issue_Received_Condition__c IN: recivedConditionList ');
        query+=  String.join(andConditionList, 'AND');

        if(orConditionList.size()>0) {
            query+=' AND ';
            query+= ' ( '+String.join(orConditionList, 'OR')+' ) ';
        } 
        //adding limits
        query+='WITH USER_MODE ORDER BY Sales_Issue_Rule_Prioritization_Number__c ASC NULLS LAST LIMIT 4000';

        returnResult= database.query(query);
        return returnResult;
    }

    /* ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    * Method       : getNCNRMatrix
    * @param       : string requestData
    * @return      : List<Sales_Issue_Matrix__c>
    * @description : To retrieve NCNR Matrix data , added as part of IAO
    * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    */
    private static List<Sales_Issue_Matrix__c> getNCNRMatrix(String requestData) {
        Map<String, Object> requestMap = (Map<String,Object>) JSON.deserializeUntyped(requestData);
        List<String> productStatusList = new List<String>();
        List<String> customIndicatorList = new List<String>();
        List<Object> productStatusCodes = (List<Object>) requestMap.get('Product_Status_code_c');
        for(object productStatusCode : productStatusCodes) {
            productStatusList.add((String) productStatusCode);
        }
        if(requestMap.get('Item_Custom_Indicator__c') != null) {
            List<Object> customIndicatorValues = (List<Object>) requestMap.get('Item_Custom_Indicator__c');
            for(object customIndicator : customIndicatorValues) {
                customIndicatorList.add((String) customIndicator);
            }
        }
        List<Sales_Issue_Matrix__c> ncnrMatrixList = [SELECT Id,Product_Status_Code__c,Item_Custom_Indicator__c,NCNR_Flag__c FROM Sales_Issue_Matrix__c WHERE RecordType.DeveloperName = 'Sales_Issue_NCNR_Matrix' AND (Product_Status_Code__c IN:productStatusList OR Item_Custom_Indicator__c IN:customIndicatorList OR Item_Custom_Indicator__c=null) AND Order_Confirmation_Flag__c = true AND NCNR_Flag__c = true];  // Added order confirmation flag as part of TWC4621-5475
        return ncnrMatrixList;
    }
}