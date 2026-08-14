//*************************************************************************************************
/*
Class Name  :  R4C_GetWarrentyAPIResponseWrapper
Test Class  : R4C_EntAPI_GetWarrentyConsuming_Test
Related Class: R4C_EntAPI_GetWarrentyConsumingClass
Created Date:  12/16/2022
Description : This class is Response Wrapper for get warrenty details - Entitlement API (R4C_EntAPI_GetWarrentyConsumingClass)
Modification Log :
* Developer                 Date                    Description             User Story
* --------------------------------------------------------------------------------------------
* Popcornapps               dec 16 2022
***********************************************************************************************/

public class R4C_GetWarrentyAPIResponseWrapper {
    public String QueryNumber {get;set;}
    public String CustomerReturnCaseNumber {get;set;}
    public String ProdUniqueId {get;set;}
    public String ProdUniqueIdTypeCode {get;set;}
    public String VizId {get;set;}
    public String OperationBusinessUnitCode {get;set;}
    public Integer ErrorCode {get;set;}
    public String VizIdStatusCode {get;set;}
    public String EnttlSoldToPartyId {get;set;}
    public String EnttlSoldToPartyName {get;set;}
    public String CaseSoldToPartyId {get;set;}
    public String SoldToPartyMissMatchIndicator {get;set;}
    public String ShipToPartyId {get;set;}
    public String ShipToPartyName {get;set;}
    public String MaterialId {get;set;}
    public String SpecCode {get;set;}
    public String SpecType {get;set;}
    public String CPN {get;set;} // Added for CPN replacement logic
    public String SalesOrganizationCode {get;set;}
    public String DistributionChannelCode {get;set;}
    public String CreditPeriodCount {get;set;}
    public String ProdUniqueIdStatusCode {get;set;}
    public String WarrantyTypeCode {get;set;}
    public String WarrantyPeriodCount {get;set;}
    public String WarrantyMaterialId {get;set;}
    public String RegistrationIndicator {get;set;}
    public String BaseWarrantyStartDate {get;set;}
    public String BaseWarrantyEndDate {get;set;}
    public String ExtendedWarrantyStartDate {get;set;}
    public String ExtendedWarrantyEndDate {get;set;}
    public String DeliveryNoteNumber {get;set;}
    public String ServiceContractNumber {get;set;}
    public String BoxId {get;set;}
    public String ShippedBoxId {get;set;}
    public String FPOLotNumber {get;set;}
    public String BatchId {get;set;}
    public String SourceSystemName {get;set;}
    public String ComponentTypeCode{set;get;}
    public String TraceResult {get;set;}
    public String EntitlementCMFSalesOrganizationCode {get;set;}
    //TWC4621-5474 -EH API channel 03 handling from response Start - SaiRam.
    public String EntitlementCMFDistributionChannelCode {set;get{
        if(EntitlementCMFDistributionChannelCode == '03') {
            return '02';
        }else {
            return EntitlementCMFDistributionChannelCode;
        }
    }}
    //TWC4621-5474 -EH API channel 03 handling from response end - SaiRam.
    public String CountryOfOrigin {get;set;}
    public String ProfitCenterCode {get;set;} //added as part of IAO
    public String ItemMarketName {get;set;} //added as part of IAO - Pravallika
}