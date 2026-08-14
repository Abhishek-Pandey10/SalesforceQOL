//*************************************************************************************************
/*
Class Name  :  R4C_GetWarrentyAPIReqWrapper
Test Class  : R4C_EntAPI_GetWarrentyConsuming_Test
Related Class: R4C_EntAPI_GetWarrentyConsumingClass
Created Date:  12/16/2022
Description : This class is Request Wrapper for get warrenty details - Entitlement API (R4C_EntAPI_GetWarrentyConsumingClass)
Modification Log :
* Developer                 Date                    Description             User Story
* --------------------------------------------------------------------------------------------
* Popcornapps               dec 16 2022
***********************************************************************************************/
public class R4C_GetWarrentyAPIReqWrapper {
  @AuraEnabled
  public String CustomerReturnCaseNumber{get; set;}
  @AuraEnabled
  public String QueryNumber{get; set;}
  @AuraEnabled
  public String ProdUniqueId{get; set;}
  @AuraEnabled
  public String ServiceTypeCode{get; set;}
  @AuraEnabled
  public String ReturnReasonCode{get; set;}
  @AuraEnabled
  public String SalesOrganizationCode{get; set;}
  @AuraEnabled
  public String DistributionChannelCode{get; set;}
  @AuraEnabled
  public String OperationBusinessUnitCode{get; set;}
  @AuraEnabled
  public String SpecCode{get; set;}
  @AuraEnabled
  public String CPN{get; set;} // Added for CPN replacement logic
  @AuraEnabled
  public String ProductFamily{get; set;}
  @AuraEnabled
  public String ProductCode{get; set;}
  @AuraEnabled
  public String MaterialId{get; set;}
  @AuraEnabled
  public String CaseSoldToPartyId{get; set;}
  @AuraEnabled
  public String BillingDate{get; set;}
  @AuraEnabled
  public String ExcludeCattsIndicator{get; set;}
  @AuraEnabled
  public String EntitlementCheckDate{get; set;}
  @AuraEnabled
  public String RemedyTypeCode{get; set;}
  @AuraEnabled
  public String ProfitCenterCode {get;set;} //added as part of IAO
  @AuraEnabled
  public String ItemMarketName {get;set;} //added as part of IAO - Pravallika
}
