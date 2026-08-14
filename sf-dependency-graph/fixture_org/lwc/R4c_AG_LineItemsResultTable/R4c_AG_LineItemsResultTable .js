/* eslint-disable @lwc/lwc/no-api-reassignments */
/* eslint-disable @lwc/lwc/no-async-operation */
import { LightningElement, api, track, wire } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent"; // Show toast messages
import { NavigationMixin } from "lightning/navigation";
import saveCase from "@salesforce/apex/R4C_AG_ViewSummaryController.saveCase"; // Call Apex Class method for view and summary
import updateECCLineItem from "@salesforce/apex/R4C_AG_ViewSummaryController.updateECCLineItem";
import updateECCLineItemStatus from "@salesforce/apex/R4C_AG_ViewSummaryController.updateECCLineItemStatus";
import LightningAlert from "lightning/alert";
import LightningConfirm from "lightning/confirm";
import r4c_CustomLabels from "c/r4c_CustomLabels";
// TWC4621-912 - Furqan - 16-01-2023 - TI Process Apex Callouts
import getCrrDetails from '@salesforce/apex/R4C_AG_DetailPage_CaseHeader_Controller.getCsirRecord';
//Start -- Prashant -- Bug Fixes -- Adding CaseNumber on Successfull case creation toast message -- End 
import r4c_CX_NPRConsentModel from 'c/r4c_CX_NPRConsentModel';
import r4c_AG_ExchangeWarrantyCheck from 'c/r4c_AG_ExchangeWarrantyCheck';
import sendEmailToCQE from '@salesforce/apex/R4C_SendEmailToCQE.sendEmail';
import updateLineItemStatus from '@salesforce/apex/R4C_AG_ViewSummaryController.updateLineItemStatus';
import { gql, graphql } from "lightning/uiGraphQLApi";
import { StringFormatter } from 'c/r4c_stringFormatter';
import getMatrixRecord from "@salesforce/apex/R4C_BusinessRule_Service.getRule";
import { getApexDateString, MMCPNAPIcheck, POsearchAPI, popuplateLineItemPopupData } from "c/r4c_AG_LineItemsResultTableUtill";

import {
    tecnincalIntakeButtons,
    technicalIntakeTable,
    validateWarranty,
    validateCEP,
    fetchCreditPrice,
    warrentyCheckNextHandler,
    poHistoryCheckNextHandler,
    creditPriceNextHandler,
    backToWarrentyChekScreenHandler,
    backToPOHistoryCheckScreenHandler,
    checkRequiredMatrix,
    productValidateNextHandlerTechnical,
    invokeCustomValidationElement,
    invokeRefreshRowElement //Samuel

} from "c/r4c_AG_TechinalIntakeHelper";

import {
    productValidateNextHandler,
    poHistoryHandler,
    getLOEDatesHandler,
    creditPriceNextBtnHandler,
    getCreditPriceHandler,
    allowMatrixNextBtnHandler,
    calculateAmmount,
    handleBackClickToLOE
} from "c/r4c_AG_StockRotationHelper";

// Tushar ---- ExceptionIntake	
import {
    poHistoryHandlerExp,
    creditPriceExpNextBtnHandler,
    fetchCreditPriceException
} from "c/r4c_AG_ExceptionIntakeHelper";

import {
    validateMRB, mrbRefNumberCheckNextHandler, warrentyScreenNextHandler,
    backToMRBRefNumberScreenHandler
} from "c/r4c_AG_QualityIntakeHelper";
const RECORDS_PER_PAGE = 50;

export default class R4c_AG_LineItemsResultTable extends NavigationMixin(
    LightningElement
) {

    /* --------- Variables Start------------*/
    PRICE_MASK_STRING = r4c_CustomLabels.PRICE_MASK_STRING;
    PAGE_COORDINATES = r4c_CustomLabels.PAGE_COUNTER;
    disableSaveForLater = true; //For disabling Save for later button in PO search screen
    firstTimeValidate = true; //After serch Go to Next Screen to Validate LOE Dates

    isFirstTime = true; // Set the value of poSearchData
    showAllowMatrixNextBtn = false; // This var show AllowMatrix Next Btn
    isCreditPriceValidateion = true; // This var check the Credit Price Validateion
    isMatrixStage = false; // This var check the Matrix Stage
    poSearchWithMatrixData = []; // store the po Search Matrix Data
    poSearchWithMatrixDataToSubmit = [];
    showLineItemStatusField = false; //added by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
    labels = r4c_CustomLabels.labels; //Assigning custom labels to variable
    hideReturnToProductButton = false;

    lineStatusbasedonCaseStatus = "";//TWC4621-1223- 24/04/23 - Accellor
    caseNumber;
    netcreditprice;//Samuel 8.5.23
    isDisablePoHistoryBTN = true;
    showReturnToProductValidateBtn = false;
    validateCreditPrice = false;
    creditPriceNextBTN = true;
    nextButtonForsubmit = true;
    disableSubmitCalculateBtn = false;
    showSpinner = false;
    enableSearchPONextBTN = true;
    saveAndViewSummaryExp = false;// this will enable and disable the save and view summary button
    creditPriceCheck = false;

    @api isECCLineItemEdit = false; //true only if want to edit only ecc line items
    @api isUserPriceMasked = false;
    @api isPortal = false;
    @api caseType;
    @api requestdetails; // Getting shipping details and collection details from parent component
    @api caserec;
    @api genericMessages;
    @api posearchdetails;
    @api casemode;
    @api currentSearchStep;
    @api searchByParent = "";//TWC4621-801 --Tushar Garg --- This variable is store the value of selected step
    @api isEmailOnLoad = false; //E2C
    @api lastSavedPath; //To hold the last saved path
    @api isEmulatedUser;//TWC4621-2010 -- Manohar -- If the login user is Emulated User, Restrict the Save functionality
    @track poSearchToProductValidateData = [];
    @track poSearchData = []; // Store poSearchData in this variable to show it on DataTable
    @track selectedPo = []; // Store Selected Po Id in this variable
    @track customerReturnRequestLine = {}; // Wrapper to store Customer line items
    @track filteredPoSearchData; // Store the value of filtered PO Records
    @track poSearchOldData = []; //Store the value of old Po Search Data , Because we need it on back button
    @track poSearchNewData = []; //Store the value of new Po Search Data
    @track poSearchOldTiData = []; // store value of warrenty screen elements
    @track poSearchWithLOEData = []; //Store the value of  Po Search Data with LOE Date
    @track poSearchWithLOETOShowData = []; //Store the value of  Po Search  with LOE Date
    @track selectedMMIDForCreditPrice = []; //Store the value of  Po Search Data with CreditPrice
    @track backStage = ""; //Store the value of  Back Stage
    @track isPCNDateAvailable = false; // Check PCN Date Available or not
    @track showProductValidateBtn = false; // show Product Validate
    @track showProductValidateNextBtn = true; // show Product Validate Next Button
    @track showCreditPriceNextBtn = false; // show Credit Price Next Button
    @track showProductValidateBTNDisable = true; //Disable Product Validate BTN
    @track showCreditPriceBTNDisable = true; //Disable Credit Price BTN
    @track selectedInvoiceNum = []; // Store selected Invoice Num
    @track showViewSummary = false; // This var show the view summary button
    @track returnRequestDetails; //stores the value of collection and shipping details passing from parent
    @track allselectedcheckbox = false;
    @track lineData; //To hold the line items data fetched from the case in edit scenario
    @track showProductValidateBackBtn; //To display the back button of product validation
    @track showToastBar = false; //boolean variable to display the credit price validation toast message
    @track type; //Variable which hold the type of toast message
    @track message; //Variable which hold the info message of credit price validation
    @track lineItemSearchData = []; // New variable for lineItem Search Data
    @track isPOHistoryValidated = false; // This variable store the value if we click on PO History or not
    @track tecnincalIntakeButtons = tecnincalIntakeButtons;
    @track technicalIntakeTable = technicalIntakeTable;
    @track existingDataException = [];
    @track disableAllSelectCheckbox = false;
    // @track isFailedLine = false;
    @track disabledLines = [];
    extendedWarrantyLines;
    @api internalCustomerFlow = false;
    @api isUcdoff; // TWC777-2688 -  CIM EOL - PO History API Changes - Shipra
    //isUCDoff = false;
    @api ispsgcase = false; //PSG Changes - Samuel
    cpnmissingcount = 0;
    showDuplicateMM = false;
    MMCPNApiRes = [];
    @track pagination = {

        currentPage: 1,
        uiIndStart: 1,
        totalPages: 0,
        indStart: 0,
        indEnd: 0,
        totalRecords: 0,
        get isFirstPage() {
            return this.currentPage == 1
        },
        get isLastPage() {
            return this.currentPage == this.totalPages;
        }
    }
    @track poHistoryBTN = {
        isSearchStep:
            this.currentSearchStep === "Product" ||
                this.currentSearchStep === "Bulk Upload"
                ? true
                : false,
        nextBTN: true,
        saveForLatter: true
    };

    /* --------- Variables End------------*/

    /*Fetching Box Condition based on ServiceType*/
    @track receiptConditions = [];
    @wire(graphql, {
        query: gql`
    query getBoxConditions ($serviceTypeId: ID){
        uiapi {
              query {
                Item_Service_Type_And_Receipt_Cndn_Assn__c (where: { 
                    Sales_Issue_Service_Type__c: { eq: $serviceTypeId },Sales_Issue_Active_Indicator__c : {eq : true} }){
                        edges {
                            node {
                              Id
                              Sales_Issue_Receipt_Condition__c {
                                  value
                              }
                              Sales_Issue_Receipt_Condition__r {
                                Name {
                                  value
                                }
                              }
                        }
                    }
                }
              }
            }
          }
        `,
        variables: "$graphQlVariables"
    })
    wiredBoxConditionQuery(result) {

        this.receiptConditions = [];
        if (result.data) {
            const boxConditionDetails = result.data.uiapi?.query?.Item_Service_Type_And_Receipt_Cndn_Assn__c?.edges;
            if (boxConditionDetails?.length > 0) {
                boxConditionDetails.forEach(rec => {
                    if (rec?.node?.Sales_Issue_Receipt_Condition__r?.Name?.value) {
                        this.receiptConditions.push({
                            label: rec?.node?.Sales_Issue_Receipt_Condition__r?.Name?.value,
                            value: rec?.node?.Sales_Issue_Receipt_Condition__r?.Name?.value
                        })
                    }
                })
            }

        } else if (result.errors) {
            console.error('error ', result?.errors)
        }
    }
    get graphQlVariables() {
        return {
            serviceTypeId: this.requestdetails?.Sales_Issue_Service_Type__c,
        };
    }

    rendered = false;
    renderedCallback() {
        if (this.rendered) return;
        this.applyStyle();

    }
    get legendTextStyle() {
        if (this.isPortal) {
            return 'vertical-align: middle; font-size: .6em;';
        }
        return 'vertical-align: middle;'
    }

    get iconZoomlevel() {
        if (this.isPortal) {
            return 'zoom: 64%;padding-top: 4px;padding-left: 1%;padding-right: 1%;';
        }
        return 'zoom: 73%;'

    }
    applyStyle() {
        const style = document.createElement('style');
        style.innerText = `
        .design.orange-icon svg{
          fill:#fe9339;
        }
        .design.my-icon svg{
          fill:#0176D3
        }
        `;
        //applying styles dynmicaly to shadow dom elements
        let inputs = this.template.querySelectorAll('span.inputDesign');

        for (let div of inputs) {
            div.appendChild(style);
            this.rendered = true;
        }

    }
    //Start -- Help Text Messages in table component , Based on the buttons displaying the help text messages to users -- Manohar
    get tableHelpTextMessage() {
        //
        //console.log('273error',JSON.stringify(this?.poSearchData))
        //
        this?.poSearchData.forEach((item) => {
            if (item.Error != undefined || item.Error != null || item.productStatus === false) {
                this.disabledLines.push(item);
                //console.log('290error',JSON.stringify(this?.disabledLines))       
            }
        })
        if (this?.poSearchData.every(data => data.productStatus === false || data.Error)) { //displaying All_Rows_Disabled_ErrorMsg when all line items are invalid
            this.disableAllSelectCheckbox = true;
            this.allselectedcheckbox = false;
            return this.labels.All_Rows_Disabled_ErrorMsg;
        } else {
            this.disableAllSelectCheckbox = false;
        }
        if (!this?.poSearchData.some(data => data.selected)) { //displaying No_Row_Selected_Msg when user doesn't selects a single record
            return this.labels.No_Row_Selected_Msg;
        }

        switch (this.backStage) {
            case '':
            case undefined:
            case this.genericMessages.step_zero:
                if (this.showTecnicalIntakeBtn) { //this condition will execute when service type is Quality or Technical or Exception Intake(NPR credit,Repair)
                    return this.disableSearchPONextBTN ? this.labels.No_Row_Selected_Msg : StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later);
                }
                if (this.showExceptionIntakeBtn) { //this condition will execute when service type is Exception Intake(credit) or Admin intake
                    return this.getHistoryButton && !tecnincalIntakeButtons.disableValidatePoHistoryBtn ? StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.PO_History) : StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later);
                }
                if (this.caseType.isStockRotation()) { //Stock Rotation Intake
                    return this.getHistoryButton && !this.disableGetHistoryButton ? StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.PO_History) : StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later);
                }
                break;
            case this.genericMessages.step_one:
                if (this.showTecnicalIntakeBtn) {
                    if (!this.caseType.isTechnicalExchange()) {
                        return tecnincalIntakeButtons.disableValidateWarrentyBtn ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Warranty_Entitlement_Check);
                    }
                    return tecnincalIntakeButtons.disableValidateWarrentyBtn ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Save_and_View_Summary) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Warranty_Entitlement_Check);
                }
                if (this.showExceptionIntakeBtn) {
                    return tecnincalIntakeButtons.disableValidatePriceCheckBtn ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Save_and_View_Summary) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Credit_Price);
                }
                if (this.caseType.isStockRotation()) {
                    return this.disableProductValidationBTN ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Product_Validation);
                }
                break;
            case this.genericMessages.step_two:
                if (this.showTecnicalIntakeBtn) {
                    return tecnincalIntakeButtons.disableValidatePoHistoryBtn ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.PO_History_Check);
                }
                if (this.caseType.isStockRotation()) {
                    return this.getCrditPrice ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Next_or_Save_for_Later) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Credit_Price);
                }
                break;
            case this.genericMessages.step_three:
                if (this.showTecnicalIntakeBtn) {
                    return tecnincalIntakeButtons.disableValidatePriceCheckBtn ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Save_and_View_Summary) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Credit_Price);
                }
                if (this.caseType.isStockRotation()) {
                    return this.getDisableSubmitCalculateBtn ? StringFormatter.format(this.labels.Proceed_Further_Msg, this.labels.Save_and_View_Summary) : StringFormatter.format(this.labels.Before_Validation_Data_Msg, this.labels.Validate_Allowance);
                }
                break;
            default:
        }
    }
    //End -- Help Text Messages in table component , Based on the buttons displaying the help text messages to users -- Manohar

    /* * Remove Box condition for NPR-Credit */
    get notNPRCredit() {
        return !(this.caseType.remedy === this.genericMessages.Credit_NPR);
    }
    connectedCallback() {
        // this.isUCDoff = false;//await getUCDtoggle();
        this.tecnincalIntakeButtons.setThis(this);
        this.technicalIntakeTable.setThis(this);
        if (this.caseType.isQualityService()) {  //Manohar---Quality Intake --TWC4621-1359 -- Intially showing search/upload screen once the component gets loaded
            this.tecnincalIntakeButtons.showPoSearchTable();
        }

        if (this.caserec === undefined) {//TWC4621-1223- 24/04/23 - Accellor
            this.lineStatusbasedonCaseStatus = '';
        } else if (this.genericMessages.CheckCaseStatusToDetermineLineStatus.includes(this.caserec?.Status)) {
            this.lineStatusbasedonCaseStatus = this.genericMessages.delete;
        } else {
            this.lineStatusbasedonCaseStatus = this.genericMessages.R4C_LineItem_Status_Cancel;
        }
        if ((this.casemode === "Edit" && this.isPortal === false) || ((this.isPortal === "true" || this.isPortal === true) && this.lineStatusbasedonCaseStatus === this.genericMessages.delete)) {//TWC4621-1223- 24/04/23 - Accellor
            this.showLineItemStatusField = true;
        }

    }
    /* --------- Getter Setters Start------------*/

    get showTecnicalIntakeBtn() {
        return this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception);
    }
    get showStockRotationBtn() {
        return this.caseType.isStockRotation();
    }
    get showAdminIntakeBtn() {
        return this.caseType.isAdminService();
    }
    //Exchange Remedy - Technical Intake
    get isTechnicalExchange() {
        return this?.caseType?.isTechnicalExchange() || this?.isMiscellaneousReturnOnly;
    }
    get isMiscellaneousReturnOnly() { //TWC4621-2030  --Manohar
        return this?.caseType?.remedy == 'Return Only' ? true : false;
    }
    get creditPriceButtonNameBasedonRemedy() { //TWC4621-2030  --Manohar
        return this.isMiscellaneousReturnOnly ? 'Validate Product' : this.labels.Get_Credit_Price;
    }
    get displayCPN() {
        return this?.caseType?.isTechnicalExchange() || this.internalCustomerFlow;
    }

    handleReturnQtyDecrease(event) {
        this.saveAndViewSummaryExp = event.detail;
    }
    get showDeliveryNoteColumn() {
        return (this.searchByParent === this.genericMessages.Delivery_Note &&
            this.technicalIntakeTable.warrentyCheck) ||
            (this.searchByParent !== this.genericMessages.Delivery_Note)
            ? false
            : true;
    }

    // Tushar ----- Exception Intake
    get showCreditPriceTable() {
        return this.caseType.isStockRotation() || this.caseType.isExceptionService() || this.caseType.isAdminService() || (this.caseType.isMiscellaneousService()); //Manohar -- TWC4621-2011
    }

    get showQualityIntakeBtn() { //Manohar--TWC4621-1359 -- displaying quality intake buttons
        return this.caseType.isQualityService();
    }
    get showExceptionIntakeBtn() { //tushar---Exception --	
        return (this.caseType.isExceptionService() && this.caseType.remedy === this.genericMessages?.Credit) || this.caseType.isAdminService() || (this.caseType.isMiscellaneousService());//Manohar -- TWC4621-2011
    }
    get isFOCReturnReason() { //TWC4621-2499 -- MiscellaneousService -- FOC return Reason
        return this.caseType.isMiscellaneousService() && this.requestdetails?.salesIssueReturnReason == 'Free of Charge Sample';
    }

    // -- Prashant -- Excel to CSV button
    get downloadCSVButton() {
        if ((this.backStage === 'step-1' || this.backStage === 'step-2' || this.backStage === 'step-3')) {
            return true
        }
        return false
    }
    // ---- US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- getter method to get the selected step value from parent
    get getSearchByParent() {
        return this.searchByParent;
    }

    // --- US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- getter method to get the selected step value from parent
    get getHistoryButton() {
        this.poHistoryBTN.isSearchStep =
            (this.backStage === "step-0" || this.backStage === "") &&
                (this.currentSearchStep === "Product" ||
                    this.currentSearchStep === "Bulk Upload" || this.isECCLineItemEdit) //Samuel - Validate ECC Lines
                ? true
                : false;

        return this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception) || (this.caseType.isMiscellaneousService() && this?.requestdetails?.remedyText != this.genericMessages.Credit)
            ? false
            : this.poHistoryBTN.isSearchStep;
    }

    // ---- disable the get History button if any item is not selected
    get disableGetHistoryButton() {
        return !this?.poSearchData.some(
            // item.selected && ((poNumber == '' && poValidated == false) || poNumber != '' && poValidated == false)
            //(item) => item.selected == true && (( item?.isEnteredPOValidated && item?.isEnteredPOValidated !== undefined && (!item.poValidated || item.poValidated == undefined)) || (item.poNumber != "" && item?.isEnteredPOValidated && item?.isEnteredPOValidated !== undefined)) //Samuel - Validate PO
            (item) => item.selected == true && (item.poNumber == "" && (!item.poValidated || item.poValidated == undefined)) //Samuel - Validate PO    
        );
    }
    // -- sandeep -- TWC4621-857
    get showULT() {
        if (this.currentSearchStep === "Bulk Upload") {
            this.poSearchData.map((item) => {
                if (
                    item.selected === true &&
                    !this.selectedInvoiceNum.includes(item.InvoiceNumber)
                ) {
                    this.selectedInvoiceNum.push(item.InvoiceNumber);
                }
                return item;
            });
        }
        return ((this.searchByParent === "ULT" || this.searchByParent === this.genericMessages?.Serial_Number) &&
            this.technicalIntakeTable.warrentyCheck) ||
            (this.searchByParent !== "ULT" && this.searchByParent !== this.genericMessages?.Serial_Number)
            ? false
            : true;
    }


    get getCrditPrice() {
        return this.validateCreditPrice;
    }
    get disableCreditPriceNextBTN() {
        return this.creditPriceNextBTN;
    }

    get disablesaveAndViewSummaryExp() {
        return this.saveAndViewSummaryExp;
    }
    get disableSubmitNextBTN() {
        if (this.isEmulatedUser && (this.isPortal === true || this.isPortal === "true")) { //TWC4621-2010 -- Manohar -- If the login user is Emulated User, Restrict the Save functionality
            return true;
        }
        return this.nextButtonForsubmit;
    }
    get getDisableSubmitCalculateBtn() {
        return this.disableSubmitCalculateBtn;
    }

    get showBillingQuantity() {
        return this.lastSavedPath === "step-1" ? true : false;
    }
    // Check PoDataExist or not ,So accordingly we will show the data table--- User Story Number TWC4621-51--- Tushar Garg
    get isPoDataExist() {
        if (this.poSearchData) {
            return this.poSearchData.length > 0 ? true : false;
        }

        return false;
    }
    // Check PoDataExist or not ,So accordingly we will show the data table--- User Story Number TWC4621-51--- Tushar Garg
    get islineItemSearchDataExists() {
        return this.lineItemSearchData && this.lineItemSearchData.length > 0
            ? true
            : false;
    }

    // Calculate Selected Credit Price  --- User Story Number TWC4621-56--- Tushar Garg
    get getSelectedCreditPrice() {
        if (this?.isMiscellaneousReturnOnly) {
            return false;
        }
        if (this?.requestdetails && this?.requestdetails?.priceMasking === true || this.isUserPriceMasked) {  //TWC4621-1900 -- 17-11-23 -- Added Price Masking logic 
            return this.PRICE_MASK_STRING;
        }
        let count = 0;
        this.poSearchData.map((item) => {
            if (item.selected === true && item.creditPrice) {
                count = parseFloat(count) + parseFloat(item.creditPrice);
            }
            return item;
        });
        return "$" + parseFloat(count)?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    get poHistoryCheckForProductAndBulkUpload() {
        return this.searchByParent === "product" &&
            this.isPOHistoryValidated === true
            ? true
            : this.searchByParent === "Purchase/Sales Order"
                ? true
                : false;
    }
    get secondStepButtonName() {
        return (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) ? this.labels.Return_to_Warranty_Check : (this.caseType.isExceptionService() || this.caseType.isAdminService() || this.caseType.isMiscellaneousCredit()) ? this.genericMessages.Return_To_Credit_Price : this.labels.Return_to_Product_Validation;//Manohar -- TWC4621-2011 -- added isMiscellaneousCredit 

    }


    get paginationNumberCss() {
        return (this.isPortal == true || this.isPortal == 'true') ? 'font-size: .6em' : 'line-height: 2em;';
    }
    get paginationHeaderCss() {

        return (this.isPortal == true || this.isPortal == 'true') ? 'font-size: .7em' : '';
    }

    get showDisabledMessage() {
        let status = false;
        status = this.poSearchData.find(i => i.productStatus == false && i.display == true);
        return status
    }
    get poSearchDataDisabledValues() {
        let disabledTotal = this.poSearchData.filter(item => (item.productStatus == false || item.Error) && item.display == true).reduce((sum, currentItem) => {
            if (!currentItem.productStatus) {
                if (!sum[currentItem.page]) {
                    sum[currentItem.page] = 0;
                }
                sum[currentItem.page] += 1;
            }
            return sum;
        }, {})

        if (Object.keys(disabledTotal).includes('undefined')) {
            // disabledTotal={}; 
            disabledTotal[1] = disabledTotal[undefined];// Added as part of UI pagination bug fix
            delete disabledTotal.undefined;
        }

        return `${this.labels?.R4C_Total} (${Object.values(disabledTotal).join(',')}) ${this.labels?.R4C_In_Pages} (${Object.keys(disabledTotal).join(',')})`;
    }

    get poSearchDataX() {
        this._processPaginationVariables();

        return this.poSearchData
            ?.filter(item => item.display == true)
            ?.map(item => {
                item.isValidationInputRequired = false;
                if ((this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) && this.tecnincalIntakeButtons.showWarrantyEntitlementValidateBtn) {
                    item.isValidationInputRequired = (item.isUltRequired && !item.ult) || item.isUltDuplicate || item.isUltInUse;
                }


                return item;
            })
            ?.sort((a, b) => b.isValidationInputRequired - a.isValidationInputRequired)
            ?.map((item, index) => {
                let itemIndex = index + 1;
                item.page = this.PAGE_COORDINATES[itemIndex];
                item.itemNumber = itemIndex;
                return item;
            })
            ?.slice(this.pagination.indStart, this.pagination.indEnd) || []

    }

    // Disable Product Validation Next BTN--- User Story Number TWC4621-51--- Tushar Garg
    get disableProductValidationNextBTN() {
        return this.showCreditPriceBTNDisable;
    }

    // Disable Product Validation BTN--- User Story Number TWC4621-51--- Tushar Garg
    get disableProductValidationBTN() {
        return this.showProductValidateBTNDisable;
    }
    get showECCLineItemSaveBTN() {
        if (!this.isECCLineItemEdit) return false;
        return this.poSearchData.filter(i => i.selected == false).length == this.poSearchData.length;
    }
    get disableValidatePoBTN() { //Samuel - Validate PO
        if (this.casemode !== "Edit" && this?.poSearchData.some((item) => item.selected == true && item.poNumber != "" && (!item?.isEnteredPOValidated || item?.isEnteredPOValidated == undefined) && (!item.poValidated || item.poValidated == undefined))) {
            console.log('618 ', JSON.stringify(this?.poSearchData));
            this.enableSearchPONextBTN = true;
            return false
        }
        if (this.poSearchData.some((item) => item.selected == true)) {
            console.log('item. 622 ');
            this.enableSearchPONextBTN = false; //???????????????????????????????
        }
        return true
    }
    get disableSearchPONextBTN() {
        if (!this?.poSearchData.some((data) => data.selected)) { return true } //Step 1 next button enable/disable based on selacted line items
        return this.currentSearchStep === "Bulk Upload"
            ? false
            : this.enableSearchPONextBTN;
    }

    get returnToProductValidatePage() {
        if (this.isECCLineItemEdit) return false;
        //TWC4621-1020 -- sandeep -- feb24th 2023 -- getter method to show/hide returnToProduct Valiadate button if we have existing data
        let oldData = this.poSearchOldData.filter((item) => {
            return item.selected === true;
        });
        return oldData.length > 0 && this.backStage === "step-0" && (this.caseType.isExceptionService || this.showReturnToProductValidateBtn) ? true : false;
    }
    //Start --- User Story Number TWC4621-961 --- Agent UI ---  09/02/2023 Save for later button- enable/disable
    get getStockRotationSaveForLater() {
        if (this.isEmulatedUser && (this.isPortal === true || this.isPortal === "true")) { //TWC4621-2010 -- Manohar -- If the login user is Emulated User, Restrict the Save functionality
            return true;
        }
        if (
            this.showProductValidateNextBtn === true &&
            this.getHistoryButton === false
        ) {
            return this.disableSearchPONextBTN;
        }
        if (this.showCreditPriceNextBtn === true) {
            return this.showCreditPriceBTNDisable;
        }
        if (this.showAllowMatrixNextBtn === true) {
            return this.creditPriceNextBTN;
        }
        if (this.getHistoryButton === true) {
            return this.historyNextBtn;
        }
        return false;
    }

    //End --- User Story Number TWC4621-961 --- Agent UI ---  09/02/2023 -- Save for later button- enable/disable
    get historyNextBtn() {
        if (!this?.poSearchData.some((data) => data.selected)) { return true } //Step 1 next button enable/disable based on selacted line items
        return this?.poSearchData.some(
            (item) => item.selected == true && (!item.poValidated || item.poValidated == undefined)
        );
    }

    get historySaveForLatter() {
        return this.poHistoryBTN.saveForLatter;
    }

    //---TWC4621-679---Tushar Garg---12-12-2022--SR - MM Search - UI Implementation integrated to PO History Check Button
    @api
    get lineItemsData() {
        return this.lineItemSearchData;
    }
    set lineItemsData(value) {
        if (value) {
            this.lineItemSearchData = value ? JSON.parse(JSON.stringify(value)) : [];
        }
    }

    // This method is used to set the value of poSearch Data --- User Story Number TWC4621-51--- Tushar Garg
    @api
    get poSearchDataFromParent() {
        // Getting poSearchData from parent component
        return this.poSearchData;
    }
    set poSearchDataFromParent(value) {
        if (value) {
            console.log('701', JSON.stringify(value))
            this.allselectedcheckbox = false;
            //Adding fix for page unresponseive
            this.poSearchData = value?.map(v => {
                return { ...v }
            }) || [];
            if (this.isFirstTime && this.poSearchData.length > 0) {
                if (this.caseType.isStockRotation() || (this.casemode === "Edit" && ((this.caseType.isExceptionService() && this.requestdetails.remedyText == this.genericMessages?.Credit && !this.requestdetails.salesIssueReturnReason == this.genericMessages?.Exception_Return) || this.caseType.isMiscellaneousService()))) {//Manohar -- TWC4621-2011
                    this.poSearchOldData = value?.map(v => {
                        return { ...v }
                    }) || [];
                }
                if ((this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) && this.casemode === "Edit") {
                    this.poSearchOldTiData = value?.map(v => {
                        return { ...v }
                    }) || [];
                }
                this.isFirstTime = false;
                //Start -- TWC4621-971 --- Agent UI ---  09/02/2023 -- Landing on search/upload page on edit scenario
                if (this.casemode === this.genericMessages.Edit_Label) {

                    this.allselectedcheckbox = true;
                    this.enableSearchPONextBTN = false;
                    this.poSearchData.map((item) => {
                        if (
                            item.selected === true &&
                            !this.selectedInvoiceNum.includes(item.InvoiceNumber)
                        ) {
                            this.selectedInvoiceNum.push(item.InvoiceNumber);
                        }
                        return item;
                    });
                }
                this.showReturnToProductValidateBtn = true;
                //End -- TWC4621-971  --- Agent UI ---  09/02/2023 -- Landing on search/upload page on edit scenario
            }
            if ((this.currentSearchStep === "Product" || this.currentSearchStep === "Serial Number" || this.currentSearchStep === "Delivery Note") && this.casemode === this.genericMessages.Edit_Label) {
                this.allselectedcheckbox = this.isEmailOnLoad ? true : false;
            } else if (this.currentSearchStep === "Bulk Upload") {
                this.allselectedcheckbox = true;
                this.isDisablePoHistoryBTN = true;
            }

            // TWC4621-1047 - Furqan - 22-02-2023 - Fixing buttons visiblity
            if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                this.tecnincalIntakeButtons.showPoSearchTable();
            }
            this._processPaginationVariables();
        }
    }
    /* --------- Getter Setters End------------*/
    /* --------- Public Methods Start------------*/
    get getPriceCheck() {
        return !this.isPortal && this.creditPriceCheck;
    }
    get creditPriceColumnName() {
        return this.caseType.isExceptionRepair() ? this.labels.Sales_Price : this.labels.Credit_Price;
    }
    get netCreditValueColumnName() {
        return this.caseType.isExceptionRepair() ? this.labels.Net_Value : this.labels.Net_Credit_Value;
    }

    @api
    resetAllData() {
        this.poSearchData = [];
        this.poSearchOldData = [];
        this.poSearchNewData = [];
        this.poSearchWithLOEData = [];
        this.poSearchWithLOETOShowData = [];
        this.poSearchWithMatrixData = [];
        this.poSearchWithMatrixDataToSubmit = [];
        this.isPCNDateAvailable = false;
        this.showProductValidateNextBtn = true;
        this.showProductValidateBtn = false;
        this.showCreditPriceNextBtn = false;
        this.showAllowMatrixNextBtn = false;
        this.isMatrixStage = false;
        this.showViewSummary = false;
        this.enableSearchPONextBTN = true;
    }
    // This method is used to go back the po search screen--- User Story Number TWC4621-52--- Tushar Garg
    @api
    backToPoSearchScreenHandler() {
        if (this.caseType.isQualityService()) { //Manohar---Quality Intake --TWC4621-1359 -- hiding other screens and showing search/upload screen
            this.poSearchWithLOEData = this.poSearchData.filter(
                (item) => item.selected
            );
        }

        //adding to fix back and forth issue from po search to warrent and vice versa
        if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            this.poSearchOldTiData = this.poSearchData;
            this.tecnincalIntakeButtons.showPoSearchTable();
        }

        /*Start--TWC4621-60,TWC4621-61--Bindhu--To display the saved line item data on posearch screen in edit scenario--*/
        if (this.caserec != undefined || this.caseType.isAdminService() || (this.caseType.isExceptionService() && this.caseType.remedy === this.genericMessages.Credit) || this.caseType.isMiscellaneousService()) {//Manohar -- TWC4621-2011
            this.poSearchOldData = this.poSearchData;
            this.poSearchData = [];
        } else {
            this.poSearchData = [];
        }
        /*End--TWC4621-60,TWC4621-61--Bindhu--To display the saved line item data on posearch screen in edit scenario--*/
        this.handleNextClick("step-1");
        this.backStage = "step-0";
        this.disableSaveForLater = true;
        this.isPCNDateAvailable = false;
        this.showProductValidateBtn = false;
        this.showProductValidateNextBtn = true;
        this.showCreditPriceNextBtn = false;
        this.poHistoryBTN.isSearchStep = true;
        this.poHistoryBTN.nextBTN = true;
        this.poHistoryBTN.saveForLatter = false;
        this.enableSearchPONextBTN = true; //TWC4621-962,992 --- Agent UI ---  09/02/2023 search/upload page next button enable/disable
        this.allselectedcheckbox = false;
        this.hideReturnToProductButton = false;

        // TWC4621-912 - Furqan - 16-01-2023 - TI Process Variables hidding warrenty buttons
        if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || (this.caseType.isExceptionService() || this.caseType.isExceptionRepair() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            this.tecnincalIntakeButtons.showWarrantyEntitlementValidateBtn = false;
            this.technicalIntakeTable.warrentyCheck = false; //added by sandeep on 20th jan
        }
        this.existingLineItemCheckExpVal = false;
        this.dispatchEvent(new CustomEvent("handleback", {}));

    }
    //Start -- TWC4621-1020 -- feb24th 2023 -- method to check any existing data is available or not, based on return value enabling Next Button in Search/upload page
    @api
    checkExistingData(clearCurrentData) {
        let oldData;
        if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            oldData = this.poSearchOldTiData.some((item) => {
                return item.selected === true;
            });
        }
        else {
            oldData = this.poSearchOldData.some((item) => {
                return item.selected === true;
            });
        }
        if (this.backStage || clearCurrentData) { //restrict Clearing Posearch data if no data in this.poSearchOldData & this.poSearchOldTiData variables
            this.poSearchNewData = [];
            this.poSearchData = [];
        }
        return oldData && this.showReturnToProductValidateBtn ? true : false;
    }
    @api
    handleClickProcessIndicator(event) {
        let currentStep;
        this.loading(true);
        if (event) {
            this.existingLineItemCheckExpVal = true;
            let step = event.split("-")[1];
            if (this.backStage) {
                currentStep = this.backStage.split("-")[1];
            }
            if (
                (currentStep === "0" && step === "2") ||
                (currentStep === undefined &&
                    step === "2" &&
                    this.casemode === this.genericMessages.Edit_Label)
            ) {

                //TWC4621-1020 -- feb24th 2023 -- method to check any existing data is available or not, based on return value moving to 2nd step
                let oldData;
                if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    oldData = this.poSearchOldTiData.filter((item) => {
                        return item.selected === true;
                    });
                } else {
                    oldData = this.poSearchOldData.filter((item) => {
                        return item.selected === true;
                    });
                }
                if (oldData.length > 0) {

                    if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                        this.productValidateNextHandlerTechnical();
                    }
                    else if (this.caseType.isExceptionService() || this.caseType.isMiscellaneousService()) {//Manohar -- TWC4621-2011
                        this.creditPriceExpNextBtnHandler();
                    }
                    else if (this.caseType.isAdminService()) {
                        this.creditPriceExpNextBtnHandler();
                    }
                    else {
                        this.productValidateNextHandler();
                    }

                }
            }
            // eslint-disable-next-line radix
            if (currentStep === "1" && step === "1") {
                //this var will store product Validation screen values
                this.poSearchToProductValidateData = this.poSearchData;
                //back to Search new items
                this.backToPoSearchScreenHandler();
            } else if (currentStep === "2" && step === "2") {
                if (this.caseType.isStockRotation()) {
                    //back to LOE validation
                    this.handleBackClickToLOE();
                }
                //Furqan - Bug fix - on click of path
                else if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    //Back to warrenty Check
                    this.backToWarrentyChekScreenHandler();
                }
            } else if (currentStep === "2" && step === "1") {
                if (this.caseType.isStockRotation()) {
                    //back to LOE validation
                    this.handleBackClickToLOE();
                }
                //back to Search new items
                this.backToPoSearchScreenHandler();
            } else if (currentStep === "3" && step === "3") {
                if (this.caseType.isStockRotation()) {
                    //back to creditprice
                    this.backToCreditPrice();
                } else if (this.caseType.isTechnicalService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    //Back to po history check
                    this.backToPOHistoryCheckScreenHandler();
                } else if (this.caseType.isQualityService()) {
                    backToMRBRefNumberScreenHandler(this);
                }
            } else if (currentStep === "3" && step === "2") {
                if (this.caseType.isStockRotation()) {
                    //back to creditprice
                    this.backToCreditPrice();
                    //back to LOE validation
                    this.handleBackClickToLOE();
                } else if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    //Back to po history check
                    this.backToWarrentyChekScreenHandler();
                }
            } else if (currentStep === "3" && step === "1") {
                if (this.caseType.isStockRotation()) {
                    //back to creditprice
                    this.backToCreditPrice();
                    //back to LOE validation
                    this.handleBackClickToLOE();
                }
                //back to Search new items
                this.backToPoSearchScreenHandler();
            } else if (currentStep === "4" && step === "4") {
                this.backToCalculateMatrix();
            } else if (currentStep === "4" && step === "3") {
                this.backToCalculateMatrix();
                //back to creditprice
                this.backToCreditPrice();
            } else if (currentStep === "4" && step === "2") {
                if (this.caseType.isStockRotation()) {
                    this.backToCalculateMatrix();
                    //back to creditprice
                    this.backToCreditPrice();
                    //back to LOE validation
                    this.handleBackClickToLOE();
                } else if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    //Back to po history check
                    this.backToWarrentyChekScreenHandler();
                }
            } else if (currentStep === "4" && step === "1") {
                if (this.caseType.isStockRotation()) {
                    this.backToCalculateMatrix();
                    //back to creditprice
                    this.backToCreditPrice();
                    //back to LOE validation
                    this.handleBackClickToLOE();
                }
                //back to Search new items
                this.backToPoSearchScreenHandler();
            }
        }
        this.loading(false);
    }
    // This method is used to add the New PoSearch Data --- User Story Number TWC4621-51--- Tushar Garg
    @api
    addNewPoSearchData(data) {
        if (data) {
            let newData = data.map(i => {
                return i;
            });
            this.poSearchNewData = [];
            for (let item of newData) {
                // Start---TWC4621-1067,TWC4621-1068--Tushar Garg---09-03-2023--SR - product Search - Logic to add new Po Search data to one varaible
                let isValueSelected = this.poSearchOldData.find((d) => d.InvoiceNumber === item.InvoiceNumber);
                if (!isValueSelected) {
                    this.poSearchNewData.push(item);
                }
            }
            this.allselectedcheckbox = false;
            this.creditPriceNextBTN = true;
            this.saveAndViewSummaryExp = true;
        }
    }
    /* --------- Public Methods Ends------------*/


    goToNextPage() {
        this.showSpinner = true;
        if (this.pagination.currentPage < this.pagination.totalPages) {
            this.pagination.currentPage += 1;
        }

        setTimeout(() => {
            this._processPaginationVariables();
            this.showSpinner = false;
        }, 1000);
    }

    goToPreviousPage() {
        this.showSpinner = true;
        if (this.pagination.currentPage > 1) {
            this.pagination.currentPage -= 1;
        }

        setTimeout(() => {
            this._processPaginationVariables();
            this.showSpinner = false;
        }, 1000);
    }
    //end - for pagination - CS

    // Select the all rows --- User Story Number TWC4621-51--- Tushar Garg
    allSelectedHandler(event) {
        if (event.target.checked == true) {
            this.allselectedcheckbox = true;
            //checking if user is on first step and he seleted some records then we are enabling PO History Button
            if (this.backStage === "step-0") {
                this.isDisablePoHistoryBTN = true;
            }
        }
        if (event.target.checked == false) {
            this.allselectedcheckbox = false;
        }
        let invoiceList = [];
        this.poSearchData.map((item) => {
            // TWC4621-1067,TWC4621-1068--Tushar Garg---09-03-2023--SR - product Search - Logic to Select all line items based on the product status and selection of the line item
            if (item.productStatus === true && item.InvoiceNumber && item.lineitemStatus !== 'Cancel') {
                item.selected = event.target.checked;
                let attr = {
                    detail: {
                        invoiceNumber: item.InvoiceNumber,
                        isChecked: item.selected
                    }
                };
                invoiceList.push(item.InvoiceNumber);

            }
            return item;
        });
        this.handleSelectedList(invoiceList, true, event.target.checked);


    }

    //Reusable method run on the press of next button --- User Story Number TWC4621-52--- Tushar Garg
    handleNextClick(status) {
        this.resetPaginationVariableOnPageChange();
        this.dispatchEvent(new CustomEvent("handlenext", { detail: status }));
    }
    // This method give the selected rows --- User Story Number TWC4621-19--- Tushar Garg
    handleSelectedList(event, isBulk, bulkSelectStatus) {
        this.enableSearchPONextBTN = false;
        //if bulk list is passed getting value for selected invoice in bulk
        let invoiceList = [];
        if (isBulk) {
            invoiceList = event;
            event = {};
            event.detail = {};
            event.detail.isChecked = bulkSelectStatus;
            this.selectedInvoiceNum = [];
            if (bulkSelectStatus) {
                this.selectedInvoiceNum = invoiceList;
            }
        }
        else {
            let isSelectedInvoiceNum = this.selectedInvoiceNum.includes(event.detail.invoiceNumber);
            if (!isSelectedInvoiceNum && event.detail.isChecked) {
                this.selectedInvoiceNum.push(event.detail.invoiceNumber);
            } else if (isSelectedInvoiceNum && event.detail.isChecked === false) {
                this.selectedInvoiceNum = this.selectedInvoiceNum.filter((item) => {
                    return item !== event.detail.invoiceNumber;
                });
            }
        }
        if (event.detail.isChecked == false) {
            this.allselectedcheckbox = false;
        }

        if (event.detail.isChecked && (this.backStage === "step-0" || this.backStage === "")) {
            this.isDisablePoHistoryBTN = true;
        }
        let oldSelectedLineitemscount = 0;
        this.poSearchOldData.map((item) => {

            if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber || invoiceList.includes(item.InvoiceNumber))) {
                item.selected = event.detail.isChecked;
                //Start -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
                if (event.detail.isChecked == false && this.casemode === this.genericMessages.Edit_Label) {
                    item.lineitemStatus = item.shipmentstatus;
                    item.lineStatus = this.lineStatusbasedonCaseStatus;//TWC4621-1223- 24/04/23 - Accellor
                } else if (event.detail.isChecked == true && this.casemode === this.genericMessages.Edit_Label) {
                    item.lineitemStatus = item.shipmentstatus;
                    item.lineStatus = item.shipmentstatus;
                }
                //End -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
            }
            if (item.selected === true) {
                oldSelectedLineitemscount++;
            }
            return item;
        });
        this.poSearchData.map((item) => {
            if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber || invoiceList.includes(item.InvoiceNumber))) {
                item.selected = event.detail.isChecked;
                //Start -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
                if (event.detail.isChecked == false && this.casemode === this.genericMessages.Edit_Label) {
                    item.lineitemStatus = item.shipmentstatus;
                    item.lineStatus = this.lineStatusbasedonCaseStatus;//TWC4621-1223
                } else if (event.detail.isChecked == true && this.casemode === this.genericMessages.Edit_Label) {
                    item.lineitemStatus = item.shipmentstatus;
                    item.lineStatus = item.shipmentstatus;
                    item.Error = item?.Error ? item?.Error : '';
                    item.errorText = item?.errorText ? item?.errorText : '';
                }
                if (this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC && event.detail.isChecked == false) {
                    item.Error = true;
                    item.errorText = 'Agent Cancelled the line item';
                } else if (this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC && event.detail.isChecked == true) {
                    item.Error = '';
                    item.errorText = '';
                }
                //End -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
            }
            return item;
        });
        this.poSearchNewData.map((item) => {
            if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber || invoiceList.includes(item.InvoiceNumber))) {
                item.selected = event.detail.isChecked;
                //Start -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
                if (event.detail.isChecked == false && this.casemode === this.genericMessages.Edit_Label) {
                    item.lineitemStatus = item.shipmentstatus;
                    item.lineStatus = this.lineStatusbasedonCaseStatus;//TWC4621-1223- 24/04/23 - Accellor
                } else if (event.detail.isChecked == true && this.casemode === this.genericMessages.Edit_Label) {
                    item.lineitemStatus = item.shipmentstatus;
                    item.lineStatus = item.shipmentstatus;
                }
                //End -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
            }
            return item;
        });
        if (this.poSearchOldTiData?.length > 0) {
            this.poSearchOldTiData.map((item) => {
                if (item?.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber || invoiceList.includes(item.InvoiceNumber))) {
                    item.selected = event.detail.isChecked;
                }
                return item;
            });
        }
        if (this.backStage === "step-1" && event.detail.isChecked === true) {
            this.showProductValidateBTNDisable = false;
            this.showCreditPriceBTNDisable = true;
        } else if (this.backStage === "step-2" && event.detail.isChecked === true) {
            this.validateCreditPrice = false;
            this.creditPriceNextBTN = true;
        } else if (this.backStage === "step-3") {
            this.disableSubmitCalculateBtn = false;
            this.nextButtonForsubmit = true;
        }
        //Start -- TWC4621-961 --- Agent UI ---  09/02/2023  -- Bypassing credit price if it is same day
        let todaysDate = this.dateCalculation();
        if (
            this.poSearchData.some((item) => {
                return (
                    (this.backStage === "step-2" || (this.backStage === "step-1" && this.caseType.isExceptionService())) &&
                    item.selected === true &&
                    ((item.creditPriceDate === "" ? true : todaysDate > this.dateCalculation(item.creditPriceDate) ? true : false) || (this.caseType.isExceptionService() && this.casemode === this.genericMessages.Edit_Label)));
            })
        ) {
            this.validateCreditPrice = false;
            this.saveAndViewSummaryExp = true;
            this.creditPriceNextBTN = true;
        } else {
            this.validateCreditPrice = true;
            this.creditPriceNextBTN = false;
        }
        //End -- TWC4621-961 --- Agent UI ---  09/02/2023  -- Bypassing credit price if it is same day
        let poDataSelectedLength = 0;
        let temppoDataLength = 0;
        this.poSearchData.map((item) => {
            if (item.selected === true && !item.disableRowBoxCondition) {
                poDataSelectedLength++;
            }
            if (!item.disableRowBoxCondition && item.productStatus) {
                temppoDataLength++;
            }
            return item;
        });
        if (temppoDataLength == poDataSelectedLength) {
            this.allselectedcheckbox = true;
        }
        if (
            poDataSelectedLength > 0 &&
            oldSelectedLineitemscount > 0 &&
            this.backStage === this.genericMessages.step_zero
        ) {
            this.hideReturnToProductButton = true;
        } else {
            this.hideReturnToProductButton = false;
        }
    }

    handleDeleteLine(event) {
        if (this.casemode === this.genericMessages.Edit_Label) {
            this.poSearchData.map((item) => {
                if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber)) {
                    item.selected = event.detail.isChecked;
                    //Start -- manohar -- jan 16th 2023 -- case edit (line item status) -- TWC4621-899
                    if (event.detail.isChecked == false && this.casemode === this.genericMessages.Edit_Label) {
                        item.lineitemStatus = item.shipmentstatus;
                        item.lineStatus = this.lineStatusbasedonCaseStatus;//TWC4621-1223


                    } else if (event.detail.isChecked == true && this.casemode === this.genericMessages.Edit_Label) {
                        item.lineitemStatus = item.shipmentstatus;
                        item.lineStatus = item.shipmentstatus;
                        item.Error = item?.Error ? item?.Error : '';
                        item.errorText = item?.errorText ? item?.errorText : '';

                    }
                    if (this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC && event.detail.isChecked == false) {
                        item.Error = true;
                        item.errorText = 'Agent Cancelled the line item';
                    } else if (this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC && event.detail.isChecked == true) {
                        item.Error = '';
                        item.errorText = '';
                    }
                }
                return item;
            });
        }
        else {
            let isSelectedInvoiceNum = this.selectedInvoiceNum.includes(event.detail.invoiceNumber);
            if (isSelectedInvoiceNum) {
                this.selectedInvoiceNum = this.selectedInvoiceNum.filter((item) => {
                    return item !== event.detail.invoiceNumber;
                });
            }
            this.poSearchData.map((item) => {
                if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber)) {
                    item.display = false;
                    item.productStatus = false;
                    item.selected = false;
                }
                return item;
            });


            this.poSearchOldData.map((item) => {
                if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber)) {
                    item.display = false;
                    item.productStatus = false;
                    item.selected = false;
                }
                return item;
            });
            this.poSearchNewData.map((item) => {
                if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber)) {
                    item.display = false;
                    item.productStatus = false;
                    item.selected = false;
                }
                return item;
            });
            if (this.poSearchOldTiData?.length > 0) {
                this.poSearchOldTiData.map((item) => {
                    if (item.InvoiceNumber && (item.InvoiceNumber === event.detail?.invoiceNumber)) {
                        item.display = false;
                        item.productStatus = false;
                        item.selected = false;
                    }
                    return item;
                });
            }
        }
    }


    //Pravallika - Delete all line items fuctionality start
    async handleDeleteSelectedLines() {
        const result = await
            LightningConfirm.open({
                message: this.labels.R4C_Delete_Confirmation,
                variant: 'success',
                label: this.labels.Confirm_Message,
            });

        if (!result) {
            return; // User clicked Cancel
        }
        const updateItem = (list) => {
            return list.map((item) => {
                if (item.InvoiceNumber && item.selected) {

                    if (this.casemode === this.genericMessages.Edit_Label) {
                        item.selected = false;
                        item.lineitemStatus = item.shipmentstatus;

                        // TWC4621-1223: Set lineStatus based on case status
                        item.lineStatus = this.lineStatusbasedonCaseStatus;


                        // Hide line item from UI when unchecked
                        item.display = false;
                        item.productStatus = false;
                        item.selected = false;


                        // FAC logic
                        if (this.requestdetails.salesIssueReturnReason === this.genericMessages?.FAC) {
                            item.Error = true;
                            item.errorText = 'Agent Cancelled the line item';
                        } else {
                            item.Error = item?.Error ? item?.Error : '';
                            item.errorText = item?.errorText ? item?.errorText : '';
                        }
                    } else {

                        item.display = false;
                        item.productStatus = false;
                        item.selected = false;
                    }
                }
                return item;
            });
        };

        this.poSearchData = updateItem(this.poSearchData);
        this.poSearchOldData = updateItem(this.poSearchOldData);
        this.poSearchNewData = updateItem(this.poSearchNewData);

        if (this.poSearchOldTiData?.length > 0) {
            this.poSearchOldTiData = updateItem(this.poSearchOldTiData);
            console.log('@@ this.poSearchOldTiData', this.poSearchOldTiData);
        }
        this.selectedInvoiceNum = [];
        console.log('@@ this.selectedInvoiceNum', this.selectedInvoiceNum);
    }
    //Pravallika - Delete all line items fuctionality start




    // Disable Box Condition Row --- User Story Number TWC4621-56--- Tushar Garg
    handleDisableRowBoxCondition(event) {
        let InvoiceNumber = event.detail.recordId;
        let creditPriceDetails = event.detail.creditPriceDetails;
        let error = event.detail.error;
        //enable calculate matrix button
        this.disableSubmitCalculateBtn = false;
        //block View & summary button
        this.nextButtonForsubmit = true;
        this.poSearchData = this.poSearchData.map((item) => {
            if (item && item.InvoiceNumber === InvoiceNumber) {
                item.productStatus = false;
                item.returnQuantity = creditPriceDetails.returnQuantity;
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                item.boxCondition = creditPriceDetails.boxCondition;
                if (error) {
                    item.disableRowBoxCondition = true;
                    item.Error = this.labels.Product_Allowance_check_boxcondition;
                }
            }
            return item;
        });
        this.poSearchWithLOETOShowData = this.poSearchWithLOETOShowData.map(
            (item) => {
                if (item.InvoiceNumber === InvoiceNumber) {
                    item.returnQuantity = creditPriceDetails.returnQuantity;
                    item.returnPO = creditPriceDetails.returnPO;
                    item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                    item.boxCondition = creditPriceDetails.boxCondition;
                    if (error) {
                        item.disableRowBoxCondition = true;
                        item.Error = this.labels.Product_Allowance_check_boxcondition;
                    }
                }
                return item;
            }
        );
        this.poSearchWithLOEData = this.poSearchWithLOEData.map((item) => {
            if (item.InvoiceNumber === InvoiceNumber) {
                item.disableRowBoxCondition = true;
                item.returnQuantity = creditPriceDetails.returnQuantity;
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                item.boxCondition = creditPriceDetails.boxCondition;
            }
            return item;
        });

        this.poSearchWithMatrixData = this.poSearchWithMatrixData.map((item) => {
            if (item.InvoiceNumber === InvoiceNumber) {
                item.returnQuantity = creditPriceDetails.returnQuantity;
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                item.boxCondition = creditPriceDetails.boxCondition;
            }
            return item;
        });
    }

    //This method return the returnQuantity --- User Story Number TWC4621-56--- Tushar Garg
    creditPriceHndler(event) {
        let InvoiceNumber = event.detail.recordId;
        let creditPriceDetails = event.detail.creditPriceDetails;
        let elementname = event.detail.elementname;
        this.poSearchData = this.poSearchData.map((item) => {
            if (item && item.InvoiceNumber === InvoiceNumber) {
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                item.boxCondition = creditPriceDetails.boxCondition;
                //if (this.caseType.isTechnicalService()) { 
                if (event.detail.elementname == 'returnQuantity') {
                    item.returnQuantity = creditPriceDetails?.returnQuantity;
                }
                if (event.detail.elementname == 'YMS2PriceExp') {
                    item.YMS2Price = creditPriceDetails?.creditPriceExp;
                    //item.priceChange = true;
                    console.log('1295', item?.YMS2Price != item?.tempYMS2Price)
                    console.log('1296', item?.tempYMS2Price && item?.YMS2Price != item?.tempYMS2Price)
                    item.priceChange = item?.tempYMS2Price && item?.YMS2Price != item?.tempYMS2Price;//TWC4621-4742,TWC4621-4789 -- Capture price change equal to true only if the orginal price is modified
                }
                if (this.isPortal === false && item?.price == 0 && !item.priceChange) {
                    item.isSoftStop = item?.YMS2Price > 0 ? false : true;
                    item.successText = item?.YMS2Price > 0 ? 'success' : this.labels.YMS2Price_not_found;
                }
                if (event.detail.elementname == 'RFPriceChange') {
                    item.RFPriceChange = creditPriceDetails.rfPriceChange;
                }
                if (event.detail.elementname == this.genericMessages?.expectedOutcomeValueForRepair) {
                    item.expectedOutcomeValueForRepair = creditPriceDetails.expectedOutcomeValueForRepair;
                }
                item.lineitemStatus = creditPriceDetails.lineItemStatus; //added by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
                let CP = event.detail.elementname == 'YMS2PriceExp' ? parseFloat(item.returnQuantity) * creditPriceDetails?.creditPriceExp : parseFloat(item.returnQuantity) * parseFloat(item.YMS2Price);
                item.creditPrice = CP;
                if (elementname === this.genericMessages?.mrbnumber) item.mrbnumber = creditPriceDetails?.mrbnumber?.trim();//Quality Intake --TWC4621-1359
                // TWC4621-912 - Furqan - 16-01-2023 - TI Process Variables adding defaut quantoty and disableing button
                if (elementname == 'ult') item.ult = creditPriceDetails.ult;
                if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception) || this.caseType.isMiscellaneousService()) {
                    if (item.ult) {
                        if (!item.isReturnQtyChanged && item?.returnQuantity && item?.returnQuantity != 1) { //TWC4621-3290
                            item.existingReturnQty = item?.returnQuantity;
                            item.isReturnQtyChanged = true;
                        }
                        item.returnQuantity = 1;
                        item.quantityDisabled = true;
                    } else {
                        item.quantityDisabled = false;
                        item.isReturnQtyChanged = false;//TWC4621-3290
                        if (item.existingReturnQty) {
                            item.returnQuantity = item.existingReturnQty;
                        }
                    }
                    //BUG Fix- on change of quantity warrenty check is not refreshed
                    if (item.warrentyValidated) {
                        if (elementname == 'ult') {
                            item.warrentyValidated = false;
                        }
                    }
                    if (this.caseType?.isMiscellaneousService() && elementname == 'ult') { //revalidate ULTs which are entered by Agent -- TWC4621-2499
                        item.priceCheck = false;
                    }
                }
                elementname === this.genericMessages?.mrbnumber && this.caseType.isQualityService() && item.mrbValidated ? item.mrbValidated = false : ''; //Quality Intake --TWC4621-1359 
            }
            if (
                ((item.selected === true && elementname === "returnQuantity") ||
                    elementname === "boxCondition" ||
                    elementname === this.genericMessages.line_Item_Status_label) && //added elementname === 'lineItemStatus' by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
                item.InvoiceNumber === InvoiceNumber
            ) {
                //added by manohar as part of bug fixing
                //enable calculate matrix button
                this.saveAndViewSummaryExp = false;
                this.disableSubmitCalculateBtn = false;
                //block View & summary button
                this.nextButtonForsubmit = true;
                if (this.casemode == "Edit" && (this.caseType.isExceptionService() || this.caseType.isAdminService())) { //manohar
                    item.successText = parseFloat(item?.prevReturnQuantity) < parseFloat(item.returnQuantity) ? this.genericMessages?.R4C_ReturnQtyDecreaseError : this.labels.Success_Message;
                    item.isSoftStop = parseFloat(item?.prevReturnQuantity) < parseFloat(item.returnQuantity) ? true : false;
                }
            }
            //TWC4621-975 -- Furqan -- Fixing variable refrence issue
            return { ...item };
        });
        if (elementname == 'YMS2PriceExp' || elementname == 'RFPriceChange' || elementname === "returnQuantity") {
            invokeCustomValidationElement(this);
        }
        this.poSearchWithMatrixData = this.poSearchWithMatrixData.map((item) => {
            if (item && item.InvoiceNumber === InvoiceNumber) {
                item.returnQuantity = creditPriceDetails.returnQuantity;
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                if (event.detail.elementname == 'YMS2PriceExp') {
                    item.YMS2Price = creditPriceDetails?.creditPriceExp;
                    //item.priceChange = true;
                    item.priceChange = item?.tempYMS2Pric && item?.YMS2Price != item?.tempYMS2Price;//TWC4621-4742,TWC4621-4789 -- Capture price change equal to true only if the orginal price is modified
                }
                if (this.isPortal === false && item?.price == 0 && !item.priceChange) {
                    item.isSoftStop = item?.YMS2Price > 0 ? false : true;
                    item.successText = item?.YMS2Price > 0 ? 'success' : this.labels.YMS2Price_not_found;
                }
                if (event.detail.elementname == 'RFPriceChange') {
                    item.RFPriceChange = creditPriceDetails.rfPriceChange;
                }
                if (event.detail.elementname == 'reasonforselection') {
                    item.rfpriceselection = creditPriceDetails.reasonforselection;
                }
                item.boxCondition = creditPriceDetails.boxCondition;
                item.lineitemStatus = creditPriceDetails.lineItemStatus; //added by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
                let CP = event.detail.elementname == 'YMS2PriceExp' ? parseFloat(item.returnQuantity) * creditPriceDetails?.creditPriceExp : parseFloat(item.returnQuantity) * parseFloat(item.YMS2Price);
                item.creditPrice = CP;
                item.RFPriceChange = creditPriceDetails.rfPriceChange;
            }
            return item;
        });

        this.poSearchWithMatrixDataToSubmit = this.poSearchWithMatrixDataToSubmit.map((item) => {
            if (item && item.InvoiceNumber === InvoiceNumber) {
                item.returnQuantity = creditPriceDetails.returnQuantity;
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                if (event.detail.elementname == 'YMS2PriceExp') {
                    item.YMS2Price = creditPriceDetails?.creditPriceExp;
                    //item.priceChange = true;
                    item.priceChange = item?.tempYMS2Pric && item?.YMS2Price != item?.tempYMS2Price;//TWC4621-4742,TWC4621-4789 -- Capture price change equal to true only if the orginal price is modified
                }
                if (this.isPortal === false && item?.price == 0 && !item.priceChange) {
                    item.isSoftStop = item?.YMS2Price > 0 ? false : true;
                    item.successText = item?.YMS2Price > 0 ? 'success' : this.labels.YMS2Price_not_found;
                }
                if (event.detail.elementname == 'RFPriceChange') {
                    item.RFPriceChange = creditPriceDetails.rfPriceChange;
                }
                if (event.detail.elementname == 'RFPriceChange') {
                    item.rfpriceselection = creditPriceDetails.reasonforselection;
                }
                item.boxCondition = creditPriceDetails.boxCondition;
                item.lineitemStatus = creditPriceDetails.lineItemStatus; //added by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
                let CP = event.detail.elementname == 'YMS2PriceExp' ? parseFloat(item.returnQuantity) * creditPriceDetails?.creditPriceExp : parseFloat(item.returnQuantity) * parseFloat(item.YMS2Price);
                item.creditPrice = CP;
                item.RFPriceChange = creditPriceDetails.rfPriceChange;
            }
            return item;
        });

        this.poSearchWithLOEData = this.poSearchWithLOEData.map((item) => {
            if (item && item.InvoiceNumber === InvoiceNumber) {
                item.returnQuantity = creditPriceDetails.returnQuantity;
                item.returnPO = creditPriceDetails.returnPO;
                item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;
                if (event.detail.elementname == 'YMS2PriceExp') {
                    item.YMS2Price = creditPriceDetails?.creditPriceExp;
                    //item.priceChange = true;
                    item.priceChange = item?.tempYMS2Pric && item?.YMS2Price != item?.tempYMS2Price;//TWC4621-4742,TWC4621-4789 -- Capture price change equal to true only if the orginal price is modified
                }
                if (this.isPortal === false && item?.price == 0 && !item.priceChange) {
                    item.isSoftStop = item?.YMS2Price > 0 ? false : true;
                    item.successText = item?.YMS2Price > 0 ? 'success' : this.labels.YMS2Price_not_found;
                }
                if (event.detail.elementname == 'RFPriceChange') {
                    item.RFPriceChange = creditPriceDetails.rfPriceChange;
                }
                if (event.detail.elementname == 'RFPriceChange') {
                    item.rfpriceselection = creditPriceDetails.reasonforselection;
                }
                item.boxCondition = creditPriceDetails.boxCondition;
                item.lineitemStatus = creditPriceDetails.lineItemStatus; //added by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
                let CP = event.detail.elementname == 'YMS2PriceExp' ? parseFloat(item.returnQuantity) * creditPriceDetails?.creditPriceExp : parseFloat(item.returnQuantity) * parseFloat(item.YMS2Price);
                item.creditPrice = CP;
                item.RFPriceChange = creditPriceDetails.rfPriceChange;
            }
            return item;
        });

        this.poSearchWithLOETOShowData = this.poSearchWithLOETOShowData.map(
            (item) => {
                if (item && item.InvoiceNumber === InvoiceNumber) {
                    item.returnQuantity = creditPriceDetails.returnQuantity;
                    item.returnPO = creditPriceDetails.returnPO;
                    item.debitReferenceNumber = creditPriceDetails.debitReferenceNumber;

                    if (event.detail.elementname == 'YMS2PriceExp') {
                        item.YMS2Price = creditPriceDetails?.creditPriceExp;
                        //item.priceChange = true;
                        item.priceChange = item?.tempYMS2Pric && item?.YMS2Price != item?.tempYMS2Price;//TWC4621-4742,TWC4621-4789 -- Capture price change equal to true only if the orginal price is modified
                    }
                    if (this.isPortal === false && item?.price == 0 && !item.priceChange) {
                        item.isSoftStop = item?.YMS2Price > 0 ? false : true;
                        item.successText = item?.YMS2Price > 0 ? 'success' : this.labels.YMS2Price_not_found;
                    }
                    if (event.detail.elementname == 'RFPriceChange') {
                        item.RFPriceChange = creditPriceDetails.rfPriceChange;
                    }
                    if (event.detail.elementname == 'reasonforselection') {
                        item.rfpriceselection = creditPriceDetails.reasonforselection;
                    }

                    item.boxCondition = creditPriceDetails.boxCondition;
                    item.lineitemStatus = creditPriceDetails.lineItemStatus; //added by manohar on jan 16th 2023 as part of case edit (line item status) TWC4621-899
                    let CP = event.detail.elementname == 'YMS2PriceExp' ? parseFloat(item.returnQuantity) * creditPriceDetails?.creditPriceExp : parseFloat(item.returnQuantity) * parseFloat(item.YMS2Price);
                    item.creditPrice = CP;
                }
                return item;
            }
        );
        //Start -- sandeep -- 8thfeb 2023 -- case edit (line item status) -- based on the line item status value  making checkbox value true/false -- TWC4621-957
        if (elementname === this.genericMessages.line_Item_Status_label && this.lineStatusbasedonCaseStatus && creditPriceDetails.lineItemStatus === this.lineStatusbasedonCaseStatus) {//TWC4621-1223- 24/04/23 - Accellor
            let attr = {
                detail: { invoiceNumber: InvoiceNumber, isChecked: false }
            };
            this.handleSelectedList(attr);
        } else if (elementname === this.genericMessages.line_Item_Status_label && this.lineStatusbasedonCaseStatus && creditPriceDetails.lineItemStatus !== this.lineStatusbasedonCaseStatus) {//TWC4621-1223- 24/04/23 - Accellor
            let attr = {
                detail: { invoiceNumber: InvoiceNumber, isChecked: true }
            };
            this.handleSelectedList(attr);
        }
        //End -- -- sandeep -- 8thfeb 2023 -- case edit (line item status) -- based on the line item status value  making checkbox value true/false -- TWC4621-957
    }

    //This method run on Back button of credit price--- User Story Number TWC4621-56--- Tushar Garg
    backToCreditPrice() {
        this.template.querySelector(".table-style-cls").scrollTop = 0;
        this.loading(true);
        this.handleNextClick("step-3");
        this.backStage = "step-2";
        this.isMatrixStage = false;
        this.showAllowMatrixNextBtn = true;
        this.isCreditPriceValidateion = true;
        let tempVar = this.poSearchWithLOETOShowData;
        tempVar.map((it) => {
            this.poSearchData.map((i) => {
                if (i && it && it.InvoiceNumber === i.InvoiceNumber) {
                    if (i.Error && !it.Error) {
                        it.Error = "";
                    }
                }
                return i;
            });
            return it;
        });

        tempVar.map((item) => {

            item.isReadOnlyBoxCondition = false;
            return item;
        });
        this.poSearchWithLOETOShowData = tempVar
            ? JSON.parse(JSON.stringify(tempVar))
            : [];
        this.poSearchData = tempVar ? JSON.parse(JSON.stringify(tempVar)) : [];
        //Start -- TWC4621-961 --- Agent UI ---  09/02/2023  -- bypassing credit price if it is a same day
        const todaysDate = this.dateCalculation();
        if (
            this.poSearchData.some((item) => {
                return (
                    item.selected === true &&
                    (item.creditPriceDate === ""
                        ? true
                        : todaysDate > this.dateCalculation(item.creditPriceDate)
                            ? true
                            : false)
                );
            })
        ) {
            this.validateCreditPrice = false;
            this.creditPriceNextBTN = true;
        } else {
            this.validateCreditPrice = true; //enabling credit price button
            this.creditPriceNextBTN = false; //enabling credit price next button
        }
        //End -- TWC4621-961 --- Agent UI ---  09/02/2023  -- bypassing credit price if it is a same day
        this.loading(false);
    }

    //This method run on next  button of credit price--- User Story Number TWC4621-56--- Tushar Garg
    NextToSubmit() {
        if (
            this.poSearchWithMatrixData.some((item) => {
                return item.selected === true;
            })
        ) {
            this.handleNextClick("step-5");
            this.backStage = "step-4";
            this.showViewSummary = true;
            this.isMatrixStage = false;
            let tempVar = this.poSearchWithMatrixData.filter((item) => {
                return item.selected;
            });

            tempVar.map((item, index) => {
                if (item && item.index) {
                    item.index = index + 1;
                } else {
                    item = { ...item, ...{ index: index + 1 } };
                }
                return item;
            });

            this.poSearchWithMatrixDataToSubmit = tempVar;
            this.poSearchData = tempVar;
        } else {
            this.showToast(
                this.labels.Please_select_some_items_first,
                'Items are not selected for the next stage.',
                "warning"
            );
        }
    }

    backToCalculateMatrix() {
        this.template.querySelector(".table-style-cls").scrollTop = 0;
        this.handleNextClick("step-4");
        this.backStage = "step-3";
        this.showViewSummary = false;

        // TWC4621-912 - Furqan - 16-01-2023 - TI Process Variables
        if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            this.tecnincalIntakeButtons.showCreditPriceTable();
            this.poSearchData.forEach((data, index) => {
                data.index = index + 1;
                data.display = data.step4Data || data.selected;
            });
        } else {
            this.isMatrixStage = true;
            this.poSearchData = this.poSearchWithMatrixData;
        }
    }

    // Start --- User Story Number TWC4621-148 --10-09-2022--- Manohar --- This method is used for navigating to case detail page
    cancelRequest() {
        let objname;
        let recId;

        if (this.casemode === "Edit" && this.caserec !== undefined) {
            objname = "Case";
            recId = this.caserec.Id;
        }
        else if (
            this.casemode === "Create" &&
            this.requestdetails.contactDetails !== undefined
        ) {
            objname = "Contact";
            recId = this.requestdetails.contactDetails.Id;
        }

        LightningConfirm.open({
            message: this.labels.Navigating_to_Case_Detail_Page,
            variant: "success",
            label: this.labels.Confirm_Message
        }).then((data) => {
            if (data) {
                // TWC4621-975 - Furqan - 08-02-2023 - TI Process Variables
                if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    this.tecnincalIntakeButtons.showPoSearchTable();
                }
                //Fixing portal naviagation issue
                if ((this.isPortal == "true" || this.isPortal == true) && objname != 'Case') {
                    this[NavigationMixin.Navigate]({
                        type: "standard__namedPage",
                        attributes: {
                            pageName: "home"
                        }
                    });
                    return;
                }
                this.closetab();
                this[NavigationMixin.Navigate]({
                    type: "standard__recordPage",
                    attributes: {
                        recordId: recId,
                        objectApiName: objname,
                        actionName: "view"
                    }
                });
            }
        });
    }
    // reusable method to close the console tab
    closetab() {
        this.invokeWorkspaceAPI("getFocusedTabInfo").then((focusedTab) => {
            if (focusedTab.tabId) {
                this.invokeWorkspaceAPI("closeTab", {
                    tabId: focusedTab.tabId
                });
            }
        });
    }
    //Start ---- US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- this method should run whenever we do any change in product
    handleProductChanges(event) {
        const elementname = event.detail.elementname;
        if (elementname === "productSelection") {
            this.poSearchData.map((item) => {
                if (item.MM === event.detail.MMID) {
                    item.selected = event.detail.value;
                }
                return item;
            });
        } else if (elementname === "searchPoNumber") {
            this.poSearchData.map((item) => {
                if (event.detail?.MMID && event.detail?.InvoiceNumber && item.MM === event?.detail.MMID && item.InvoiceNumber === event.detail.InvoiceNumber) {
                    item.poNumber = event.detail.value;
                    item.CustomerPONumber = event.detail.value;
                    item.isEnteredPOValidated = false; // Samuel - Validate PO
                } else if (event.detail.ULT && item.ult === event.detail.ULT) {
                    item.poNumber = event.detail.value;
                    item.CustomerPONumber = event.detail.value;
                    item.isEnteredPOValidated = false; // Samuel - Validate PO
                }
                return item;
            });
            //Start --- Sandeep --- TWC4621-938 --- 30th jan 2023 Merging earlier Searched data with Consequnt searches
            this.poSearchOldData.map((item) => {
                if (event.detail.MMID && item.MM === event.detail.MMID) {
                    item.poNumber = event.detail.value;
                    item.CustomerPONumber = event.detail.value;
                    item.isEnteredPOValidated = false; // Samuel - Validate PO
                } else if (event.detail.ULT && item.ult === event.detail.ULT) {
                    item.poNumber = event.detail.value;
                    item.CustomerPONumber = event.detail.value;
                    item.isEnteredPOValidated = false; // Samuel - Validate PO
                }
                return item;
            });
            //End --- Sandeep --- TWC4621-938 --- 30th jan 2023 Merging earlier Searched data with Consequnt searches
        }
    }

    returnToProductPageHandler(event) {
        //TWC4621-1020 -- sandeep -- feb24th 2023 -- Navigating to product validation page if we have existing data
        if (event.target.value) {
            this.handleClickProcessIndicator(event.target.value);
        }
    }

    //Start --- User Story Number TWC4621-1105 --- Agent UI ---  23/03/2023 -- Add a clone button in Credit price validation to select multiple box
    cloneHandler() {
        if (!this.poSearchData.some((it) => it.selected)) {
            this.showToast(
                this.labels.Error_Title,
                this.labels.no_record_is_selected_message,
                "error"
            );

        }
        else {
            LightningConfirm.open({
                message: this.labels.R4C_CloneItemConfirmation,
                variant: 'success',
                label: this.labels.r4c_ConfirmationHeader
            })
                .then((data) => {
                    if (data) {
                        let tempVar = [];
                        this.poSearchData.map(item => {
                            if (item.selected) {
                                let copiedObj = JSON.parse(JSON.stringify(item));
                                copiedObj.InvoiceNumber = this.stringGen(6) + '-' + item.Data.Name;
                                if (this.casemode === this.genericMessages.Edit_Label) {
                                    delete copiedObj.lineItemRecId;
                                }
                                tempVar.push(copiedObj);
                            }
                            return item;
                        });
                        this.poSearchData = [...this.poSearchData, ...tempVar];
                    }
                })
                .catch(e => {
                    console.error(e);
                    this.showToast(this?.labels?.Error_Title, this?.labels?.generic_error_msg, "error", "dismissable"); //Added as part of Failure Handling - TWC4621-3040
                })
        }
    }
    failedlineitem = [];//TWC4621-2886
    /* Start --- User Story Number TWC4621-54,72 --28-08-2022 --- Manohar --- This method is call in View and summary button 
      and save for Later functionalities(TWC4621-212,213,214,215) --Manohar,Ravi,Nishant --26-09-2022---*/

    async viewSummaryHandler(event) {
        let targetname = event.target.name;
        let lineitemdata = [];
        let casestatus;
        let boxConditionFailedItems = [];
        //manohar -- checking validations on input fields
        invokeCustomValidationElement(this);
        let childObj = this.template.querySelector("c-r4c_-a-g_-line-items-result-row");
        if (childObj) {
            let result = childObj.validateInputFields();
            if (!result) return;
        }
        //setting line item data to local variable
        if (this.requestdetails?.soldToCMFRec?.Customer_CPN_Support__c) {
            await this.cpncheckindicator();
            if (this.cpnmissingcount > 0) {
                return;
            }
        }
        if (this.caseType.isQualityService() && this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC) {
            lineitemdata = this.poSearchData.filter((data) => {
                return data.selected === true || data.productStatus === false || data.productStatus === true /*&& !data.disableRowBoxCondition*/;
            });
        } else {
            lineitemdata = this.poSearchData.filter((data) => {
                return data.selected === true && !data.disableRowBoxCondition;
            });
            let failedEccLineItem = [];

            if (this.isECCLineItemEdit) {
                failedEccLineItem = this.poSearchData.filter((data) => {
                    return data.selected === false;
                }).map(i => {
                    i.lineitemStatus = 'Unexpected Product - Declined';
                    i.Error = i?.errorText || ''
                    return i;
                })
            }
            else {
                this.failedlineitem = this.poSearchData.filter((data) => {
                    return data.VisIdbagError == true;
                });
            }

            lineitemdata = [...lineitemdata, ...this.failedlineitem, ...failedEccLineItem];//TWC4621-2886
        }
        if (this.isPortal == 'false' || this.isPortal == false) {
            // if((this.caseType.isAdminService() && (this.requestdetails.salesIssueReturnReason == 'Overship' || this.requestdetails.salesIssueReturnReason == 'Lost Shipment' || this.requestdetails.salesIssueReturnReason == 'Wrong Destination' || this.requestdetails.salesIssueReturnReason == 'Sample'))) { //TWC4621-4742
            //   if (targetname === this.genericMessages.Save_and_View_Summary && lineitemdata &&
            //     lineitemdata.some((item) => item.selected && (item.YMS2Price != item.tempYMS2Price && item.YMS2Price != 0))
            //   ) {
            //     this.showToast(
            //       this.labels.Missing,
            //       'Please fill the Credit Price as per Return Reason',
            //       "error"
            //     );
            //     return;
            //   }
            // }
            const price_Zero_RetrnResn = this.genericMessages?.Retrn_Resn_for_ZERO_Price?.split(';') || [];
            const price_Zero_OR_Orginal_RetrnResn = this.genericMessages?.Retrn_Resn_for_ZERO_OR_Original_Price?.split(';') || [];
            //TWC4621-4742,TWC4621-4789 -- added Retrn_Resn_for_ZERO_OR_Original_Price condition to allow zero dollar
            if (!(this.caseType.isTechnicalExchange() || (this.caseType.isMiscellaneousService() && this.requestdetails.remedyText == this?.genericMessages?.Return_Only) || (price_Zero_RetrnResn?.includes(this.requestdetails.salesIssueReturnReason)) || (price_Zero_OR_Orginal_RetrnResn?.includes(this.requestdetails.salesIssueReturnReason)))) { //TWC4621-1588 Bux Fixing -- added OR condition for technical exchange to exclude the price validation
                if (targetname === this.genericMessages.Save_and_View_Summary && lineitemdata &&
                    lineitemdata.some((item) => item.selected && (!item.YMS2Price || item.YMS2Price <= 0))
                ) {
                    this.showToast(
                        this.labels.Missing,
                        'Please fill in Valid Credit Price',
                        "error"
                    );
                    return;
                }
            } else if (!(this.caseType.isMiscellaneousService() && this.requestdetails.remedyText == this?.genericMessages?.Return_Only)) {
                if (targetname === this.genericMessages.Save_and_View_Summary && lineitemdata &&
                    lineitemdata.some((item) => item.selected && !item?.YMS2Price || item?.YMS2Price != 0)
                    && price_Zero_RetrnResn.includes(this.requestdetails.salesIssueReturnReason)) {
                    this.showToast(
                        this.labels.Missing,
                        'Please set the Credit Price to Zero',
                        "error"
                    );
                    return;
                }
            }
            if (targetname === this.genericMessages.Save_and_View_Summary && lineitemdata.some((data) => data.selected && (!data.returnQuantity || data.returnQuantity <= 0))) {
                this.showToast(
                    this.labels.Missing,
                    this.labels.return_qty_is_not_valid,
                    "error"
                );
                this.loading(false);
                return;
            }
            if (targetname === this.genericMessages.Save_and_View_Summary && lineitemdata.some((data) => data.selected && ((data.price == 0 || data.priceChange) && !data.RFPriceChange?.trim()))) {
                this.showToast(
                    this.genericMessages.Missing,
                    this.genericMessages?.priceChangeErrorMsg,
                    "error"
                );
                this.loading(false);
                return;
            }
        }
        if ((this.caseType.isExceptionService() && this.caseType?.remedy === this.genericMessages?.Credit) || this.requestdetails?.salesIssueReturnReason == 'Free of Charge Sample' || this.caseType.isStockRotation()) { //TWC4621-2030 added salesIssueReturnReason condition , for return reason "Return Only" product condition is mandtory
            lineitemdata.forEach((item) => {
                if (item.boxCondition == "") {
                    boxConditionFailedItems.push(item.MM)
                }
            })
            if (boxConditionFailedItems.length > 0) {
                this.showToast(
                    this.labels.Warning,
                    this.genericMessages?.Missing_Box_Condition,
                    "warning"
                );
                this.loading(false);
                return;
            }
        }
        if (targetname === this.genericMessages.Save_and_View_Summary && this.caseType.isExceptionRepair() && lineitemdata.some((data) => data.selected && (!data.expectedOutcomeValueForRepair))) { //Validating expected outcome value for remedy as repair
            this.showToast(
                this.labels.Warning,
                this.genericMessages?.Missing_Expected_Outcome,
                "warning"
            );
            this.loading(false);
            return;
        }
        if (lineitemdata.length > 0) {
            //TWC4621-962,992 --- Agent UI ---  09/02/2023 -- checking line items data length
            casestatus = this.casemode === this.genericMessages.Edit_Label ? this.caserec?.Status : this.genericMessages.Case_Status_Open_Unsubmitted;//TWC4621-1223- 24/04/23 - Accellor
            if (this.isECCLineItemEdit) casestatus = this.caserec?.Status;
            if (targetname === this.genericMessages.Save_and_View_Summary) {

                this.viewSummaryHndlrHelper(lineitemdata, targetname, casestatus);
            } else if (targetname === this.genericMessages.Save_for_Later) {
                LightningConfirm.open({
                    message: this.labels.Save_for_later_error_message,
                    variant: this.labels.Success_Message,
                    label: this.labels.Confirm_Message
                }).then((data) => {
                    if (data) {
                        this.viewSummaryHndlrHelper(lineitemdata, targetname, casestatus);
                    }
                });
            }
        } else {
            //TWC4621-962,992 --- Agent UI ---  09/02/2023 -- showing toast message if no line items selected
            this.showToast(
                this.labels.Warning,
                this.labels.no_record_is_selected_message,
                "warning"
            );
        }
    }

    showConsentPopup() {
        r4c_CX_NPRConsentModel.open({
            size: 'medium',
            label: 'NPR Consent Model',
            recordId: this.caserec.Id,
            isDownloadPdfBtn: false,
            isUltWarringMsg: this.tecnincalIntakeButtons.showLineItemTWDMsg,
            isAcceptBtn: false,
            isCancelPrompt: false
        })

    }
    /* --------- Helper Methods------------*/
    // Start---TWC4621-1067,TWC4621-1068--Accellor---09-03-2023--SR - generating random number for uniqueness of each line item

    //helper method for view summary and save for later functionalities
    viewSummaryHndlrHelper(lineitemdataDetails, targetname, casestatus) {
        let pathstage;
        let lineitemdata = lineitemdataDetails.map(i => {
            return JSON.parse(JSON.stringify(i))
        })
        if (lineitemdata) {
            lineitemdata.forEach((item) => {
                if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                    //BUG Fix- Bulk Upload
                    if (item?.warrantyResult && item?.warrantyCheck?.warrentyCheckDate) {
                        item.warrantyResult.BaseWarrantyStartDate = getApexDateString(item.warrantyResult.BaseWarrantyStartDate);
                        item.warrantyResult.BaseWarrantyEndDate = getApexDateString(item.warrantyResult.BaseWarrantyEndDate);
                        item.warrantyResult.ExtendedWarrantyStartDate = getApexDateString(item.warrantyResult.ExtendedWarrantyStartDate);
                        item.warrantyResult.ExtendedWarrantyEndDate = getApexDateString(item.warrantyResult.ExtendedWarrantyEndDate);
                        item.warrantyResult.warrentyCheckDate = getApexDateString(item.warrantyCheck.warrentyCheckDate);
                        item.creditPriceDate = getApexDateString(item.creditPriceDate)

                        if (!item.creditPrice) item.creditPrice = null;

                        //Fixing bug of not shoing warrenty status values 
                        let statusMsg = '';
                        //Do not put the below values in label as we dont need translation of these, and do not add to custom settings as these will not be changed
                        const warrentyStatus = {
                            ultValid: 'Valid ULT',
                            ultInvalid: 'Invalid ULT',
                            warrentyTBD: 'Warranty to be Decided',
                            warrentyValid: 'In warranty',
                            warrentyInvalid: 'Out of warranty'
                        }

                        if (item?.warrantyCheck?.isUnderWarrenty) {
                            if (this.caseType.remedy == 'Exchange') {
                                statusMsg = (item?.warrantyCheck.isExchangeValid) ? warrentyStatus.ultValid : warrentyStatus.ultInvalid;
                            }
                            else if (!item?.warrantyCheck?.isUltCorrect) {
                                statusMsg = warrentyStatus.ultInvalid;
                            }
                            else {
                                statusMsg = warrentyStatus.warrentyValid;
                            }

                        }
                        else if (item?.warrantyCheck?.isUnderCEPDays) {
                            statusMsg = warrentyStatus.warrentyTBD;
                            item.isSoftStop = true;
                        }
                        else {
                            statusMsg = warrentyStatus.warrentyInvalid;
                        }
                        item.warrantyResult.status = statusMsg;

                        if (!item?.warrantyResult?.CreditPeriodCount) {
                            item.warrantyResult.CreditPeriodCount = null;
                        }
                    }
                    if (!item.Error) {
                        item.Error = "";
                    } else if (item.errorText) {
                        item.Error = item.errorText;
                    }
                    if (this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC) {
                        item.lineitemStatus = item.Error ? this.genericMessages.Cancelled_Status_Value : item.lineitemStatus;
                        if (item.isULTSoftStop) item.Error = this.labels.ULT_not_Found;
                    }

                }
                if ((this.caseType.isQualityService() && this?.requestdetails?.remedyText == this.genericMessages?.Credit) || (this.caseType.isMiscellaneousService() && this.requestdetails.salesIssueReturnReason == 'Free of Charge Sample')) { //TWC4621-2499 -- MiscellaneousService -- FOC return Reason
                    item.warrantyResult.ProdUniqueId = item?.ult;
                }

                //JSON cleanup
                item = this._cleanLineWrapper(item);
            });
        }
        //setting the value for last saved path
        if (!(this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC) && (this.backStage === "" || this.backStage === undefined || this.backStage === this.genericMessages.step_zero)) {
            let templineitemdata = [];
            //TWC4621-811 -- Furqan -- based on servce type process line items
            //BUG FIX- Duplicate Line items
            lineitemdata.map((item) => {
                if (
                    item.selected &&
                    !templineitemdata.some((i) => {
                        return i && i.InvoiceNumber === item.InvoiceNumber;
                    })
                ) {
                    //commneted TWC4621-1067
                    templineitemdata.push(item);
                }
                return item;
            });
            let oldData;
            if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                oldData = this.poSearchOldTiData;
            } else {
                oldData = this.poSearchOldData;
            }
            oldData.map((item) => {
                if (
                    item.selected &&
                    !templineitemdata.some((i) => {
                        return i && i.InvoiceNumber === item.InvoiceNumber;
                    })
                ) {
                    //commneted TWC4621-1067
                    templineitemdata.push(item);
                }
                return item;
            });
            lineitemdata = templineitemdata;
            pathstage = this.genericMessages.PO_Search;
        } else if (this.backStage === this.genericMessages.step_one) {
            //Furqan
            pathstage = this.genericMessages.Product_Validation;
            if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                pathstage = this.genericMessages.Warranty_Entitlement_Check_label;
            }
        } else if (this.backStage === this.genericMessages.step_two) {
            pathstage = this.genericMessages.Credit_Price_Validation_label;
            if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                pathstage = this.genericMessages.Product_Validation_PO_History_label;
            }
        } else if (this.backStage === this.genericMessages.step_three) {
            pathstage = this.genericMessages.Allowed_Matrix_Validation;
            if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
                pathstage = this.genericMessages.Credit_Price_Validation_label;
            }
        }

        let caseExtraDetails = {
            Sales_Issue_Last_Saved_Path__c: pathstage
        };

        this.requestdetails = { ...this.requestdetails, ...caseExtraDetails };
        this.requestdetails.Sales_Issue_Last_Saved_Path__c = pathstage;
        delete this.requestdetails["Sold_CMF__C"];
        delete this.requestdetails["sales_Area__c"];
        delete this.requestdetails["Sales_Org__c"];
        //TWC4621-811 -- Furqan -- based on servce type adding techinal intake variables
        if (this.caseType.isTechnicalService() || this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            if (lineitemdata.length > 0 && lineitemdata[0].warrantyResult?.QueryNumber) {
                this.requestdetails.Sales_Issue_Query_Number__c =
                    lineitemdata[0].warrantyResult?.QueryNumber;
            }
        }

        this.loading(true);
        //Furqan
        let recordTypeName = this.genericMessages.Case_Stock_Rotation;
        if (this.caseType.isTechnicalService()) {
            recordTypeName = this.genericMessages.Technical_Intake_label;
        } else if (this.caseType.isQualityService()) {
            recordTypeName = this.genericMessages.Quality_Intake; //Manohar---Quality Intake --TWC4621-1359
        }
        else if (this.caseType.isExceptionService()) {
            recordTypeName = this.genericMessages.Exception_Intake;
        } else if (this.caseType.isAdminService()) {
            recordTypeName = this.genericMessages.Admin_Intake;
        } else if (this.caseType.isMiscellaneousService()) { //Manohar -- TWC4621-2011
            recordTypeName = this.genericMessages.Miscellaneous_Intake;
        }
        let caseLineSt = this.genericMessages.CPU_POH_Rejection_Status;
        //preparing data  to be sended to apex
        let returnReqDetailsWrapper = {
            customerReturnRequest: this.requestdetails, //collection and shipping details
            customerReturnRequestLineWrapperList: lineitemdata, //selected line item details
            caserec: this.caserec, //case record
            casemode: this.casemode, // case mode edit or create
            caserecTypeName: recordTypeName, // case recordtype developer name
            isPortal: this.isPortal, //TWC4621-904 - Samuel - Sending portal variable for case origin,
            contactDetails: this.requestdetails?.contactDetails, //Accellor -- 20/03/2023 -- TWC4621-1123 && TWC4621-1124 added contact details to the wrapper and those values are used in case insertion -- as part of data model changes
            remedyDetails: this.requestdetails?.remedyDetails,
            externalCaseId: this.requestdetails?.External_Case_ID__c, // Exchange R4E case id
            r4eCaseNumber: this.requestdetails?.r4eCaseNumber, // Exchange R4E case number
            // SHIPRA
            comments: this.requestdetails?.comments
        };

        if (!this.requestdetails?.contactDetails?.Id) {//added for Internal Customer flow
            delete returnReqDetailsWrapper["contactDetails"];
            delete returnReqDetailsWrapper.customerReturnRequest["contactDetails"];
        }
        let apexCall;
        if (this.isECCLineItemEdit) {
            console.log('2106saveCase', {
                returnReqDetails: returnReqDetailsWrapper,
                caseStatus: 'Discrepant'//casestatus
            })
            apexCall = updateECCLineItem({
                returnReqDetails: returnReqDetailsWrapper,
                caseStatus: casestatus
            })
        }
        else {
            console.log('saveCase', {
                returnReqDetails: returnReqDetailsWrapper,
                caseStatus: casestatus
            })
            apexCall = saveCase({
                returnReqDetails: returnReqDetailsWrapper,
                caseStatus: casestatus
            })
        }
        //apex calling
        apexCall
            .then((result) => {
                let message;
                if (
                    result.insertR4CCaseRes != undefined &&
                    result.customeraSalesIssueRequestInsertRecord != undefined &&
                    result.customeraSalesIssueRequestLineInsertRecord != undefined
                ) {

                    //Start -- Prashant -- Bug Fixes -- Adding CaseNumber on Successful case creation toast message
                    getCrrDetails({ recId: result.insertR4CCaseRes.Id })
                        .then((data) => {
                            this.relatedId = data.requestRec.Id;
                            this.crrRecord = data.requestRec;
                            this.caseNumber = this.crrRecord.Sales_Issue_CaseNumber__r.CaseNumber;
                            message = this.caseNumber + ' ' + this.labels.Case_is_Created_Successfully;
                            //End -- Prashant -- Bug Fixes -- Adding CaseNumber on Successfull case creation toast message

                            this.showToast(this.labels.Success_Message, message, "success");
                        })
                        .catch((error) => {
                            this.error = error;
                            this.crrRecord = undefined;
                            message = this.labels.Something_went_wrong_please_contact_super_user;
                            this.showToast(this.labels.Error_Title, message, "error");
                        });
                } else {
                    message = this.labels.Something_went_wrong_please_contact_super_user;
                    this.showToast(this.labels.Error_Title, message, "error");
                }

                //preparing data need to be sended to parent
                let templineitemdata = [];
                let caselineitemsresponse;
                if (result.customeraSalesIssueRequestLineInsertRecord != undefined) {
                    caselineitemsresponse = {
                        caserecord: result.insertR4CCaseRes, //added by ram sai
                        posearchmatrixdata: lineitemdata
                    };
                } else {
                    caselineitemsresponse = {
                        caserecord: result.insertR4CCaseRes, //added by ram sai
                        posearchmatrixdata: templineitemdata
                    };
                }
                if (
                    targetname === this.genericMessages.Save_and_View_Summary &&
                    result.insertR4CCaseRes !== undefined &&
                    result.customeraSalesIssueRequestInsertRecord !== undefined
                ) {
                    //custom event passing data to parent component(r4c_AG_POSearch)
                    const selectedEvent = new CustomEvent("handlecaseheader", {
                        bubbles: true,
                        composed: true,
                        detail: caselineitemsresponse
                    });
                    // Dispatches the event.
                    this.dispatchEvent(selectedEvent);
                } else if (
                    result.insertR4CCaseRes !== undefined &&
                    result.customeraSalesIssueRequestInsertRecord !== undefined
                ) {
                    if (this.requestdetails.salesIssueReturnReason == this.genericMessages?.FAC && this.poSearchData.every((data) => { return data.productStatus === false; })) {
                        // Manohar -- send Email To CQE if all line items failed
                        sendEmailToCQE({ caseId: result.insertR4CCaseRes.Id })
                            .catch((error) => {
                                this.showToast(this.labels.Error_Title, this.labels.Something_went_wrong_please_contact_super_user, "error");
                            });
                    }
                    // if it is save for later
                    if (this.isPortal == true || this.isPortal == "true") {
                        this[NavigationMixin.Navigate]({
                            type: "standard__recordPage",
                            attributes: {
                                recordId: result.insertR4CCaseRes.Id,
                                objectApiName: "Case",
                                actionName: "view"
                            }
                        });
                        return;
                    }
                    let pagetab;
                    let parenttab;
                    this.invokeWorkspaceAPI("getFocusedTabInfo")
                        .then((focusedTab) => {
                            if (focusedTab.isSubtab) {
                                pagetab = focusedTab.tabId;
                                parenttab = focusedTab.parentTabId;
                                this.invokeWorkspaceAPI("openSubtab", {
                                    parentTabId: parenttab,
                                    recordId: result.insertR4CCaseRes.Id,
                                    focus: true
                                }).then(() => {
                                    this.invokeWorkspaceAPI("closeTab", {
                                        tabId: pagetab
                                    }).then(() => {
                                        this.invokeWorkspaceAPI("refreshTab", {
                                            tabId: parenttab,
                                            includeAllSubtabs: true
                                        });
                                    });
                                });
                            } else {
                                let tempFocustab = focusedTab.tabId;
                                this.invokeWorkspaceAPI("openTab", {
                                    recordId: result.insertR4CCaseRes.Id,
                                    focus: true
                                }).then(() => {
                                    this.invokeWorkspaceAPI("closeTab", {
                                        tabId: tempFocustab
                                    });
                                });
                            }
                        });
                }
                this.loading(false);
            })
            .catch((error) => {
                console.log('2244', JSON.stringify(error))
                this.loading(false);
                this.showToast(
                    this.labels.Error_Title,
                    this.labels.Case_Insertion_Failed,
                    "error"
                );
            });
    }

    getApexDateFormat(date) {
        //BUG Fix - Save Case
        if (!(date instanceof Date)) date = new Date(date);
        let day = date.getDate();
        if (day < 10) day = "0" + day;
        let month = date.getMonth() + 1;
        if (month < 10) month = "0" + month;
        return `${date.getFullYear()}-${month}-${day}`;
    }

    stringGen(value) {
        let result = "";
        let input_length = +value;
        let chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < input_length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    loading(condition) {
        this.dispatchEvent(new CustomEvent("loading", { detail: condition }));
    }
    _processPaginationVariables() {
        // start - for pagination - CS
        let totalItems = this.poSearchData.filter(item => item.display == true)?.length || 0;
        if (totalItems != this.pagination.totalRecords) {
            this.pagination.totalRecords = totalItems;
            this.showSpinner = true;
            setTimeout(() => {
                this.showSpinner = false;
            }, 100);
        }
        this.pagination.totalPages = Math.ceil(this.pagination.totalRecords / RECORDS_PER_PAGE);
        this.pagination.indStart = (this.pagination.currentPage - 1) * RECORDS_PER_PAGE;
        this.pagination.uiIndStart = this.pagination.indStart + 1;
        this.pagination.indEnd = this.pagination.indStart + RECORDS_PER_PAGE;
        if (this.pagination.indEnd > this.pagination.totalRecords) {
            this.pagination.indEnd = this.pagination.totalRecords;
        }
        //end - for pagination - CS
    }
    resetPaginationVariableOnPageChange() {
        this.pagination.currentPage = 1;
        this._processPaginationVariables();
    }
    //Reusable method to show toast message--- User Story Number TWC4621-52--- Tushar Garg
    showToast(title, message, variant) {
        const event = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant
        });
        this.dispatchEvent(event);
    }
    //Start -- TWC4621-961 --- Agent UI ---  09/02/2023 -- formating date
    dateCalculation(inputParam) {
        let today;
        if (inputParam != undefined) {
            today = new Date(inputParam);
        } else {
            today = new Date();
        }
        const currentDateTime =
            today.getFullYear() +
            "-" +
            (today.getMonth() + 1 < 10 ? "0" : "") +
            (today.getMonth() + 1) +
            "-" +
            (today.getDate() < 10 ? "0" : "") +
            today.getDate();
        return currentDateTime;
    }
    // console workspace API method
    invokeWorkspaceAPI(methodName, methodArgs) {
        return new Promise((resolve, reject) => {
            const apiEvent = new CustomEvent("internalapievent", {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail: {
                    category: "workspaceAPI",
                    methodName: methodName,
                    methodArgs: methodArgs,
                    callback: (err, response) => {
                        if (err) {
                            return reject(err);
                        }
                        return resolve(response);
                    }
                }
            });
            window.dispatchEvent(apiEvent);
        });
    }

    /* Tecnincal Intake */

    // Start - TWC4621-912 - Furqan - 16-01-2023 - TI Process Methods
    async validateWarranty() {
        await validateWarranty(this);
    }
    validateCEP() {
        //Po hsitory check for sleected line items that are not under CEP
        if (this.caseType.isTechnicalService()) {
            validateCEP(this);
        } else if (this.caseType.isQualityService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            validateMRB(this);
        }
    }
    async fetchCreditPrice() {
        if (this.caseType?.isMiscellaneousService() && this.requestdetails?.salesIssueReturnReason == 'Free of Charge Sample') {
            if (this.poSearchData.some((data) => data.selected && data.ult && data.ult.length < 6)) {
                this.showToast(this.labels.Warning, this.labels.ULT_min_length_Toast_msg, "warning");
                return;
            }
            if (this.poSearchData.some((data) => data.selected && data.ult && data.ult.length > 40)) {
                this.showToast(this.labels.Warning, this.labels.ULT_max_length_Toast_msg, "warning");
                return;
            }
            let ultList = this.poSearchData.map((data) => {
                let status = '';
                if (data.selected && data.ult) {
                    status = data.ult?.match(/^[0-9]+$/) ? data?.ult : data?.ult?.trim()?.toUpperCase();
                }
                return status;
            }).filter((data) => data);

            const duplicates = ultList.filter((item, index) => index !== ultList.indexOf(item));
            let request = this.poSearchData
                .filter((data) => data.selected == true)
                .map((data) => {
                    //ULT Duplicate check
                    let ult = data.ult?.match(/^[0-9]+$/) ? data?.ult : data?.ult?.trim()?.toUpperCase();
                    data.isUltDuplicate = duplicates.indexOf(ult) > -1;
                    data.ult = ult;
                })
            //check for duplicate ult
            invokeCustomValidationElement(this);
            if (new Set(ultList).size !== ultList.length) {
                LightningAlert.open({
                    message: this.labels.TI_ULT_Error_msg,
                    variant: "header",
                    label: this.labels.TI_ULT_Error_Header
                });
                return;
            }
        }
        await fetchCreditPrice(this);
    }

    validateExchangeWarranty() {
        let failedItems = this?.poSearchData.filter(data => data?.warrantyCheck?.isWarrentyCEPDaysValid == false && data.errorText.includes(this.labels.TI_Warrenty_SourceSystem_InvlaidErrorMsg));
        //console.log('failedItems', failedItems)
        r4c_AG_ExchangeWarrantyCheck.open({
            size: 'full',
            description: 'Validate Failed items with Exchange remedy',
            label: this.labels?.R4C_Validate_With_Exchange,
            lineItems: failedItems,
            isPortal: this.isPortal,
            casemode: this.casemode,
            genericMessages: this.genericMessages,
            caserec: this.caserec,
            requestdetails: this.requestdetails,
            caseType: this.caseType,
            receiptConditions: this.receiptConditions,
            ontoast: (e) => {
                const { title, msg, err } = e.detail;
                this.showToast(title, msg, err);
            }
        })
            .then(res => {
                //console.log(res)
            })
    }

    async warrentyCheckNextHandler() {


        if (this.caseType.isTechnicalService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            warrentyCheckNextHandler(this);
        } else if (this.caseType.isQualityService()) {
            warrentyScreenNextHandler(this);
        }

    }
    poHistoryCheckNextHandler() {
        if (this.caseType.isTechnicalService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            poHistoryCheckNextHandler(this);
        } else if (this.caseType.isQualityService()) {
            mrbRefNumberCheckNextHandler(this);
        }

    }
    creditPriceNextHandler() {
        creditPriceNextHandler(this);

    }

    backToWarrentyChekScreenHandler() {
        backToWarrentyChekScreenHandler(this);
    }
    backToPOHistoryCheckScreenHandler() {
        if (this.caseType.isTechnicalService() || this.caseType.isExceptionRepair() || (this.caseType?.isExceptionService() && this.requestdetails.salesIssueReturnReason == this.genericMessages.GRL_Exception)) {
            backToPOHistoryCheckScreenHandler(this);
        } else if (this.caseType.isQualityService()) {
            backToMRBRefNumberScreenHandler(this);
        }
    }
    async checkRequiredMatrix() {

        await checkRequiredMatrix(this);
    }
    productValidateNextHandlerTechnical() {
        productValidateNextHandlerTechnical(this);
    }
    /* Stock Rotation */

    // This method is used to validate the product--- User Story Number TWC4621-52--- Tushar Garg
    productValidateNextHandler() {
        productValidateNextHandler(this);
    }
    // Start ---US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- Continuation method to for PO History button
    poHistoryHandler() {
        poHistoryHandler(this);
    }
    // End ---US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- Continuation method to for PO History button
    // Method to  Get PCN /LOE Dates --- User Story Number TWC4621-147--- Tushar Garg
    getLOEDatesHandler() {
        getLOEDatesHandler(this);
    }
    // This price show the selected credit price  --- User Story Number TWC4621-52--- Tushar Garg
    creditPriceNextBtnHandler() {
        creditPriceNextBtnHandler(this);
    }

    // This method get the values from credit price --- User Story Number TWC4621-56--- Tushar Garg
    getCreditPriceHandler() {
        getCreditPriceHandler(this);
    }
    //This method run on  the allow Matrix Next Btn Handler --- User Story Number TWC4621-56--- Tushar Garg
    allowMatrixNextBtnHandler() {
        //Validating Credit price and Reason for price change values
        if (this.poSearchData && (this.isPortal === false || this.isPortal === 'false') &&  //Added portal condition check - Samuel
            this.poSearchData.some((item) => item.selected && (!item.YMS2Price || item.YMS2Price <= 0))) {
            this.showToast(this.labels.Missing, 'Please fill in Valid Credit Price', "error");
            return;
        }
        if ((this.isPortal === false || this.isPortal === 'false') && this.poSearchData.some((data) => data.selected && ((data.price == 0 || data.priceChange) && !data.RFPriceChange?.trim()))) {
            this.showToast(this.genericMessages.Missing, this.genericMessages?.priceChangeErrorMsg, "error");
            this.loading(false);
            return;
        }
        allowMatrixNextBtnHandler(this);
    }

    //This method calculate the amount of allow matrix Ammount--- User Story Number TWC4621-56--- Tushar Garg
    calculateAmmount() {
        calculateAmmount(this);
    }
    // This method runs on back button --- User Story Number TWC4621-56--- Tushar Garg
    handleBackClickToLOE() {
        handleBackClickToLOE(this);
    }
    // Exception Intake----- Tushar Garg	
    fetchCreditPriceException() {
        fetchCreditPriceException(this);
    }
    creditPriceExpNextBtnHandler() {
        creditPriceExpNextBtnHandler(this);
    }
    poHistoryHandlerExp() {
        poHistoryHandlerExp(this);
    }
    async cpncheckindicator() {
        this.cpnmissingcount = 0;
        let mmList = [...new Set(this.poSearchData.filter((item) => item.selected && !item.customerItemNbr && item.MM).map((item) => {
            if (this.alphanumeric(item.MM)) {
                return String(item.MM).padStart(18, "0");
            } else {
                return item.MM;
            }
        }))].filter((i) => i);
        //console.log('2491',mmList)
        if (mmList.length > 0) {
            this.isLoading = true;
            await MMCPNAPIcheck(mmList, [""], [this.requestdetails?.sales_Area__c?.Customer_Sales_Organization__r?.Customer_Sales_Organization_Code__c],
                [this.requestdetails?.sales_Area__c?.Customer_Disti_Channel__r?.Customer_Distribution_Channel_Code__c],
                [this.requestdetails?.selectedsoldToCMF])
                .then((result) => {
                    if (result?.isError == true) {
                        throw new Error("MM/CPN API Failure");
                    }
                    if (result?.apiResult?.length > 0) {
                        result = JSON.parse(result.apiResult);
                        const itemCountMap = new Map();
                        let hasMultipleCustomerPartNumbers = false;
                        for (const item of result) {
                            //SaiRam - TWC4621-5092 To Support MM CPN for Both IAO and R4C Start
                            if (this.genericMessages.isIaoFlag == 'true' || this.genericMessages.isIaoFlag == true) {
                                if (itemCountMap.has(item.ITEM_ID)) {
                                    // we've seen this itemId before, so increment the count of customerpartnumbers
                                    const count = itemCountMap.get(item.ITEM_ID);
                                    itemCountMap.set(item.ITEM_ID, count + 1);
                                    if (count + 1 >= 2) {
                                        hasMultipleCustomerPartNumbers = true;
                                        break;
                                    }
                                } else {
                                    // this is the first time we've seen this itemId, so add it to the itemCountMap with a count of 1
                                    itemCountMap.set(item.ITEM_ID, 1);
                                }
                            } else {
                                if (itemCountMap.has(item.ItemId)) {
                                    // we've seen this itemId before, so increment the count of customerpartnumbers
                                    const count = itemCountMap.get(item.ItemId);
                                    itemCountMap.set(item.ItemId, count + 1);
                                    if (count + 1 >= 2) {
                                        hasMultipleCustomerPartNumbers = true;
                                        break;
                                    }
                                } else {
                                    // this is the first time we've seen this itemId, so add it to the itemCountMap with a count of 1
                                    itemCountMap.set(item.ItemId, 1);
                                }
                            }
                            //SaiRam - TWC4621-5092 To Support MM CPN for Both IAO and R4C End
                        }
                        if (hasMultipleCustomerPartNumbers) {
                            this.showDuplicateMM = true;
                            this.MMCPNApiRes = result;
                        } else {
                            this.showDuplicateMM = false;
                            this.MMCPNApiRes = result;
                            this.showUpdatedCPNOnTable(null);
                        }
                    }
                })
                .catch((error) => {
                    console.error(error);
                    this.showToast(this.labels.Error_Title, this.labels.MM_CPN_Failed, "error");
                })
                .finally(() => {
                    this.loading(false);
                });
        }
        return this.cpnmissingcount;
    }
    hideMMCPNModalHandler() {
        this.showDuplicateMM = false;
    }
    async showUpdatedCPNOnTable(event) {
        this.showDuplicateMM = false;
        let mmCPNMap = new Map();
        if (event != null && event.detail != null) {
            this.MMCPNApiRes = JSON.parse(event.detail);
        }
        if (this.MMCPNApiRes.length > 0) {
            this.MMCPNApiRes.map((mmCPNRes) => {
                //SaiRam - TWC4621-5092 To Support MM CPN for Both IAO and R4C Start
                if (this.genericMessages.isIaoFlag == 'true' || this.genericMessages.isIaoFlag === 'true') {
                    mmCPNMap.set(
                        mmCPNRes.ITEM_ID.replace(/^0+/, ""),
                        mmCPNRes.CUSTOMER_PART_NBR
                    );
                } else {
                    mmCPNMap.set(
                        mmCPNRes.ItemId.replace(/^0+/, ""),
                        mmCPNRes.CustomerPartNbr
                    );
                }
                //SaiRam - TWC4621-5092 To Support MM CPN for Both IAO and R4C Start

                return mmCPNRes;
            });
        }
        this.poSearchData.forEach((item) => {
            if (item.selected && !item.customerItemNbr) {
                if (mmCPNMap?.get(item?.MM)) {
                    item.customerItemNbr = mmCPNMap?.get(item?.MM);
                } else {
                    item.errorText = this.labels.R4C_CPN_ErrorMsg;
                    item.productStatus = false;
                    item.selected = item.productStatus;
                    item.Error = !item.productStatus;
                    this.cpnmissingcount++;
                }
            }
        });
    }

    //Syed - on click of next and back verify if all elements are selected if yes then mark check box as true
    updateSelectAllCheckbox() {
        setTimeout(() => {
            const listElm = this.poSearchData;
            let selectedElements = listElm.filter(i => {
                return i.selected == true;
            });
            if (selectedElements.length > 0) {
                let displayElements = listElm.filter(i => {

                    return i.display == true && i.productStatus == true
                });
                if (displayElements.length == selectedElements.length) {
                    this.allselectedcheckbox = true;
                }
                else {
                    this.allselectedcheckbox = false;
                }
            }
        }, 100)
    }

    async updateLineItems() {
        //Unexpected Lines - Samuel - All lines failure scenario fix to get price
        await this.fetchCreditPrice();
        let lineitemdata = this.poSearchData;

        //manohar -- checking validations on input fields
        let childObj = this.template.querySelector("c-r4c_-a-g_-line-items-result-row");
        if (childObj) {
            let result = childObj.validateInputFields();
            if (!result) return;
        }
        //setting line item data to local variable
        if (this.requestdetails?.soldToCMFRec?.Customer_CPN_Support__c) {
            await this.cpncheckindicator();
            if (this.cpnmissingcount > 0) {
                return;
            }
        }

        let toUpdateLineItemData = lineitemdata.map(i => {
            return {
                Id: i.lineItemRecId,
                Sales_Issue_Line_Item_Status__c: 'Unexpected Product - Declined',
                Line_item_error_messages__c: i?.errorText || '',
                Sales_Issue_Disti_Price__c: i?.YMS2Price || 0,
                Sales_Issue_Pricing_Condition_Type__c: i?.pricingCondition || '',
                Sales_Issue_PO_Price__c: i?.UnitPrice || 0
            }
        })
        this.showSpinner = true;
        LightningConfirm.open({
            message: 'Save Line Item Status',
            variant: this.labels.Success_Message,
            label: this.labels.Confirm_Message
        }).then((data) => {
            if (data) {
                updateECCLineItemStatus({
                    customerReturnRequestLineList: toUpdateLineItemData
                })
                    .then(() => {
                        this.invokeWorkspaceAPI("getFocusedTabInfo")
                            .then((focusedTab) => {
                                if (focusedTab.isSubtab) {
                                    let pagetab = focusedTab.tabId;
                                    let parenttab = focusedTab.parentTabId;
                                    this.invokeWorkspaceAPI("openSubtab", {
                                        parentTabId: parenttab,
                                        recordId: this.caserec.Id,
                                        focus: true
                                    }).then(() => {
                                        this.invokeWorkspaceAPI("closeTab", {
                                            tabId: pagetab
                                        }).then(() => {
                                            this.invokeWorkspaceAPI("refreshTab", {
                                                tabId: parenttab,
                                                includeAllSubtabs: true
                                            });
                                        });
                                    });
                                } else {
                                    let tempFocustab = focusedTab.tabId;
                                    this.invokeWorkspaceAPI("openTab", {
                                        recordId: this.caserec.Id,
                                        focus: true
                                    }).then(() => {
                                        this.invokeWorkspaceAPI("closeTab", {
                                            tabId: tempFocustab
                                        });
                                    });
                                }
                            });
                        this.showSpinner = false;
                    })
                    .catch(e => {
                        this.showToast(this?.labels?.Error_Title, this?.labels?.generic_error_msg, "error"); //Added as part of Failure Handling - TWC4621-3040
                    })
            }
            else {
                this.showSpinner = false;
            }
        });
    }

    alphanumeric(inputtxt) {
        var letterNumber = /^[0-9]+$/;
        return inputtxt.match(letterNumber) ? true : false;
    }
    _cleanLineWrapper(item) {
        //Line wrap
        delete item["isPoNumberEditable"];
        delete item["display"];
        delete item["productStatus"];
        //delete item["selected"];
        delete item["isULTNumberEditable"];
        delete item["isULTNumberEditable"];
        delete item["page"];
        delete item["itemNumber"];
        delete item["step2Data"];
        delete item["boxConditionDisabled"];
        delete item["isUltRequired"];
        delete item["ultDisabled"];
        delete item["quantityDisabled"];
        delete item["isUltDuplicate"];
        delete item["isSoftStop"];
        delete item["isULTSoftStop"];
        delete item["poValidated"];
        delete item["isPoHistoryValid"];
        delete item["checkMMBUObj"];
        delete item["warrentyValidated"];
        delete item["index"];
        delete item["step2DisplayLock"];
        delete item["step3Data"];
        delete item["step3DisplayLock"];
        delete item["priceCheck"];
        delete item["isValidationInputRequired"];
        // delete item["checkMMBUObj"];

        //Warranty Check
        if (item?.warrantyCheck?.warrentyCheckDate) {
            delete item.warrantyCheck["isCEPDaysValidValue"];
            delete item.warrantyCheck["isUnderWarrenty"];
            delete item.warrantyCheck["isUnderCEPDays"];
            delete item.warrantyCheck["isMMChange"];
            delete item.warrantyCheck["isError"];
            delete item.warrantyCheck["isUltCorrect"];
            delete item.warrantyCheck["isExchangeValid"];
            delete item.warrantyCheck["isMRBQANValid"];
            delete item.warrantyCheck["isGRLExceptionValid"];
            delete item.warrantyCheck["iSOutOfWarrenty"];
            delete item.warrantyCheck["isCanceled"];
            delete item.warrantyCheck["isUltValid"];
            delete item.warrantyCheck["isWarrentyCEPDaysValid"];
        }
        //MM data
        if (item?.Data?.Id) {
            delete item.Data["Item_Type__c"];
            delete item.Data["Name"];
            delete item.Data["Item_PCN_date__c"];
            delete item.Data["Item_Spec_Code__c"];
            delete item.Data["Item_Cust_Product_To_Order__c"];
            delete item.Data["ICS_WR_SBS_Name__c"];
            delete item.Data["ICS_WR_Family_Name__c"];
            delete item.Data["Item_Product_Description__c"];
            delete item.Data["Item_Order_Part_Number__c"];
            delete item.Data["Item_Product_Code__c"];
            //delete item.Data["ICS_WR_Operation_Business_Unit_Code__c"];
            delete item.Data["Disti_Channel_Product_Statuses__r"];
        }
        return item;
    }

    //Samuel - Validate PO
    _validatePO() {
        try {
            console.log('this.requestdetails', JSON.stringify(this.requestdetails));
            console.log('this.poSearchData', JSON.stringify(this.poSearchData));
            this.loading(true);
            var requestDetailsVal = this.requestdetails;
            var selectedPoArr;
            selectedPoArr = this.poSearchData.map((item) => item?.poNumber.trim());
            if (selectedPoArr.length < 0) {
                return;
            }
            let refreshPopUpUi = false;

            //Start - TWC4621-
            POsearchAPI(this, [...new Set(selectedPoArr)], [], this.caseType.serviceType,
                '', '')
                .then(async (res) => {
                    //console.log('poResult ', poResult);
                    if (res?.isError == true) {
                        throw new Error("PO SEARCH API Failure");
                    }
                    let poResult = res?.apiResult;
                    let productStatusNumericCodes = new Set();//TWC4621-5414 NCNR Matrix Check
                    let itemCustomIndicatorValues = new Set(); ////TWC4621-5514 NCNR handling blank values in NCNR Matrix - Storing Custom Indicator for NCNR Matrix query
                    this.poSearchData.map((item) => {
                        if (this.genericMessages?.NCNR_Check == "true" && (this.caseType.isExceptionService() || this.caseType.isStockRotation())) { //TWC4621-5414 NCNR Matrix Check
                            productStatusNumericCodes.add(item?.Data?.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c);
                            itemCustomIndicatorValues.add(item?.Data?.Item_Custom_Indicator__c);
                        }
                        if (item.poNumber != '' && !item.isEnteredPOValidated) {
                            let poHistoryData = [];
                            poHistoryData = poResult?.elements.find((data) => {
                                // let mmDates = _processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate);
                                // let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                return (
                                    data.ItemId == item.MM &&
                                    data.CustomerPurchaseOrderNbr == item.poNumber
                                );
                            });

                            if (poHistoryData) {
                                let popuplateStatus = popuplateLineItemPopupData(
                                    item,
                                    poHistoryData,
                                    this.genericMessages.isIaoFlag == 'true'
                                );//TWC4621-5161 -- added isIaoFlag for IAO conditions
                                refreshPopUpUi = popuplateStatus.status;
                                item = popuplateStatus.item;
                                item.productStatus = true;
                                item.isEnteredPOValidated = true;

                                item.poValidated = this.showTecnicalIntakeBtn ? false : true; //For Warranty steps, need to validate dates with EH dates.
                                item.isPoNumberEditable = false;
                                item.isPoHistoryValid = true;
                                item.poNumber = ''; //Removing to handle SR PO History button logic
                                //Confirm Manohar abt poSearchDataMap using invoiceNumber
                                //Compare SR PO History method line variables if required
                                console.log('item', JSON.stringify(item));
                            }
                            else {
                                item.selected = false;
                                item.productStatus = false;
                                item.Error = true;
                                item.errorText = this.labels.PO_Search_Record_Not_Found;
                                item.isEnteredPOValidated = true;
                                item.isPoNumberEditable = false;
                                item.poValidated = true;
                                item.isPoHistoryValid = false;
                            }
                        }
                    })
                    console.log('NCNR CHECK ', productStatusNumericCodes, itemCustomIndicatorValues);

                    //NCNR Matrix Check TWC4621-5414
                    if (this.genericMessages?.NCNR_Check == "true" && productStatusNumericCodes.size > 0) {
                        console.log('Status Codes ', productStatusNumericCodes);
                        let requestData = {
                            Product_Status_code_c: [...productStatusNumericCodes],
                            Item_Custom_Indicator__c: [...itemCustomIndicatorValues]
                        }
                        await getMatrixRecord({
                            recordType: 'Sales_Issue_NCNR_Matrix',
                            requestData: JSON.stringify(requestData)
                        }).then((result) => {
                            if (result.length > 0) {
                                console.log('NCNR Matrix', result);
                                this.poSearchData.forEach(item => {
                                    if (item.selected) {
                                        let record = result.filter((resp) => {
                                            if (item?.Data?.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c === resp?.Product_Status_Code__c && resp?.Item_Custom_Indicator__c === item?.Data?.Item_Custom_Indicator__c) {
                                                return true;
                                            } else if (item?.Data?.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c === resp?.Product_Status_Code__c && resp?.Item_Custom_Indicator__c == null) {
                                                return true;
                                            } else if (resp?.Product_Status_Code__c == null && resp?.Item_Custom_Indicator__c === item?.Data?.Item_Custom_Indicator__c) {
                                                return true;
                                            } else {
                                                return false;
                                            }
                                        });
                                        console.log('Filtered matrix ', record.length, record);
                                        console.log('1947', JSON.stringify(item))
                                        if (record && item.selected == true) {
                                            item.productStatus = false;
                                            item.selected = false;
                                            item.Error = true;
                                            item.errorText = 'Record is NCNR';
                                        }
                                        item.isNcnrValidated = item.selected || item.productStatus == false ? true : false;
                                        return item;
                                    }
                                })
                            }
                        }).catch((error) => {
                            console.error(error);
                            this.loading(false);
                        });
                    }
                })
                .catch((error) => {
                    console.log("callHANAAPIContinuation error", error);
                    this.showToast(
                        this.labels.Error_Title,
                        this.labels.generic_error_msg,
                        "error");
                })
                .finally(() => {
                    this.loading(false);
                    if (refreshPopUpUi) {
                        invokeRefreshRowElement(this);
                    }
                });
            //End - TWC4621-3660 - Add all API from JS to Util component -Manohar

        }
        catch (error) {
            console.log(error);
            this.showToast(this?.labels?.Error_Title, this?.labels?.generic_error_msg, "error"); //Added as part of Failure Handling - TWC4621-3040

        }
    }

    //IAO Changes Remove OPID and show profit center in place of OPID only for Agent UI
    //TWC4621-5330 Start
    get showProfitCenter() {
        return this.genericMessages.isIaoFlag == 'true' && (!this.isPortal == true || !this.isPortal == "true");
    }

    get isNotIaoUI() {
        return !this.genericMessages.isIaoFlag == 'true'
    }
    //TWC4621-5330 End
}