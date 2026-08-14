/******************************************************** 	
//* @Component Name: r4c_AG_ExceptionIntakeHelper 	
//* @Author :  	Tushar garg
//* @Date Created :  22-May-2023	
//* @Description : This is Helper component for Exception Intake . 	
//* @LastModifiedDate : 13-Sept-2024 	
//* @LastModifiedBy : Syed Ahmed. 	
//* @ParentComponent : r4c_AG_LineItemsResultTable
//* @ChildComponent : r4c_CustomLabels, r4c_AG_pochangepopup, r4c_AG_LineItemsResultTableUtill
/******************************************************************/
// Importing custom labels
import ModalForPOChange from "c/r4c_AG_pochangepopup";
import r4c_CustomLabels from "c/r4c_CustomLabels";
import getMatrixRecord from "@salesforce/apex/R4C_BusinessRule_Service.getRule";
import { poHistoryCheck } from "c/r4c_AG_LineItemsResultTableUtill";
import TIME_ZONE from '@salesforce/i18n/timeZone';
import { _BypassPOHistoryValidation } from "c/r4c_AG_QualityIntakeHelper";
import { checkNPRMatrix } from "c/r4c_AG_TechinalIntakeHelper";
// This price show the selected credit price  --- User Story Number TWC4621-52--- Tushar Garg
import { StringFormatter } from 'c/r4c_stringFormatter';

let expMsgs = {
    priceNotFoundMsg: r4c_CustomLabels.labels.TI_Price_Not_found,
    pricePortalHeaderErrorMsg:
        r4c_CustomLabels.labels.TI_Portal_Price_Not_Found_Header,
    pricePortalDescriptionErrorMsg:
        r4c_CustomLabels.labels.TI_Portal_Price_Not_Found_Description,
}

// This method run on credit price next button --- User Story Number TWC4621-52--- Tushar Garg - Start
let creditPriceExpNextBtnHandler = (that) => {
    that.validateCreditPrice = false;
    let todaysDate = dateCalculation();
    let selectedpoSearchNewDataCount = that.poSearchData.reduce((count, item) => count + (item.selected === true ? 1 : 0), 0);
    let oldData = that.poSearchOldData.some((item) => {
        return item.selected === true;
    });
    let existingData = oldData && that.showReturnToProductValidateBtn ? true : false;
    if (that.template.querySelector(".table-style-cls")) {
        //TWC4621-1020 -- sandeep -- feb24th 2023 -- added if condition to check whether any element contains .table-style-cls css class
        that.template.querySelector(".table-style-cls").scrollTop = 0;
    }
    if (!that.isECCLineItemEdit && ((that.requestdetails.remedyText == that.genericMessages?.Credit && that.requestdetails.salesIssueReturnReason == that.genericMessages?.Exception_Return) || that.caseType.isAdminService())) { //Unexpected lines bug fix - Samuel
        if (selectedpoSearchNewDataCount > 1 && oldData == false) {
            that.showToast(
                that.labels.Error_Title,
                that.labels.Select_one_line_item,
                "error"
            );
            return;
        }
        else if (existingData && !that.existingLineItemCheckExpVal) {
            that.showToast(
                that.genericMessages.Error_Title,
                that.genericMessages.Existing_Line_Item,
                "error"
            );
            return;
        }
    }
    if (selectedpoSearchNewDataCount == 0 && !existingData && ((that.requestdetails.remedyText == that.genericMessages?.Credit && that.requestdetails.salesIssueReturnReason != that.genericMessages?.Exception_Return) || that?.caseType?.isAdminService() || that.caseType.isMiscellaneousService())) { //Manohar -- TWC4621-2011
        that.showToast(
            that.labels.Error_Title,
            that.labels.no_record_is_selected_message,
            "error"
        );
        return;
    }
    if (that.selectedInvoiceNum.length > 0 || oldData) {
        //During edit if user checks validation again  
        if (that.firstTimeValidate) {
            that.poSearchOldData = that.poSearchOldData.filter(
                (item) => item.selected === true
            );
            that.firstTimeValidate = false;
            that.showCreditPriceBTNDisable = true;
        }
        let oldLOERecords = that.poSearchWithLOEData && that.poSearchWithLOEData.length;
        if (!that.existingLineItemCheckExpVal || that.existingLineItemCheckExpVal == undefined
            && ((that.requestdetails.remedyText == that.genericMessages?.Credit && that.requestdetails.salesIssueReturnReason != that.genericMessages?.Exception_Return) || that.caseType.isAdminService() || that.caseType.isMiscellaneousService())) { //Manohar -- TWC4621-2011
            that.poSearchData.map((item) => {
                if (
                    // commented as per new design invoice number is never same
                    !that.poSearchOldData.some((d) => {
                        return (d && d.InvoiceNumber && d.InvoiceNumber === item.InvoiceNumber);
                    }) && item.selected
                ) {
                    that.poSearchOldData.push(item);
                    that.existingDataException.push(item);
                }
                return item;
            });
        }
        let isNewRecordForValidate = false;
        let newlyUpdatedData = that.poSearchOldData;

        let tempVar = [];
        //NOTE:check if this logic is working or not if not then delete realted logic 
        newlyUpdatedData.map((data) => {
            //this is newly added by tushar__ to not select any non selected po history record from product
            if (data.selected) {
                if (
                    !that.poSearchWithLOEData.some((d) => {
                        return (
                            d &&
                            d.InvoiceNumber &&
                            data &&
                            data.InvoiceNumber &&
                            d.InvoiceNumber === data.InvoiceNumber
                        );
                    })
                ) {
                    tempVar.push(data);
                    //if new record found then isNewRecordForValidate will be true so that we can validate again
                    isNewRecordForValidate = true;
                } else {
                    that.poSearchWithLOEData.map((item) => {
                        if (item.InvoiceNumber === data.InvoiceNumber) {
                            tempVar.push(item);
                        }
                        return item;
                    });
                }
            }
            return data;
        });

        let isSelectedAll = false;
        that.showReturnToProductValidateBtn = true;
        tempVar.map((item) => {

            if (!item.selected) {
                isSelectedAll = true;
            }
            return item;
        });
        if (!isSelectedAll) {
            //now check select all checkbox
            that.allselectedcheckbox = true;
        }
        if (isNewRecordForValidate || oldLOERecords !== tempVar.length) {
            //for next button
            that.showCreditPriceBTNDisable = true;
            //for product validation
            that.showProductValidateBTNDisable = false;
        }
        else {
            that.showCreditPriceBTNDisable = false;
            that.showProductValidateBTNDisable = true;
        }
        if (tempVar.length > 0) {
            //added tempVar.length condition by sandeep TWC4621-938 30th jan 2023
            that.poSearchData = tempVar.map(i => {
                return { ...i }
            });
        }
        let editonNextDay = (that.poSearchData.length > 0 && todaysDate > dateCalculation(that.poSearchData[0]?.creditPriceDate)) ? true : false;

        that.poSearchData.forEach((data, index) => {
            data.index = index + 1;
            if (data.selected === true) {
                data.priceCheck = (data.creditPriceDate === "" || editonNextDay) ? false : true;
                if (data?.YMS2Price == "0.00" && (data?.tempYMS2Price === '' || data?.tempYMS2Price === undefined)) { //TWC4621-4742,TWC4621-4789 -- if tempYMS2Price is null , fetch price from API call
                    data.priceCheck = false;
                }
            }
            if (data?.ult) {
                data.quantityDisabled = true;
                data.returnQuantity = 1;
            }
        });


        //End -- TWC4621-961 --- Agent UI ---  09/02/2023 -- Bypassing credit price if it is same day
        that.handleNextClick("step-2");
        that.backStage = "step-1";
        that.showProductValidateNextBtn = false;
        that.poHistoryBTN.isSearchStep = false;
        that.showProductValidateBtn = true;

    } else {
        console.log('170')
        that.showToast(
            that.labels.Records_are_not_selected,
            that.labels.no_record_is_selected_message,
            "warning"
        );
        return;
    }
    that.showCreditPriceNextBtn = false;
    that.showProductValidateBtn = false;
    that.isPCNDateAvailable = true;
    that.existingLineItemCheckExpVal = false;
    // Bug fix for reason for price change header not visible
    if ((that.caseType?.isExceptionService() && (that.requestdetails.salesIssueReturnReason == that.genericMessages?.Quarterly_Exception)) || ((that.genericMessages?.Retrn_Resn_for_ZERO_Price?.split(';') || [])?.includes(that.requestdetails.salesIssueReturnReason) || ((that.genericMessages?.Retrn_Resn_for_ZERO_OR_Original_Price?.split(';') || [])?.includes(that.requestdetails.salesIssueReturnReason)))) { //TWC4621-4742,TWC4621-4789 -- added Retrn_Resn_for_ZERO_Price & Retrn_Resn_for_ZERO_OR_Original_Price condition to allow zero dollar
        if (that.isPortal == false || that.isPortal == 'false') {
            that.creditPriceCheck = true;
        }
    }

    //TWC4621-4624 - SaiRam Added for product status check
    let agentProductstatusArr = that.genericMessages.isIaoFlag == 'true' ? that.genericMessages.Agent_Allowed_Product_Status_IAO.split(';') : that.genericMessages.Agent_Allowed_Product_Status.split(';');
    let portalProductstatusArr = that.genericMessages.isIaoFlag == 'true' ? that.genericMessages.Portal_Allowed_Product_Status_IAO.split(';') : that.genericMessages.Portal_Allowed_Product_Status.split(';');
    that.poSearchData.map((item) => {
        let objMMIDBUHierarchy = { ...item.Data };
        // let objMMIDBUHierarchyWrapper = {};
        console.log('Searched Data ', objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]);
        if (item.selected === true && item.Data) {
            if (that.genericMessages.isIaoFlag == 'true') {
                if (!(objMMIDBUHierarchy?.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c)) {
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
                if (!(objMMIDBUHierarchy?.Disti_Channel_Product_Statuses__r)) {
                    item.Error = true;
                    item.errorText = that.labels.No_dist_channel_product_available
                } else {
                    if (that.isPortal == false && objMMIDBUHierarchy && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
                        !agentProductstatusArr.includes(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c)
                    ) {
                        item.Error = true;
                        item.errorText = StringFormatter.format(that.labels.Current_product_status, objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c);
                    } else if (that.isPortal == true && objMMIDBUHierarchy && objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r && !portalProductstatusArr.includes(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c)) {
                        item.Error = true;
                        item.errorText = that.labels.R4C_ProductStatus_ErrMsg;
                    }
                }
            }

        }

        if (item.Error) {
            item.productStatus = false;
            item.selected = false;
            invokeRefreshRowElement(that);
        }
        console.log('225', JSON.stringify(item))
        return { ...item }
    });

    //SaiRam TWC4621-4624 end

}
// This method run on credit price next button --- User Story Number TWC4621-52--- Tushar Garg - End

// Po HistoryHandler -- User Story Number TWC4621-52--- Tushar Garg - Start
let poHistoryHandlerExp = async (that) => {
    let poHistoryResultwithVIZID = [];
    let poHistoryResultwithoutVIZID = [];
    let refreshPopUpUi = false;
    let newLineItemDataAfterPoHistory = [];
    let reqDetails = that.requestdetails;
    const { isPsgCase } = reqDetails;
    let isIaoFlag = that?.genericMessages.isIaoFlag;//TWC4621-5161 -- isIaoFlag
    that.loading(true);
    let caseType = that.caseType;
    let productStatusNumericCodes = new Set();//TWC4621-5414 NCNR Matrix Check
    let itemCustomIndicatorValues = new Set();//TWC4621-5514 NCNR handling blank values in NCNR Matrix - Storing Custom Indicator for NCNR Matrix query

    console.log('MMID DAta ', JSON.stringify(that.poSearchData));

    if (that.genericMessages?.NCNR_Check == "true") {
        that.poSearchData.forEach((item) => {
            if ((caseType.isExceptionService() || caseType.isStockRotation()) && item?.selected) {
                productStatusNumericCodes.add(item?.Data?.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c);
                itemCustomIndicatorValues.add(item?.Data?.Item_Custom_Indicator__c);
            }
        })
    }
    if (that.genericMessages?.NCNR_Check == "true" && productStatusNumericCodes.size > 0) {
        console.log('Status Codes ', productStatusNumericCodes);
        let requestData = {
            Product_Status_code_c: [...productStatusNumericCodes],
            Item_Custom_Indicator__c: [...itemCustomIndicatorValues]
        }
        let ncnrMatrixResult;
        await getMatrixRecord({
            recordType: 'Sales_Issue_NCNR_Matrix',
            requestData: JSON.stringify(requestData)
        }).then((result) => {
            ncnrMatrixResult = result;
        }).catch((error) => {
            console.error(error);
            that.loading(false);
        });

        console.log('NCNR Matrix', ncnrMatrixResult);

        that.poSearchData.forEach(item => {
            if (item.selected) {
                let matchResult = ncnrMatrixResult.filter((resp) => {
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
                console.log('Filtered matrix ', matchResult);
                if (matchResult.length > 0) {
                    item.productStatus = false;
                    item.selected = false;
                    item.Error = true;
                    item.errorText = 'Record is NCNR';
                }
                item.isNcnrValidated = item.selected || item.productStatus == false ? true : false;
            }
        })
    }
    if (that.caseType.isExceptionService() && that.caseType.isNPRCredit()) { //TWC4621-4282
        if (!that.poSearchData.some((data) => data.selected == true && !data.poValidated)) {
            await checkNPRMatrix(that);
            return;
        }
        _BypassPOHistoryValidation(that);
    }
    await poHistoryCheck(that, that.poSearchData, reqDetails, that.caseType).then(async (response) => {
        console.log('response', response)
        poHistoryResultwithVIZID = response?.poHistoryResultwithVIZID || [];
        poHistoryResultwithoutVIZID = response?.poHistoryResultwithoutVIZID || [];
    })
        .catch((err) => {
            that.showToast(that.labels.Error_Title, that.labels.PO_history_check_failed, "error");
        })
        .finally(() => {
            that.loading(false);
        });
    await that.poSearchData.forEach((item) => {
        let poHistoryData = [];

        if (isIaoFlag == 'true' && item?.warrantyResult?.WarrantyTypeCode == '2') { // TWC4621-5161 -- CPU EW PO History changes
            poHistoryData = poHistoryResultwithoutVIZID.find((data) => {
                return (data.ItemId == item.MM && data.SalesOrderId == item?.warrantyResult?.ServiceContractNumber);
            });
        } else if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
            poHistoryData = poHistoryResultwithVIZID.filter((data) => {
                return (data.ItemId == item.MM && data?.DeliveryNoteNbr == item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0"));
            });
        } else {
            poHistoryData = poHistoryResultwithoutVIZID.filter((data) => {
                return (data.ItemId == item.MM && item.selected);
            })
        }
        if (isPsgCase && poHistoryData.length == 0) { //PSG -- TWC4621-3857
            if (isIaoFlag == 'true' && item?.warrantyResult?.WarrantyTypeCode == '2') { // TWC4621-5161 -- CPU EW PO History changes 
                poHistoryData = poHistoryResultwithoutVIZID.find((data) => {
                    if (!item?.oldMM) return false;
                    return (data.ItemId == item.oldMM && data.SalesOrderId == item?.warrantyResult?.ServiceContractNumber);
                });
            } else if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
                poHistoryData = poHistoryResultwithVIZID.filter((data) => {
                    return (data?.ItemId == item?.oldMM && data?.DeliveryNoteNbr == item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0"));
                });
            } else {
                poHistoryData = poHistoryResultwithoutVIZID.filter((data) => {
                    return (data?.ItemId == item?.oldMM && item.selected);
                })
            }
        }

        poHistoryData.sort((date1, date2) => {
            date1 = new Date(date1.CustomerBillingDocumentDt);
            date2 = new Date(date2.CustomerBillingDocumentDt);
            if (date1 < date2) return 1;
            return -1;
        });

        if ((item.selected || (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && item?.VisIdbagError)) && !item.poValidated) {
            if (poHistoryData.length > 0 && poHistoryData !== undefined) {
                let popuplateStatus = popuplateLineItemPopupData(item, poHistoryData[0], isIaoFlag);
                refreshPopUpUi = popuplateStatus?.status;
                item = popuplateStatus?.item;
                item.poHistoryData = poHistoryData[0];
                item.isPoHistoryValid = true;
            } else {
                item.Error = true;
                item.errorText = that.genericMessages?.PO_History_not_found;//'PO not Found';
                item.isPoNumberEditable = false;
            }
            item.productStatus = item?.VisIdbagError ? false : item?.isPoHistoryValid;
            item.selected = item?.VisIdbagError ? false : item?.isPoHistoryValid;
            item.poValidated = true;
            console.log('NCNR FLAG FROM PO ->', item?.poHistoryData?.NcnrFlag, 'Is IAO ', isIaoFlag == 'true');
            if (isIaoFlag == 'true' && item.poHistoryData != undefined && (item?.poHistoryData?.NcnrFlag == 'X' || item?.poHistoryData?.NcnrFlag == 'Z')) { //TWC4621-5161 -- Ncnr Flag for Exception Intake
                item.selected = false;
                item.productStatus = false;
                item.Error = true;
                item.errorText = 'Product is non-cancellable and non-returnable';
                item.isPoNumberEditable = false;
            }
            //Start -- TWC4621-4002 -- set the staus as CPU_POH_Rejection for the failed line items if ult type is VISID
            if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && item.Error) {
                item.VisIdbagError = true;
                item.selected = false;
                item.lineitemStatus = that.genericMessages?.CPU_POH_Rejection;
            }
            //End -- TWC4621-4002 -- set the staus as CPU_POH_Rejection for the failed line items if ult type is VISID
            newLineItemDataAfterPoHistory.push(item);
        }
        that.loading(false);
        if (that.poSearchData.length > 0) {
            that.poHistoryBTN.nextBTN = false;
            that.poHistoryBTN.saveForLatter = false;
        } else {
            // true means we are disable these buttons
            that.poHistoryBTN.nextBTN = true;
            that.poHistoryBTN.saveForLatter = true;
        }
    })
    that.isDisablePoHistoryBTN = false;
    //refreshing popup data
    if (refreshPopUpUi) {
        invokeRefreshRowElement(that);
    }
    let temp = that.poSearchData.filter((data) => data.CustomerOldPONumber !== undefined)
    let poChangedList = temp.filter((data) => data?.CustomerOldPONumber.length != 0 && data?.CustomerOldPONumber !== '').map(item => {
        return {
            newMM: item?.MM,
            oldPO: item?.CustomerOldPONumber,
            newPO: item?.CustomerPONumber
        }
    })
    if (poChangedList.length > 0) {
        that.loading(false);
        await ModalForPOChange.open({
            rows: poChangedList,
            modelHeader: that.labels.TI_PoModel_Header,
            description: that.labels.TI_PoModel_Description,
            subDescription: that.labels.TI_PoModel_SubDescription,
            columns: [
                { label: that.labels.MMID, fieldName: 'newMM' },
                { label: that.labels.PO_Number, fieldName: 'oldPO' },
                { label: that.labels.TI_PoModel_New_POName, fieldName: 'newPO' },
            ],
            hideCancle: true,
            size: 'small',
        })
    }
}
// Po HistoryHandler -- User Story Number TWC4621-52--- Tushar Garg - End
// Invoke Refresh Row Element -- User Story Number TWC4621-52--- Tushar Garg - Start
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
// Invoke Refresh Row Element -- User Story Number TWC4621-52--- Tushar Garg - End

// DateCalculation-- User Story Number TWC4621-52--- Tushar Garg - Start
function dateCalculation(inputParam) {
    let today;
    if (inputParam != undefined) {
        today = new Date(inputParam);
    } else {
        today = new Date();
    }

    let year = today.getFullYear();
    let month = today.getMonth() + 1;
    let day = today.getDate();
    if (month.toString().length == 1) {
        month = "0" + month;
    }
    if (day.toString().length == 1) {
        day = "0" + day;
    }
    const currentDateTime = year + "-" + month + "-" + day;
    return currentDateTime;
}

// DateCalculation-- User Story Number TWC4621-52--- Tushar Garg - End

// popuplateLineItemPopupData-- User Story Number TWC4621-52--- Tushar Garg - Start
function popuplateLineItemPopupData(item, poHistoryData, isIaoFlag) { //TWC4621-5161 -- added isIaoFlag for IAO conditions
    let refresh = false;
    if (!item.BillingDate || item.BillingDate != poHistoryData.CustomerBillingDocumentDt) {
        refresh = true;
        item.BillingDate = poHistoryData.CustomerBillingDocumentDt;
    }
    if (!item.CustomerPONumber || item.CustomerPONumber != poHistoryData.CustomerPurchaseOrderNbr) {
        if (item.CustomerPONumber) item.CustomerOldPONumber = item.CustomerPONumber;
        item.CustomerPONumber = poHistoryData.CustomerPurchaseOrderNbr;
        refresh = true;
    }

    if (!item.SalesOrderNumber || item.SalesOrderNumber != poHistoryData.SalesOrderId) {
        item.SalesOrderNumber = poHistoryData.SalesOrderId;
        refresh = true;
    }

    if (!item.customerBillingDocumentId || item.customerBillingDocumentId != poHistoryData.CustomerBillingDocumentId) {
        refresh = true;
        item.customerBillingDocumentId = poHistoryData.CustomerBillingDocumentId;
    }
    if (!item.customerItemNbr || item.customerItemNbr != poHistoryData.CustomerItemNbr) {
        refresh = true;
        item.customerItemNbr = poHistoryData.CustomerItemNbr;
    }

    if (!item.SalesOrderNumberLineNumber || item.SalesOrderNumberLineNumber != poHistoryData.SalesOrderLineNbr)
        item.SalesOrderNumberLineNumber = poHistoryData.SalesOrderLineNbr;
    //Manohar
    if (!item.Soldto || item.Soldto != poHistoryData.SoldToCustomerId) {
        item.SoldTo = poHistoryData.SoldToCustomerId ? poHistoryData.SoldToCustomerId : "";
        refresh = true;
    }
    if (!item.BillingQuantity || item.BillingQuantity != poHistoryData.BillingQty) {
        item.BillingQuantity = poHistoryData.BillingQty ? poHistoryData.BillingQty : "";
        refresh = true;
    }
    //TWC4621-2173 - Use ContraRevenueAdjustmentRequestlineNetPriceAmt instead of SalesOrderLineNetPriceAmt
    if (!item.UnitPrice || (poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt ? item.UnitPrice != poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt : item.UnitPrice != poHistoryData.SalesOrderLineNetPriceAmt)) {
        if (poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt && poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt > 0) {
            item.UnitPrice = poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt;
        }
        else {
            item.UnitPrice = poHistoryData.SalesOrderLineNetPriceAmt ? poHistoryData.SalesOrderLineNetPriceAmt : "";
        }
        refresh = true;
    }
    if (!item.invoiceLineItemNumber || item.invoiceLineItemNumber != poHistoryData.CustomerBillingDocumentLineNbr) {
        item.invoiceLineItemNumber = poHistoryData.CustomerBillingDocumentLineNbr ? poHistoryData.CustomerBillingDocumentLineNbr : "";
        refresh = true;
    }
    if (!item.currency_z || item.currency_z != poHistoryData.SalesOrderCurrencyCd) {
        item.currency_z = poHistoryData.SalesOrderCurrencyCd ? poHistoryData.SalesOrderCurrencyCd : "";
        refresh = true;
    }
    if (!item?.HanaBatchId || item?.HanaBatchId != poHistoryData?.BatchId) { //TWC4621-4282 -- Mapping batch id from hana
        item.HanaBatchId = poHistoryData.BatchId ? poHistoryData.BatchId : "";
        refresh = true;
    }
    if (isIaoFlag == 'true' && (!item?.ActualInvoiceIndicator || item?.ActualInvoiceIndicator != 'POH')) {//Mapping ActualInvoiceIndicator whether it is PO Search/PO history-TWC4621-4719 
        item.ActualInvoiceIndicator = 'POH';
        refresh = true;
    }
    item.isPoNumberEditable = false;
    //Manohar    
    return { item: item, status: refresh };
}
// popuplateLineItemPopupData-- User Story Number TWC4621-52--- Tushar Garg - End
//------------------------------------------------------------------------------

export {
    creditPriceExpNextBtnHandler,
    poHistoryHandlerExp
};