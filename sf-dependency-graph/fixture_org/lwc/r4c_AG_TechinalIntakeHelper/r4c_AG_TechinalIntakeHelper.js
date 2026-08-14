/* eslint-disable no-else-return */
/******************************************************** 	
//* @Component Name: r4c_AG_TechinalIntakeHelper 	
//* @Author :  	Furqan
//* @DateCreated :  26-Jan-2023	
//* @Description : All tecnical intake related logic for r4c_AG_LineItemsResultTable cmp. 	
//* @LastModifiedDate : 13-Sept-2024 	
//* @LastModifiedBy : Syed Ahmed. 	
//* @ParentComponent : r4c_AG_LineItemsResultTable, r4c_AG_QualityIntakeHelper, r4c_AG_ExchangeWarrantyCheck
//* @ChildComponent : r4c_AG_mmchangepopup, r4c_AG_pochangepopup, r4c_AG_LineItemsResultTableUtill, r4c_stringFormatter, r4c_AG_LineItemsCloneModal
//* @ApexController : R4C_AG_POSearch_Controller,R4C_BusinessRule_Service,R4C_API_POsearch_HANAConsumingClass,R4C_EntAPI_GetWarrentyConsumingClass
/******************************************************************/

import getWarrantyCheck from "@salesforce/apexContinuation/R4C_EntAPI_GetWarrentyConsumingClass.invokeInitialRequest";
import poHistoryCheckV2 from "@salesforce/apexContinuation/R4C_API_POsearch_HANAConsumingClass.invokeInitialRequest";
import getMatrixRecord from "@salesforce/apex/R4C_BusinessRule_Service.getRule";
import getLineItems from "@salesforce/apex/R4C_AG_POSearch_Controller.getLineItems";
import getCaseWithUlt from "@salesforce/apex/R4C_AG_POSearch_Controller.getCaseWithUlt";
import LightningAlert from "lightning/alert";
import ModalForMMChange from "c/r4c_AG_mmchangepopup";
import ModalForPOChange from "c/r4c_AG_pochangepopup";
import ModalForLineItemsClone from "c/r4c_AG_LineItemsCloneModal";
import r4c_CustomLabels from "c/r4c_CustomLabels";
import { StringFormatter } from 'c/r4c_stringFormatter';
import { fieldSorter } from "c/r4c_CX_QuerySearchUtill";
import { poHistoryCheck } from "c/r4c_AG_LineItemsResultTableUtill";
import { popuplateLineItemPopupData, getApexDateString, getULTDuplicates, generateWarrantyRequestBody, stringGen, splitArrayIntoChunks, filterBAGList, splitObjectArrayIntoChunks } from "c/r4c_AG_LineItemsResultTableUtill";
let tecnincalIntakeButtons = {
    //Refrence
    that: undefined,
    setThis(t) {
        this.that = t;
    },
    //action btns
    showWarrantyEntitlementValidateBtn: false,
    showPOHistoryCheckValidateBtn: false,
    showCreditPriceValidateBtn: false,
    showPOHistoryCheckNextBtn: false,
    showPOHistoryCheckSaveBtn: false,
    //poupup buttons
    showConsentModal: false,
    showLineItemTWDMsg: false,
    get showCODAgreementButton() {
        return (
            this.that.casemode == "Edit" &&
            this.that.caseType.remedy == "NPR-Credit" &&
            this.that?.caserec?.Sales_Issue_Crt_Of_Destruction_Date__c
        );
    },
    get showCheckExchangeWarrantyButton() {
        let status = false;
        if (this.showWarrantyEntitlementValidateBtn == false) {
            return false;
        }
        else if (this.that.caseType.isTechnicalExchange()) {
            return false;
        }
        else if (this.that.caseType.isTechnicalNPRCredit() || this.that.caseType.isTechnicalCredit()) {
            status = this?.that?.poSearchData.some(data => data?.warrantyCheck?.isWarrentyCEPDaysValid == false && data.errorText.includes(r4c_CustomLabels.labels.TI_Warrenty_SourceSystem_InvlaidErrorMsg));
        }


        return status;
    },
    get isRecordSelected() {
        return this?.that?.poSearchData.some((data) => data.selected);
    },
    // TWC4621-1047 - Furqan - 22-02-2023 - adding disable condition to validation buttons
    get disableValidateWarrentyBtn() {
        return !this.that.poSearchData.some(
            (data) =>
                data.selected == true &&
                (data.warrentyValidated == undefined || data.warrentyValidated == false)
        );
    },
    get disableValidatePoHistoryBtn() {
        if (this.that.caseType.isTechnicalService() || this.that.caseType?.isExceptionRepair() || (this.that.caseType?.isExceptionService() || this.that.caseType?.isAdminService() || this.that.caseType?.isMiscellaneousService())) { //Manohar -- TWC4621-2011 -- added isMiscellaneousService condition
            return !this.that.poSearchData.some(
                (data) =>
                    data.selected == true &&
                    (data.poValidated == undefined || data.poValidated == false)
            );
        } else if (this.that.caseType.isQualityService()) {
            return !this.that.poSearchData.some(
                (data) =>
                    data.selected == true &&
                    (data.poValidated == undefined || data.poValidated == false || (this.that.requestdetails.salesIssueReturnReason === this.that.genericMessages?.QAN_MRB_PRT && data.mrbValidated == undefined || data.mrbValidated == false))
            );
        }
    },
    get disableValidatePriceCheckBtn() {
        return !this.that.poSearchData.some(
            (data) =>
                data.selected == true &&
                (data.priceCheck == undefined || data.priceCheck == false)
        );
    },
    get disableWarrentyCheckBackBTN() { //quality
        if (!this.that) return false;
        //if (!this.isRecordSelected) return true;
        return this.that.caseType.remedy === this.that.genericMessages?.Credit && this.that.requestdetails.salesIssueReturnReason === this.that.genericMessages?.FAC
    },
    //nxt btns -
    get disableWarrentyCheckNextBTN() {
        if (!this.that) return false;
        if (!this.isRecordSelected) return true;
        return this?.that?.poSearchData.some(
            (item) => item.selected == true && !item.warrentyValidated
        );
    },
    get disablePOShitoryCheckNextBTN() {
        if (!this.that) return false;
        if (!this.isRecordSelected) return true;
        if (this.that.caseType.isTechnicalService() || this.that.caseType?.isExceptionRepair() || (this.that.caseType?.isExceptionService() || this.that.caseType?.isAdminService() || this.that.caseType?.isMiscellaneousService())) { //Manohar -- TWC4621-2011 -- added isMiscellaneousService condition
            return this?.that?.poSearchData.some(
                (item) => item.selected == true && (!item.poValidated || item.poValidated == undefined)
            );
        } else if (this.that.caseType.isQualityService()) {
            return this?.that?.poSearchData.some(
                (item) => item.selected == true && (!item.poValidated || (this.that.requestdetails.salesIssueReturnReason === this.that.genericMessages?.QAN_MRB_PRT && !item.mrbValidated)));
        }
    },
    get disableCreditPriceNextBTN() {
        if (!this.that) return false;
        if (!this.isRecordSelected) return true;
        if (this?.that?.isEmulatedUser && (this?.that?.isPortal === true || this?.that?.isPortal === "true")) { //TWC4621-2010 -- Manohar -- If the login user is Emulated User, Restrict the Save functionality
            return true;
        }
        if (this.that.caseType.isTechnicalExchange()) { //Exchange Remedy - Technical Intake
            return this?.that?.poSearchData.some(
                (item) => item.selected == true && !item.isInWarrenty == true
            );
        }
        if (this?.that?.casemode == "Edit" && (this?.that?.caseType?.isExceptionService() || this?.that?.caseType.isAdminService())) {
            return this?.that?.poSearchData.some(
                (item) => item.selected == true && (!item.priceCheck || (parseFloat(item?.prevReturnQuantity) < parseFloat(item?.returnQuantity)))
            );
        }
        if (this.that.caseType.isQualityService() || this.that.caseType.isExceptionService() || this.that.caseType.isAdminService() || this.that.caseType?.isMiscellaneousService()) { //Manohar -- TWC4621-2011 -- added isMiscellaneousService condition
            return this?.that?.poSearchData.some(
                (item) => item.selected == true && !item.priceCheck
            );
        }
        return !this?.that?.poSearchData.some(
            (item) => item.selected == true && item.priceCheck == true
        );
    },

    // User Story Number TWC4621-962,992 --- Agent UI ---  09/02/2023 -- Save for later button
    get disableTechnicalIntakeSaveForLater() {
        if (this?.that?.isEmulatedUser && (this?.that?.isPortal === true || this?.that?.isPortal === "true")) { //TWC4621-2010 -- Manohar -- If the login user is Emulated User, Restrict the Save functionality
            return true;
        }
        if (this.that.caseType.remedy === this.that.genericMessages?.Credit && this.that.requestdetails.salesIssueReturnReason === this.that.genericMessages?.FAC) {
            let failedLineitems = this.that.poSearchData.filter((data) => data.selected == false || data.productStatus == false)
            if (this.that.poSearchData.length === failedLineitems.length) {
                this.that.enableSearchPONextBTN = true;
                return false;
            }
        }
        if (!this.isRecordSelected) return true;
        if (this?.that?.casemode == "Edit" && (this?.that?.caseType?.isExceptionService() || this?.that?.caseType.isAdminService())) { //!item.priceCheck ||
            return this?.that?.poSearchData.some(
                (item) => item.selected == true && ((parseFloat(item?.prevReturnQuantity) < parseFloat(item?.returnQuantity)))
            );
        }
        if (this.that.showProductValidateNextBtn === true) {
            return this.that.disableSearchPONextBTN;
        }
        if (this.showWarrantyEntitlementValidateBtn === true) {
            return this.disableWarrentyCheckNextBTN;
        }
        if (this.showPOHistoryCheckValidateBtn === true) {
            return this.disablePOShitoryCheckNextBTN;
        }
        return false;
    },
    showPoSearchTable() {
        this.showWarrantyEntitlementValidateBtn = false;
        this.showPOHistoryCheckValidateBtn = false;
        this.showCreditPriceValidateBtn = false;

        this.that.technicalIntakeTable.warrentyCheck = false;
        this.that.technicalIntakeTable.creditPriceCheck = false;
        this.that.technicalIntakeTable.showMRBColumn = false;
        this.that.technicalIntakeTable.showExpectedOutcomeValueForRepair = false;
        this.that.showProductValidateNextBtn = true;
        this.showPOHistoryCheckSaveBtn = false; // To hide save and view summary in Exchange last step
    },
    async showWarrentyCheckTable() {
        this.showWarrantyEntitlementValidateBtn = true;
        this.showPOHistoryCheckValidateBtn = false;
        this.showCreditPriceValidateBtn = false;

        this.that.technicalIntakeTable.warrentyCheck = true;
        this.that.technicalIntakeTable.creditPriceCheck = false;
        this.that.technicalIntakeTable.showMRBColumn = false;
        this.that.technicalIntakeTable.showExpectedOutcomeValueForRepair = false;
        this.that.showProductValidateNextBtn = false;
        this.showPOHistoryCheckNextBtn = true;
        //Exchange Remedy - Technical Intake
        if (this.that.caseType.isTechnicalExchange()) {
            this.showPOHistoryCheckNextBtn = false;
            this.showPOHistoryCheckSaveBtn = true; // To hide save and view summary in Exchange last step
        }

        await this.that.checkRequiredMatrix(this);

        if (this.that.casemode != "Edit") {
            this.that.poSearchData = this.that.poSearchData.sort((a, b) => {
                if (a?.isUltRequired) {
                    return -1;
                }

                return 0;
            });
        }

    },
    showPoHistoryTable() {


        this.showWarrantyEntitlementValidateBtn = false;
        this.showPOHistoryCheckValidateBtn = true;
        this.showCreditPriceValidateBtn = false;
        this.showPOHistoryCheckNextBtn = true;

        this.that.technicalIntakeTable.warrentyCheck = true;
        this.that.technicalIntakeTable.creditPriceCheck = false;
        this.that.showProductValidateNextBtn = false;
        if (this.that.caseType.isQualityService() && this.that.requestdetails.salesIssueReturnReason !== this.that.genericMessages?.FAC) {
            this.that.technicalIntakeTable.showMRBColumn = true;
        }
        if (this.that.caseType.isExceptionRepair()) {
            this.that.technicalIntakeTable.showExpectedOutcomeValueForRepair = true;
        }
        /* if (this.that.caseType.isTechnicalExchange()) {
           this.showPOHistoryCheckNextBtn = false;
           this.showPOHistoryCheckSaveBtn = true;
         }*/

    },
    showCreditPriceTable() {
        this.showWarrantyEntitlementValidateBtn = false;
        this.showPOHistoryCheckValidateBtn = false;
        this.showCreditPriceValidateBtn = true;

        this.that.technicalIntakeTable.warrentyCheck = true;
        this.that.technicalIntakeTable.creditPriceCheck = true;
        this.that.showProductValidateNextBtn = false;
        if (this.that.caseType.isQualityService() && this.that.requestdetails.salesIssueReturnReason !== this.that.genericMessages?.FAC) {
            this.that.technicalIntakeTable.showMRBColumn = true;
        }
        if (this.that.caseType.isExceptionRepair()) {
            this.that.technicalIntakeTable.showExpectedOutcomeValueForRepair = true;
        }

    }
};
let technicalIntakeTable = {
    that: undefined,
    setThis(t) {
        this.that = t;
    },
    warrentyCheck: false,
    creditPriceCheck: false,
    showMRBColumn: false,
    showExpectedOutcomeValueForRepair: false,
};

import {
    getDateString,
    doPicAPIpriceCheck
} from "c/r4c_AG_LineItemsResultTableUtill";

let tiMsgs = {
    uniqueULTErrorMsg: r4c_CustomLabels.labels.TI_ULT_Error_msg,
    uniqueULTErrorHeader: r4c_CustomLabels.labels.TI_ULT_Error_Header,
    ultInUseHeader: r4c_CustomLabels.labels.TI_ULT_Error_In_Use,
    warrentyInvalid: r4c_CustomLabels.labels.TI_Warrenty_Invalid,
    warrentyWTBD: r4c_CustomLabels.labels.TI_Warranty_WTBD, // WTBD Status - Warranty to be decided
    warrentyValid: r4c_CustomLabels.labels.Warrenty_valid_till,
    warrentyExpired: r4c_CustomLabels.labels.TI_Warranty_Expired,
    warrentyCEPExpired: r4c_CustomLabels.labels.TI_CEP_Experied,
    warrentyInwarrentyCEPExpired: r4c_CustomLabels.labels.TI_Inwarrenty_cepexpired,
    warrentyOutWarrentyExchange: r4c_CustomLabels.labels.TI_Exchange_OW_ErrMsg,
    warrentyNoResponse: r4c_CustomLabels.labels.TI_No_Warranty_Response,
    cepExpiredMsg: r4c_CustomLabels.labels.TI_CEP_Eligibility_Expired,
    poDataNotFoundMsg: r4c_CustomLabels.labels.TI_PO_History_not_found,
    priceNotFoundMsg: r4c_CustomLabels.labels.YMS2Price_not_found,
    pricePortalHeaderErrorMsg: r4c_CustomLabels.labels.TI_Portal_Price_Not_Found_Header,
    pricePortalDescriptionErrorMsg: r4c_CustomLabels.labels.TI_Portal_Price_Not_Found_Description,
    cpnRequiredErrorMsg: r4c_CustomLabels.labels.TI_CPN_Requried,
    nprCodNotElgible: r4c_CustomLabels.labels.TI_Npr_Cod_Not_Elgible,
    warrentyULTInvalid: r4c_CustomLabels.labels.TI_Warrenty_ULT_Invalid,
    mmModelHeader: r4c_CustomLabels.labels.TI_MmModel_Header,
    mmModelDescription: r4c_CustomLabels.labels.TI_MmModel_Description,
    mmModelSubDescription: r4c_CustomLabels.labels.R4C_Replacement_MMID,
    mmModelExsitingMMName: r4c_CustomLabels.labels.MMID,
    mmModelNewMMName: r4c_CustomLabels.labels.TI_New_MMID,
    poModelHeader: r4c_CustomLabels.labels.TI_PoModel_Header,
    poModelDescription: r4c_CustomLabels.labels.TI_PoModel_Description,
    poModelSubDescription: r4c_CustomLabels.labels.TI_PoModel_SubDescription,
    poModelExsitingPOName: r4c_CustomLabels.labels.PO_Number,
    poModelNewPOName: r4c_CustomLabels.labels.TI_PoModel_New_POName,
    warrentyStatusCodeIRCErrorMsg: r4c_CustomLabels.labels.TI_Warrenty_StatusCodeI_RCErrorMsg,
    warrentySourceSystemInvlaidErrorMsg: r4c_CustomLabels.labels.TI_Warrenty_SourceSystem_InvlaidErrorMsg, // Out of Warranty Err Msg
    warrentyInvalidVizIdErrorMsg: r4c_CustomLabels.labels.TI_WarrentyInvalid_VizId_ErrorMsg, // WTBD Error Message
    missingMMErrorMsg: r4c_CustomLabels.labels.TI_MissingMM_ErrorMsg,
    exchangeValidULT: r4c_CustomLabels.labels.TI_Exchange_ValidUlt,
    exchangeINValidULT: r4c_CustomLabels.labels.TI_Exchange_INValidUlt,
    exchangeLimitError: r4c_CustomLabels.labels.reduceULTLineItemsErrMsg,
    warrentyApiDown: r4c_CustomLabels.labels.Warranty_check_failed,
    ewParentFailedErrMsg: r4c_CustomLabels.labels.TI_Extended_InvalidLine,
    componentTypeCodeErrMsg: r4c_CustomLabels.labels.ULT_Component_Type_Code_ErrorMsg,
    ULTnotFound: r4c_CustomLabels.labels.ULT_not_Found,
    VIZTypeULTNotValid: r4c_CustomLabels.labels.VisIdULT_NotValidInBag_ErrMsg,
    ErrMsgAgSIN: r4c_CustomLabels.labels.VisIdULT_SIN_ErrMsg, //'Visual ID Unauthorized Security Investigation Needed.',
    ErrMsgAgPIN: r4c_CustomLabels.labels.VisIdULT_PIN_ErrMsg, //'Visual ID Unauthorized PMFT Investigation: PMFT Investigation Needed.',
    //ErrMsgAgIRC: 'This product was transferred to a secondary market seller and is not supported by Intel. Upon title transfer, all warranty support was terminated by Intel. The secondary market seller should be contacted for warranty help should any be offered.', //TI_Warrenty_StatusCodeI_RCErrorMsg
    //ErrMsgMMOOW: 'Product is no longer eligible for credit, Out of Warranty.', //Using warrentySourceSystemInvlaidErrorMsg - TI_Warrenty_SourceSystem_InvlaidErrorMsg	
    //ErrMsgWTBD: 'Unable to determine warranty. Please ship the unit to the depot and warranty and entitlement will be determined upon receipt.', //Using warrentyInvalidVizIdErrorMsg
    ErrMsgAgPC: r4c_CustomLabels.labels.VisIdULT_PC_ErrMsg,
    WarrantyServiceDown: r4c_CustomLabels.labels.R4C_API_Service_Unavailable,

};
//Api Call
let validateWarranty = async (that) => {
    //Start -- TWC4621-3290 --Manohar --Add multiple lines for MM having more ULTs
    let cloneLineItemsList = that.poSearchData.filter((data) => data.isReturnQtyChanged == true && data.ult).map(item => {
        return {
            LineIdentifer: item.InvoiceNumber,
            MM: item.MM,
            returnQuantity: 1,
            existingReturnQty: item.existingReturnQty,
            oldULT: item.ult,
            ULT: '',
        }
    })

    if (cloneLineItemsList.length > 0) {
        let data = await ModalForLineItemsClone.open({
            rows: cloneLineItemsList,
            modelHeader: that.labels?.R4C_ULTClone_ModalHeader,
            subDescription: that.labels?.R4C_ULTClone_SubDescription,
            description: that.labels?.R4C_ULTClone_Description,
            size: 'medium',
        })
        console.log('336', JSON.stringify(data))
        if (data?.message == 'added new lines' && Array.isArray(data?.lineItems) && data?.lineItems.length > 0) {
            // Map for quick lookup of InvoiceNumber
            const dataMap = new Map(that.poSearchData.map(data => [data?.InvoiceNumber, data]));
            // newClonesItems array
            const newClonesItems = [];
            data.lineItems.forEach(item => {
                if (item && item.LineIdentifer) {
                    const existingData = dataMap.get(item.LineIdentifer);
                    if (existingData) {
                        existingData.isReturnQtyChanged = false;
                        // Create a new object by copying the existing data and modifying necessary fields
                        const copiedObj = {
                            ...existingData,
                            ult: item?.ULT,
                            returnQuantity: 1,
                            InvoiceNumber: `${stringGen(6)}-${item?.MM}`,
                            existingReturnQty: 1
                        };
                        delete copiedObj?.lineItemRecId; //E2E Bug fix - Samuel 
                        // Add modified object to the newClonesItems array
                        newClonesItems.push(copiedObj);
                    }
                }
            });
            // Update poSearchData only if there are new items to add
            if (newClonesItems.length > 0) {
                that.poSearchData = [...that.poSearchData, ...newClonesItems];

            }
        } else if (data?.message == 'no new lines') {
            that.poSearchData.forEach((data, index) => {
                if (data.ult && data.isReturnQtyChanged) {
                    data.isReturnQtyChanged = false
                }
            });
        }
        else {
            return;
        }
    }
    //End -- TWC4621-3290 --Manohar -- Add multiple lines for MM having more ULTs

    let reqDetails = { ...that.requestdetails };
    if (!that.poSearchData.some((data) => data.selected == true && !data.warrentyValidated)) {
        return;
    }
    if (that.poSearchData.some((data) => data.selected && data.ult && data.ult.length < 6)) {
        that.showToast(that.labels.Warning, that.labels.ULT_min_length_Toast_msg, "warning");
        return;
    }
    if (that.poSearchData.some((data) => data.selected && data.ult && data.ult.length > 40)) {
        that.showToast(that.labels.Warning, that.labels.ULT_max_length_Toast_msg, "warning");
        return;
    }

    if (that.caseType.isTechnicalExchange() && that.poSearchData.filter(w => w.selected == true).length > 51) {
        that.showToast(that.labels.Warning, tiMsgs.exchangeLimitError, "warning");
        return;
    }
    //If servicetype = quality ,Remedy = NPR-Credit or remedy as credit with FAC return reason , ult is mandtory 
    if (that.caseType?.isQualityService() && (reqDetails?.remedyText === that.genericMessages?.Credit_NPR || (reqDetails?.remedyText === that.genericMessages?.Credit && reqDetails?.salesIssueReturnReason === that.genericMessages?.FAC)) && that.poSearchData.some((data) => data.selected && !data.ult)) { //manohar
        that.showToast(that.labels.Warning, that.labels.Please_enter_required_ult_numbers, "warning");
        return;
    }
    let ultList = that.poSearchData
        .map((data) => {
            let status = '';
            if (data.selected && data.ult) {
                status = data.ult?.match(/^[0-9]+$/) ? data?.ult : data?.ult?.trim()?.toUpperCase();
                if (data?.warrantyResult?.WarrantyTypeCode == 2) {
                    status = '';
                }
                else if (data?.parentLineId) {
                    status = '';
                }
            }
            return status;
        })
        .filter((data) => data);
    const duplicates = ultList.filter((item, index) => index !== ultList.indexOf(item));
    //Syed - Moving request generation to helper
    let request = await generateWarrantyRequestBody(that.poSearchData, reqDetails, that.caseType, that.casemode, duplicates, that.isPortal, that.caserec, that?.isECCLineItemEdit);
    //check for duplicate ult
    if (new Set(ultList).size !== ultList.length) {
        LightningAlert.open({
            message: tiMsgs.uniqueULTErrorMsg,
            variant: "header",
            label: tiMsgs.uniqueULTErrorHeader
        });
        invokeCustomValidationElement(that);
        return;
    }

    //If servicetype = quality ,Remedy = Credit and Return reason = MRB/QAN , need to bypass Warranty API call
    if ((that.caseType?.isQualityService() && reqDetails?.remedyText === that.genericMessages?.Credit && reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT)) { //manohar
        that.poSearchData.forEach((item) => {
            item.warrentyValidated = true;
            item.priceCheck = item.selected === true && (item.creditPriceDate === "" ? false
                : getApexDateString(new Date()) > getApexDateString(item.creditPriceDate)
                    ? false : true);
        })
        return;
    }

    let requestWithUlt = request.filter((item) => item.ProdUniqueId);
    let requestWitoutUlt = request.filter((item) => !item.ProdUniqueId);
    if (that.caseType?.isExceptionRepair() || (that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
        requestWitoutUlt = [];
    }
    that.loading(true);
    //commented for testing purpose - Duplicate ULT check error
    const isPerformDuplicateUltCheck = that.genericMessages?.CHECK_DUPLICATE_ULT == 'true' || that.genericMessages?.CHECK_DUPLICATE_ULT == true
    if (ultList.length > 0 && isPerformDuplicateUltCheck) {
        console.time('Duplicate Check');
        let hasDuplicates = await getULTDuplicates(that, ultList, tiMsgs, reqDetails);
        console.timeEnd('Duplicate Check');
        console.log('hasDuplicates', hasDuplicates)
        if (hasDuplicates) {
            invokeCustomValidationElement(that);
            that.loading(false);
            return;
        }
    }
    that.loading(true);
    let acceptedWarrentyProductTypes = that.genericMessages?.valid_warranty_status_code?.split(',') || ['ACT'];
    let notAcceptedVizStatusTypes = that.genericMessages?.invalid_warrenty_viz_types?.split(',') || ['CAN', 'MCN', 'ECN'];
    let notAcceptingVizStatusCode = that.genericMessages?.invalid_warrenty_viz_code?.split(',') || ['PC', 'CME', 'INV', 'PIN', 'SIN'];
    let ComponentTypeCodeValue = 'S';
    let ewLinesList = []; //EW
    let ultRequestList = [];
    let withoutUltRequestList = [];
    console.log('Warrenty requestWithUlt', requestWithUlt);
    console.log('Warrenty requestWitoutUlt', requestWitoutUlt);
    //Syed - start - Optimization of code to support more then 600 requests - splitting request list into parts of 1000
    let splitCount = +that.genericMessages.Warranty_JS_Chunk_Size || 600;
    if (requestWithUlt.length > splitCount) {
        let spitRequestList = splitArrayIntoChunks(requestWithUlt, splitCount);
        ultRequestList = [];
        for (let i = 0; i < spitRequestList.length; i++) {
            ultRequestList.push(getWarrantyCheck({
                reqString: JSON.stringify(spitRequestList[i])
            }));
        }
    }
    else if (requestWithUlt.length > 0) {
        ultRequestList.push(getWarrantyCheck({
            reqString: JSON.stringify(requestWithUlt)
        }));
    }
    if (requestWitoutUlt.length > splitCount) {
        let spitRequestList = splitArrayIntoChunks(requestWitoutUlt, splitCount);
        for (let i = 0; i < spitRequestList.length; i++) {
            withoutUltRequestList.push(getWarrantyCheck({
                reqString: JSON.stringify(spitRequestList[i])
            }));
        }
    }
    else if (requestWitoutUlt.length > 0) {
        withoutUltRequestList.push(getWarrantyCheck({
            reqString: JSON.stringify(requestWitoutUlt)
        }));
    }
    //Syed - end - Optimization of code to support more then 1500 requests
    console.time('Warrenty Check');
    if ((requestWithUlt.length > 0 || requestWitoutUlt.length > 0) && !reqDetails?.warrentyQueryNumber) { // mapping query number to use the same number for entire case creation
        that.requestdetails = { ...that.requestdetails, ...{ warrentyQueryNumber: requestWithUlt[0]?.QueryNumber || requestWitoutUlt[0]?.QueryNumber } };
    }
    Promise.all([...ultRequestList, ...withoutUltRequestList])

        .then(async (response) => {

            let { ultResponse, wihtoutUltResponse } = processWarrantyResponse(response, ultRequestList, withoutUltRequestList);

            //Syed - end - Optimization of code to support more then 1500 requests
            console.log('Warrenty ultResponse', ultResponse)
            console.log('Warrenty wihtoutUltResponse', wihtoutUltResponse);

            let todaysDate = new Date();
            let mmChangeList = [];
            let ewLines;//EW
            let mapMainLines = new Map();
            that.poSearchData.filter(i => i.parentLineId == undefined).forEach((item) => {
                if ((item.selected || !item.selected && that?.isECCLineItemEdit) && !item.warrentyValidated) {
                    if (!item.Soldto) item.Soldto = reqDetails.selectedsoldToCMF;
                    let itemWarrentyWithUniqueId = ultResponse.find(
                        (resp) => resp.ProdUniqueId && item.ult && resp.ProdUniqueId == item.ult && (resp.WarrantyTypeCode == 1 || resp.WarrantyTypeCode == '')
                    );
                    //itemWarrentyWithUniqueId.ProdUniqueIdStatusCode = 'IRC';
                    //itemWarrentyWithUniqueId.CreditPeriodCount=1;
                    let itemWarrentyDetails = wihtoutUltResponse.find(
                        (resp) => resp.MaterialId == item.MM
                    );

                    ewLines = ultResponse.filter(
                        (resp) =>
                            resp.ProdUniqueId && item.ult && resp.ExtendedWarrantyStartDate && resp.ExtendedWarrantyEndDate
                            && resp.WarrantyTypeCode == 2 && resp.ProdUniqueId == item.ult
                    );

                    item.warrantyCheck = {};
                    item.warrantyCheck.warrentyCheckDate = new Date();
                    if (that.casemode == "Edit" && item?.warrantyResult?.warrentyCheckDate) {
                        item.warrantyCheck.warrentyCheckDate = item.warrantyResult.warrentyCheckDate;
                    }
                    item.warrantyCheck.isCEPDaysValidValue = false;
                    item.warrantyCheck.isUnderWarrenty = false;
                    item.warrantyCheck.isUnderCEPDays = false;
                    item.warrantyCheck.isMMChange = false;
                    item.warrantyCheck.isError = true;
                    item.warrantyCheck.isUltCorrect = false;
                    item.warrantyCheck.isExchangeValid = false;
                    item.warrantyCheck.isMRBQANValid = false;//manohar
                    item.warrantyCheck.isGRLExceptionValid = false;
                    item.warrantyCheck.creditElgiblityEndDate = "";
                    item.warrantyCheck.iSOutOfWarrenty = false;
                    item.warrantyCheck.isCanceled = false;
                    item.isSoftStop = false;
                    item.isULTSoftStop = false;
                    item.isInWarrenty = false;
                    item.productStatus = false;
                    //item.selected = false; //Commented to handle Unexpected lines logic - unselcted lines from UI
                    item.Error = true;
                    item.errorText = tiMsgs.warrentyInvalid;
                    item.successText = 'success';
                    item.poValidated = false
                    item.isPoHistoryValid = false;
                    if (item.poHistoryData) delete item.poHistoryData;
                    let warrantyEndDate = '';
                    //TWC4621-2404 - Syed -warrenty response contains ult, refactored as part of code change
                    if (itemWarrentyWithUniqueId) {
                        if (itemWarrentyWithUniqueId.ProdUniqueIdTypeCode === 'PPIN') { // Gap Fix in PPIN logic - Samuel
                            itemWarrentyWithUniqueId.ProdUniqueIdTypeCode = 'VISID';
                            itemWarrentyWithUniqueId.ProdUniqueId = itemWarrentyWithUniqueId.VizId;
                            itemWarrentyWithUniqueId.VizId = item.ult;
                            item.ult = itemWarrentyWithUniqueId.ProdUniqueId;
                        }

                        let cepCount = itemWarrentyWithUniqueId.CreditPeriodCount || 0;
                        if (typeof cepCount === 'string') cepCount = +cepCount;
                        let wepCount = itemWarrentyWithUniqueId.WarrantyPeriodCount || 0;
                        if (typeof wepCount === 'string') wepCount = +wepCount;
                        const isULTReponseError = itemWarrentyWithUniqueId.ErrorCode !== 0 || itemWarrentyWithUniqueId?.ComponentTypeCode === ComponentTypeCodeValue;
                        warrantyEndDate = new Date(itemWarrentyWithUniqueId.BaseWarrantyEndDate);
                        item.warrantyResult = itemWarrentyWithUniqueId;
                        //setting defaults
                        item.warrantyCheck.isUltCorrect = true;
                        item.ultDisabled = true;
                        item.warrantyCheck.isError = isULTReponseError || notAcceptedVizStatusTypes.includes(itemWarrentyWithUniqueId?.SourceSystemName?.trim());
                        item.warrantyCheck.isUltValid = acceptedWarrentyProductTypes.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.trim());
                        item.warrantyCheck.isCEPDaysValidValue = cepCount != 0;
                        item.warrantyCheck.isCanceled = itemWarrentyWithUniqueId.ProdUniqueIdStatusCode != 'ACT';

                        //SYED - TWC4621-2141- checking ig ult type is VISID and part of same bag  
                        if (itemWarrentyWithUniqueId.ProdUniqueIdTypeCode === 'VISID') {
                            const { bagList } = reqDetails;
                            const cmfList = JSON.parse(bagList);
                            let cmfIdsSet = new Set(cmfList.map(i => {
                                //const bagAndCmf = !that?.isUcdoff ? i.split('_') : i.split('-');
                                const bagAndCmf = !that?.isUcdoff ? i.split('+000_') : i.split('-');
                                return bagAndCmf[1];
                            }));
                            console.log('CMF SET ', cmfIdsSet);
                            cmfIdsSet.delete('AM03_03_0000024100');//need to delete this line, Added for Unit testing of 03 EOL Functionality for EH - sairam 
                            cmfIdsSet.add(`${reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c}_${reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c}_${reqDetails?.selectedsoldToCMF}`);
                            if (!cmfIdsSet.has(`${itemWarrentyWithUniqueId?.EntitlementCMFSalesOrganizationCode}_${itemWarrentyWithUniqueId?.EntitlementCMFDistributionChannelCode}_${itemWarrentyWithUniqueId?.EnttlSoldToPartyId?.padStart(10, "0")}`)) {
                                item.VisIdbagError = true;
                                item.selected = false;
                                item.warrantyCheck.isError = true;
                                item.lineitemStatus = that.genericMessages?.CPU_POH_Rejection; //TWC4621-2886

                            }
                        }
                        if (that.caseType.isTechnicalExchange()) {
                            item.warrantyCheck.isError = isULTReponseError;

                        }
                        else if (that.caseType.isQualityService()) {
                            if (reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT) {
                                item.warrantyCheck.isError = isULTReponseError || item.VisIdbagError || !acceptedWarrentyProductTypes.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.toUpperCase());
                                item.warrantyCheck.isMRBQANValid = !item.warrantyCheck.isError;
                            }
                            else if (reqDetails?.salesIssueReturnReason === that.genericMessages?.FAC) { //manohar
                                item.warrantyCheck.isError = isULTReponseError || item.VisIdbagError || !acceptedWarrentyProductTypes.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.toUpperCase());
                            }
                        }
                        else if (that.caseType?.isExceptionRepair()) {
                            item.warrantyCheck.isError = isULTReponseError || !acceptedWarrentyProductTypes.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.toUpperCase());
                            item.warrantyCheck.isGRLExceptionValid = !item.warrantyCheck.isError;
                        }
                        else if (that.caseType.isExceptionService()) {
                            if (reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception) {
                                item.warrantyCheck.isError = isULTReponseError || !acceptedWarrentyProductTypes.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.toUpperCase());
                                item.warrantyCheck.isGRLExceptionValid = !item.warrantyCheck.isError;
                            }
                        }
                        //Populate Missing Data and replace any data that is invalid based on response
                        if (itemWarrentyWithUniqueId?.ComponentTypeCode != ComponentTypeCodeValue) {

                            //MMID will change if for givien ult another mm is returned
                            if (item.MM && itemWarrentyWithUniqueId?.MaterialId != item.MM) {
                                item.warrantyCheck.newMMId = itemWarrentyWithUniqueId?.MaterialId;
                                item.warrantyCheck.oldMMId = item.MM;
                                mmChangeList.push({
                                    oldMMId: item.warrantyCheck.oldMMId,
                                    newMMId: item.warrantyCheck.newMMId
                                });
                                item.warrantyCheck.isMMChange = true;
                                item.checkMMBUObj = true;
                                if (reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT) { //manohar
                                    item.mrbValidated = false;
                                    item.CustomerPONumber = '';
                                    item.priceCheck = false;
                                }
                            }
                            else if (!item.MM) {
                                item.warrantyCheck.isMMChange = true;
                            }
                        }
                        //popuplate ult if not present before
                        if (itemWarrentyWithUniqueId.ProdUniqueId && !item.ult) {
                            item.ult = itemWarrentyWithUniqueId.ProdUniqueId;
                            item.quantityDisabled = true;
                            item.returnQuantity = 1;
                        }
                        //populate MM if not present before
                        if (!item.MM) {
                            item.MM = itemWarrentyWithUniqueId?.MaterialId;
                            item.checkMMBUObj = true;
                            item.warrantyCheck.isMMChange = false;
                        }
                        // populate  OPID data if not present before
                        if (that.genericMessages.isIaoFlag != 'true') {
                            if (!item?.Data?.ICS_WR_Operation_Business_Unit_Code__c) {
                                if (!item.Data) item.Data = {};
                                item.Data.ICS_WR_Operation_Business_Unit_Code__c = itemWarrentyWithUniqueId.OperationBusinessUnitCode;
                            }
                        }

                        console.log('Product Search data', JSON.stringify(item.Data));

                        if (that.genericMessages.isIaoFlag == 'true') {
                            if (!item?.Data?.ICS_WR_Profit_Center_Code__c) {
                                if (!item.Data) item.Data = {};
                                //item.Data.ICS_WR_Profit_Center_Code__c = itemWarrentyWithUniqueId.ProfitCenterCode;
                                item.Data = { ...item.Data, ...{ 'ICS_WR_Profit_Center_Code__c': itemWarrentyWithUniqueId.ProfitCenterCode } };
                            }
                            if (!item?.Data?.Item_Market_Name__c && itemWarrentyWithUniqueId.ItemMarketName) {
                                if (!item.Data) item.Data = {};
                                //item.Data.Item_Market_Name__c = itemWarrentyWithUniqueId.ItemMarketName;
                                item.Data = { ...item.Data, ...{ 'Item_Market_Name__c': itemWarrentyWithUniqueId.ItemMarketName } }
                            }
                        }
                        //Warrenty Check Logic

                        if ((that.caseType.isTechnicalService()) ||
                            (that.caseType.isQualityService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.FAC)) { //manohar
                            //calcuate cep 
                            item.warrantyCheck.creditElgiblityEndDate = new Date(itemWarrentyWithUniqueId.BaseWarrantyStartDate);
                            item.warrantyCheck.creditElgiblityEndDate.setDate(item.warrantyCheck.creditElgiblityEndDate.getDate() + cepCount);
                            item.warrantyCheck.isWarrentyCEPDaysValid = todaysDate <= item.warrantyCheck.creditElgiblityEndDate;
                            item.warrantyCheck.iSOutOfWarrenty = todaysDate >= item.warrantyCheck.creditElgiblityEndDate;
                            //calcuate wep
                            item.warrantyCheck.warrentyElgiblityEndDate = new Date(itemWarrentyWithUniqueId.BaseWarrantyStartDate);
                            item.warrantyCheck.warrentyElgiblityEndDate.setDate(item.warrantyCheck.warrentyElgiblityEndDate.getDate() + wepCount);
                            //FURQAN 1- In warrenty Status
                            //Check Warrenty Status - for exchange check warrenty and for other check cep
                            if (that.caseType.isTechnicalExchange()) {
                                item.warrantyCheck.isUnderWarrenty = todaysDate <= warrantyEndDate && item.warrantyCheck.isCanceled == false && (ewLines.length > 0 ? true : wepCount != 0);
                                warrantyEndDate = getDateString(warrantyEndDate);
                                item.warrantyCheck.isExchangeValid = item.warrantyCheck.isUnderWarrenty;
                                if (item.warrantyResult && item.warrantyResult?.status) {
                                    item.warrantyResult.status = (item.warrantyCheck.isUnderWarrenty) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT;
                                }
                            }
                            else {
                                item.warrantyCheck.isUnderWarrenty = item.warrantyCheck.isWarrentyCEPDaysValid && item.warrantyCheck.isCanceled == false;
                                warrantyEndDate = getDateString(item.warrantyCheck.creditElgiblityEndDate);
                            }
                            //SOFT stop
                            if (notAcceptingVizStatusCode.includes(itemWarrentyWithUniqueId?.VizIdStatusCode?.toUpperCase())) {
                                item.isSoftStop = true;
                            }
                        }
                    }
                    //warrenty request doesnt contians ult
                    //TWC4621-975 -- Furqan -- Fixing warrenty invalid if ult is not found
                    else if (that.caseType.isTechnicalService() && itemWarrentyDetails && !item.ult) {
                        item.warrantyResult = itemWarrentyDetails;
                        item.warrantyCheck.isError = itemWarrentyDetails.ErrorCode != 0 || itemWarrentyWithUniqueId?.ComponentTypeCode == ComponentTypeCodeValue || notAcceptedVizStatusTypes.includes(itemWarrentyDetails?.SourceSystemName?.trim());
                        //CEP check using basewarrenty start date if not then today - CPC
                        if (itemWarrentyDetails.CreditPeriodCount) {
                            let cepCount = +itemWarrentyDetails.CreditPeriodCount;
                            if (typeof cepCount === 'string') cepCount = +cepCount;
                            let baseCepStartDate = new Date();
                            baseCepStartDate.setDate(baseCepStartDate.getDate() - cepCount);
                            item.warrantyCheck.creditElgiblityEndDate = baseCepStartDate;
                            //FURQAN 2 - WTBD
                            item.warrantyCheck.isUnderCEPDays = true;
                            item.warrantyCheck.isCEPDaysValidValue = cepCount != 0;
                        }
                        //HARD


                        //SOFT
                        if (itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'PC' || itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'CME' || itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'INV' || itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'PIN' || itemWarrentyDetails?.VizIdStatusCode == 'SIN') {
                            //item.successText = tiMsgs.warrentyInvalidVizIdErrorMsg;
                            item.isSoftStop = true;
                        }

                    }
                    else if (that.caseType.isExceptionService() && !item.ult) {
                        item.warrantyCheck.isGRLExceptionValid = true;
                        //item.successText = 'Success';
                    }
                    else if (reqDetails?.salesIssueReturnReason === that.genericMessages?.FAC && item.ult && !itemWarrentyWithUniqueId) { //manohar -- when ULT is not found in EH , it is a soft stop for Quality FAC case
                        //item.successText = tiMsgs.ULTnotFound;
                        item.isSoftStop = true;
                        item.isULTSoftStop = true;
                        item.warrantyCheck.isError = false;
                        item.warrantyCheck.isUnderWarrenty = true;
                        item.warrantyCheck.isUltValid = true;
                        item.warrantyCheck.isCEPDaysValidValue = true;
                        item.checkMMBUObj = false;
                    }

                    item.isInWarrenty = item.warrantyCheck.isError == false &&
                        (((item.warrantyCheck.isWarrentyCEPDaysValid == true && item.warrantyCheck.isUltValid == true) ||
                            item.warrantyCheck.isUnderCEPDays == true) && item.warrantyCheck.isCEPDaysValidValue);

                    if (that.caseType.isTechnicalExchange()) {
                        item.isInWarrenty = item.warrantyCheck.isExchangeValid;
                        item.warrantyCheck.isUnderWarrenty = item.warrantyCheck.isExchangeValid;
                    }
                    if (that.caseType.isQualityService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT) { //manohar
                        item.isInWarrenty = item.warrantyCheck.isMRBQANValid;
                        item.warrantyCheck.isUnderWarrenty = item.warrantyCheck.isMRBQANValid;
                    }
                    if (that.caseType?.isExceptionRepair() || (that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
                        item.isInWarrenty = item.warrantyCheck.isGRLExceptionValid;
                        item.warrantyCheck.isUnderWarrenty = item.warrantyCheck.isGRLExceptionValid;
                    }
                    //Unexpected Lines changes - Samuel - Unselelected lines
                    item.productStatus = (that?.isECCLineItemEdit == true && item.selected == false) ? false : item.isInWarrenty;
                    item.selected = (that?.isECCLineItemEdit == true && item.selected == false) ? false : item.isInWarrenty;
                    item.Error = (that?.isECCLineItemEdit == true && item.selected == false) ? true : !item.isInWarrenty;
                    //Unexpected Lines changes - Samuel - Unselelected lines - END

                    //TEMP
                    //item.productStatus = true;
                    //item.selected = true;
                    //item.Error = false;

                    //Bug Fix- for mm chaned warrenty valid only after user accepts
                    item.warrentyValidated = true;
                    if (item.warrantyCheck.isMMChange) {
                        item.warrentyValidated = false;
                    }
                    //Getting respective Error Msgs and Success Texts
                    item = getErrorMessages(that, item, itemWarrentyWithUniqueId, itemWarrentyDetails, reqDetails, warrantyEndDate);
                    // if (that?.isECCLineItemEdit == true && item.selected == false) {          //Unexpected Lines changes - Samuel - Unselelected lines
                    //   //item.display = false;
                    //   item.errorText += ' ' + 'Agent has unselected this lineitem;';
                    // }
                    if (item.isInWarrenty) {
                        if (item.successText && item.successText != 'success' && item.successText != tiMsgs.warrentyWTBD) {
                            //if succes text is set dont overrride
                        }
                        else if (item.warrantyCheck.isUnderCEPDays) {

                            item.isSoftStop = true;
                        }
                        else if (!item.warrantyCheck.creditElgiblityEndDate && item.isInWarrenty && itemWarrentyWithUniqueId) {

                            item.isSoftStop = true;
                        }



                    }

                    //EW 0 Fetching extendend warrenty line item from response 
                    if ((that.caseType.isTechnicalService() && !that.caseType.isTechnicalExchange()) || (that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
                        ewLinesList = [...ewLinesList, ...ewLines];
                    }
                    //creating map of ult as unique
                    if (itemWarrentyWithUniqueId) {
                        mapMainLines.set(item.ult, item);
                    }
                    //EW

                }
            });
            //EW
            if (ewLinesList) {
                //getting parent and child line items of warrenty and extended items
                let ewLineItem = await handleEWLines(ewLinesList, mapMainLines, that.poSearchData, that.casemode);
                that.extendedWarrantyLines = ewLineItem;
                //Syed - adding logic to show ew items below parent 
                let poSearchData = that.poSearchData;

                //exsiting line items remove from the list for new ew items to be added
                if (that.casemode == "Edit") {
                    ewLineItem.forEach(ewLine => {
                        let extendedWarrentyItemIndex = poSearchData.findIndex(i => i?.warrantyResult?.ProdUniqueId == ewLine?.ult &&
                            i.MM == ewLine.MM && i.warrantyResult.ServiceContractNumber == ewLine.warrantyResult.ServiceContractNumber);
                        if (extendedWarrentyItemIndex > -1) {
                            poSearchData.splice(extendedWarrentyItemIndex, 1);
                        }
                    })

                }
                let ewItemsgroupByParentUlt = ewLineItem.reduce(function (storage, item) {
                    var group = item.parentId.ult;
                    storage[group] = storage[group] || [];
                    storage[group].push(item);
                    return storage;
                }, {})
                //adding ew items bellow parent ult index
                for (let ult of Object.keys(ewItemsgroupByParentUlt)) {
                    let indexOfParent = poSearchData.findIndex(i => i.ult == ult)
                    if (indexOfParent > -1) {
                        poSearchData.splice(indexOfParent + 1, 0, ...ewItemsgroupByParentUlt[ult]);
                    }
                }
                that.poSearchData = poSearchData;
            }

            //EW    
            that.poSearchWithLOEData = that.poSearchData.filter(
                (item) => item.selected
            );
            //If mm is changed conform with user for changing
            if (mmChangeList.length > 0) {
                that.loading(false);
                await ModalForMMChange.open({
                    rows: mmChangeList,
                    modelHeader: tiMsgs.mmModelHeader,
                    description: tiMsgs.mmModelDescription,
                    subDescription: tiMsgs.mmModelSubDescription,
                    columns: [
                        { label: tiMsgs.mmModelExsitingMMName, fieldName: 'oldMMId' },
                        { label: tiMsgs.mmModelNewMMName, fieldName: 'newMMId' },
                    ],
                    size: 'small',
                    hideCancle: true
                }).then((data) => {
                    if (data) {
                        that.loading(true);
                        that.poSearchData.forEach((item) => {
                            if (item?.warrantyCheck?.isMMChange) {
                                item.MM = item.warrantyCheck.newMMId;
                                item.warrentyValidated = true;
                                //Syed - reseting cpn if mm replaced getting it again in po history 
                                item.customerItemNbr = '';
                            }
                        });

                    }
                });
            }

            if (that.poSearchData.some(i => i.checkMMBUObj)) {
                await checkMMIds(that, reqDetails, that.poSearchData, that.caseType, that.genericMessages);
            }
            if ((that.caseType.isTechnicalService() && !that.caseType.isTechnicalExchange()) || (that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
                that.poSearchData = validatedEWItemsBasedonParent(that.poSearchData);
            }
        })
        .catch((error) => {
            console.error('error', error)
            that.showToast(
                that.labels.Error_Title,
                that.labels.Warranty_check_failed,
                "error"
            );
        })
        .finally(() => {
            invokeRefreshRowElement(that);
            invokeCustomValidationElement(that);




            that.loading(false);


            console.timeEnd('Warrenty Check');
        });
};

let validateCEP = async (that) => {
    let isIaoFlag = that?.genericMessages.isIaoFlag;//TWC4621-5161 -- added isIaoFlag for IAO conditions
    _BypassPOHistoryValidation(that);//TWC4621-4234
    let requestDetails = that.poSearchData.filter(
        (data) => data.selected && !data.poValidated
    );
    if (requestDetails.length == 0) {
        if (that.caseType.remedy == "NPR-Credit") {
            await checkNPRMatrix(that);
        }
        return;
    }
    let reqDetails = { ...that.requestdetails };
    const { isPsgCase } = reqDetails; //PSG -- TWC4621-3907
    // TWC4621-1047 - Furqan - 22-02-2023 - Fixing CEP Days Calculation
    let reqWithWarrenty = that.poSearchData.filter(
        (data) =>
            data.selected && data.warrantyCheck.isUnderWarrenty &&
            data.warrantyResult.ProdUniqueIdTypeCode != 'VISID'
            &&
            !data.poValidated
    );
    if (that?.isECCLineItemEdit == true) { // Samuel - Unexpected Lines issue - Unselected lines
        reqWithWarrenty = [...reqWithWarrenty, ...that.poSearchData.filter(
            (item) =>
                item.selected == false && item.warrantyResult?.ProdUniqueIdTypeCode != 'VISID' && !item.poValidated
                && item.ProdUniqueId != ''
        )];
    }
    let requestDetailVsiderror = that.poSearchData.filter(
        (data) => (data.VisIdbagError == true && !data.poValidated) || (that?.isECCLineItemEdit == true && data.selected == false && data.warrantyResult.ProdUniqueIdTypeCode == 'VISID') // Samuel - Unexpected Lines unselected lines
    );
    let reqWithWarrentyVizId = that.poSearchData.filter(
        (data) =>
            data.selected && data.warrantyCheck.isUnderWarrenty && data.warrantyResult.ProdUniqueIdTypeCode == 'VISID'

            && !data.poValidated
    );
    reqWithWarrentyVizId = [...reqWithWarrentyVizId, ...requestDetailVsiderror];//TWC4621-2886
    let reqWithoutUlt = that.poSearchData.filter(
        (data) => data.selected && data.warrantyCheck.isUnderCEPDays && !data.poValidated
    );
    let dates = _procesPoSearchDates(reqWithWarrenty, reqWithWarrentyVizId, reqWithoutUlt);
    //Setting Dates End
    //TWC4621-1653 - Syed - creating cmf list with bag  and calling aletrnate api for bag and po
    const { bagList, poHistoryBagsCMFList } = reqDetails;
    let bagAndcmf = JSON.parse(bagList);
    let soldToBagCmflst = JSON.parse(poHistoryBagsCMFList);//Manohar -- TWC4621-3538 -- PO History changes for CMFs based BAGs
    console.log('931soldToBagCmflst', JSON.stringify(soldToBagCmflst))
    console.log('931that?.isUcdoff ', that?.isUcdoff)
    if (!that?.isUcdoff) {
        const AM03_CMFs_for_IN01 = [
            ...(that.genericMessages?.AM03_CMFs_for_IN01_1?.split(';') || []),
            ...(that.genericMessages?.AM03_CMFs_for_IN01_2?.split(';') || [])
        ];
        soldToBagCmflst = filterBAGList(soldToBagCmflst, AM03_CMFs_for_IN01, true);
        //soldToBagCmflst = filterBAGList(soldToBagCmflst);//To Filter CMF Values based on Latest  CMF Added to BAG Date to avoid duplicates CMF for PO Histroy Performance
        if (!isPsgCase) {
            soldToBagCmflst.push(`${r4c_CustomLabels.labels.R4C_Default_Time_Stamp}_${reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c}_${reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c}_${reqDetails?.selectedsoldToCMF}`);
            if (AM03_CMFs_for_IN01.includes(reqDetails?.selectedsoldToCMF) && reqDetails?.sales_Area__c?.Customer_Sales_Organization__r?.Customer_Sales_Organization_Code__c === 'IN01') {
                soldToBagCmflst.push(`${r4c_CustomLabels.labels.R4C_Default_Time_Stamp}_AM03_${reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c}_${reqDetails?.selectedsoldToCMF}`);
            }
        } else {
            soldToBagCmflst.push(`${r4c_CustomLabels.labels.R4C_Default_Time_Stamp}_****_**_${reqDetails?.selectedsoldToCMF}`);
        }
    } else {
        bagAndcmf.push(`9999-${that.requestdetails?.selectedsoldToCMF}`);//Manohar --TWC4621-3489 --adding selected CMF with default bag 9999-selectedCM
    }
    console.log('186soldToBagCmflst ', JSON.stringify(soldToBagCmflst))
    console.log('933reqWithWarrenty ', JSON.stringify(reqWithWarrenty))
    console.log('933reqWithoutUlt ', JSON.stringify(reqWithoutUlt))
    console.log('933reqWithWarrentyVizId ', JSON.stringify(reqWithWarrentyVizId))
    let customerBillingDocTypeCd = isIaoFlag != 'true' ? (that.poSearchData.some(i => i?.isExtended)) ? 'F2\',\'FV' : 'F2' : (that.poSearchData.some(i => i?.isExtended)) ? 'F2,ZF2,FV,ZFV' : 'F2,ZF2';//TWC4621-5129;F2,ZF2,FV,ZFV;F2,ZF2
    //Start --TWC4621-5161 -- CPU EW
    let reqForInWarrentyVIZIDMMset = [];
    let reqForInWarrentyMMset = [];
    if (isIaoFlag == 'true') {
        let processDatesResponse = processDatesforPOHistory(reqWithWarrenty, reqWithWarrentyVizId, isPsgCase);
        reqForInWarrentyVIZIDMMset = processDatesResponse?.reqForInWarrentyVIZIDmmList || [];
        reqForInWarrentyMMset = processDatesResponse?.reqForInWarrentymmList || [];
    }
    //End --TWC4621-5161 -- CPU EW
    //Creating Request Start
    let reqForInWarrenty = {
        mmListbyInput: isIaoFlag == 'true' ? [...reqForInWarrentyMMset] : [...new Set(reqWithWarrenty.map((item) => `${item.MM}_${_processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate)}`))].filter((i) => i),//Manohar --TWC4621-3489
        poListbyInput: [],
        soListbyInput: [],
        availableCMFList: that?.isUcdoff ? bagAndcmf : soldToBagCmflst,
        CustomerBillingDocumentTypeCd: customerBillingDocTypeCd,//(that.poSearchData.some(i => i?.isExtended) && that.caseType.isTechnicalService()) ? 'F2\',\'FV' : 'F2',
        apiType: 'BAG'
    };
    if (isPsgCase && isIaoFlag != 'true') { //PSG -- TWC4621-3857
        let oldMMLst = [...new Set(reqWithWarrenty.map((item) => ((item?.oldMM) ? `${item.oldMM}_${_processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate)}` : null
        )) // Filter out any null values
        )
        ]?.filter((i) => i);
        reqForInWarrenty.mmListbyInput = [...reqForInWarrenty.mmListbyInput, ...oldMMLst];
    }

    //SYED - TWC4621-2141- checking if ult type is VISID and part of same bag 
    //Start -- Vizid new API request
    let reqForInWarrentyVIZID = {
        availableCMFList: [],
        mmListbyInput: isIaoFlag == 'true' ? [...reqForInWarrentyVIZIDMMset] : [...new Set(reqWithWarrentyVizId.map((item) => `${item?.MM}_${_processDate(item?.warrantyResult?.BaseWarrantyStartDate)}_${_processDate(item?.warrantyCheck?.creditElgiblityEndDate)}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}`))].filter((i) => i),
        poListbyInput: [],
        soListbyInput: [],
        CustomerBillingDocumentTypeCd: customerBillingDocTypeCd,//(that.poSearchData.some(i => i?.isExtended) && that.caseType.isTechnicalService()) ? 'F2\',\'FV' : 'F2',
        apiType: 'VIZID'
    }
    if (isPsgCase && isIaoFlag != 'true') {
        let oldMMLst = [...new Set(reqWithWarrentyVizId.map((item) => ((item?.oldMM) ? `${item?.oldMM}_${_processDate(item?.warrantyResult?.BaseWarrantyStartDate)}_${_processDate(item?.warrantyCheck?.creditElgiblityEndDate)}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}` : null
        )))]?.filter((i) => i);// Filter out any null values
        reqForInWarrentyVIZID.mmListbyInput = [...reqForInWarrentyVIZID.mmListbyInput, ...oldMMLst];
    }
    //End -- Vizid new API request
    let reqForWitoutULT = {
        mmListbyInput: isIaoFlag == 'true' ? [...new Set(reqWithoutUlt.map((item) => `${item.MM}_${_processPoHistoryDates(item?.warrantyCheck?.creditElgiblityEndDate, new Date())}_**********`))].filter((i) => i) : [...new Set(reqWithoutUlt.map((item) => `${item.MM}_${_processPoHistoryDates(item?.warrantyCheck?.creditElgiblityEndDate, new Date())}`))].filter((i) => i),//Manohar --TWC4621-3489
        //availableCMFList: ['20241231T00:00:00.000+000_AP01_01_0000535140','99991231T00:00:00.000+000_AP30_01_0000535140','99991231T00:00:00.000+000_JP01_03_6000010055'],//that?.isUcdoff ? bagAndcmf : soldToBagCmflst,
        poListbyInput: [],
        soListbyInput: [],
        availableCMFList: that?.isUcdoff ? bagAndcmf : soldToBagCmflst,
        CustomerBillingDocumentTypeCd: customerBillingDocTypeCd,//(that.poSearchData.some(i => i?.isExtended) && that.caseType.isTechnicalService()) ? 'F2\',\'FV' : 'F2',
        apiType: 'BAG'
    };
    if (isPsgCase) { //PSG -- TWC4621-3857
        let oldMMLst = [];
        if (isIaoFlag == 'true') {
            oldMMLst = [...new Set(reqWithoutUlt.map((item) => ((item?.oldMM) ? `${item.oldMM}_${_processPoHistoryDates(item?.warrantyCheck?.creditElgiblityEndDate, new Date())}_**********` : null
            ))
            )
            ]?.filter((i) => i);
        } else {
            oldMMLst = [...new Set(reqWithoutUlt.map((item) => ((item?.oldMM) ? `${item.oldMM}_${_processPoHistoryDates(item?.warrantyCheck?.creditElgiblityEndDate, new Date())}` : null
            ))
            )
            ]?.filter((i) => i);
        }
        reqForWitoutULT.mmListbyInput = [...reqForWitoutULT.mmListbyInput, ...oldMMLst];
    }
    console.log('CEP Po Request reqForInWarrenty  ', reqForInWarrenty);
    console.log('CEP Po Request reqForInWarrenty VIZID ', reqForInWarrentyVIZID);
    console.log('CEP Po Request reqForWitoutULT ', reqForWitoutULT);
    //Start - TWC4621-4586 -- JS Chunking for bulk data
    const splitCount = +that.genericMessages.POHistory_JS_Chunk_Size || 600;
    const reqForInWarrentytList = [];
    const reqForWitoutULTList = [];
    const reqForInWarrentyVIZIDList = [];
    const requestArrayOrder = [];
    let count = 0;
    // 1. In Warranty
    if (reqForInWarrenty.mmListbyInput.length > splitCount) {
        const splitList = splitObjectArrayIntoChunks(reqForInWarrenty, 'mmListbyInput', splitCount);
        for (let i = 0; i < splitList.length; i++) {
            reqForInWarrentytList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArrayOrder.push({ label: 'INWARRENTY', index: count++ });
        }
    }
    else if (reqForInWarrenty.mmListbyInput.length > 0) {
        reqForInWarrentytList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForInWarrenty) }));
        requestArrayOrder.push({ label: 'INWARRENTY', index: count++ });
    }
    // 2. Without ULT
    if (reqForWitoutULT.mmListbyInput.length > splitCount) {
        const splitList = splitObjectArrayIntoChunks(reqForWitoutULT, 'mmListbyInput', splitCount);
        for (let i = 0; i < splitList.length; i++) {
            reqForWitoutULTList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArrayOrder.push({ label: 'WITHOUTULT', index: count++ });
        }
    }
    else if (reqForWitoutULT.mmListbyInput.length > 0) {
        reqForWitoutULTList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForWitoutULT) }));
        requestArrayOrder.push({ label: 'WITHOUTULT', index: count++ });
    }
    // 3. In Warranty VIZID
    if (reqForInWarrentyVIZID.mmListbyInput.length > splitCount) {
        const splitList = splitObjectArrayIntoChunks(reqForInWarrentyVIZID, 'mmListbyInput', splitCount);
        for (let i = 0; i < splitList.length; i++) {
            reqForInWarrentyVIZIDList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArrayOrder.push({ label: 'INWARRENTYVIZID', index: count++ });
        }

    }
    else if (reqForInWarrentyVIZID.mmListbyInput.length > 0) {
        reqForInWarrentyVIZIDList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForInWarrentyVIZID) }));
        requestArrayOrder.push({ label: 'INWARRENTYVIZID', index: count++ });
    }
    //End -- TWC4621-4586 -- JS Chunking for bulk data

    //Creating Request End
    that.loading(true);
    let refreshPopUpUi = false;
    Promise.all([...reqForInWarrentytList, ...reqForWitoutULTList, ...reqForInWarrentyVIZIDList])
        //Promise.all(requestArray)
        .then(async (response) => {
            console.log('1055', response);
            //Start -- TWC4621-4586 -- JS Chunking for bulk data
            let inWarrentyResponse = [];
            let withoutUltResponse = [];

            for (let i = 0; i < response.length; i++) {
                const { label } = requestArrayOrder[i];
                if (response[i]?.isError == true) {
                    throw new Error("PO History API Failure");
                }
                let result = response[i]?.apiResult;
                // Parse if response is a string
                if (typeof result === 'string' || result instanceof String) {
                    result = JSON.parse(result);
                }
                const elements = result?.elements || [];
                if (label === 'WITHOUTULT') {
                    withoutUltResponse.push(...elements);
                } else if (label === 'INWARRENTY' || label === 'INWARRENTYVIZID') {
                    inWarrentyResponse.push(...elements);
                }
            }

            console.log('In Warranty Response:', inWarrentyResponse);
            console.log('Without ULT Response:', withoutUltResponse);
            //End -- TWC4621-4586 -- JS Chunking for bulk data

            inWarrentyResponse = inWarrentyResponse.toSorted((date1, date2) => { //Sorting PO response based on CustomerBillingDocumentDt
                if (date1.CustomerBillingDocumentDt == '' || date2.CustomerBillingDocumentDt == '') return 0;
                date1 = new Date(date1.CustomerBillingDocumentDt);
                date2 = new Date(date2.CustomerBillingDocumentDt);
                if (date1 < date2) return 1;
                return -1;
            });
            withoutUltResponse = withoutUltResponse.toSorted((date1, date2) => { //Sorting PO response based on CustomerBillingDocumentDt
                if (date1.CustomerBillingDocumentDt == '' || date2.CustomerBillingDocumentDt == '') return 0;
                date1 = new Date(date1.CustomerBillingDocumentDt);
                date2 = new Date(date2.CustomerBillingDocumentDt);
                if (date1 < date2) return 1;
                return -1;
            });

            console.log('CEP po response inWarrentyResponse', inWarrentyResponse);
            console.log('CEP po response withoutUltResponse', withoutUltResponse);

            //Extracting response End
            that.poSearchData.forEach((item) => {
                if ((item.selected & !item.poValidated) || (item.VisIdbagError == true) || (that.isECCLineItemEdit == true && !item.selected)) {
                    item.isPoHistoryValid = false;
                    let today = new Date();
                    if (item.warrantyCheck.isUnderWarrenty) {
                        let isUnderCEP = today < item.warrantyCheck.creditElgiblityEndDate;

                        if (inWarrentyResponse.length == 0) {
                            item.Error = true;
                            item.errorText = tiMsgs.poDataNotFoundMsg;
                        }
                        //under cep and check po history data for mm is changed
                        else if (isUnderCEP) {
                            let poHistoryData = [];
                            if (isIaoFlag == 'true' && item?.warrantyResult?.WarrantyTypeCode == '2') { //TWC4621-5161 -- CPU EW
                                poHistoryData = inWarrentyResponse.find((data) => {
                                    let mmDates = _processPoHistoryDates(item?.parentId?.warrantyResult?.BaseWarrantyStartDate, item?.parentId?.warrantyCheck?.creditElgiblityEndDate);
                                    let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                    return (
                                        data.ItemId == item.MM &&
                                        mmDates == responseDates &&
                                        data.SalesOrderId == item?.warrantyResult?.ServiceContractNumber
                                    );
                                });
                                if (isPsgCase && !poHistoryData) {
                                    poHistoryData = inWarrentyResponse.find((data) => {
                                        // Check if item.oldMM exists before processing
                                        if (!item?.oldMM) return false;
                                        let mmDates = _processPoHistoryDates(item?.parentId?.warrantyResult?.BaseWarrantyStartDate, item?.parentId?.warrantyCheck?.creditElgiblityEndDate);
                                        let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                        return (
                                            data.ItemId == item?.oldMM &&
                                            mmDates == responseDates &&
                                            data.SalesOrderId == item?.warrantyResult?.ServiceContractNumber
                                        );
                                    });
                                }
                            }
                            else if (item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') {
                                poHistoryData = inWarrentyResponse.find((data) => {
                                    let mmDates = _processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate);
                                    let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                    return (
                                        data.ItemId == item.MM &&
                                        mmDates == responseDates
                                    );//Manohar --TWC4621-3489 
                                });
                                if (isPsgCase && !poHistoryData) { //PSG -- TWC4621-3857
                                    poHistoryData = inWarrentyResponse.find((data) => {
                                        // Check if item.oldMM exists before processing
                                        if (!item?.oldMM) return false;

                                        let mmDates = _processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate);
                                        let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                        return (
                                            data.ItemId == item?.oldMM &&
                                            mmDates == responseDates
                                        );
                                    });
                                }
                            } else if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
                                poHistoryData = inWarrentyResponse.find((data) => {
                                    let mmDates = `${_processDate(item?.warrantyResult?.BaseWarrantyStartDate)}_${_processDate(item?.warrantyCheck?.creditElgiblityEndDate)}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`;
                                    let responseDates = `${data.ItemEffectiveStartDt}_${data.ItemEffectiveEndDt}_${data?.DeliveryNoteNbr?.padStart(10, "0")}`;
                                    return (
                                        data.ItemId == item.MM &&
                                        mmDates == responseDates
                                    );
                                });
                                if (isPsgCase && !poHistoryData) { //PSG -- TWC4621-3857
                                    poHistoryData = inWarrentyResponse.find((data) => {
                                        // Check if item.oldMM exists before processing
                                        if (!item?.oldMM) return false;

                                        let mmDates = `${_processDate(item?.warrantyResult?.BaseWarrantyStartDate)}_${_processDate(item?.warrantyCheck?.creditElgiblityEndDate)}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`;
                                        let responseDates = `${data.ItemEffectiveStartDt}_${data.ItemEffectiveEndDt}_${data?.DeliveryNoteNbr?.padStart(10, "0")}`;
                                        return (
                                            data.ItemId == item?.oldMM &&
                                            mmDates == responseDates
                                        );
                                    });
                                }
                            }
                            if (poHistoryData) {
                                let popuplateStatus = popuplateLineItemPopupData(
                                    item,
                                    poHistoryData,
                                    isIaoFlag
                                );
                                refreshPopUpUi = popuplateStatus.status;
                                item = popuplateStatus.item;
                                item.poHistoryData = poHistoryData;
                                item.isPoHistoryValid = true;
                            }
                            else if (!inWarrentyResponse.find(data => data.ItemId == item.MM)) {
                                item.Error = true;
                                item.errorText = tiMsgs.poDataNotFoundMsg;
                            }
                            else {
                                item.Error = true;
                                item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
                                //item.errorText = item.warrantyResult?.WarrantyTypeCode == '2' ? tiMsgs.poDataNotFoundMsg : tiMsgs.cepExpiredMsg;
                            }
                        } else if (!isUnderCEP) {
                            let poHistoryData = [];
                            if (isIaoFlag == 'true' && item?.warrantyResult?.WarrantyTypeCode == '2') { //TWC4621-5161 -- CPU EW
                                poHistoryData = inWarrentyResponse.find((data) => {
                                    let mmDates = _processPoHistoryDates(item?.parentId?.warrantyResult?.BaseWarrantyStartDate, item?.parentId?.warrantyCheck?.creditElgiblityEndDate);
                                    let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                    return (
                                        data.ItemId == item.MM &&
                                        mmDates == responseDates &&
                                        data.SalesOrderId == item?.warrantyResult?.ServiceContractNumber
                                    );
                                });
                                if (isPsgCase && !poHistoryData) { //PSG -- TWC4621-3857
                                    poHistoryData = inWarrentyResponse.find((data) => {
                                        // Check if item.oldMM exists before processing
                                        if (!item?.oldMM) return false;
                                        let mmDates = _processPoHistoryDates(item?.parentId?.warrantyResult?.BaseWarrantyStartDate, item?.parentId?.warrantyCheck?.creditElgiblityEndDate);
                                        let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                        return (
                                            data.ItemId == item?.oldMM &&
                                            mmDates == responseDates &&
                                            data.SalesOrderId == item?.warrantyResult?.ServiceContractNumber
                                        );
                                    });
                                }
                            }
                            else if (item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') {
                                poHistoryData = inWarrentyResponse.find((data) => {
                                    let mmDates = _processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate);
                                    let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                    return (
                                        data.ItemId == item.MM &&
                                        mmDates == responseDates
                                    );//Manohar --TWC4621-3489 
                                });
                                if (isPsgCase && !poHistoryData) { //PSG -- TWC4621-3857
                                    poHistoryData = inWarrentyResponse.find((data) => {
                                        // Check if item.oldMM exists before processing
                                        if (!item?.oldMM) return false;
                                        let mmDates = _processPoHistoryDates(item?.warrantyResult?.BaseWarrantyStartDate, item?.warrantyCheck?.creditElgiblityEndDate);
                                        let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;
                                        return (
                                            data.ItemId == item?.oldMM &&
                                            mmDates == responseDates
                                        );//Manohar --TWC4621-3489 
                                    });
                                }
                            }
                            else if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
                                poHistoryData = inWarrentyResponse.find((data) => {
                                    let mmDates = `${_processDate(item?.warrantyResult?.BaseWarrantyStartDate)}_${_processDate(item?.warrantyCheck?.creditElgiblityEndDate)}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`;
                                    let responseDates = `${data.ItemEffectiveStartDt}_${data.ItemEffectiveEndDt}_${data?.DeliveryNoteNbr?.padStart(10, "0")}`;
                                    return (
                                        data.ItemId == item.MM &&
                                        mmDates == responseDates
                                    );//Manohar --TWC4621-3489 
                                });
                                if (isPsgCase && !poHistoryData) { //PSG -- TWC4621-3857
                                    poHistoryData = inWarrentyResponse.find((data) => {
                                        // Check if item.oldMM exists before processing
                                        if (!item?.oldMM) return false;
                                        let mmDates = `${_processDate(item?.warrantyResult?.BaseWarrantyStartDate)}_${_processDate(item?.warrantyCheck?.creditElgiblityEndDate)}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`;
                                        let responseDates = `${data.ItemEffectiveStartDt}_${data.ItemEffectiveEndDt}_${data?.DeliveryNoteNbr?.padStart(10, "0")}`;
                                        return (
                                            data.ItemId == item?.oldMM &&
                                            mmDates == responseDates
                                        );//Manohar --TWC4621-3489 
                                    });
                                }
                            }
                            if (poHistoryData) {
                                let popuplateStatus = popuplateLineItemPopupData(
                                    item,
                                    poHistoryData,
                                    isIaoFlag
                                );
                                refreshPopUpUi = popuplateStatus.status;
                                item = popuplateStatus.item;
                                item.poHistoryData = poHistoryData;
                                item.isPoHistoryValid = true;
                            } else {
                                item.Error = true;
                                item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
                            }
                        }
                    }
                    else if (item.warrantyCheck.isUnderCEPDays) {
                        let poHistoryDataList = [];
                        poHistoryDataList = withoutUltResponse.filter((data) => {
                            let mmDates = _processPoHistoryDates(item?.warrantyCheck?.creditElgiblityEndDate, new Date());
                            let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;

                            return (
                                data.ItemId == item.MM &&
                                mmDates == responseDates
                            );
                        });
                        if (isPsgCase && poHistoryDataList.length == 0) { //PSG -- TWC4621-3857
                            poHistoryDataList = withoutUltResponse.filter((data) => {
                                // Check if item.oldMM exists before processing
                                if (!item?.oldMM) return false;
                                let mmDates = _processPoHistoryDates(item?.warrantyCheck?.creditElgiblityEndDate, new Date());
                                let responseDates = `${data.ItemEffectiveStartDt}${data.ItemEffectiveEndDt}`;

                                return (
                                    data.ItemId == item?.oldMM &&
                                    mmDates == responseDates
                                );
                            });
                        }
                        //check cep days agens sales order date
                        if (poHistoryDataList.length > 0) {
                            let poHistoryData = poHistoryDataList.find((data) => {
                                let salesOrderCreateDt = convertStringToDate(data.CustomerBillingDocumentDt); //TWC4621-2173 - Replaced SalesOrderCreateDt with CustomerBillingDocumentDt
                                let cep = convertStringToDate(item.warrantyCheck.creditElgiblityEndDate);
                                return (

                                    salesOrderCreateDt <= today &&
                                    salesOrderCreateDt >= cep
                                );
                            });

                            if (poHistoryData) {
                                item.poHistoryData = poHistoryData;
                                item.isPoHistoryValid = true;
                                let popuplateStatus = popuplateLineItemPopupData(
                                    item,
                                    poHistoryData,
                                    isIaoFlag
                                );
                                refreshPopUpUi = popuplateStatus.status;
                                item = popuplateStatus.item;
                            } else {
                                item.Error = true;
                                item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
                            }
                        } else {
                            item.Error = true;
                            item.errorText = tiMsgs.poDataNotFoundMsg;
                        }
                    }
                    //BUG Fix- CPN required
                    if (item.isCPNRequired && !item.customerItemNbr) {
                        item.isPoHistoryValid = false;
                        item.Error = true;
                        item.errorText = tiMsgs.cpnRequiredErrorMsg;
                    }

                    if (item.isMMRequired && !item.MM) {
                        item.isPoHistoryValid = false;
                        item.Error = true;
                        item.errorText = tiMsgs.missingMMErrorMsg;
                    }

                    item.productStatus = (that?.isECCLineItemEdit == true && item.selected == false) ? false : item.isPoHistoryValid; //Samuel Unexpecetd lines issue unselected lines fix
                    item.selected = (that?.isECCLineItemEdit == true && item.selected == false) ? false : item.isPoHistoryValid; //Samuel Unexpecetd lines issue unselected lines fix
                    item.poValidated = true;
                    //Start -- TWC4621-4002 -- set the staus as CPU_POH_Rejection for the failed line items if ult type is VISID
                    if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && item.Error) {
                        item.VisIdbagError = true;
                        item.selected = false;
                        item.lineitemStatus = that.genericMessages?.CPU_POH_Rejection;
                    }
                    //End -- TWC4621-4002 -- set the staus as CPU_POH_Rejection for the failed line items if ult type is VISID
                    /*temp*/
                    /*item.productStatus = true;
                    item.selected = true;
                    item.Error = false;*/


                }
            });
            //Prashant -- Start -- Replace POSearch Modal Popup Fuctionality
            let temp = that.poSearchData.filter((data) => data.CustomerOldPONumber !== undefined)
            let poChangedList = temp.filter((data) => data.CustomerOldPONumber.length != 0 && data.CustomerOldPONumber !== '').map(item => {
                return {
                    newMM: item.MM,
                    oldPO: item.CustomerOldPONumber,
                    newPO: item.CustomerPONumber
                }
            })
            if (poChangedList.length > 0) {
                that.loading(false);
                await ModalForPOChange.open({
                    rows: poChangedList,
                    modelHeader: tiMsgs.poModelHeader,
                    description: tiMsgs.poModelDescription,
                    subDescription: tiMsgs.poModelSubDescription,
                    columns: [
                        { label: tiMsgs.mmModelExsitingMMName, fieldName: 'newMM' },
                        { label: tiMsgs.poModelExsitingPOName, fieldName: 'oldPO' },
                        { label: tiMsgs.poModelNewPOName, fieldName: 'newPO' },
                    ],
                    hideCancle: true,
                    size: 'small',
                })
            }
            if (that.caseType.remedy == "NPR-Credit") {
                await checkNPRMatrix(that);
            }
            if ((that.caseType.isTechnicalService() && !that.caseType.isTechnicalExchange()) || (that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
                that.poSearchData = validatedEWItemsBasedonParent(that.poSearchData);
            }

        })
        .catch((error) => {
            console.error("error validateCEP", error);
            that.showToast(
                that.labels.Error_Title,
                that.labels.PO_history_check_failed,
                "error"
            );
        })
        .finally(() => {
            that.loading(false);
            if (refreshPopUpUi) {
                invokeRefreshRowElement(that);
            }
        });

};

let fetchCreditPrice = async (that) => {
    let reqDetails = that.requestdetails;
    that.saveAndViewSummaryExp = false; // Exception Intake ---- Tushar Garg
    let apiCallData = [];
    let allLineItems = [];
    let extendedLines = [];
    allLineItems = that.poSearchData.filter((item) => item.selected);
    let failedlineitem = that.poSearchData.filter((item) => item.VisIdbagError == true || (that?.isECCLineItemEdit == true && item.selected == false));//TWC4621-2886  //Samuel Unexpected Lines changes for unselected/failed lines
    //allLineItems = [...allLineItems, ...failedlineitem];
    extendedLines = that.poSearchData.filter((item) => item.selected && item.warrantyResult?.WarrantyTypeCode == 2);
    apiCallData = that.poSearchData.filter((item) => item.selected && (item.warrantyResult?.WarrantyTypeCode != 2));
    apiCallData = [...apiCallData, ...failedlineitem];
    if (
        allLineItems.some((item) => !item.returnQuantity || item.returnQuantity <= 0)
    ) {
        that.showToast(
            that.labels.Missing,
            that.labels.return_qty_is_not_valid,
            "error"
        );
        return;
    }
    //If Distribution chanal is 01 send mm that are changed if not send all
    if ((reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c == "01" &&
        (that.caseType?.isTechnicalService() || that.caseType?.isQualityService())) ||
        (((that.caseType?.isExceptionService() &&
            (((reqDetails?.salesIssueReturnReason == that?.genericMessages?.GRL_Exception_Return || reqDetails?.salesIssueReturnReason == that?.genericMessages?.GRL_Exception) &&
                reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c == "01") ||
                reqDetails.salesIssueReturnReason == that.genericMessages.Exception_Return ||
                reqDetails.salesIssueReturnReason == that?.genericMessages?.Quarterly_Exception)))) ||
        (that.caseType?.isAdminService()) || that.caseType?.isExceptionRepair() ||
        (that.caseType.isMiscellaneousService() && reqDetails.remedyText == that?.genericMessages?.Return_Only)) {
        //Syed - Adding check if po hsitory data is missing
        let poHistoryResultwithouVIZID = [];
        let poHistoryResultwitVIZID = [];
        if (that.poSearchData.some(i => (!i.isPoHistoryValid && i.selected) || (!i.isPoHistoryValid && that?.isECCLineItemEdit == true && i.selected == false)) && !(that.caseType.isMiscellaneousService() && reqDetails.remedyText == that?.genericMessages?.Return_Only)) { //Samuel Unexpected Lines changes for unselected/failed lines
            that.loading(true);
            const { poHistoryResultwithoutVIZID, poHistoryResultwithVIZID } = await poHistoryCheck(that, that.poSearchData, reqDetails, that.caseType);
            poHistoryResultwithouVIZID = poHistoryResultwithoutVIZID;
            poHistoryResultwitVIZID = poHistoryResultwithVIZID;
            console.log('poHistoryResult from price check ', poHistoryResultwithouVIZID, poHistoryResultwitVIZID);
        }
        // Adding Conditions for Exception and Admin Intake --------- TWC4621-1470------ Tushar ------Start
        that.loading(true);
        let isPortalSoftStop = false;
        that.poSearchData.forEach((item) => {
            if (item.selected || (that?.isECCLineItemEdit == true && item.selected == false)) { //Confirm with Manoahr for adding Reject CPU here //Samuel Unexpected Lines changes for unselected/failed lines
                //Syed - adding po hsitory data if missing
                let poHistoryRequestResultData = [];
                if (!item.isPoHistoryValid && item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
                    poHistoryRequestResultData = poHistoryResultwitVIZID?.filter((data) => {
                        return (data.ItemId == item.MM);
                    });
                }
                else if (!item.isPoHistoryValid) {
                    poHistoryRequestResultData = poHistoryResultwithouVIZID?.filter((data) => {
                        return (data.ItemId == item.MM);
                    })
                }
                if (!item.isPoHistoryValid && poHistoryRequestResultData?.length > 0) {
                    item.poHistoryData = poHistoryRequestResultData[0];
                    if (item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0) {
                        item.UnitPrice = item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt;
                    }
                    else {
                        item.UnitPrice = item.poHistoryData.SalesOrderLineNetPriceAmt ? item.poHistoryData.SalesOrderLineNetPriceAmt : "";
                    }
                }
                item.YMS2Price = 0;
                // Adding Conditions for Exception and Admin Intake --------- TWC4621-1470------ Tushar ------Start
                if ((!item?.warrantyCheck?.isMMChange || that.caseType?.isAdminService() || that.caseType?.isExceptionService() || that.caseType?.isMiscellaneousService())) {
                    if (that.caseType?.isExceptionService() || that.caseType?.isAdminService()) {
                        that.validateCreditPrice = true;
                        that.saveAndViewSummaryExp = false;
                    }
                    if (that.caseType.isMiscellaneousService() && reqDetails.remedyText == that?.genericMessages?.Return_Only) {
                        item.YMS2Price = 0;
                    } else {
                        item.YMS2Price = item.UnitPrice;
                        item.tempYMS2Price = item.UnitPrice;//TWC4621-4742,TWC4621-4789 -- mapping the value for zero dollar Scenrios where the price should be zero or orginal price
                    }
                    item.creditPrice = +item.returnQuantity * +item.YMS2Price;
                    item.creditPriceDate = new Date();
                } else if (item.poHistoryData) {
                    //TWC4621-2173 - Use ContraRevenueAdjustmentRequestlineNetPriceAmt instead of SalesOrderLineNetPriceAmt
                    item.UnitPrice = item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0 ? item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.poHistoryData.SalesOrderLineNetPriceAmt;
                    item.YMS2Price = item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0 ? item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.poHistoryData.SalesOrderLineNetPriceAmt;
                    item.tempYMS2Price = item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0 ? item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.poHistoryData.SalesOrderLineNetPriceAmt;//TWC4621-4742,TWC4621-4789 -- mapping the value for zero dollar Scenrios where the price should be zero or orginal price
                    item.creditPrice = +item.returnQuantity * +item.YMS2Price;
                    item.creditPriceDate = new Date();

                }

                item.priceCheck = true;
                if (!item.YMS2Price) {
                    if (that.isPortal == true || that.isPortal == "true") {
                        item.creditPrice = 0;
                        item.YMS2Price = 0;
                        isPortalSoftStop = true;
                        item.isSoftStop = true
                    } else if (!(that.caseType.isMiscellaneousService() && reqDetails.remedyText == that?.genericMessages?.Return_Only)) {
                        item.productStatus = false;
                        item.selected = false;
                        item.Error = true;
                        item.errorText = tiMsgs.priceNotFoundMsg;
                        that.creditPriceCheck = true;
                    }
                }
            }
        });
        //BUG - Fixing Portal soft stop for 01 channel
        if (isPortalSoftStop && (that.isPortal == true || that.isPortal == "true")) {
            that.showToast(tiMsgs.pricePortalHeaderErrorMsg, tiMsgs.pricePortalDescriptionErrorMsg, "warning");
        }
        that.loading(false);
        console.log('PO price done ', JSON.stringify(that.poSearchData))
        return;
    }
    if ((that.caseType?.isExceptionService() && (reqDetails.salesIssueReturnReason == that?.genericMessages?.GRL_Exception_Return || reqDetails.salesIssueReturnReason == that?.genericMessages?.GRL_Exception)) ||
        !that.caseType?.isExceptionService()) {
        that.loading(true);
        let mmListbyInput;
        if (apiCallData.length > 0) {
            mmListbyInput = [...new Set(apiCallData.map((item) => item.MM))].filter((i) => i)
        }
        //EW
        if (extendedLines?.length > 0) {
            let isPortalSoftStop = false;
            that.poSearchData.forEach((item) => {
                if (item.selected && item.warrantyResult?.ServiceContractNumber && !item.priceCheck) {
                    item.YMS2Price = 0;
                    if (item.poHistoryData) {
                        //TWC4621-2173 - Use ContraRevenueAdjustmentRequestlineNetPriceAmt instead of SalesOrderLineNetPriceAmt
                        item.UnitPrice = item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0 ? item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.poHistoryData.SalesOrderLineNetPriceAmt;
                        item.YMS2Price = item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0 ? item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.poHistoryData.SalesOrderLineNetPriceAmt;
                        item.tempYMS2Price = item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt && item.poHistoryData?.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0 ? item.poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.poHistoryData.SalesOrderLineNetPriceAmt;//TWC4621-4742,TWC4621-4789 -- mapping the value for zero dollar Scenrios where the price should be zero or orginal price
                        item.creditPrice = +item.returnQuantity * +item.YMS2Price;
                        item.creditPriceDate = new Date();
                    }
                    item.priceCheck = true;
                    if (!item.YMS2Price) {
                        if (that.isPortal == true || that.isPortal == "true") {
                            item.creditPrice = 0;
                            item.YMS2Price = 0;
                            isPortalSoftStop = true;
                            item.isSoftStop = true
                        }
                        else {
                            item.productStatus = false;
                            item.selected = false;
                            item.Error = true;
                            item.errorText = tiMsgs.priceNotFoundMsg;
                        }
                    }
                }
            });
            if (isPortalSoftStop && (that.isPortal == true || that.isPortal == "true")) {
                that.showToast(tiMsgs.pricePortalHeaderErrorMsg, tiMsgs.pricePortalDescriptionErrorMsg, "warning");
            }
            that.loading(false);
        }

        if (mmListbyInput) {
            console.log('PIC call ', mmListbyInput);
            doPicAPIpriceCheck(that, mmListbyInput, reqDetails.selectedsoldToCMF, [reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c])
                .then((result) => {
                    if (result?.isError == true) {
                        throw new Error("PIC API Failure");
                    }
                    let response = result?.apiResult;
                    if (typeof response === "string" || response instanceof String) response = JSON.parse(response);
                    let portalSoftStop = false;
                    that.poSearchData.forEach((item) => {
                        if (item.selected && item.warrantyResult?.WarrantyTypeCode != 2 || (that?.isECCLineItemEdit == true && item.selected == false)) { //Samuel Unexpected Lines changes for unselected/failed lines
                            let today = new Date();
                            // TWC4621-963 - Furqan - 08-02-2023 - TI Price Api valid to
                            let creditResponse = response.find((data) => {
                                let validFromDate = new Date(data.ValidFromDate);
                                let validToDate = new Date(data.ValidToDate);
                                let valid = today < validToDate && today > validFromDate;
                                return data?.MM?.trim() == item?.MM?.trim() && valid;
                            });
                            if (creditResponse) {
                                item.YMS2Price = creditResponse.CurrentPrice;
                                item.tempYMS2Price = creditResponse.CurrentPrice;//TWC4621-4742,TWC4621-4789 -- mapping the value for zero dollar Scenrios where the price should be zero or orginal price
                                item.creditPrice = +item.returnQuantity * +item.YMS2Price;
                                item.creditPriceDate = new Date();
                                item.pricingCondition = creditResponse.PriceCondition;
                            }
                            else {
                                // TWC4621-975 - Furqan - 08-02-2023 - for portal all values are 0
                                item.creditPrice = 0;
                                item.YMS2Price = 0;
                                item.pricingCondition = '';
                                item.isSoftStop = true;
                                item.successText = tiMsgs.priceNotFoundMsg;
                                portalSoftStop = true;
                                //bug fix- on portal dont show price overrride header
                                if (that.isPortal == false) {
                                    that.creditPriceCheck = true;
                                    item.RFPriceChange = '';

                                }
                            }
                            item.priceCheck = true;
                            item.price = item.YMS2Price;
                        }
                    });
                    if (
                        portalSoftStop &&
                        (that.isPortal == true || that.isPortal == "true")
                    ) {
                        that.showToast(
                            that.labels.Warning,
                            tiMsgs.pricePortalDescriptionErrorMsg,
                            "warning"
                        );
                    }
                })
                .catch((err) => {
                    console.error("error fetchCreditPrice", err);
                    that.showToast(
                        that.labels.Error_Title,
                        that.labels.Credit_Price_Check_Failed,
                        "error"
                    );
                })
                .finally(() => {
                    if (that.caseType?.isExceptionService() || that.caseType?.isAdminService() || that.caseType?.isMiscellaneousService()) { //Manohar -- TWC4621-2011 -- added isMiscellaneousService condition
                        that.validateCreditPrice = true;
                        that.saveAndViewSummaryExp = false;
                    }
                    //console.log('1633',JSON.stringify(this.poSearchData))
                    that.loading(false);
                });
        }

    }
};


///Next handlers
let productValidateNextHandlerTechnical = (that) => { // ************Next handler on click of next after search/bulk upload******************
    let INTAKE_LIMIT = +that.genericMessages?.INTAKE_LINEITEM_LIMIT || 1000;
    if (that.template.querySelector(".table-style-cls")) {
        that.template.querySelector(".table-style-cls").scrollTop = 0;
    }
    if (that.selectedInvoiceNum.length == 0) {
        that.showToast(
            r4c_CustomLabels.labels.Records_are_not_selected,
            r4c_CustomLabels.labels.no_record_is_selected_message,
            "warning"
        );
        return;
    }
    let orignalData = that.poSearchData.filter(i => i.selected);
    if (that.caseType.isQualityService() && that.requestdetails.salesIssueReturnReason == that.genericMessages?.FAC) {
        orignalData = that.poSearchData;
    }
    let orignalDataInvoiceNumber = orignalData.map(i => i.InvoiceNumber);
    let selectedDataFromWarrentyScreen = that.poSearchOldTiData.filter(i => i.selected && orignalDataInvoiceNumber.indexOf(i.InvoiceNumber) == -1);
    let selectedInvoiceNumberFromWarrentyScreen = that.poSearchOldTiData.map(i => i.InvoiceNumber);
    if (that.casemode == "Edit" && that.poSearchOldTiData.some(i => orignalDataInvoiceNumber.includes(i.InvoiceNumber))) {
        selectedDataFromWarrentyScreen = [];
    }
    let selectedNewData = that.poSearchNewData.filter(i => i.selected && selectedInvoiceNumberFromWarrentyScreen.indexOf(i.InvoiceNumber) == -1 && orignalDataInvoiceNumber.indexOf(i.InvoiceNumber) == -1);
    let fullData = [];
    fullData.push(...orignalData.map((rec) => {
        rec = processNewLineItemData(that, rec);
        return { ...rec };
    }));

    fullData.push(...selectedDataFromWarrentyScreen.map((rec) => {
        rec = processNewLineItemData(that, rec);
        return { ...rec };
    }));
    fullData.push(...selectedNewData.map((rec) => {
        rec = processNewLineItemData(that, rec);
        return { ...rec };
    }));
    if (fullData.length == 0) {
        that.showToast(
            r4c_CustomLabels.labels.Error_Title,
            r4c_CustomLabels.labels.no_record_is_selected_message,
            "error"
        );
        return;
    }
    if (that.caseType?.isTechnicalExchange() && fullData.length > 50) {
        that.showToast(
            r4c_CustomLabels.labels.Error_Title,
            tiMsgs.exchangeLimitError,
            "error"
        );
        return;
    }
    //Syed - TWC4621-2627 - Limit intake items to 1500 only
    else if (fullData.filter((it) => it.selected).length > INTAKE_LIMIT) {
        that.showToast(
            r4c_CustomLabels.labels.Error_Title,
            r4c_CustomLabels.labels.INTAKE_LIMIT_MESSAGE,
            "error"
        );
        return;
    }
    that.poSearchData = fullData;
    that.allselectedcheckbox = true;
    that.handleNextClick("step-2");
    that.backStage = "step-1";
    that.showProductValidateNextBtn = false;
    that.poHistoryBTN.isSearchStep = false;
    that.showReturnToProductValidateBtn = true;
    if (that.caseType?.isTechnicalService() || that.caseType?.isQualityService() || that.caseType?.isExceptionRepair() || (that.caseType?.isExceptionService() && that.requestdetails.salesIssueReturnReason == that.genericMessages?.GRL_Exception)) {
        that.tecnincalIntakeButtons.showWarrentyCheckTable();
    }

}

let warrentyCheckNextHandler = async (that) => {
    if (that.caseType.isTechnicalExchange() && that.poSearchData.filter(w => w.selected == true).length > 51) {
        that.showToast(
            that.labels.Warning,
            tiMsgs.exchangeLimitError,
            "warning"
        );
        return;
    }

    let ultList = that.poSearchData.filter((data) => {
        let status = '';
        if (data.selected && data.ult) {
            //status = data.ult?.match(/^[0-9]+$/) ? data.ult : data?.ult?.trim()?.toUpperCase();
            status = data.ult;
            if (data?.warrantyResult?.WarrantyTypeCode == 2) {
                status = '';
            }
            else if (data?.parentLineId) {
                status = '';
            }
        }
        return status;
    })
        .map((data) => data.selected == true && data.ult)
        .filter((data) => data);

    if (new Set(ultList).size !== ultList.length) {
        LightningAlert.open({
            message: tiMsgs.uniqueULTErrorMsg,
            variant: "header",
            label: tiMsgs.uniqueULTErrorHeader
        });
        return;
    }

    await that.checkRequiredMatrix(that);

    if (
        that.poSearchData.some(
            (item) => item.selected && item.isUltRequired && !item.ult
        )
    ) {
        that.showToast(
            that.labels.Warning,
            that.labels.Please_enter_required_ult_numbers,
            "warning"
        );
        return;
    }
    //Step 2
    that.handleNextClick("step-3");
    that.backStage = "step-2";
    that.poSearchData.forEach((data, index) => {
        data.index = index + 1;
        //TWC4621-1041 - Furqan - Fixing bug of ult getting not disabled on next step
        if (data.selected) {
            data.ultDisabled = true
        }
        if (data.ult) {
            data.quantityDisabled = true;
            data.returnQuantity = 1;
        }
        data.display = data.selected;
        if (!data.step2DisplayLock) {
            data.step2Data = true;
            data.step2DisplayLock = true;
        }
        //Fixing 327 Bug - remove selected varailabe
    });

    if (that.caseType?.isTechnicalService() || that.caseType?.isQualityService() || that.caseType?.isExceptionRepair() || (that.caseType?.isExceptionService() && that.requestdetails.salesIssueReturnReason == that.genericMessages?.GRL_Exception)) {
        that.tecnincalIntakeButtons.showPoHistoryTable();
    }

    //TWC4621-4577 - SaiRam Added for product status check
    let agentProductstatusArr = that.genericMessages.isIaoFlag == 'true' ? that.genericMessages.Agent_Allowed_Product_Status_IAO.split(';') : that.genericMessages.Agent_Allowed_Product_Status.split(';');
    let portalProductstatusArr = that.genericMessages.isIaoFlag == 'true' ? that.genericMessages.Portal_Allowed_Product_Status_IAO.split(';') : that.genericMessages.Portal_Allowed_Product_Status.split(';');
    that.poSearchData.map((item) => {
        let objMMIDBUHierarchy = { ...item.Data };
        console.log('Status data ', JSON.stringify(objMMIDBUHierarchy?.Disti_Channel_Product_Statuses__r));
        if (item.selected === true && item.Data) {
            //SaiRam - Added method to check productstatus validations for IAO Start - TWC4621-5396  
            if (that.genericMessages.isIaoFlag == 'true') {
                if (!(objMMIDBUHierarchy && objMMIDBUHierarchy?.Disti_Channel_Product_Statuses__r && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c)) {
                    item.Error = true;
                    item.errorText = that.labels.No_dist_channel_product_available
                } else {
                    if (that.isPortal == false && objMMIDBUHierarchy && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
                        !agentProductstatusArr.includes(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c)
                    ) {
                        item.Error = true;
                        item.errorText = StringFormatter.format(that.labels.Current_product_status, `${objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c} (${objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Disti_Channel_Product_Status_Description__c})`);
                    } else if (that.isPortal == true && objMMIDBUHierarchy && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r && !portalProductstatusArr.includes(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c)) {
                        item.Error = true;
                        item.errorText = that.labels.R4C_ProductStatus_ErrMsg;
                    }
                }
            } else {
                if (!(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c)) {
                    item.Error = true;
                    item.errorText = that.labels.No_dist_channel_product_available
                } else {
                    if (that.isPortal == false && objMMIDBUHierarchy && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
                        !agentProductstatusArr.includes(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c)
                    ) {
                        item.Error = true;
                        item.errorText = StringFormatter.format(that.labels.Current_product_status, objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c);
                    } else if (that.isPortal == true && objMMIDBUHierarchy && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r && !portalProductstatusArr.includes(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Disti_Channel_prd_Status_Cd__c)) {
                        item.Error = true;
                        item.errorText = that.labels.R4C_ProductStatus_ErrMsg;
                    }
                }
            }
            //SaiRam - Added method to check productstatus validations for IAO End - TWC4621-5396 
        }

        if (item.Error) {
            item.productStatus = false;
            item.selected = false;
            invokeRefreshRowElement(that);
            invokeCustomValidationElement(that)
        }

        return { ...item }
    });

    //SaiRam TWC4621-4577 end

    that.updateSelectAllCheckbox();


};
let poHistoryCheckNextHandler = (that) => {
    //Step 3
    that.handleNextClick("step-4");
    that.backStage = "step-3";

    that.poSearchData.forEach((data, index) => {
        data.index = index + 1;
        data.display = data.selected;
        if (data?.YMS2Price == "0.00" && (data?.tempYMS2Price === '' || data?.tempYMS2Price === undefined)) { //TWC4621-4742,TWC4621-4789 -- if tempYMS2Price is null , fetch price from API call
            data.priceCheck = false;
        }
        if (!data.step3DisplayLock) {
            data.step3Data = true;
            data.step3DisplayLock = true;
        }
    });

    if (that.caseType?.isTechnicalService() || that.caseType?.isExceptionRepair() || (that.caseType?.isExceptionService() && that.requestdetails.salesIssueReturnReason == that.genericMessages?.GRL_Exception)) {
        that.tecnincalIntakeButtons.showCreditPriceTable();
        if (that.isPortal == false || that.isPortal == 'false') {
            that.creditPriceCheck = that.poSearchData.some(item => (item?.price == 0 || +item?.YMS2Price == 0)) || (that.genericMessages?.Retrn_Resn_for_ZERO_OR_Original_Price?.split(';') || [])?.includes(that.requestdetails.salesIssueReturnReason);//TWC4621-4742,TWC4621-4789 -- added Retrn_Resn_for_ZERO_OR_Original_Price condition to allow zero dollar in Price
        }

    }
    that.updateSelectAllCheckbox();
};
let creditPriceNextHandler = (that) => {
    //Step 4
    that.handleNextClick("step-5");
    that.backStage = "step-4";
    that.tecnincalIntakeButtons.showCreditPriceValidateBtn = false;
    that.showViewSummary = true;
    that.poSearchData.forEach((data, index) => {
        data.index = index + 1;
        data.display = data.selected;
        if (!data.step4DisplayLock) {
            data.step4Data = true;
            data.step4DisplayLock = true;
        }
    });
    that.updateSelectAllCheckbox();
};

//Back handlers
let backToWarrentyChekScreenHandler = (that) => {
    //Step 2
    that.handleNextClick("step-2");
    that.backStage = "step-1";

    that.poSearchData.forEach((data, index) => {
        if (!(data.ultDisabled === true)) {
            data.ultDisabled = false;
        }
        data.index = index + 1;
        data.display = data.step2Data || data.selected;
    });
    if (that.caseType?.isTechnicalService() || that.caseType.isQualityService() || that.caseType?.isExceptionRepair() || (that.caseType?.isExceptionService() && that.requestdetails.salesIssueReturnReason == that.genericMessages?.GRL_Exception)) that.tecnincalIntakeButtons.showWarrentyCheckTable();
    //if(that.caseType?.isExceptionService() && that.requestdetails.salesIssueReturnReason == 'GRL Exception')  that.ExceptionIntakeButtons.showWarrentyCheckTable();

    that.updateSelectAllCheckbox();
};

let backToPOHistoryCheckScreenHandler = (that) => {
    //Step 3
    that.handleNextClick("step-3");
    that.backStage = "step-2";
    that.poSearchData.forEach((data, index) => {
        data.index = index + 1;
        data.display = data.step3Data || data.selected;
    });
    if (that.caseType?.isTechnicalService() || that.caseType?.isExceptionRepair() || (that.caseType?.isExceptionService() && that.requestdetails.salesIssueReturnReason == that.genericMessages?.GRL_Exception)) that.tecnincalIntakeButtons.showPoHistoryTable();
    that.updateSelectAllCheckbox();
};

//Apex Call
let checkRequiredMatrix = async (that) => {
    let reqDetails = that.requestdetails;
    let Sales_Issue_Operation_Business_Unit_CodeList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.ICS_WR_Operation_Business_Unit_Code__c)
        )
    ].filter((i) => i);
    let Item_Family_NameList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.ICS_WR_Family_Name__c)
        )
    ].filter((i) => i);
    let Item_Product_CodeList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item.ProductCode)
        )
    ].filter((i) => i);

    // SaiRam - OPID changes for IAO
    let Profit_Centre_CodeList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.ICS_WR_Profit_Center_Code__c)
        )
    ].filter((i) => i);

    let Item_Market_NameList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.Item_Market_Name__c)
        )
    ].filter((i) => i);

    let requestData = {};
    if (that.genericMessages?.isIaoFlag !== 'true') {
        requestData = {
            Sales_Issue_Remedy_Type__c: reqDetails.Sales_Issue_Remedy_Type__c,
            Sales_Issue_Customer_CMF__c: reqDetails.sales_Area__c.Customer_CMF__c,
            Customer_Sales_Organization_Code__c: reqDetails.Sales_Issue_Sales_Organization__c,
            Customer_Distribution_Channel_Code__c: reqDetails.Sales_Issue_Distribution_Channel__c,
            Sales_Issue_Customer_Return_Reason__c: reqDetails.Sales_Issue_Return_Reason__c,
            Sales_Issue_Service_Type__c: reqDetails.Sales_Issue_Service_Type__c,
            Location_SoldTo_Country__c: reqDetails?.soldToAddressRec?.Customer_Country__c, //TWC4621-1046 --Prashant-- Add soldToAddress Country field in Where condition of Sales_Issue_Matrix__c sObject in POSearch_Controller Class
            Sales_Issue_Operation_Business_Unit_Code__c: Sales_Issue_Operation_Business_Unit_CodeList,
            Item_Family_Name__c: Item_Family_NameList,
            Item_Product_Code__c: Item_Product_CodeList,
        };
    } else {
        requestData = {
            Sales_Issue_Remedy_Type__c: reqDetails.Sales_Issue_Remedy_Type__c,
            Sales_Issue_Customer_CMF__c: reqDetails.sales_Area__c.Customer_CMF__c,
            Customer_Sales_Organization_Code__c: reqDetails.Sales_Issue_Sales_Organization__c,
            Customer_Distribution_Channel_Code__c: reqDetails.Sales_Issue_Distribution_Channel__c,
            Sales_Issue_Customer_Return_Reason__c: reqDetails.Sales_Issue_Return_Reason__c,
            Sales_Issue_Service_Type__c: reqDetails.Sales_Issue_Service_Type__c,
            Location_SoldTo_Country__c: reqDetails?.soldToAddressRec?.Customer_Country__c, //TWC4621-1046 --Prashant-- Add soldToAddress Country field in Where condition of Sales_Issue_Matrix__c sObject in POSearch_Controller Class
            Item_Family_Name__c: Item_Family_NameList,
            Item_Market_Name__c: Item_Market_NameList,
            Sales_Issue_Profit_Center__c: Profit_Centre_CodeList
        };
    }

    that.loading(true);
    console.log('Sales_Issue_Required_Field_Matrix', requestData)
    let result = await getMatrixRecord({
        recordType: 'Sales_Issue_Required_Field_Matrix',
        requestData: JSON.stringify(requestData)
    });
    console.log('Sales_Issue_Required_Field_Matrix result ', result)
    //Filter using BR SOQL Where conditions first
    // result = result.filter(record => {
    //   return (
    //     //AND conditions
    //     (record?.Sales_Issue_Service_Type__c === reqDetails.Sales_Issue_Service_Type__c || record?.Sales_Issue_Service_Type__c === undefined) &&
    //     (record?.Sales_Issue_Remedy_Type__c === reqDetails.Sales_Issue_Remedy_Type__c || record?.Sales_Issue_Remedy_Type__c === undefined) &&
    //     (record?.Sales_Issue_Customer_Return_Reason__c === reqDetails.Sales_Issue_Return_Reason__c || record?.Sales_Issue_Customer_Return_Reason__c === undefined) &&
    //     (record?.Sales_Issue_Customer_CMF__c === reqDetails.sales_Area__c.Customer_CMF__c || record?.Sales_Issue_Customer_CMF__c === undefined) &&
    //     (record?.Sales_Issue_Customer_Sales_Organization__c === reqDetails.Sales_Issue_Sales_Organization__c || record?.Sales_Issue_Customer_Sales_Organization__c === undefined) &&
    //     (record?.Customer_Disti_Channel__c === reqDetails.Sales_Issue_Distribution_Channel__c || record?.Customer_Disti_Channel__c === undefined) &&
    //     (record?.Location_SoldTo_Country__c === reqDetails?.soldToAddressRec?.Customer_Country__c || record?.Location_SoldTo_Country__c === undefined) &&
    //     //OR conditions
    //     ((Sales_Issue_Operation_Business_Unit_CodeList.includes(record?.Sales_Issue_Operation_Business_Unit_Code__c) || record?.Sales_Issue_Operation_Business_Unit_Code__c === undefined) ||
    //       (Item_Product_CodeList.includes(record?.Item_Product_Code__c) || record?.Item_Product_Code__c === undefined) ||
    //       (Item_Family_NameList.includes(record?.Item_Family_Name__c) || record?.Item_Family_Name__c === undefined)
    //     ))
    // })
    that.poSearchData.forEach((item) => {
        if (item.productStatus && !item.isUltRequired) {
            /* checking unitcode,family,product code for match or it is empty in rule record */
            let matchResult = result.filter(matrix => {
                if (that.genericMessages?.isIaoFlag == 'true') {
                    return (
                        (((!item?.Data?.ICS_WR_Profit_Center_Code__c && !matrix.Sales_Issue_Profit_Center__c) || (matrix?.Sales_Issue_Profit_Center__c == item?.Data?.ICS_WR_Profit_Center_Code__c) || !matrix?.Sales_Issue_Profit_Center__c) ||
                            ((!item?.Data?.Item_Market_Name__c && !matrix.Item_Market_Name__c) || (matrix?.Item_Market_Name__c == item?.Data?.Item_Market_Name__c) || !matrix?.Item_Market_Name__c)) &&
                        ((!item?.Data?.ICS_WR_Family_Name__c && !matrix.Item_Family_Name__c) || (matrix?.Item_Family_Name__c == item?.Data?.ICS_WR_Family_Name__c) || !matrix?.Item_Family_Name__c)
                    )
                } else {
                    return (
                        ((!item?.Data?.ICS_WR_Operation_Business_Unit_Code__c && !matrix.Sales_Issue_Operation_Business_Unit_Code__c) || (matrix?.Sales_Issue_Operation_Business_Unit_Code__c == item?.Data?.ICS_WR_Operation_Business_Unit_Code__c) || !matrix?.Sales_Issue_Operation_Business_Unit_Code__c) &&
                        ((!item?.Data?.ICS_WR_Family_Name__c && !matrix.Item_Family_Name__c) || (matrix?.Item_Family_Name__c == item?.Data?.ICS_WR_Family_Name__c) || !matrix?.Item_Family_Name__c) &&
                        ((!item?.ProductCode && !matrix.Item_Product_Code__c) || (matrix?.Item_Product_Code__c == item?.ProductCode) || !matrix?.Item_Product_Code__c)
                    )
                }

            });
            console.log('matchResult', matchResult)
            //getting rule that has lowest priority
            if (matchResult?.length > 0) {
                let rule = matchResult[0];
                console.log('rule', rule)
                item.isUltRequired = rule.Product_Unique_Id_Required_Indicator__c;
                item.isCPNRequired = rule.Sales_Issue_CPN_Support_Indicator__c;
                item.isMMRequired = rule.Item_Required_Indicator__c;
            }

        }
    });
    that.loading(false);
};
function processNewLineItemData(that, rec) {
    if (!rec.warrantyCheck) {
        rec.step2Data = rec.selected;
        rec.display = rec.selected;
        if (that.caseType.isTechnicalService() && !that.caseType?.isTechnicalExchange() || (that.caseType.isQualityService() && that?.requestdetails?.salesIssueReturnReason === that.genericMessages?.FAC)) { //manohar
            if (!rec.boxCondition) {
                rec.boxCondition = that.genericMessages.Outer_Box_Open_Product_Unsealed;
            }
            rec.boxConditionDisabled = true;
        }
        rec.isPoNumberEditable = false; //added if condition by sandeep TWC4621-938 30th jan 2023
        rec.isUltRequired = false;
        rec.ultDisabled = that?.isECCLineItemEdit ? true : false; //Unexpected Lines Bug Fix - Samuel
        rec.quantityDisabled = false;
        if ((rec.returnQuantity && that.searchByParent === "ULT") || rec.ult) {
            //added if condition by sandeep as part of bulk upload TWC4621-857 on 20th jan
            rec.quantityDisabled = true;
            rec.returnQuantity = 1;
        }
        if (!rec.ult) {
            rec.ult = "";
        }
        // TWC4621-963 - Furqan - added for edit scenario to poupulate ult
        if (rec?.warrantyResult?.status && that.casemode == "Edit" && !that.caseType?.isTechnicalExchange()) {
            let editOnNextDay = false;
            if (that.caseType.isQualityService()) { //manohar
                rec.mrbDisabled = false;
                editOnNextDay = rec.selected === true && (rec.creditPriceDate === "" ? true
                    : getApexDateString(new Date()) > getApexDateString(rec.creditPriceDate)
                        ? true : false)
            }
            if (that.requestdetails.warrentyQueryNumber) {
                let dateString = that.requestdetails.warrentyQueryNumber.substring(0, 8);
                let year = dateString.substring(0, 4);
                let month = dateString.substring(4, 6);
                let day = dateString.substring(6, 8);
                let newDate = new Date(year, +month - 1, day);
                let todayDate = new Date();
                if (
                    todayDate.getDate() != newDate.getDate() ||
                    todayDate.getMonth() != newDate.getMonth() ||
                    todayDate.getFullYear() != newDate.getFullYear()
                ) {
                    editOnNextDay = true;
                }
            }
            rec.warrantyCheck = {};
            rec.warrantyCheck.queryNumber = that.requestdetails.warrentyQueryNumber || "";
            rec.warrantyCheck.isUnderWarrenty = rec?.warrantyResult?.status == that.genericMessages.In_warranty_label;
            rec.warrantyCheck.isUnderCEPDays = rec?.warrantyResult?.status == that?.genericMessages?.TI_Warranty_WTBD;//tiMsgs.warrentyWTBD;
            rec.warrantyCheck.isMMChange = false;
            rec.warrantyCheck.isError = false;
            rec.warrantyCheck.creditElgiblityEndDate = "";
            rec.warrantyCheck.warrentyCheckDate = rec?.warrantyResult?.warrentyCheckDate;
            if (rec?.warrantyResult?.BaseWarrantyStartDate) { //Updated to BaseWarrantyStartDate from end date - Bug Fix Samuel. Manohar need to verify
                rec.warrantyCheck.creditElgiblityEndDate = new Date(rec?.warrantyResult?.BaseWarrantyStartDate);
                rec.warrantyCheck.creditElgiblityEndDate.setDate(rec.warrantyCheck.creditElgiblityEndDate.getDate() + +rec.warrantyResult.CreditPeriodCount);
                if (that.caseType.isTechnicalExchange()) {
                    rec.successText = StringFormatter.format(tiMsgs.warrentyValid, getDateString(rec?.warrantyResult?.BaseWarrantyEndDate));
                    if (rec?.warrantyResult?.ExtendedWarrantyEndDate) {
                        rec.successText = StringFormatter.format(tiMsgs.warrentyValid, getDateString(rec?.warrantyResult?.ExtendedWarrantyEndDate));
                    }
                }
                else {
                    rec.successText = StringFormatter.format(tiMsgs.warrentyValid, getDateString(rec?.warrantyCheck?.creditElgiblityEndDate));
                }
                //Bug fix - Samuel - Show WTBD for portal case edit based on VisId status
                const notAcceptingVizStatusCodes = new Set(that.genericMessages?.invalid_warrenty_viz_code?.split?.(',') || ['PC', 'CME', 'INV', 'PIN', 'SIN']);
                if (rec?.warrantyResult?.VizIdStatusCode && notAcceptingVizStatusCodes.has(rec?.warrantyResult?.VizIdStatusCode?.toUpperCase())) {
                    rec.isSoftStop = true;
                    rec.successText = (that.isPortal == true || that.isPortal == 'true')
                        ? tiMsgs.warrentyWTBD
                        : {
                            SIN: tiMsgs.ErrMsgAgSIN,
                            PIN: tiMsgs.ErrMsgAgPIN,
                            PC: tiMsgs.ErrMsgAgPC,
                        }[rec?.warrantyResult?.VizIdStatusCode] || tiMsgs.warrentyWTBD;
                }
                //Syed - Adding extented warrenty check 
            }
            else if (rec?.warrantyResult?.CreditPeriodCount) {
                rec.warrantyCheck.creditElgiblityEndDate = new Date();
                rec.warrantyCheck.creditElgiblityEndDate.setDate(rec.warrantyCheck.creditElgiblityEndDate.getDate() - +rec?.warrantyResult.CreditPeriodCount);
                rec.successText = tiMsgs.warrentyWTBD;// tiMsgs.warrentyInvalidVizIdErrorMsg;//tiMsgs.warrentyWTBD; //Commented - Nishant TWC4621-2309. Shd I use isPortal condition (portalErrMsg)
                rec.isSoftStop = true;
            }
            if (rec?.warrantyResult?.ProdUniqueId) {
                rec.ult = rec?.warrantyResult?.ProdUniqueId;
                rec.ultDisabled = true;
                rec.quantityDisabled = true;
                rec.returnQuantity = 1;
                rec.warrantyCheck.isUltCorrect = !!rec?.warrantyResult?.ProdUniqueId;
            }
            rec.isInWarrenty = rec.warrantyCheck.isUnderWarrenty || rec.warrantyCheck.isUnderCEPDays;
            rec.poHistoryData = {};
            rec.poHistoryData.SalesOrderLineNetPriceAmt = rec.UnitPrice;
            rec.errorText = rec.Error;
            //Bug Fix warrenty check next day
            if (editOnNextDay) {
                rec.isPoHistoryValid = false;
                rec.poValidated = false;
                rec.priceCheck = false;
                rec.warrentyValidated = (rec?.warrantyCheck?.warrentyCheckDate) && (!rec?.isULTSoftStop) ? true : false;
            }
            else {
                rec.warrentyValidated = true;
                if (rec.UnitPrice) {
                    rec.isPoHistoryValid = true;
                    rec.poValidated = true;
                }
                if (rec.YMS2Price) {
                    rec.priceCheck = true;
                    // rec.creditPrice = rec.UnitPrice;
                    //rec.creditPrice = rec.creditPrice
                }
            }
            //Samuel - Unexpected line & Edit case bug fix
            if (rec.warrentyValidated && !rec.isInWarrenty) {
                rec.productStatus = rec.isInWarrenty;
                rec.selected = rec.isInWarrenty;
                rec.Error = !rec.isInWarrenty;
                // item.warrantyCheck.isWarrentyCEPDaysValid = todaysDate <= item.warrantyCheck.creditElgiblityEndDate;
                // item.warrantyCheck.iSOutOfWarrenty = todaysDate >= item.warrantyCheck.creditElgiblityEndDate;
                rec.errorText = tiMsgs.warrentyCEPExpired;
            }
            //Samuel - END

            if ((that.isPortal == true || that.isPortal == "true") && editOnNextDay) {
                rec.warrentyValidated = false;
                rec.isPoHistoryValid = false;
                rec.poValidated = false;
                rec.priceCheck = false;
                rec.YMS2Price = "";
                rec.creditPrice = 0;
            }
        }
        if (that.caseType?.isQualityService() && (that?.requestdetails?.remedyText === that.genericMessages?.Credit_NPR || (that?.requestdetails?.remedyText === that.genericMessages?.Credit && that?.requestdetails?.salesIssueReturnReason === that.genericMessages?.FAC))) { //TWC4621-1588 Bux Fixing -- added ULT required condition
            rec.isUltRequired = true;
        }
    }
    return rec;
}

async function checkNPRMatrix(that) {
    let reqDetails = that.requestdetails;
    let Sales_Issue_Operation_Business_Unit_CodeList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.ICS_WR_Operation_Business_Unit_Code__c)
        )
    ].filter((i) => i);

    let Item_Product_CodeList = [
        ...new Set(
            that.poSearchData.filter((item) => item.selected).map((item) => item.MM)
        )
    ].filter((i) => i);

    let Item_Market_NameList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.Item_Market_Name__c)
        )
    ].filter((i) => i);

    let Profit_Centre_CodeList = [
        ...new Set(
            that.poSearchData
                .filter((item) => item.selected)
                .map((item) => item?.Data?.ICS_WR_Profit_Center_Code__c)
        )
    ].filter((i) => i);

    let requestData = {};

    if (that.genericMessages?.isIaoFlag !== 'true') {
        requestData = {
            Sales_Issue_Customer_CMF__c: reqDetails.sales_Area__c.Customer_CMF__c,
            Customer_Sales_Organization_Code__c: reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c,
            Customer_Distribution_Channel_Code__c: reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c,
            Sales_Issue_Customer_Return_Reason__c: reqDetails.Sales_Issue_Return_Reason__c,
            Sales_Issue_Operation_Business_Unit_Code__c: Sales_Issue_Operation_Business_Unit_CodeList,
            Sales_Issue_Item__c: Item_Product_CodeList,
            //Location_Country__c: reqDetails?.soldToAddressRec?.Customer_Country__c,
            Location_Country__c: reqDetails?.Sales_Issue_Cst_Collection_Address__r?.Customer_Country__c, //NPR Changes - Samuel - Add collection address to fetch NPR Matrix data
        };
    } else {
        requestData = {
            Sales_Issue_Customer_CMF__c: reqDetails.sales_Area__c.Customer_CMF__c,
            Customer_Sales_Organization_Code__c: reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c,
            Customer_Distribution_Channel_Code__c: reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c,
            Sales_Issue_Customer_Return_Reason__c: reqDetails.Sales_Issue_Return_Reason__c,
            Item_Market_Name__c: Item_Market_NameList,
            Sales_Issue_Profit_Center__c: Profit_Centre_CodeList,
            Sales_Issue_Item__c: Item_Product_CodeList,
            Location_Country__c: reqDetails?.Sales_Issue_Cst_Collection_Address__r?.Customer_Country__c, //NPR Changes - Samuel - Add collection address to fetch NPR Matrix data
        };
    }

    that.loading(true);
    //TWC4621-1884 -- adding support for NPR BR
    console.log('getNPRMatrix Req ', requestData);

    let nprMatrix = await getMatrixRecord({
        recordType: 'Sales_Issue_NPR_Rule_Matrix',
        requestData: JSON.stringify(requestData)
    });
    console.log('getNPRMatrix Res', nprMatrix);
    // nprMatrix = nprMatrix.filter(record =>
    //   //AND conditions
    //   (record?.Sales_Issue_Customer_CMF__c === requestData.Sales_Issue_Customer_CMF__c || record?.Sales_Issue_Customer_CMF__c === undefined) &&
    //   (record?.Sales_Issue_Customer_Sales_Organization__r?.Customer_Sales_Organization_Code__c === requestData.Customer_Sales_Organization_Code__c || record?.Sales_Issue_Customer_Sales_Organization__c === undefined) &&
    //   (record?.Customer_Disti_Channel__r?.Customer_Distribution_Channel_Code__c === requestData.Customer_Distribution_Channel_Code__c || record?.Customer_Disti_Channel__c === undefined) &&
    //   (requestData.Sales_Issue_Item__c.includes(record?.Sales_Issue_Item__r?.Name) || record?.Sales_Issue_Item__c === undefined) &&
    //   (requestData.Sales_Issue_Operation_Business_Unit_Code__c.includes(record?.Sales_Issue_Operation_Business_Unit_Code__c) || record?.Sales_Issue_Operation_Business_Unit_Code__c === undefined) &&
    //   (record?.Sales_Issue_Customer_Return_Reason__c === requestData.Sales_Issue_Customer_Return_Reason__c || record?.Sales_Issue_Customer_Return_Reason__c === undefined) &&
    //   (record?.Location_Country__c === requestData.Location_Country__c || record?.Location_Country__c === undefined)
    // )
    that.poSearchData.forEach((item) => {
        if (item.selected) {
            let block = false;
            let matchResult = nprMatrix.filter(matrix => {
                if (
                    ((that.genericMessages?.isIaoFlag !== 'true' &&
                        ((!item?.Data?.ICS_WR_Operation_Business_Unit_Code__c && !matrix.Sales_Issue_Operation_Business_Unit_Code__c) ||
                            (item?.Data?.ICS_WR_Operation_Business_Unit_Code__c == matrix?.Sales_Issue_Operation_Business_Unit_Code__c) ||
                            !matrix?.Sales_Issue_Operation_Business_Unit_Code__c)
                    ) || (that.genericMessages?.isIaoFlag == 'true' &&
                        ((!item?.Data?.Item_Market_Name__c && !matrix?.Item_Market_Name__c) || (!item?.Data?.Item_Market_Name__c && !matrix?.Item_Market_Name__c) ||
                            (item?.Data?.ICS_WR_Profit_Center_Code__c == matrix?.Sales_Issue_Profit_Center__c) || (!item?.Data?.ICS_WR_Profit_Center_Code__c && !matrix?.Sales_Issue_Profit_Center__c) ||
                            !matrix?.Item_Market_Name__c || !matrix?.Sales_Issue_Profit_Center__c))) &&
                    (
                        (!item?.MM && !matrix.Sales_Issue_Item__c) ||
                        (item?.MM == matrix?.Sales_Issue_Item__r?.Name) ||
                        !matrix?.Sales_Issue_Item__c
                    )
                ) {
                    return matrix;
                }
            });
            console.log('2087', JSON.stringify(matchResult))
            block = matchResult.length == 0;
            if (matchResult.length == 0) {
                let matchResultWithMmid = nprMatrix.filter(matrix => {
                    if (
                        (((that.genericMessages?.isIaoFlag !== 'true' && !matrix.Sales_Issue_Operation_Business_Unit_Code__c) || (!matrix.Item_Market_Name__c || !matrix?.Sales_Issue_Profit_Center__c)) &&
                            (
                                (!item?.MM && !matrix.Sales_Issue_Item__c) ||
                                (item?.MM == matrix?.Sales_Issue_Item__r?.Name) ||
                                !matrix?.Sales_Issue_Item__c
                            )
                        )
                    ) {
                        return matrix;
                    }
                });
                console.log('2087matchResultWithMmid', JSON.stringify(matchResultWithMmid))
                block = matchResultWithMmid.length == 0;
            }
            if (block) {
                item.Error = true;
                item.errorText = tiMsgs.nprCodNotElgible;
                item.productStatus = false;
                item.selected = false;
            }
        }
    });
    that.loading(false);
}
//Utill Methods
function invokeRefreshRowElement(that) {
    let childObj = that.template.querySelectorAll(
        "c-r4c_-a-g_-line-items-result-row"
    );
    if (childObj) {
        childObj.forEach((item) => {
            item.refreshPopupFields();
        });
    }
}
function invokeCustomValidationElement(that) {
    let childObj = that.template.querySelectorAll(
        "c-r4c_-a-g_-line-items-result-row"
    );
    if (childObj) {
        childObj.forEach((item) => {
            item.setCustomValidation();
        });
    }
}

function convertStringToDate(date) {
    if (!(date instanceof Date))
        date = new Date(
            date
        );
    return date
}

//BUG FIX- MM not saving on bulk upload
async function checkMMIds(that, requestDetails, poSearchData, caseType, genericMessages) {
    let productInputWrapper = {
        SalesOrganisation: requestDetails.Sales_Issue_Sales_Organization__c,
        DistributionChannel: requestDetails.Sales_Issue_Distribution_Channel__c,
        ReturnReason: requestDetails.Sales_Issue_Return_Reason__c,
        CMFNum: requestDetails.selectedsoldToCMF,
        SoldTo: requestDetails.Sales_Issue_SoldTo_Customer__c,
        serviceType: caseType.serviceType,
        returnReasonText: requestDetails.salesIssueReturnReason,
        ramedyTypeText: requestDetails.remedyText,
        productSearchText: 'MM Changed',
        productSearchValue: poSearchData.filter(i => i.checkMMBUObj).map(i => i.MM).join(',')

    }
    let mmIdsResult = await getLineItems({ prdctSearchVals: productInputWrapper, isPSGCase: requestDetails?.isPsgCase })
    poSearchData.forEach(item => {
        if (item.checkMMBUObj) { //Commented item.selected for Reject CPU-POH lines
            let newMMData = mmIdsResult?.lstPoSearchAgentDataWrapper?.find(i => i.MM == item.MM);
            if (newMMData) {
                item.Data = newMMData.Data;
                item.ProductCode = newMMData.ProductCode;
                item.productDescription = newMMData.productDescription;
                //item.orderPartNumber = newMMData.orderPartNumber; //bug fix - Mapping OPN value for lineitems
                if (item?.warrantyResult?.WarrantyTypeCode != '2') { // Syed - for ew items not line item check
                    if (!that.caseType.isTechnicalExchange()) {
                        if (caseType.serviceType === genericMessages.Service_Type_Technical_Intake &&
                            genericMessages.Item_Type_Technical_RR_Is_Warranty.includes(item.Data.Item_Type__c) &&
                            productInputWrapper.returnReasonText === genericMessages.Warranty_service_Software &&
                            (productInputWrapper.ramedyTypeText === genericMessages.Credit_NPR ||
                                productInputWrapper.ramedyTypeText === genericMessages.Credit)) {
                            item.Error = item.Error ? item.Error : false;
                        } else if (
                            caseType.serviceType ===
                            genericMessages.Service_Type_Technical_Intake &&
                            !genericMessages.Item_Type_Technical_RR_Is_Warranty.includes(
                                item.Data.Item_Type__c
                            ) &&
                            productInputWrapper.returnReasonText ===
                            genericMessages.Warranty_service_Software &&
                            (productInputWrapper.ramedyTypeText === genericMessages.Credit_NPR ||
                                productInputWrapper.ramedyTypeText === genericMessages.Credit)) {
                            if (!item.Error) {
                                item.selected = false;
                                item.Error = true;
                                item.productStatus = false;
                                item.errorText = r4c_CustomLabels.labels.MMs_Failed_Technical_ServiceSoftware;
                            }
                        } else if (item.Data && item.Data.Item_Type__c && genericMessages.Item_Type_Technical_RR_Not_Warranty.includes(item.Data.Item_Type__c) &&
                            ((caseType.serviceType === genericMessages.Service_Type_Technical_Intake && productInputWrapper.returnReasonText !== genericMessages.Warranty_service_Software &&
                                (productInputWrapper.ramedyTypeText === genericMessages.Credit_NPR || productInputWrapper.ramedyTypeText === genericMessages.Credit)) || caseType.serviceType === genericMessages.Quality)) {
                            item.Error = item.Error ? item.Error : false;
                        } else if (item.Data && item.Data.Item_Type__c && !genericMessages.Item_Type_Technical_RR_Not_Warranty.includes(item.Data.Item_Type__c) &&
                            ((caseType.serviceType === genericMessages.Service_Type_Technical_Intake && productInputWrapper.returnReasonText !== genericMessages.Warranty_service_Software &&
                                (productInputWrapper.ramedyTypeText === genericMessages.Credit_NPR || productInputWrapper.ramedyTypeText === genericMessages.Credit)) || caseType.serviceType === genericMessages.Quality)) {
                            if (!item.Error) {
                                item.selected = false;
                                item.Error = true;
                                item.productStatus = false;
                                item.errorText = r4c_CustomLabels.labels.MMs_Failed_Technical;
                            }

                        }
                    }
                }
                //Start -- PSG Changes
                const psgOPIDs = 'ZI,HF,HE,HJ,KP,PG';
                let isPsgCase = requestDetails?.isPsgCase;
                if (isPsgCase === true && !psgOPIDs.includes(item.Data.ICS_WR_Operation_Business_Unit_Code__c)) {
                    item.selected = false;
                    item.productStatus = false;
                    item.Error = true;
                    item.errorText = r4c_CustomLabels.labels.R4C_Intel_OPID_ErrMsg;
                } else if (isPsgCase === false && genericMessages?.PSG_MM_SUPPORT == 'true' && (psgOPIDs.includes(item.Data.ICS_WR_Operation_Business_Unit_Code__c) || (item.Data.ICS_WR_Operation_Business_Unit_Code__c == 'HD' && item.Data?.PSG_Equivalent_MM__c))) {
                    item.selected = false;
                    item.productStatus = false;
                    item.Error = true;
                    item.errorText = item.Data.ICS_WR_Operation_Business_Unit_Code__c == 'HD' ? r4c_CustomLabels.labels.R4C_PSG_HD_ErrMsg : r4c_CustomLabels.labels.R4C_PSG_OPID_ErrMsg;
                }
                if (isPsgCase && item.Data?.PSG_Equivalent_MM__r?.Name && item.Data.ICS_WR_Operation_Business_Unit_Code__c == 'ZI') {
                    item.oldMM = item.Data.PSG_Equivalent_MM__r.Name;
                } else if (isPsgCase) {
                    item.oldMM = '';
                }
                //End -- PSG Changes
            }
            else if (!that.caseType.isTechnicalExchange()) {
                item.selected = false;
                item.Error = true;
                item.productStatus = false;
                item.errorText = r4c_CustomLabels.labels.MM_not_present_Message;

            }
        }
    })
    return poSearchData;


}

async function handleEWLines(EWLineItems, mainLineItemsMap, poSearchData, casemode) {

    let ewItemsList = [];
    let todaysDate = new Date();
    let warrentyEndDate = "";
    const acceptedWarrentyProductTypes = ['ACT'];
    EWLineItems.forEach((item) => {
        let parentItem = mainLineItemsMap.get(item.ProdUniqueId);
        let ewLine = {}
        let extendedWarrantyEndDate = new Date(item.ExtendedWarrantyEndDate);
        if (parentItem.warrantyCheck.maxExtendedWarrantyEndDate) {
            extendedWarrantyEndDate = new Date(parentItem.warrantyCheck.maxExtendedWarrantyEndDate);
        }
        ewLine.warrantyCheck = {};
        ewLine.warrantyCheck.isUnderWarrenty = false;
        ewLine.warrantyCheck.isError = item.ErrorCode != 0
        ewLine.isInWarrenty = false;
        ewLine.Error = true;
        ewLine.errorText = tiMsgs.warrentyInvalid;
        ewLine.successText = 'success';
        ewLine.parentId = parentItem;
        ewLine.MM = item.WarrantyMaterialId;
        ewLine.InvoiceNumber = stringGen(6) + "-" + item.WarrantyMaterialId;
        ewLine.warrantyResult = item;
        ewLine.checkMMBUObj = true;
        ewLine.display = true;
        ewLine.selected = true;
        ewLine.Soldto = item.CaseSoldToPartyId;
        ewLine.isUltRequired = false;
        ewLine.ultDisabled = true;
        ewLine.quantityDisabled = false;
        ewLine.ult = item.ProdUniqueId;
        ewLine.creditPrice = null;
        ewLine.isUltDuplicate = false;
        ewLine.warrentyValidated = true;
        ewLine.productStatus = true;
        ewLine.warrantyCheck.warrentyCheckDate = todaysDate;
        //Syed EW - hirarchy fix
        ewLine.quantityDisabled = true;
        ewLine.boxCondition = parentItem.boxCondition;
        ewLine.boxConditionDisabled = parentItem.boxConditionDisabled;
        ewLine.returnQuantity = 1;
        ewLine.isExtended = true;
        if (!isNaN(extendedWarrantyEndDate) && todaysDate < extendedWarrantyEndDate) {
            ewLine.warrantyCheck.isUnderWarrenty = true;
            ewLine.warrantyCheck.creditElgiblityEndDate = parentItem.warrantyCheck.creditElgiblityEndDate;
            ewLine.warrantyCheck.isWarrentyCEPDaysValid = parentItem.warrantyCheck.isWarrentyCEPDaysValid;
            ewLine.warrantyCheck.isCEPDaysValidValue = parentItem.warrantyCheck.isCEPDaysValidValue;
        }
        ewLine.isInWarrenty = ewLine.warrantyCheck.isError == false && ewLine.warrantyCheck.isUnderWarrenty == true && mainLineItemsMap.get(item.ProdUniqueId).Error == false;
        if (ewLine.isInWarrenty) {
            warrentyEndDate = getDateString(extendedWarrantyEndDate);
            ewLine.successText = StringFormatter.format(tiMsgs.warrentyValid, warrentyEndDate);
        }
        ewLine.warrantyCheck.isUltCorrect = acceptedWarrentyProductTypes.includes(item?.ProdUniqueIdStatusCode?.trim());
        ewLine.Error = !ewLine.isInWarrenty;
        if (ewLine.Error) {
            if (!ewLine.warrantyCheck.isUnderWarrenty) {
                ewLine.errorText = tiMsgs.warrentySourceSystemInvlaidErrorMsg;
            }
            if (mainLineItemsMap.get(item.ProdUniqueId).Error) {
                ewLine.errorText = tiMsgs.ewParentFailedErrMsg;
            }
            ewLine.productStatus = false;
            ewLine.selected = false;
        }
        if (casemode == "Edit") {
            let extendedWarrentyItem = poSearchData.find(i => i?.warrantyResult?.ProdUniqueId == ewLine?.ult &&
                i.MM == ewLine.MM && i.warrantyResult.ServiceContractNumber == ewLine.warrantyResult.ServiceContractNumber);
            if (extendedWarrentyItem) {
                ewLine = addMissingKeys(ewLine, extendedWarrentyItem);
            }
        }
        ewItemsList = [...ewItemsList, ewLine];
    })
    return ewItemsList;
}
function addMissingKeys(obj1, obj2) {
    // Get the keys of each object
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    // Find missing keys in obj1
    const missingKeys = keys2.filter(key => !keys1.includes(key));
    // Add missing keys to obj1
    missingKeys.forEach(key => {
        obj1[key] = obj2[key];
    });
    return obj1;
}
function validatedEWItemsBasedonParent(poSearchData) {

    let ultErrorMap = poSearchData.filter(i => i?.warrantyResult?.WarrantyTypeCode == '1')
        .map(i => {
            let obj = {};
            obj[i.ult] = i;
            return obj
        })
        .reduce(function (storage, item) {
            let key = Object.keys(item)[0];
            var group = key;
            storage[group] = item[key];
            return storage;
        }, {})
    poSearchData.forEach(item => {
        if (item.isExtended) {
            if (ultErrorMap[item.ult]) {
                if (ultErrorMap[item.ult].Error) {
                    item.Error = true;
                    item.productStatus = false;
                    item.selected = false;
                    item.errorText = tiMsgs.ewParentFailedErrMsg;
                }
                //Syed - Copy cep days from parent
                if (ultErrorMap[item.ult].warrantyCheck) {
                    item.warrantyCheck.creditElgiblityEndDate = ultErrorMap[item.ult].warrantyCheck.creditElgiblityEndDate;
                    item.warrantyCheck.isWarrentyCEPDaysValid = ultErrorMap[item.ult].warrantyCheck.isWarrentyCEPDaysValid;
                }
            }
        }
    })

    return poSearchData;
}

function _procesPoSearchDates(reqWithWarrenty, reqWithWarrentyVizId, reqWithoutUlt) {
    let dates = {
        today: new Date(),
        minBaseStartDateWithWarrenty: "",
        maxCEPDateWithWarrenty: "",
        minBaseStartDateWithWarrentyVIZID: "",
        maxCEPDateWithWarrentyVIZID: "",
        maxCEPDateWithoutWarrenty: "",
        todayString() {
            let month = this.today.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;
            let date = this.today.getDate();
            date = date < 10 ? "0" + date : "" + date;
            return `${this.today.getFullYear()}-${month}-${date}`;
        },
        last36MonthString() {
            let oldDate = new Date();
            oldDate.setFullYear(oldDate.getFullYear() - 3);
            let month = oldDate.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;
            let date = oldDate.getDate();
            date = date < 10 ? "0" + date : "" + date;
            return `${oldDate.getFullYear()}-${month}-${date}`;
        },
        minBaseStartDateWithWarrentyDate() {

            if (!this.minBaseStartDateWithWarrenty) return "";
            this.minBaseStartDateWithWarrenty = convertStringToDate(this.minBaseStartDateWithWarrenty);
            let month = this.minBaseStartDateWithWarrenty.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;
            let date = this.minBaseStartDateWithWarrenty.getDate();
            date = date < 10 ? "0" + date : "" + date;
            return `${this.minBaseStartDateWithWarrenty.getFullYear()}-${month}-${date}`;
        },
        maxCEPDateWithWarrentyDate() {
            if (!this.maxCEPDateWithWarrenty) return "";
            this.maxCEPDateWithWarrenty = convertStringToDate(this.maxCEPDateWithWarrenty);
            let value = this.minBaseStartDateWithWarrenty;
            let baseWarrentyStartDate = convertStringToDate(value);
            baseWarrentyStartDate.setFullYear(baseWarrentyStartDate.getFullYear() + 3);
            if (this.maxCEPDateWithWarrenty > baseWarrentyStartDate) {
                let month = baseWarrentyStartDate.getMonth() + 1;
                month = month < 10 ? "0" + month : "" + month;
                let date = baseWarrentyStartDate.getDate();
                date = date < 10 ? "0" + date : "" + date;
                return `${baseWarrentyStartDate.getFullYear()}-${month}-${date}`;
            }
            let month = this.maxCEPDateWithWarrenty.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;
            let date = this.maxCEPDateWithWarrenty.getDate();
            date = date < 10 ? "0" + date : "" + date;
            return `${this.maxCEPDateWithWarrenty.getFullYear()}-${month}-${date}`;
        },
        minBaseStartDateWithWarrentyDateVIZID() {

            if (!this.minBaseStartDateWithWarrentyVIZID) return "";
            this.minBaseStartDateWithWarrentyVIZID = convertStringToDate(this.minBaseStartDateWithWarrentyVIZID);
            let month = this.minBaseStartDateWithWarrentyVIZID.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;
            let date = this.minBaseStartDateWithWarrentyVIZID.getDate();
            date = date < 10 ? "0" + date : "" + date;
            return `${this.minBaseStartDateWithWarrentyVIZID.getFullYear()}-${month}-${date}`;
        },
        maxCEPDateWithWarrentyDateVIZID() {
            if (!this.maxCEPDateWithWarrentyVIZID) return "";
            this.maxCEPDateWithWarrentyVIZID = convertStringToDate(this.maxCEPDateWithWarrentyVIZID);
            let value = this.minBaseStartDateWithWarrentyVIZID;
            let baseWarrentyStartDate = convertStringToDate(value);
            baseWarrentyStartDate.setFullYear(baseWarrentyStartDate.getFullYear() + 3);
            if (this.maxCEPDateWithWarrentyVIZID > baseWarrentyStartDate) {
                let month = baseWarrentyStartDate.getMonth() + 1;
                month = month < 10 ? "0" + month : "" + month;
                let date = baseWarrentyStartDate.getDate();
                date = date < 10 ? "0" + date : "" + date;
                return `${baseWarrentyStartDate.getFullYear()}-${month}-${date}`;
            }
            let month = this.maxCEPDateWithWarrentyVIZID.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;

            let date = this.maxCEPDateWithWarrentyVIZID.getDate();
            date = date < 10 ? "0" + date : "" + date;

            return `${this.maxCEPDateWithWarrentyVIZID.getFullYear()}-${month}-${date}`;
        },
        maxCEPDateWithoutWarrentyDate() {
            if (!this.maxCEPDateWithoutWarrenty) return "";
            this.maxCEPDateWithoutWarrenty = convertStringToDate(this.maxCEPDateWithoutWarrenty);
            let oldDate = new Date();
            oldDate.setFullYear(oldDate.getFullYear() - 3);
            if (this.maxCEPDateWithoutWarrenty < oldDate) {
                return this.last36MonthString();
            }
            let month = this.maxCEPDateWithoutWarrenty.getMonth() + 1;
            month = month < 10 ? "0" + month : "" + month;
            let date = this.maxCEPDateWithoutWarrenty.getDate();
            date = date < 10 ? "0" + date : "" + date;
            return `${this.maxCEPDateWithoutWarrenty.getFullYear()}-${month}-${date}`;
        }
    };
    //Setting Dates Start
    const minBaseStartDateWithWarrenty = reqWithWarrenty && reqWithWarrenty?.length > 0
        ? reqWithWarrenty.reduce((prev, current) => {
            let prevDate = convertStringToDate(prev.warrantyResult?.BaseWarrantyStartDate);
            let currentDate = convertStringToDate(current.warrantyResult?.BaseWarrantyStartDate);
            if (prevDate < currentDate) {
                return prev;
            }
            else if (isNaN(currentDate)) {
                return prev;
            }
            return current;
        })
        : "";
    const maxCEPDateWithWarrenty =
        reqWithWarrenty && reqWithWarrenty?.length > 0
            ? reqWithWarrenty.reduce((prev, current) => {
                let prevDate = convertStringToDate(prev.warrantyCheck?.creditElgiblityEndDate);
                let currentDate = convertStringToDate(current.warrantyCheck?.creditElgiblityEndDate);
                if (prevDate > currentDate) {
                    return prev;
                }
                else if (isNaN(currentDate)) {
                    return prev;
                }
                return current;
            })
            : "";
    //SYED - TWC4621-2141- checking ig ult type is VISID and part of same bag  
    const minBaseStartDateWithWarrentyVIZID = reqWithWarrentyVizId && reqWithWarrentyVizId?.length > 0
        ? reqWithWarrentyVizId.reduce((prev, current) => {
            let prevDate = convertStringToDate(prev.warrantyResult?.BaseWarrantyStartDate);
            let currentDate = convertStringToDate(current.warrantyResult?.BaseWarrantyStartDate);
            if (prevDate < currentDate) {
                return prev;
            }
            else if (isNaN(currentDate)) {
                return prev;
            }
            return current;
        })
        : "";

    const maxCEPDateWithWarrentyVIZID =
        reqWithWarrentyVizId && reqWithWarrentyVizId?.length > 0
            ? reqWithWarrentyVizId.reduce((prev, current) => {
                let prevDate = convertStringToDate(prev.warrantyCheck?.creditElgiblityEndDate);
                let currentDate = convertStringToDate(current.warrantyCheck?.creditElgiblityEndDate);
                if (prevDate > currentDate) {
                    return prev;
                }
                else if (isNaN(currentDate)) {
                    return prev;
                }
                return current;
            })
            : "";

    const maxCEPDateWithoutWarrenty =
        reqWithoutUlt && reqWithoutUlt?.length > 0
            ? reqWithoutUlt.reduce((prev, current) => {
                let prevDate = convertStringToDate(prev.warrantyCheck?.creditElgiblityEndDate);
                let currentDate = convertStringToDate(current.warrantyCheck?.creditElgiblityEndDate);
                if (prevDate > currentDate) {
                    return prev;
                }
                else if (isNaN(currentDate)) {
                    return prev;
                }
                return current;
            })
            : "";
    dates.minBaseStartDateWithWarrenty = minBaseStartDateWithWarrenty?.warrantyResult?.BaseWarrantyStartDate;
    dates.maxCEPDateWithWarrenty = maxCEPDateWithWarrenty?.warrantyCheck?.creditElgiblityEndDate;
    dates.minBaseStartDateWithWarrentyVIZID = minBaseStartDateWithWarrentyVIZID?.warrantyResult?.BaseWarrantyStartDate;
    dates.maxCEPDateWithWarrentyVIZID = maxCEPDateWithWarrentyVIZID?.warrantyCheck?.creditElgiblityEndDate;
    dates.maxCEPDateWithoutWarrenty = maxCEPDateWithoutWarrenty?.warrantyCheck?.creditElgiblityEndDate;
    return dates;
}
function _processULTLine(that, item, itemWarrentyWithUniqueId, reqDetails) {
    let ComponentTypeCodeValue = 'S';
    let mmChangeVar
    item.warrantyResult = itemWarrentyWithUniqueId;
    //Common Hard stop based on Error code, Component type code
    item.warrantyCheck.isError = itemWarrentyWithUniqueId.ErrorCode !== 0 || itemWarrentyWithUniqueId?.ComponentTypeCode == ComponentTypeCodeValue;
    //MMID will change if for givien ult another mm is returned
    if (itemWarrentyWithUniqueId?.ComponentTypeCode != ComponentTypeCodeValue && item.MM && itemWarrentyWithUniqueId?.MaterialId != item.MM) {
        item.warrantyCheck.newMMId = itemWarrentyWithUniqueId?.MaterialId;
        item.warrantyCheck.oldMMId = item.MM;
        mmChangeVar = {
            oldMMId: item.warrantyCheck.oldMMId,
            newMMId: item.warrantyCheck.newMMId
        };
        item.warrantyCheck.isMMChange = true;
        item.checkMMBUObj = true;
        if (reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT) { //manohar
            item.mrbValidated = false;
            item.CustomerPONumber = '';
            item.priceCheck = false;
        }
    }
    else if (itemWarrentyWithUniqueId?.ComponentTypeCode != ComponentTypeCodeValue && !item.MM) {
        item.warrantyCheck.isMMChange = true;
    }
    //populate MM and OPID data if not present before
    if (itemWarrentyWithUniqueId?.ComponentTypeCode != ComponentTypeCodeValue && !item.MM) {
        item.MM = itemWarrentyWithUniqueId?.MaterialId;
        item.checkMMBUObj = true;
        item.warrantyCheck.isMMChange = false;
    }
    if (!item?.Data?.ICS_WR_Operation_Business_Unit_Code__c) {
        if (!item.Data) item.Data = {};
        item.Data.ICS_WR_Operation_Business_Unit_Code__c =
            itemWarrentyWithUniqueId.OperationBusinessUnitCode;
    }
    if (that.genericMessages.isIaoFlag == 'true') {
        if (!item?.Data?.ICS_WR_Profit_Center_Code__c) {
            if (!item.Data) item.Data = {};
            item.Data.ICS_WR_Profit_Center_Code__c = itemWarrentyWithUniqueId.ProfitCenterCode;
        }
        if (!item?.Data?.Item_Market_Name__c) {
            if (!item.Data) item.Data = {};
            item.Data.Item_Market_Name__c = itemWarrentyWithUniqueId.ItemMarketName;
        }
    }
    //populate ult if not present before
    if (itemWarrentyWithUniqueId.ProdUniqueId && !item.ult) {
        item.ult = itemWarrentyWithUniqueId.ProdUniqueId;
        item.quantityDisabled = true;
        item.returnQuantity = 1;
    }

    //For Exhange check only  errorcode
    if (that.caseType.isTechnicalExchange()) {
        item.warrantyCheck.isExchangeValid = !item.warrantyCheck.isError;
        item.successText = (item.warrantyCheck.isExchangeValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT;
        item.errorText = (item.warrantyCheck.isExchangeValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT;
        if (item.warrantyResult && item.warrantyResult?.status) {
            item.warrantyResult.status = (item.warrantyCheck.isExchangeValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT;
        }
    }

    if (itemWarrentyWithUniqueId?.ProdUniqueIdTypeCode == 'VISID') { //itemWarrentyWithUniqueId?.SourceSystemName?.trim() === 'CATTS' (Better to check with ultTypeCode instead of source system?)
        const { bagList } = reqDetails;
        let cmfList = JSON.parse(bagList);
        let cmfIds = cmfList.map(i => {
            //let bagAndCmf = i.split('-');
            let bagAndCmf = !that?.isUcdoff ? i.split('_') : i.split('-');
            return bagAndCmf[1]?.padStart(10, "0");
        })
        if (cmfIds.indexOf(itemWarrentyWithUniqueId?.EnttlSoldToPartyId?.padStart(10, "0")) == -1) {
            item.errorText = tiMsgs.VIZTypeULTNotValid;
        }

    }
    return { item, mmChangeVar };
}
//Warrenty Check Helper Methods
function getErrorMessages(that, item, itemWarrentyWithUniqueId, itemWarrentyDetails, reqDetails, warrentyEndDate) {
    const ComponentTypeCodeValue = 'S';
    const notAcceptedVizIdStatuses = that.genericMessages?.invalid_warrenty_viz_types?.split(',') || ['CAN', 'MCN', 'ECN'];
    const notAcceptingVizStatusCode = that.genericMessages?.invalid_warrenty_viz_code?.split(',') || ['PC', 'CME', 'INV', 'PIN', 'SIN'];
    let agentErrMsgsLst = [];
    let portalErrMsgsLst = [];
    /** item.errorText already has tiMsgs.warrentyInvalid present */

    // Error Messages if EH response with ULT present
    if (itemWarrentyWithUniqueId) {
        //Common Validations for all ULTs
        if (itemWarrentyWithUniqueId?.ComponentTypeCode == ComponentTypeCodeValue) {
            agentErrMsgsLst.push(tiMsgs.componentTypeCodeErrMsg);
            portalErrMsgsLst.push(tiMsgs.componentTypeCodeErrMsg);
        }
        //VisID Validations
        if (itemWarrentyWithUniqueId.ProdUniqueIdTypeCode == 'VISID') { //All are Soft Stops
            if (item?.VisIdbagError == true) { //Setting new param to check for visId Bag error
                agentErrMsgsLst.push(tiMsgs.VIZTypeULTNotValid);
                portalErrMsgsLst.push(tiMsgs.VIZTypeULTNotValid);
            }
            if (itemWarrentyWithUniqueId.VizIdStatusCode == 'SIN') { //Visual Id status shd store SIN
                agentErrMsgsLst.push(tiMsgs.ErrMsgAgSIN);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
            if (itemWarrentyWithUniqueId.VizIdStatusCode == 'PIN') { //Visual Id status shd store PIN
                agentErrMsgsLst.push(tiMsgs.ErrMsgAgPIN);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
            if (itemWarrentyWithUniqueId.VizIdStatusCode == 'CME') { //Mostly not valid scenario, added code just in case
                agentErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
            if (itemWarrentyWithUniqueId.VizIdStatusCode == 'PC') { //Bug fix
                agentErrMsgsLst.push(tiMsgs.ErrMsgAgPC);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
        }
        //Serial Number Validations
        if (itemWarrentyWithUniqueId.ProdUniqueIdTypeCode == 'SN') { //All are Hard Stops for agent/cust
            if (itemWarrentyWithUniqueId.ProdUniqueIdStatusCode == 'IRC') { // Shd check warranty type code =0 (as said in document) but confirmed from EH team, we won't get code = 0 if ULT found in system
                agentErrMsgsLst.push(tiMsgs.warrentyStatusCodeIRCErrorMsg);
                if (that.caseType.isTechnicalExchange()) {
                    portalErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                }
                else {
                    portalErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                }
            }
            else if (notAcceptedVizIdStatuses.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.toUpperCase())) { //Error Msg if status = CAN or ECN or MCN
                if (that.caseType.isTechnicalExchange()) {
                    agentErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                    portalErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                }
                else {
                    agentErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                    portalErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                }
            }
        }
        //SOFT
        if (notAcceptingVizStatusCode.includes(itemWarrentyWithUniqueId?.VizIdStatusCode?.toUpperCase())) {
            item.successText = (that?.isPortal == true || that?.isPortal == "true") ? tiMsgs.warrentyInvalidVizIdErrorMsg : agentErrMsgsLst.join(';');
        }
        //For Intake specific scenarios having ULT response
        if (that.caseType.isTechnicalExchange()) {
            item.successText = (item.warrantyCheck.isExchangeValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT;
            item.errorText = (item.warrantyCheck.isExchangeValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT; // same message for portal and agent
        }
        if (that.caseType.isQualityService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT) { //manohar
            item.errorText = (item.warrantyCheck.isMRBQANValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT;
            item.successText = (item.warrantyCheck.isMRBQANValid) ? tiMsgs.exchangeValidULT : tiMsgs.exchangeINValidULT; // same message for portal and agent
        }
        if (that.caseType?.isExceptionRepair() || (that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
            item.successText = (item.warrantyCheck.isGRLExceptionValid) ? 'Success' : that.genericMessages?.GRL_Exception_Invalid_Serial_Num_Msg;
            item.errorText = (item.warrantyCheck.isGRLExceptionValid) ? 'Success' : that.genericMessages?.GRL_Exception_Invalid_Serial_Num_Msg;
        }
    }
    //Error Messages if EH response without ULT (Only using MM)
    else if (that.caseType.isTechnicalService() && itemWarrentyDetails && !item.ult) {
        //Common Validations - none
        //VisID Validations
        if (itemWarrentyDetails.ProdUniqueIdTypeCode == 'VISID') { //All are Soft Stops
            if (item?.VisIdbagError == true) { //Setting new param to check for visId Bag error
                agentErrMsgsLst.push(tiMsgs.VIZTypeULTNotValid);
                portalErrMsgsLst.push(tiMsgs.VIZTypeULTNotValid);
            }
            if (itemWarrentyDetails.VizIdStatusCode == 'SIN') { //Visual Id status shd store SIN
                agentErrMsgsLst.push(tiMsgs.ErrMsgAgSIN);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
            if (itemWarrentyDetails.VizIdStatusCode == 'PIN') { //Visual Id status shd store PIN
                agentErrMsgsLst.push(tiMsgs.ErrMsgAgPIN);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
            if (itemWarrentyDetails.VizIdStatusCode == 'CME') { //Mostly not valid scenario, added code just in case
                agentErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
            if (itemWarrentyDetails.VizIdStatusCode == 'PC') { //Mostly not valid scenario, added code just in case
                agentErrMsgsLst.push(tiMsgs.ErrMsgAgPC);
                portalErrMsgsLst.push(tiMsgs.warrentyInvalidVizIdErrorMsg);
            }
        }
        //Serial Number Validations
        if (itemWarrentyDetails.ProdUniqueIdTypeCode == 'SN') { //All are Hard Stops for agent/cust
            if (itemWarrentyDetails.ProdUniqueIdStatusCode == 'IRC') { // Shd check warranty type code =0 (as said in document) but confirmed from EH team, we won't get code = 0 if ULT found in system
                agentErrMsgsLst.push(tiMsgs.warrentyStatusCodeIRCErrorMsg);
                if (that.caseType.isTechnicalExchange()) {
                    portalErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                }
                else {
                    portalErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                }
            }
            else if (notAcceptedVizIdStatuses.includes(itemWarrentyWithUniqueId?.ProdUniqueIdStatusCode?.toUpperCase())) {//Error Msg if status = CAN or ECN or MCN
                if (that.caseType.isTechnicalExchange()) {
                    agentErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                    portalErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                }
                else {
                    agentErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                    portalErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                }
            }
        }
        //SOFT
        if (itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'PC' || itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'CME' || itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'INV' || itemWarrentyDetails?.VizIdStatusCode?.toUpperCase() == 'PIN' || itemWarrentyDetails?.VizIdStatusCode == 'SIN') {
            item.successText = (that?.isPortal == true || that?.isPortal == "true") ? tiMsgs.warrentyInvalidVizIdErrorMsg : agentErrMsgsLst.join(';');
        }
    }
    // For intake specific scenarios without EH response
    else if (that.caseType.isExceptionService() && !item.ult) {
        item.successText = 'Success';
    }
    else if (reqDetails?.salesIssueReturnReason === that.genericMessages?.FAC && item.ult && !itemWarrentyWithUniqueId) { //manohar -- when ULT is not found in EH , it is a soft stop for Quality FAC case
        item.successText = tiMsgs.ULTnotFound;
    }

    if (item.isInWarrenty) {
        if (item.successText && item.successText != 'success') {
            //if success text is set dont override
        }
        else if (item.warrantyCheck.isUnderCEPDays) { // under warranty end date + CEP days //Soft Stop
            item.successText = tiMsgs.warrentyWTBD; // Need to update - Unable to determine warranty. Please ship the unit to the depot and warranty and entitlement will be determined upon receipt.
        }
        else if (!item.warrantyCheck.creditElgiblityEndDate && item.isInWarrenty && itemWarrentyWithUniqueId) {
            item.successText = tiMsgs.warrentyInwarrentyCEPExpired; //Soft Stop //ULT is given and CEP date is empty
        }
        else if (item.isInWarrenty) {
            item.successText = StringFormatter.format(tiMsgs.warrentyValid, warrentyEndDate);
        }
    }
    else if (!itemWarrentyWithUniqueId && !itemWarrentyDetails) {
        agentErrMsgsLst.push(tiMsgs.warrentyNoResponse);
        portalErrMsgsLst.push(tiMsgs.warrentyNoResponse);
    }
    else if (item.Error) {
        if (agentErrMsgsLst.size > 0 && portalErrMsgsLst.size > 0) {//(item.errorText && item.errorText != tiMsgs.warrentyInvalid) {
            //if error text is set dont overrride
        }

        //SaiRam To handle EH API Error codes- TWC4621-5155 Start 
        else if (itemWarrentyWithUniqueId?.ErrorCode == 1) {
            agentErrMsgsLst.push(tiMsgs.WarrantyServiceDown); //One of Our API is down 
            portalErrMsgsLst.push(tiMsgs.WarrantyServiceDown);
        }
        else if (itemWarrentyWithUniqueId?.ErrorCode == 16) {
            agentErrMsgsLst.push(tiMsgs.ULTnotFound); // ULT Not found error.
            portalErrMsgsLst.push(tiMsgs.ULTnotFound);
        }
        //SaiRam To handle EH API Error codes- TWC4621-5155 End 

        else if (!item.warrantyCheck.isUnderWarrenty && itemWarrentyWithUniqueId) {

            if (that.caseType.isTechnicalExchange()) {
                agentErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
                portalErrMsgsLst.push(tiMsgs.warrentyOutWarrentyExchange);
            }
            else {
                agentErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
                portalErrMsgsLst.push(tiMsgs.warrentySourceSystemInvlaidErrorMsg);
            }

        }
        else if (!item.warrantyCheck.isUltValid && itemWarrentyWithUniqueId) {
            agentErrMsgsLst.push(tiMsgs.warrentyULTInvalid);
            portalErrMsgsLst.push(tiMsgs.warrentyULTInvalid);
        }
        else if (!item.warrantyCheck.isCEPDaysValidValue) {
            agentErrMsgsLst.push(tiMsgs.warrentyCEPExpired); // CEP date expired
            portalErrMsgsLst.push(tiMsgs.warrentyCEPExpired);
        }
    }

    item.errorText = ((that?.isPortal == true || that?.isPortal == "true") && agentErrMsgsLst.length > 0 && portalErrMsgsLst.length > 0) ? [...new Set(portalErrMsgsLst)].join(';') : [...new Set(agentErrMsgsLst)].join(';');

    return item;
}
function processWarrantyResponse(response, ultRequestList, withoutUltRequestList) {
    if (typeof response === "string" || response instanceof String)
        response = JSON.parse(response);
    //Syed - start - Optimization of code to support more then 1500 requests - based on number of request getting response from index
    let ultResponse = [];
    let wihtoutUltResponse = [];
    let count = 0;
    if (ultRequestList.length != 0) {
        for (let i = 0; i < ultRequestList.length; i++) {
            if (response[i]?.isError == true) {
                throw new Error("Warranty API Failure");
            }
            let ultRes = response[i]?.apiResult;
            if (typeof ultRes === "string" || ultRes instanceof String) {
                ultRes = JSON.parse(ultRes);
            }
            count++;
            ultResponse.push(...ultRes);
        }
    }
    if (withoutUltRequestList.length != 0) {
        for (let i = 0; i < withoutUltRequestList.length; i++) {
            if (response[count + i]?.isError == true) {
                throw new Error("Warranty API Failure");
            }
            let withoutUltRes = response[count + i]?.apiResult;
            if (typeof withoutUltRes === "string" || withoutUltRes instanceof String) {
                withoutUltRes = JSON.parse(withoutUltRes);
            }

            wihtoutUltResponse.push(...withoutUltRes);
        }
    }
    return {
        ultResponse,
        wihtoutUltResponse
    }
}

// function getMMDateString(dateVar) {
//   let today = convertStringToDate(dateVar);
//         let month = today.getMonth() + 1;
//         month = month < 10 ? "0" + month : "" + month;
//         let date = today.getDate();
//         date = date < 10 ? "0" + date : "" + date;
//         return `${today.getFullYear()}${month}${date}`;
//       }

// TWC4621-3489 -- Manohar -- Method to format and concatenate two dates as YYYYMMDDYYYYMMDD for POhistory API
function _processPoHistoryDates(dateInput1, dateInput2) {
    const startDate = _processDate(dateInput1);
    const endDate = _processDate(dateInput2);
    return `${startDate}${endDate}`;
}
function _processDate(dateInput) {
    const today = convertStringToDate(dateInput);
    let month = today.getMonth() + 1;
    month = month < 10 ? "0" + month : "" + month;
    let date = today.getDate();
    date = date < 10 ? "0" + date : "" + date;
    return `${today.getFullYear()}${month}${date}`;
}
function _BypassPOHistoryValidation(that) { //TWC4621-4234
    that.poSearchData = that.poSearchData.map((item) => {
        if (item?.CustomerPONumber && item?.BillingDate && !item?.warrantyCheck?.isMMChange
            && item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') { // TWC4621-6310: don't bypass VisId, let it go through real POH
            if ((item.selected && !item.poValidated) || (item?.VisIdbagError == true)) {
                item.isPoHistoryValid = false;
                if (item.warrantyCheck.isUnderWarrenty) {
                    if (new Date(item?.warrantyResult?.BaseWarrantyStartDate) <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= item?.warrantyCheck?.creditElgiblityEndDate) {
                        item.isPoHistoryValid = true;
                    } else {
                        item.Error = true;
                        item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
                    }
                }
                else if (item.warrantyCheck.isUnderCEPDays) {
                    if (item?.warrantyCheck?.creditElgiblityEndDate <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= new Date()) {
                        item.isPoHistoryValid = true;
                    } else {
                        item.Error = true;
                        item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
                    }
                }
                item.productStatus = item.isPoHistoryValid;
                item.selected = item.isPoHistoryValid;
                item.poValidated = true;
            }
        }
        return item;
    })
}
// function _BypassPOHistoryValidation(that) { //TWC4621-4234
//   that.poSearchData = that.poSearchData.map((item) => {
//     if (item?.CustomerPONumber && item?.BillingDate && !item?.warrantyCheck?.isMMChange) {
//       if ((item.selected && !item.poValidated) || (item?.VisIdbagError == true)) {
//         item.isPoHistoryValid = false;
//         if (item.warrantyCheck.isUnderWarrenty) {
//           if (item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') {
//             if (new Date(item?.warrantyResult?.BaseWarrantyStartDate) <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= item?.warrantyCheck?.creditElgiblityEndDate) {
//               item.isPoHistoryValid = true;
//             } else {
//               item.Error = true;
//               item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
//             }
//           } else if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
//             if (new Date(item?.warrantyResult?.BaseWarrantyStartDate) <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= item?.warrantyCheck?.creditElgiblityEndDate && item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0") == item?.deliveryNote?.padStart(10, "0")) {
//               item.isPoHistoryValid = true;
//             } else {
//               item.Error = true;
//               item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
//             }
//           }
//         }
//         else if (item.warrantyCheck.isUnderCEPDays) {
//           if (item?.warrantyCheck?.creditElgiblityEndDate <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= new Date()) {
//             item.isPoHistoryValid = true;
//           } else {
//             item.Error = true;
//             item.errorText = tiMsgs.poDataNotFoundMsg; //Samuel tiMsgs.cepExpiredMsg;
//           }
//         }
//         item.productStatus = item.isPoHistoryValid;
//         item.selected = item.isPoHistoryValid;
//         item.poValidated = true;
//         if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && item.Error) {
//           item.VisIdbagError = true;
//           item.selected = false;
//           item.lineitemStatus = that.genericMessages?.CPU_POH_Rejection;
//         }
//       }

//     }
//     return item;
//   })
// }
//TWC4621-5161 -- PO History dates
function processDatesforPOHistory(reqWithWarrenty, reqWithWarrentyVizId, isPsgCase) {
    const reqForInWarrentymmList = new Set();
    const reqForInWarrentyVIZIDmmList = new Set();
    // Helper function to process items (common logic for both reqWithWarrenty and reqWithWarrentyVizId)
    function processItems(items, isVizId) {
        items.forEach(item => {
            const warrantyTypeCode = item?.warrantyResult?.WarrantyTypeCode;
            const warrantyStartDate = item?.warrantyResult?.BaseWarrantyStartDate;
            const creditEligibilityEndDate = item?.warrantyCheck?.creditElgiblityEndDate;
            const extendedStartDate = item?.parentId?.warrantyResult?.BaseWarrantyStartDate;
            const extendedEndDate = item?.parentId?.warrantyResult?.BaseWarrantyEndDate;
            const serviceContractNumber = item?.warrantyResult?.ServiceContractNumber;
            const oldMM = item?.oldMM;
            const mm = item?.MM;

            // Format the date range based on whether it's for 'VizId' or not
            const formattedWarrantyDate = isVizId
                ? `${_processDate(warrantyStartDate)}_${_processDate(creditEligibilityEndDate)}`
                : `${_processPoHistoryDates(warrantyStartDate, creditEligibilityEndDate)}`;
            const formattedExtendedWarrantyDate = `${_processPoHistoryDates(extendedStartDate, extendedEndDate)}`;

            let result = '';
            if (warrantyTypeCode !== '2') {
                if (isVizId) {
                    result = `${mm}_${formattedWarrantyDate}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}`;
                } else {
                    result = `${mm}_${formattedWarrantyDate}_********`;
                }
            } else {
                result = `${mm}_${formattedExtendedWarrantyDate}_${serviceContractNumber}`;
            }
            // Add the result to the corresponding set based on the WarrantyTypeCode
            if (result) {
                if (warrantyTypeCode !== '2' && isVizId) {
                    reqForInWarrentyVIZIDmmList.add(result);
                } else {
                    reqForInWarrentymmList.add(result);
                }
            }
            // If it's a PSG case, handle the oldMM entries
            if (isPsgCase && oldMM) {
                let oldMMResult = '';
                if (warrantyTypeCode !== '2') {
                    if (isVizId) {
                        oldMMResult = `${oldMM}_${formattedWarrantyDate}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}`;
                    } else {
                        oldMMResult = `${oldMM}_${formattedWarrantyDate}_********`;
                    }
                } else {
                    oldMMResult = `${oldMM}_${formattedExtendedWarrantyDate}_${serviceContractNumber}`;
                }
                // Add the result to the corresponding set based on the WarrantyTypeCode
                if (oldMMResult) {
                    if (warrantyTypeCode !== '2' && isVizId) {
                        reqForInWarrentyVIZIDmmList.add(oldMMResult);
                    } else {
                        reqForInWarrentymmList.add(oldMMResult);
                    }
                }
            }
        });
    };
    // Process reqWithWarrenty and reqWithWarrentyVizId
    processItems(reqWithWarrenty, false);  // isVizId = false for reqWithWarrenty
    processItems(reqWithWarrentyVizId, true);  // isVizId = true for reqWithWarrentyVizId

    return { reqForInWarrentymmList, reqForInWarrentyVIZIDmmList }; // Return both sets
};
export {
    processWarrantyResponse,
    productValidateNextHandlerTechnical,
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
    processNewLineItemData,
    checkNPRMatrix,
    invokeRefreshRowElement,
    invokeCustomValidationElement,
    validatedEWItemsBasedonParent
};