/********************************************************   
//* @Component Name: r4c_AG_StockRotationHelper   
//* @Author :
//* @DateCreated :  11-May-2023   
//* @Description : This is a Helper component.   
//* @LastModifiedDate : 06-Sept-2024   
//* @LastModifiedBy : Manohar Reddy.
//* @ParentComponent :  r4c_AG_LineItemsResultTable
//* @ChildComponent : r4c_CustomLabels, r4c_AG_LineItemsResultTableUtill, r4c_stringFormatter
//* @ApexController : R4C_API_POsearch_HANAConsumingClass
/******************************************************************/
a
import getAllowanceData from "@salesforce/apex/R4C_AG_POSearch_Controller.getAllowanceData";
import getMatrixRecord from "@salesforce/apex/R4C_BusinessRule_Service.getRule";
import r4c_CustomLabels from "c/r4c_CustomLabels";
import { StringFormatter } from 'c/r4c_stringFormatter';
import {
    getDateString,
    doPicAPIpriceCheck, filterBAGList, poHistoryCheck
} from "c/r4c_AG_LineItemsResultTableUtill";

let labels = r4c_CustomLabels.labels;
// This method is used to validate the product--- User Story Number TWC4621-52--- Tushar Garg
let productValidateNextHandler = (that) => {
    let INTAKE_LIMIT = +that.genericMessages?.INTAKE_LINEITEM_LIMIT || 1500;

    if (that.template.querySelector(".table-style-cls")) {
        //TWC4621-1020 -- sandeep -- feb24th 2023 -- added if condition to check whether any element contains .table-style-cls css class
        that.template.querySelector(".table-style-cls").scrollTop = 0;
    }
    if (that.poSearchNewData.length > 0 && !that.poSearchNewData.some((it) => it.selected) && that.caseType.isStockRotation()) {
        that.showToast(
            labels.Error_Title,
            labels.no_record_is_selected_message,
            "error"
        );
        return;
    }
    //Syed - TWC4621-2627 - Limit intake items to 1500 only
    else if (that.poSearchNewData.filter((it) => it.selected).length > INTAKE_LIMIT) {
        that.showToast(
            labels.Error_Title,
            labels.INTAKE_LIMIT_MESSAGE,
            "error"
        );
        return;
    }
    if (that.selectedInvoiceNum.length > 0) {
        //During edit if user checks validation again 
        if (that.firstTimeValidate) {
            that.poSearchOldData = that.poSearchOldData.filter(
                (item) => item.selected === true
            );
            that.firstTimeValidate = false;
            that.showCreditPriceBTNDisable = true;
        }
        let oldLOERecords = that.poSearchWithLOEData && that.poSearchWithLOEData.length;


        that.poSearchNewData.map((item) => {
            if (
                !that.poSearchOldData.some((d) => {
                    return (d && d.InvoiceNumber && d.InvoiceNumber === item.InvoiceNumber);
                }) && item.selected
            ) {
                that.poSearchOldData.push(item);
            }
            return item;
        });

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
            that.poSearchData = tempVar.map(i => {
                return { ...i }
            });
        }
        that.handleNextClick("step-2");
        that.backStage = "step-1";
        that.showCreditPriceNextBtn = true;
        //hide cancell and next button
        that.showProductValidateNextBtn = false;
        that.poHistoryBTN.isSearchStep = false;
        that.showProductValidateBtn = true;
    } else {
        that.showToast(
            labels.Records_are_not_selected,
            labels.no_record_is_selected_message,
            "warning"
        );
    }
}

// Start ---US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- Continuation method to for PO History button
let poHistoryHandler = (that) => {
    that.loading(true);
    let poNumber = [];
    let reqDetails = { ...that.requestdetails };
    let isIaoFlag = that?.genericMessages.isIaoFlag;//TWC4621-5161 -- added isIaoFlag for IAO conditions
    const { isPsgCase } = reqDetails; //PSG -- TWC4621-3907
    let replacedPoNumbers = [];
    const poSearchDataMap = new Map();
    that.poSearchData.forEach((lineItem) => {
        poSearchDataMap.set(lineItem.InvoiceNumber, lineItem); //added invoicenumber in key instead of MM ,to allow duplicate MM's -- TWC4621-1067 && TWC4621-1068 -- Accellor -- 10th march 2023
        if (lineItem.poNumber && lineItem.selected) {
            poNumber.push(lineItem.poNumber);
        }
    });
    poHistoryCheck(that, that.poSearchData, reqDetails, that.caseType).then((response) => {
        let result = response?.poHistoryResultwithoutVIZID || [];
        console.log('Po Search response  ', result);
        that.allselectedcheckbox = true;
        that.loading(false);
        let isProductAvailable = false;
        let newLineItemDataAfterPoHistory = [];
        let tempVar = [];
        // Filter out MM Data using Billing Date
        let isECCLineItemEdit = that?.isECCLineItemEdit;// TWC4621-5332
        let Bypass_R4C_Validations = that.genericMessages?.Bypass_R4C_Validations;
        poSearchDataMap.forEach((item) => {
            if (item.selected && !item?.poValidated) {
                let poDataWrapper = result?.filter((data) => {
                    return data.ItemId === item.MM;
                });
                if (isPsgCase && poDataWrapper.length == 0) { //PSG -- TWC4621-3857
                    poDataWrapper = result?.filter((data) => {
                        return data?.ItemId === item?.oldMM;
                    });
                }
                if (poDataWrapper.length > 0) {
                    let prepredObject = {};
                    // sort date wise and take 0 index item.MM
                    poDataWrapper.sort((date1, date2) => {
                        date1 = new Date(date1.CustomerBillingDocumentDt);
                        date2 = new Date(date2.CustomerBillingDocumentDt);
                        if (date1 < date2) return 1;
                        return -1;
                    });
                    prepredObject.MM = poSearchDataMap.get(item.InvoiceNumber)?.MM || '';
                    if (isPsgCase && poSearchDataMap.get(item.InvoiceNumber)?.oldMM) {
                        prepredObject.oldMM = poSearchDataMap.get(item.InvoiceNumber)?.oldMM;
                    }
                    // Call Another method to prepare Wrapper,Which we show in UI
                    prepredObject = prepareObject(
                        prepredObject,
                        poDataWrapper[0],
                        isIaoFlag
                    );
                    // Start---TWC4621-1067,TWC4621-1068--Accellor---09-03-2023--SR - product Search - Allow Duplicate MM's in PO Search -- for uniqueness of each line item, using invoicenumber field which contains random number appended with MM
                    prepredObject.Data = poSearchDataMap.get(item.InvoiceNumber).Data;
                    prepredObject.orderPartNumber = poSearchDataMap.get(item.InvoiceNumber).orderPartNumber;
                    prepredObject.productValidate = false;
                    prepredObject.selected = true;
                    prepredObject.productStatus = true;
                    prepredObject.customerItemNbr = poSearchDataMap.get(
                        item.InvoiceNumber
                    ).customerItemNbr;
                    prepredObject.isPoNumberEditable = false;
                    prepredObject.productDescription = poSearchDataMap.get(
                        item.InvoiceNumber
                    ).productDescription;
                    prepredObject.display = true;
                    prepredObject.ProductCode = poSearchDataMap.get(item.InvoiceNumber)?.Data?.Item_Product_Code__c;
                    prepredObject.lineitemStatus = that.casemode === that.genericMessages.Edit_Label ? isECCLineItemEdit ? 'Discrepant' : that.caserec?.Status : "";//TWC4621-1223- 24/04/23 - Accellor
                    prepredObject.shipmentstatus = that.casemode === that.genericMessages.Edit_Label ? isECCLineItemEdit ? 'Discrepant' : that.caserec?.Status : "";
                    prepredObject.lineStatus = that.casemode === that.genericMessages.Edit_Label ? isECCLineItemEdit ? 'Discrepant' : that.caserec?.Status : "";
                    prepredObject.boxCondition = item.boxCondition;//item.ReturnPackageCondition;
                    prepredObject.debitReferenceNumber = item.CustomerDebitReference;
                    prepredObject.returnPO = item.ReturnPO;
                    prepredObject.returnQuantity = item.returnQuantity; //item.Qty; //Dunno why using Qty instead of returnQuantity
                    prepredObject.creditPriceDate = "";
                    prepredObject.pricingCondition = "";
                    prepredObject.lineItemRecId = poSearchDataMap.get(item.InvoiceNumber)?.lineItemRecId;
                    //E2C
                    if (that.isEmailOnLoad) {
                        prepredObject.editBillingDate = poSearchDataMap.get(item.InvoiceNumber)?.editBillingDate;
                        prepredObject.returnRequestRec = poSearchDataMap.get(item.InvoiceNumber)?.returnRequestRec;
                        prepredObject.returnPO = poSearchDataMap.get(item.InvoiceNumber)?.returnPO;
                        prepredObject.returnQuantity = poSearchDataMap.get(item.InvoiceNumber)?.returnQuantity;
                        prepredObject.lineItemRecId = poSearchDataMap.get(item.InvoiceNumber)?.lineItemRecId;
                        prepredObject.boxCondition = poSearchDataMap.get(item.InvoiceNumber)?.boxCondition;
                        prepredObject.caseCreatedDate = poSearchDataMap.get(item.InvoiceNumber)?.caseCreatedDate;
                        prepredObject.warrantyResult = poSearchDataMap.get(item.InvoiceNumber)?.warrantyResult;
                    }
                    //E2C
                    if (item.poNumber !== "" && item.poNumber != null && item.poNumber !== prepredObject.CustomerPONumber
                    ) {
                        replacedPoNumbers.push(item.poNumber);
                    }
                    tempVar.push(prepredObject);
                    newLineItemDataAfterPoHistory.push(prepredObject);
                    isProductAvailable = true;
                } else {
                    if (item.selected) {
                        let prepredObject = {
                            ...item,
                            ...{
                                selected: false,
                                productStatus: false,
                                isPoNumberEditable: false,
                                Error: labels?.TI_PO_History_not_found,
                                display: true,
                                poValidated: true,//added to enable/disable pohistory button in SR
                            }
                        };
                        newLineItemDataAfterPoHistory.push(prepredObject);
                    } else {
                        let prepredObject = {
                            ...item,
                            ...{
                                productStatus: true,
                                isPoNumberEditable: true,
                                Error: "",
                                display: true
                            }
                        };
                        newLineItemDataAfterPoHistory.push(prepredObject);
                    }
                }
            } else {
                newLineItemDataAfterPoHistory.push(item);
            }
        });
        // End---TWC4621-1067,TWC4621-1068--Accellor---09-03-2023--SR - product Search - Allow Duplicate MM's in PO Search -- for uniqueness of each line item using invoicenumber field which contains random number appended with MM
        if (replacedPoNumbers.length > 0) {
            that.showToast(
                labels.Error_Title,
                `${replacedPoNumbers.join(",")} ${labels.Po_Number_Changed_Msg
                }`,
                "error",
                false
            );
        }
        that.poSearchData =
            newLineItemDataAfterPoHistory.length > 0
                ? JSON.parse(JSON.stringify(newLineItemDataAfterPoHistory))
                : [];
        //disable PO History Button
        that.isDisablePoHistoryBTN = false;
        if (that.poSearchData.length > 0 && isProductAvailable) {
            that.poHistoryBTN.nextBTN = false;
            that.poHistoryBTN.saveForLatter = false;
            that.addNewPoSearchData(newLineItemDataAfterPoHistory);
        } else {
            // true means we are disable these buttons
            that.poHistoryBTN.nextBTN = true;
            that.poHistoryBTN.saveForLatter = true;
        }

        //updating old data
        if (that.firstTimeValidate) {
            if (that?.lastSavedPath === undefined && (that?.caserec?.Origin === that.genericMessages.Email_Label || that?.caserec?.Origin === 'ILM')) {
                that.poSearchOldData = [];
            }
            newLineItemDataAfterPoHistory.map((item) => {
                that.poSearchOldData.map((oldItem) => {
                    if (item && oldItem && item.selected &&
                        item.InvoiceNumber ===
                        oldItem.InvoiceNumber
                    ) {
                        oldItem = item;
                    } else if (!oldItem?.lineItemRecId || that.isEmailOnLoad) {
                        oldItem.selected = false;
                        oldItem.productStatus = false;
                    }
                    return oldItem;
                });

                //pushing the select invoice number into selectedInvoiceNum because if someone upload data from bulk update then we need to update the selected items
                if (
                    item.selected === true &&
                    !that.selectedInvoiceNum.includes(item.InvoiceNumber)
                ) {
                    that.selectedInvoiceNum.push(item.InvoiceNumber);
                }
                return item;
            });
        }
        if (
            that.poSearchData.some(
                (data) => data.selected == false && data.productStatus == true
            )
        ) {
            that.allselectedcheckbox = false;
        } else {
            that.allselectedcheckbox = true;
        }
    })
        .catch((error) => {
            console.error("error", error);
            that.showToast(labels?.Error_Title, labels?.PO_history_check_failed, "error");
        })
        .finally(() => {
            that.loading(false);
        });
}

// End ---US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- Continuation method to for PO History button
// Method to  Get PCN /LOE Dates --- User Story Number TWC4621-147--- Tushar Garg
let getLOEDatesHandler = async (that) => {
    var productstatusArr;
    that.loading(true);
    let tempVar = [];
    let prepMap = {};
    let prepMapTemp = [];
    productstatusArr = ["AC", "EN", "RS"];
    let agentProductstatusArr = that.genericMessages.isIaoFlag == 'true' ?  that.genericMessages.Agent_Allowed_Product_Status_IAO.split(';') : that.genericMessages.Agent_Allowed_Product_Status.split(';');
    let portalProductstatusArr = that.genericMessages.isIaoFlag == 'true' ? that.genericMessages.Portal_Allowed_Product_Status_IAO.split(';') : that.genericMessages.Portal_Allowed_Product_Status.split(';');
    if (
        !that.poSearchData.some((it) => {
            return it.selected === true;
        })
    ) {
        that.showToast(
            labels.Error_Title,
            labels.no_record_is_selected_message,
            "error"
        );
        that.loading(false);
        return;
    }

    let productStatusNumericCodes = new Set(); // Storing product status codes for NCNR Matrix query
    let itemCustomIndicatorValues = new Set(); ////TWC4621-5514 NCNR handling blank values in NCNR Matrix - Storing Custom Indicator for NCNR Matrix query


    that.poSearchData.forEach((item) => {
        let objMMIDBUHierarchy = { ...item.Data };
        console.log('AAAAA objMMIDBUHierarchy ', JSON.stringify(objMMIDBUHierarchy));
        let objMMIDBUHierarchyWrapper = {};
        if (item.selected === true && item.Data && !item.productValidate) {
            if (that.isPortal == false) {
                objMMIDBUHierarchyWrapper = that.genericMessages.isIaoFlag =='true' ? checkProductStatus_IAO(that, agentProductstatusArr, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper) :  checkProductStatus(that, agentProductstatusArr, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper);
            } else {
                objMMIDBUHierarchyWrapper = that.genericMessages.isIaoFlag =='true' ? checkProductStatus_IAO(that, portalProductstatusArr, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper) : checkProductStatus(that, portalProductstatusArr, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper);
            }

            if (objMMIDBUHierarchyWrapper.Error) {
                item.productStatus = false;
                item.selected = false;
            } else {
                item.productStatus = true;
                if (
                    that.genericMessages?.NCNR_Check == "true" && !item.isNcnrValidated && objMMIDBUHierarchy &&
                    objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
                    objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c
                ) { //NCNR Matrix Check TWC4621-5414
                    productStatusNumericCodes.add(objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c);
                    itemCustomIndicatorValues.add(objMMIDBUHierarchy?.Item_Custom_Indicator__c) //TWC4621-5514 NCNR handling blank values in NCNR Matrix
                }
            }
            objMMIDBUHierarchyWrapper.productValidate = true;
            objMMIDBUHierarchyWrapper = productValidateWrapper(that,
                objMMIDBUHierarchyWrapper,
                item
            );
            item = { ...item, ...objMMIDBUHierarchyWrapper };
            tempVar.push(JSON.parse(JSON.stringify(item)));
        } else {
            console.log('AAAAA else ');
            objMMIDBUHierarchyWrapper.productValidate =
                item.productValidate !== undefined && item.productValidate === true
                    ? true
                    : false;
            objMMIDBUHierarchyWrapper = productValidateWrapper(that,
                objMMIDBUHierarchyWrapper,
                item
            );
            item = { ...item, ...objMMIDBUHierarchyWrapper };
            tempVar.push(JSON.parse(JSON.stringify(item)));
        }

        if (
            item.selected &&
            item.productValidate &&
            item.Data &&
            item.Data.Name &&
            item.Data.ICS_WR_Operation_Business_Unit_Code__c
        ) {
            let m = {};
            if(that.genericMessages.isIaoFlag != 'true') {
                m[item.Data.ICS_WR_Operation_Business_Unit_Code__c] = [];
                m[item.Data.ICS_WR_Operation_Business_Unit_Code__c].push(item.Data.Name);
                if (prepMap[item.Data.ICS_WR_Operation_Business_Unit_Code__c]) {
                    prepMap[item.Data.ICS_WR_Operation_Business_Unit_Code__c].push(
                        item.Data.Name
                    );
                } else {
                    prepMap = { ...prepMap, ...m };
                }           
            }else {
                m[item.Data.ICS_WR_Profit_Center_Code__c] = [];
                m[item.Data.ICS_WR_Profit_Center_Code__c].push(item.Data.Name);
                if (prepMap[item.Data.ICS_WR_Profit_Center_Code__c]) {
                    prepMap[item.Data.ICS_WR_Profit_Center_Code__c].push(item.Data.Name);
                } else {
                    prepMap = { ...prepMap, ...m };
                } 
            }
            prepMapTemp.push(m);
        }

    });
    if (tempVar.length <= 0) {
        that.showToast(
            labels.Warning,
            labels.Status_not_valid,
            "warning"
        );
        that.loading(false);
        return;
    }

    if (Object.keys(prepMap).length === 0 || prepMapTemp.length === 0) {
        that.poSearchData = tempVar;
        that.showToast(
            labels.Warning,
            labels.All_products_failed,
            "warning"
        );
        that.loading(false);
        return;
    }
    console.log('521', JSON.stringify(prepMap))
    console.log('522', JSON.stringify(that.posearchdetails))
     //NCNR Matrix Check TWC4621-5414
    if (that.genericMessages?.NCNR_Check == "true" && productStatusNumericCodes.size > 0) {
        console.log('Status Codes ', productStatusNumericCodes);
        let requestData = {
            Product_Status_code_c: [...productStatusNumericCodes],
            Item_Custom_Indicator__c: [...itemCustomIndicatorValues]
        }
        console.log('NCNR request wrap ->',requestData);

        let ncnrMatrixResult;
        await getMatrixRecord({
            recordType: 'Sales_Issue_NCNR_Matrix',
            requestData: JSON.stringify(requestData)
        }).then((result) => {
            ncnrMatrixResult = result;
        }).catch((error) => {
            console.error(error);
            that.loading(false);
        });;

        console.log('NCNR Matrix', ncnrMatrixResult);
        tempVar = tempVar.map(item => {
            if (item.selected) {
                console.log('496', JSON.stringify(item))
                let record = ncnrMatrixResult.filter((resp) => {
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

                console.log('Filtered matrix ', record);

                if (record.length > 0 && !item.isNcnrValidated) {
                    item.productStatus = false;
                    item.selected = false;
                    item.Error = 'Record is NCNR';
                }
                if (!item.isNcnrValidated) {
                    item.isNcnrValidated = item.selected || item.productStatus == false ? true : false;
                }
                return item;
            }
        })
    }

    console.log('Allownce req -->',prepMap,'PO data',JSON.stringify(that.posearchdetails));


    getAllowanceData({
        mmopidMap: prepMap,
        poSearchValues: that.posearchdetails
    })
        .then((result) => {
            console.log('528', JSON.stringify(result))

            tempVar = tempVar.map((item) => {
                if (
                    item &&
                    item.productValidate &&
                    item.selected &&
                    item.Data &&
                    item.Data.Name
                ) {
                    let rec = result[item.Data.Name];
                    console.log('539', JSON.stringify(rec))
                    if (rec) {
                        item.allowanceCategory = rec?.Sales_Issue_Stock_Rotation_Category__r?.Name;
                        item.SRallowanceMatrixId = rec?.Id;
                        if (
                            !rec.Sales_Issue_Stock_Rotation_Allowance_Amt__c ||
                            rec.Sales_Issue_Stock_Rotation_Allowance_Amt__c === 0
                        ) {
                            item.productStatus = false;
                            item.selected = false;
                            item.Error = labels.Product_allowance_check;
                            item = {
                                ...item,
                                ...{
                                    productAllowance: 0,
                                    stockRotationAllowance:
                                        rec.Sales_Issue_Stock_Rotation_Allowance_Amt__c,
                                    stockRotationId: rec.Id,
                                    stockRotationRec: rec
                                }
                            };
                        } else {
                            if (
                                rec.Sales_Issue_SR_Open_Prd_Allowance_Amt__c &&
                                rec.Sales_Issue_Stock_Rotation_Allowance_Amt__c
                            ) {
                                item = {
                                    ...item,
                                    ...{
                                        productAllowance:
                                            rec.Sales_Issue_SR_Open_Prd_Allowance_Amt__c,
                                        stockRotationAllowance:
                                            rec.Sales_Issue_Stock_Rotation_Allowance_Amt__c,
                                        stockRotationId: rec.Id,
                                        stockRotationRec: rec
                                    }
                                };
                            } else if (!rec.Sales_Issue_SR_Open_Prd_Allowance_Amt__c) {
                                item = {
                                    ...item,
                                    ...{
                                        productAllowance: 0,
                                        stockRotationAllowance:
                                            rec.Sales_Issue_Stock_Rotation_Allowance_Amt__c,
                                        stockRotationId: rec.Id,
                                        stockRotationRec: rec
                                    }
                                };
                            }
                        }
                    } else {
                        item.productStatus = false;
                        item.selected = false;
                        item.Error = labels.Stock_Rotation_Not_found;
                        item = {
                            ...item,
                            ...{
                                productAllowance: 0,
                                stockRotationAllowance: 0,
                                stockRotationRec: rec
                            }
                        };
                    }
                }
                return item;
            });
            if (tempVar.length > 0) {
                that.poSearchData = tempVar;
                that.poSearchWithLOEData = tempVar;
                that.loading(false);
            } else {
                that.showToast(
                    labels.Error_Title,
                    labels.All_products_failed,
                    "error"
                );
                that.loading(false);
            }
            if (
                tempVar.some((i) => {
                    return i && i.productValidate === true && i.selected;
                })
            ) {
                that.showProductValidateNextBtn = false; //False PO Search Buttons
                that.showProductValidateBTNDisable = true;
                that.showCreditPriceBTNDisable = false;
            } else {
                that.showProductValidateNextBtn = false; //False PO Search Buttons
                that.showProductValidateBTNDisable = true;
                that.showCreditPriceBTNDisable = true;
                that.showToast(
                    labels.Warning,
                    labels.All_products_failed,
                    "warning"
                );
            }
            that.loading(false);
        })
        .catch((error) => {
            console.error(error);
            that.loading(false);
        });

}


//TWC4621-4577 added util method to check the product status for agent and portal
function checkProductStatus(that, productStatusArr, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper) {
    if (
        objMMIDBUHierarchy &&
        objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
        productStatusArr.includes(
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Disti_Channel_prd_Status_Cd__c
        )
    ) {
        console.log('AAAAA checking condition 390');
        if (
            objMMIDBUHierarchy &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Disti_Channel_prd_Status_Cd__c === "EN"
        ) {
            if (
                objMMIDBUHierarchy &&
                objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c &&
                objMMIDBUHierarchy.Item_PCN_date__c
            ) {
                let addDays = new Date(objMMIDBUHierarchy.Item_PCN_date__c);
                if (
                    objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c &&
                    new Date(objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c) >=
                    addDays.setDate(addDays.getDate() + 120)
                ) {
                    objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c = new Date(
                        objMMIDBUHierarchy.Item_PCN_date__c
                    );
                } else {
                    let newDate = new Date(objMMIDBUHierarchy.Item_PCN_date__c);
                    objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c = new Date(
                        newDate.setDate(newDate.getDate() + 120)
                    );
                }
                if (
                    objMMIDBUHierarchy &&
                    !objMMIDBUHierarchy.Item_Last_Return_Dates__c
                ) {
                    let lastOrderEntryDate = new Date(
                        objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c
                    );
                    objMMIDBUHierarchy.Item_Last_Return_Dates__c = new Date(
                        lastOrderEntryDate.setDate(lastOrderEntryDate.getDate() + 30)
                    );
                }
                //start----- Bug Fixing --- if past return date is with in the current date than we need to disable the line item -----TWC4621-499----Tushar Garg
                let todaysDate = new Date();
                if (
                    objMMIDBUHierarchy &&
                    new Date(objMMIDBUHierarchy.Item_Last_Return_Dates__c) <
                    todaysDate
                ) {
                    //End----- Bug Fixing --- if past return date is with in the current date than we need to disable the line item -----TWC4621-499----Tushar Garg
                    objMMIDBUHierarchyWrapper.PCNDate = null;
                    objMMIDBUHierarchyWrapper.Error = labels.Past_Return_Date;
                }
                if (!objMMIDBUHierarchyWrapper.Error) {
                    objMMIDBUHierarchyWrapper = checkSpecType(that,
                        objMMIDBUHierarchy,
                        objMMIDBUHierarchyWrapper
                    );
                }
            } else {
                objMMIDBUHierarchyWrapper.PCNDate = null;
                objMMIDBUHierarchyWrapper.Error = labels.LOE_and_PCN_not_available_Message;
            }
        } else if (objMMIDBUHierarchy &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
            (objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Disti_Channel_prd_Status_Cd__c === "AC" || objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                    .Sales_Issue_Disti_Channel_prd_Status_Cd__c === "RS")) {
            console.log('AAAAA else AC OR RS ');
            objMMIDBUHierarchyWrapper = checkSpecType(that,
                objMMIDBUHierarchy,
                objMMIDBUHierarchyWrapper
            );
        }
    } else {
        // Start ---- Bug Fixing --- Add Disti product status if product status is not AC,EN,RS -----TWC4621-499----Tushar Garg
        if (
            objMMIDBUHierarchy &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0] &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Disti_Channel_prd_Status_Cd__c
        ) {
            objMMIDBUHierarchyWrapper.Error = that.isPortal ? labels.R4C_ProductStatus_ErrMsg : StringFormatter.format(labels.Current_product_status, objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Disti_Channel_prd_Status_Cd__c);
        } else {
            objMMIDBUHierarchyWrapper.Error = labels.No_dist_channel_product_available;
        }
    }
    return objMMIDBUHierarchyWrapper;
}
//TWC4621-4577 end


//TWC4621-5396 added util method to check the product status for agent and portal for IAO based on numeric values
function checkProductStatus_IAO(that, productStatusArr, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper) {
    if (
        objMMIDBUHierarchy &&
        objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
        productStatusArr.includes(
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Channel_StatusCode_Numeric__c
        )
    ) {
        console.log('AAAAA checking condition 390');
        if (
            objMMIDBUHierarchy &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Channel_StatusCode_Numeric__c === "45"
        ) {
            if (
                objMMIDBUHierarchy &&
                objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c &&
                objMMIDBUHierarchy.Item_PCN_date__c
            ) {
                let addDays = new Date(objMMIDBUHierarchy.Item_PCN_date__c);
                if (
                    objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c &&
                    new Date(objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c) >=
                    addDays.setDate(addDays.getDate() + 120)
                ) {
                    objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c = new Date(
                        objMMIDBUHierarchy.Item_PCN_date__c
                    );
                } else {
                    let newDate = new Date(objMMIDBUHierarchy.Item_PCN_date__c);
                    objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c = new Date(
                        newDate.setDate(newDate.getDate() + 120)
                    );
                }
                if (
                    objMMIDBUHierarchy &&
                    !objMMIDBUHierarchy.Item_Last_Return_Dates__c
                ) {
                    let lastOrderEntryDate = new Date(
                        objMMIDBUHierarchy.Item_Last_Order_Entry_Date__c
                    );
                    objMMIDBUHierarchy.Item_Last_Return_Dates__c = new Date(
                        lastOrderEntryDate.setDate(lastOrderEntryDate.getDate() + 30)
                    );
                }
                //start----- Bug Fixing --- if past return date is with in the current date than we need to disable the line item -----TWC4621-499----Tushar Garg
                let todaysDate = new Date();
                if (
                    objMMIDBUHierarchy &&
                    new Date(objMMIDBUHierarchy.Item_Last_Return_Dates__c) <
                    todaysDate
                ) {
                    //End----- Bug Fixing --- if past return date is with in the current date than we need to disable the line item -----TWC4621-499----Tushar Garg
                    objMMIDBUHierarchyWrapper.PCNDate = null;
                    objMMIDBUHierarchyWrapper.Error = labels.Past_Return_Date;
                }
                if (!objMMIDBUHierarchyWrapper.Error) {
                    objMMIDBUHierarchyWrapper = checkSpecType(that,
                        objMMIDBUHierarchy,
                        objMMIDBUHierarchyWrapper
                    );
                }
            } else {
                objMMIDBUHierarchyWrapper.PCNDate = null;
                objMMIDBUHierarchyWrapper.Error = labels.LOE_and_PCN_not_available_Message;
            }
        } else if (objMMIDBUHierarchy &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
            (objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Channel_StatusCode_Numeric__c === "35")) {
            console.log('AAAAA else AC OR RS ');
            objMMIDBUHierarchyWrapper = checkSpecType(that,
                objMMIDBUHierarchy,
                objMMIDBUHierarchyWrapper
            );
        }
    } else {
        // Start ---- Bug Fixing --- Add Disti product status if product status is not AC,EN,RS -----TWC4621-499----Tushar Garg
        if (
            objMMIDBUHierarchy &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0] &&
            objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0]
                .Sales_Issue_Channel_StatusCode_Numeric__c
        ) {
            objMMIDBUHierarchyWrapper.Error = that.isPortal ? labels.R4C_ProductStatus_ErrMsg : StringFormatter.format(labels.Current_product_status, `${objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Sales_Issue_Channel_StatusCode_Numeric__c} (${objMMIDBUHierarchy.Disti_Channel_Product_Statuses__r[0].Disti_Channel_Product_Status_Description__c})`);
        } else {
            objMMIDBUHierarchyWrapper.Error = labels.No_dist_channel_product_available;
        }
    }
    return objMMIDBUHierarchyWrapper;
}
//TWC4621-5396 end


// This price show the selected credit price  --- User Story Number TWC4621-52--- Tushar Garg
let creditPriceNextBtnHandler = (that) => {
    let todaysDate = dateCalculation(); //TWC4621-961 --- Agent UI ---  09/02/2023 --- get formatted date
    that.template.querySelector(".table-style-cls").scrollTop = 0;

    if (!that.poSearchWithLOEData.some((item) => item.selected === true && item.productValidate)) {
        that.showToast(
            labels.Warning,
            labels.no_record_is_selected_message,
            "warning"
        );
        that.showProductValidateBTNDisable = true;
    }
    that.showCreditPriceNextBtn = false;
    that.showProductValidateBtn = false;
    that.isPCNDateAvailable = true; //Enable Validate Credit Point Button For Credit Price Screen
    let tempvar = that.poSearchData.map((item) => {
        if (item.disableRowBoxCondition === true) {
            item.productStatus = false;
        }
        return item;
    });
    if (
        that.poSearchWithLOETOShowData &&
        that.poSearchWithLOETOShowData.length > 0
    ) {
        that.poSearchWithLOETOShowData.map((it) => {
            tempvar.map((i) => {
                if (i && it && i.InvoiceNumber === it.InvoiceNumber) {
                    if (it.Error) {
                        i.Error = it.Error;
                    } else {
                        i.Error = "";
                    }
                    if (!it.productStatus) {
                        i.productStatus = it.productStatus;
                    }
                    if (!it.selected) {
                        i.selected = "F";
                    }
                }
                return i;
            });
            return it;
        });
    }

    tempvar = tempvar.filter((data) => {
        return data.selected === true || data.selected === "F";
    });
    tempvar.map((item) => {
        if (item.selected === "F") {
            item.selected = false;
        }
        return item;
    });
    that.allselectedcheckbox = true;
    that.poSearchData = tempvar ? JSON.parse(JSON.stringify(tempvar)) : [];
    that.poSearchWithLOETOShowData = tempvar
        ? JSON.parse(JSON.stringify(tempvar))
        : [];
    //Start -- TWC4621-961 --- Agent UI ---  09/02/2023 -- Bypassing credit price if it is same day
    if (
        that.poSearchData.some((item) => {
            return (
                item.selected === true && ((item?.YMS2Price == "0.00" && !item?.priceCheck) ||
                    (item.creditPriceDate === ""
                        ? true
                        : todaysDate > dateCalculation(item.creditPriceDate)
                            ? true
                            : false))
            );
        })
    ) {
        that.validateCreditPrice = false; //enable credit price button
        that.creditPriceNextBTN = true; //disable credit price page next button
    } else {
        that.validateCreditPrice = true; //disable credit price button
        that.creditPriceNextBTN = false; //enable credit price page next button
    }
    //End -- TWC4621-961 --- Agent UI ---  09/02/2023 -- Bypassing credit price if it is same day


    that.showAllowMatrixNextBtn = tempvar.length > 0;
    that.handleNextClick("step-3");
    that.backStage = "step-2";

}

// This method get the values from credit price --- User Story Number TWC4621-56--- Tushar Garg
let getCreditPriceHandler = (that) => {
    console.log('in getCreditPriceHandler of StockRotationHelper');
    that.loading(true);
    let prepMMIDList = [];
    let validate = true;
    let salesorgcode;
    if (that.casemode === "Create") {
        if (
            that.requestdetails !== undefined &&
            that.requestdetails.sales_Area__c !== undefined &&
            that.requestdetails.sales_Area__c.Customer_Sales_Organization__r !==
            undefined &&
            that.requestdetails.sales_Area__c.Customer_Disti_Channel__r !==
            undefined
        ) {
            salesorgcode =
                that.requestdetails.sales_Area__c.Customer_Sales_Organization__r
                    .Customer_Sales_Organization_Code__c;

        }
    } else if (that.casemode === "Edit") {
        if (
            that.requestdetails !== undefined &&
            that.requestdetails.Sales_Issue_Sales_Organization__r !== undefined &&
            that.requestdetails.Sales_Issue_Distribution_Channel__r !== undefined
        ) {
            salesorgcode =
                that.requestdetails.Sales_Issue_Sales_Organization__r
                    .Customer_Sales_Organization_Code__c;

        }
    }
    that.poSearchData.map((item) => {
        if (
            item.selected === true &&
            item.productStatus &&
            item.returnQuantity &&
            item.returnQuantity > 0
        ) {
            prepMMIDList.push(item.MM);
        } else if (
            item.selected === true &&
            validate &&
            !item.disableRowBoxCondition
        ) {
            validate = false;
        }
        return item;
    });

    if (!that.poSearchData.some((it) => it.selected === true)) {
        that.showToast(
            labels.Warning,
            labels.no_record_is_selected_message,
            "warning"
        );
        that.loading(false);
        return;
    }
    if (!(prepMMIDList.length > 0 && validate)) {
        that.showToast(
            labels.Missing,
            labels.return_qty_is_not_valid,
            "error"
        );
        that.loading(false);
        return;
    }
    /**Pravallika -- Start -- error on Select box condition as it is required*/
    console.log('822', JSON.stringify(that.poSearchData))
    console.log('823', that.poSearchData.some((it) => it?.boxCondition === '' || it?.boxCondition === undefined))
    if (that.poSearchData.some((it) => it.selected === true && (it.boxCondition == '' || it?.boxCondition === undefined)) && validate) {
        that.showToast(
            labels.Missing,
            labels.Box_Condition_PlaceHolder,
            "error"
        );
        that.loading(false);
        return;
    }
    /**Pravallika -- End -- error on Select box condition as it is required */

    doPicAPIpriceCheck(that, prepMMIDList, that.requestdetails.selectedsoldToCMF, [salesorgcode])
        .then((response) => {
            if (response?.isError == true) {
                throw new Error("PIC API Failure");
            }
            let result = response?.apiResult;
            console.log('result', JSON.stringify(result));
            const todaysDate = dateCalculation(); //TWC4621-961 --- Agent UI ---  09/02/2023 -- get formatted date
            let creditPriceParsedData = JSON.parse(result);
            let creditPriceMap = new Map();
            creditPriceParsedData.map((key) => {
                creditPriceMap.set(key.MM.trim(), key);
                return key;
            });
            let creditPriceList = prepMMIDList.map((key) => {
                let creditPricerec = {};

                if (creditPriceMap.get(key) !== undefined) {
                    creditPricerec = {
                        MM: key,
                        YMS2Price: creditPriceMap.get(key)?.CurrentPrice,
                        pricingCondition: creditPriceMap.get(key)?.PriceCondition,
                        error: "No Error"
                    };
                }
                // TWC4621-912 - Furqan - 16-01-2023 - portal soft stop if no value for credit price
                else {
                    creditPricerec = {
                        MM: key,
                        YMS2Price: 0,
                        pricingCondition: '',
                        error: labels.YMS2Price_not_found
                    };
                }

                return creditPricerec;
            });

            let data = creditPriceList.map(i => {
                return { ...i }
            })

            let portalSoftStop = false;
            let tempVar = that.poSearchData.map((item) => {
                data.map((lineitem) => {
                    if (lineitem.MM === item.MM && item.selected === true && !item.priceCheck) {
                        item.creditPriceDate = todaysDate; //TWC4621-961 --- Agent UI ---  09/02/2023 -- assigning credit price date after API call
                        //start--- Disable item if  price is 0 --- User Story Number TWCC4621-532--- Tushar Garg
                        // TWC4621-912 - Furqan - 16-01-2023 - portal soft stop if no value for credit price
                        if (lineitem.YMS2Price < 1 && that.isPortal == false) {
                            item.successText = lineitem.error;
                            item.isSoftStop = true;
                            item.YMS2Price = 0;
                            item.creditPrice = 0;
                            item.pricingCondition = '';
                            that.creditPriceCheck = true;
                        } else {
                            // TWC4621-912 - Furqan - 16-01-2023 - portal soft stop if no value for credit price defaulting value to 0
                            if (!lineitem.YMS2Price) lineitem.YMS2Price = "0";
                            let CP = parseFloat(item.returnQuantity) * parseFloat(lineitem.YMS2Price);
                            item.creditPrice = CP;
                            item.YMS2Price = lineitem.YMS2Price;
                            item.tempYMS2Price = lineitem.YMS2Price;//TWC4621-4742,TWC4621-4789 -- mapping the value for zero dollar Scenrios where the price should be zero or orginal price
                            item.pricingCondition = lineitem?.pricingCondition;
                            portalSoftStop = item.YMS2Price < 1;
                            item.isSoftStop = portalSoftStop;
                            if (portalSoftStop) item.successText = lineitem.error; // Bug fix for - Customer seeing "success" message on hover of validated info icon
                        }
                        item.priceCheck = true; // Price Overide
                        item.price = lineitem.YMS2Price;// Price Overide
                        //End--- Disable item if  price is 0 --- User Story Number TWCC4621-532--- Tushar Garg
                    }
                    return lineitem;
                });
                return item;
            });
            that.poSearchData = tempVar;
            that.poSearchWithLOETOShowData = tempVar;
            that.creditPriceNextBTN = tempVar.some((i) => i && i.selected && i.productStatus && i.returnQuantity);

            that.showAllowMatrixNextBtn = true;
            that.showTotalAmmount = true;
            that.crditPriceNextBnt = false;

            //Enable Next Button
            that.validateCreditPrice = true;
            that.creditPriceNextBTN = false;

            if (
                portalSoftStop &&
                (that.isPortal == true || that.isPortal == "true")
            ) {
                that.showToast(
                    labels.Warning,
                    labels.TI_Portal_Price_Not_Found_Description,
                    "warning"
                );
            }
        })
        .catch((error) => {
            console.error(error);
            that.showToast(
                labels.Error_Title,
                labels.Credit_Price_Check_Failed,
                "error"
            );
        }).finally(() => {
            that.loading(false);
        })
}

//This method run on  the allow Matrix Next Btn Handler --- User Story Number TWC4621-56--- Tushar Garg
let allowMatrixNextBtnHandler = (that) => {
    that.template.querySelector(".table-style-cls").scrollTop = 0;
    if (
        that.poSearchData.some((item) => {
            return item.selected === true && item.productStatus;
        })
    ) {
        that.loading(true);
        that.handleNextClick("step-4");
        that.backStage = "step-3";
        that.isMatrixStage = true;
        that.showAllowMatrixNextBtn = false;
        that.isCreditPriceValidateion = false;
        let tempvar = that.poSearchData.filter((data) => {
            return (
                data.selected === true &&
                !data.disableRowBoxCondition &&
                data.productStatus
            );
        });
        that.allselectedcheckbox = true;

        if (
            that.poSearchWithMatrixData &&
            that.poSearchWithMatrixData.length > 0
        ) {
            that.poSearchWithMatrixData.map((it) => {
                tempvar.map((i) => {
                    if (i && it && i.InvoiceNumber === it.InvoiceNumber) {
                        if (it.Error) {
                            i.Error = it.Error;
                        }
                    }
                    return i;
                });
                return it;
            });
        }

        that.poSearchData = tempvar ? JSON.parse(JSON.stringify(tempvar)) : [];
        //checking if any new row is add then enable button
        if (that.poSearchData.length !== that.poSearchWithMatrixData.length) {
            that.disableSubmitCalculateBtn = false;
            that.nextButtonForsubmit = true;
        }

        that.poSearchWithMatrixData = tempvar
            ? JSON.parse(JSON.stringify(tempvar))
            : [];

        that.poSearchData.map((item) => {

            item.isReadOnlyBoxCondition = true;
            return item;
        });

        that.poSearchWithMatrixData.map((item) => {

            item.isReadOnlyBoxCondition = true;
            return item;
        });
        that.loading(false);
    } else {
        that.showToast(
            labels.Warning,
            labels.no_record_is_selected_message,
            "warning"
        );
    }
}

//This method calculate the amount of allow matrix Ammount--- User Story Number TWC4621-56--- Tushar Garg
let calculateAmmount = (that) => {
    that.loading(true);
    let failedRecords = [];
    let failedReturnQuatity = [];
    let stockallownaceids = [];
    let stockallownacemap = new Map();
    let selectedlineitemscount = 0;
    that.poSearchData.map((item) => {
        if (
            item.selected === true &&
            item.stockRotationId !== undefined &&
            item.stockRotationId !== null
        ) {
            selectedlineitemscount++;
            if (!stockallownaceids.includes(item.stockRotationId)) {
                stockallownaceids.push(item.stockRotationId);
                let SRcombinedprice = 0;
                let OPcombinedprice = 0;
                if (
                    item.boxCondition === that.genericMessages.Box_Closed_Factory_Sealed
                ) {
                    SRcombinedprice = SRcombinedprice + parseFloat(item.creditPrice);

                } else if (
                    item.boxCondition ===
                    that.genericMessages.Outer_Box_Open_Product_Unsealed
                ) {
                    OPcombinedprice = OPcombinedprice + parseFloat(item.creditPrice);

                }
                let stockallowancrecord = {
                    Id: item.stockRotationId,
                    SRcombinedprice: SRcombinedprice,
                    OPcombinedprice: OPcombinedprice
                };
                stockallownacemap.set(item.stockRotationId, stockallowancrecord);
            }
            else {
                let tempstockallowancrecord = stockallownacemap.get(
                    item.stockRotationId
                );
                if (tempstockallowancrecord) {
                    if (
                        item.boxCondition === that.genericMessages.Box_Closed_Factory_Sealed
                    ) {
                        tempstockallowancrecord.SRcombinedprice =
                            tempstockallowancrecord.SRcombinedprice +
                            parseFloat(item.creditPrice);
                    } else if (
                        item.boxCondition === that.genericMessages.Outer_Box_Open_Product_Unsealed
                    ) {
                        tempstockallowancrecord.OPcombinedprice =
                            tempstockallowancrecord.OPcombinedprice +
                            parseFloat(item.creditPrice);
                    }
                }
                stockallownacemap.delete(item.stockRotationId);
                stockallownacemap.set(item.stockRotationId, tempstockallowancrecord);
            }
        }
        return item;
    });
    if (selectedlineitemscount <= 0) {
        that.showToast(
            labels.Please_select_some_items_first,
            labels.Items_Are_Not_selected_for_validation,
            "warning"
        );
        that.loading(false);
        return;
    }

    that.poSearchData.map((item) => {
        if (item.selected === true) {
            if (
                item.boxCondition === that.genericMessages.Box_Closed_Factory_Sealed
            ) {
                if (
                    stockallownacemap &&
                    stockallownacemap.get(item.stockRotationId) &&
                    item.stockRotationAllowance <=
                    stockallownacemap.get(item.stockRotationId).SRcombinedprice
                ) {
                    failedRecords.push(item.MM);
                    item.Error = labels.sra_amount_too_high;
                } else {
                    item.Error = null;
                }
            } else if (
                item.boxCondition === that.genericMessages.Outer_Box_Open_Product_Unsealed
            ) {
                if (
                    stockallownacemap &&
                    stockallownacemap.get(item.stockRotationId) &&
                    item.productAllowance <=
                    stockallownacemap.get(item.stockRotationId).OPcombinedprice
                ) {
                    failedRecords.push(item.MM);
                    item.Error = that.labels.sra_amount_too_high;
                } else {
                    item.Error = null;
                }
            }
            if (item.returnQuantity < 1) {
                failedReturnQuatity.push(item.MM);
            }
        }
        return item;
    });
    if (failedReturnQuatity.length > 0) {
        that.showToast(
            labels.Warning,
            failedReturnQuatity + " " + labels.return_qty_is_not_valid,
            "warning"
        );
        that.nextButtonForsubmit = true;

        that.loading(false);
        return;
    }
    if (failedRecords.length > 0) {
        that.showToast(
            labels.Warning,
            failedRecords + " " + labels.reduce_amount_message,
            "warning"
        );
        that.nextButtonForsubmit = true;

        that.loading(false);
        return;
    }

    if (failedRecords.length === 0) {
        that.showToast(
            labels.Success_Message,
            labels.Validate_allowance_success_message,
            "success"
        );
        that.disableSubmitCalculateBtn = true;
        that.nextButtonForsubmit = false;
    }
    that.loading(false);

}
let handleBackClickToLOE = (that) => {
    that.template.querySelector(".table-style-cls").scrollTop = 0;
    let tempVar = that.poSearchWithLOEData.map((item) => {
        if (item.selected === true) {
            item.productStatus = true;
        }
        return item;
    });
    tempVar.map((it) => {
        that.poSearchData.map((i) => {
            if (i && it && it.InvoiceNumber === i.InvoiceNumber) {
                if (i.Error && !it.Error) {
                    it.Error = "";
                }
                //Start -- TWC4621-961 --- Agent UI ---  09/02/2023 -- adding credit price values to Product Validated data(Bypassing credit price if it is same day)
                it.YMS2Price = i.YMS2Price;
                it.tempYMS2Price = i.YMS2Price;//TWC4621-4742,TWC4621-4789 -- mapping the value for zero dollar Scenrios where the price should be zero or orginal price
                it.creditPrice = i.creditPrice;
                it.creditPriceDate = i.creditPriceDate;
                it.pricingCondition = i.pricingCondition;
                it.priceCheck = i.priceCheck;
                it.successText = i.successText;
                it.isSoftStop = i.isSoftStop;
                it.price = i.price;
                //End -- TWC4621-961 --- Agent UI --- 09/02/2023 -- adding credit price values to Product Validated data(Bypassing credit price if it is same day)
            }
            return i;
        });
        return it;
    });

    that.poSearchData = tempVar ? JSON.parse(JSON.stringify(tempVar)) : [];
    that.poSearchWithLOEData = tempVar
        ? JSON.parse(JSON.stringify(tempVar))
        : [];
    that.handleNextClick("step-2");
    that.backStage = "step-1";
    that.showProductValidateNextBtn = false;
    that.showProductValidateBtn = true;
    that.showAllowMatrixNextBtn = false;
    that.showAllowMatrixNexdtBtn = false;
    that.showTotalAmmount = false;
    that.showProductValidateBTNDisable = true;
    that.showCreditPriceNextBtn = true; //disable Next Button For Credit Price Screen
    that.isPCNDateAvailable = false; //Enable Validate Credit Point Button For Credit Price Screen
}

//------------------
//Manohar --TWC4621-3489 -- combine the date in YYYYMMDD format for POHistory
function getMMDateString(NumOfMonths) {
    // Get the current date
    const currentDate = new Date();
    // Clone the current date to avoid mutating the original date
    const targetDate = new Date(currentDate);
    // Subtract the specified number of months
    targetDate.setMonth(currentDate.getMonth() + NumOfMonths);
    // Format the date in YYYYMMDD format
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(targetDate.getDate()).padStart(2, '0');
    // Combine into YYYYMMDD format
    return `${year}${month}${day}`;
}

function stringGen(value) {
    let result = "";
    let input_length = +value;
    let chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < input_length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Start ---US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- Method to prepare Wrapper,Which we show in UI
function prepareObject(prepredObject, poDataWrapper, isIaoFlag) {
    let randomnumber = stringGen(6);
    randomnumber += "-" + poDataWrapper.ItemId;
    prepredObject.CustomerPONumber = poDataWrapper.CustomerPurchaseOrderNbr
        ? poDataWrapper.CustomerPurchaseOrderNbr
        : "";
    prepredObject.SalesOrderNumberLineNumber = poDataWrapper.SalesOrderLineNbr
        ? poDataWrapper.SalesOrderLineNbr
        : "";
    prepredObject.Soldto = poDataWrapper.SoldToCustomerId
        ? poDataWrapper.SoldToCustomerId
        : "";
    prepredObject.BillingDate = poDataWrapper.CustomerBillingDocumentDt
        ? poDataWrapper.CustomerBillingDocumentDt
        : "";
    //prepredObject.MM = poDataWrapper.ItemId ? poDataWrapper.ItemId : "";

    prepredObject.BillingQuantity = poDataWrapper.BillingQty
        ? poDataWrapper.BillingQty
        : "";
    //TWC4621-2173 - Use ContraRevenueAdjustmentRequestlineNetPriceAmt instead of SalesOrderLineNetPriceAmt
    if (poDataWrapper.ContraRevenueAdjustmentRequestlineNetPriceAmt) {
        prepredObject.UnitPrice = poDataWrapper.ContraRevenueAdjustmentRequestlineNetPriceAmt;
    } else {
        prepredObject.UnitPrice = poDataWrapper.SalesOrderLineNetPriceAmt
            ? poDataWrapper.SalesOrderLineNetPriceAmt
            : "";
    }
    prepredObject.InvoiceNumber = randomnumber;
    prepredObject.customerBillingDocumentId =
        poDataWrapper.CustomerBillingDocumentId
            ? poDataWrapper.CustomerBillingDocumentId
            : "";
    prepredObject.SalesOrderNumber = poDataWrapper.SalesOrderId
        ? poDataWrapper.SalesOrderId
        : "";
    prepredObject.deliveryNote = poDataWrapper.DeliveryNoteNbr
        ? poDataWrapper.DeliveryNoteNbr
        : "";
    prepredObject.invoiceLineItemNumber =
        poDataWrapper.CustomerBillingDocumentLineNbr
            ? poDataWrapper.CustomerBillingDocumentLineNbr
            : "";
    prepredObject.currency_z = poDataWrapper.SalesOrderCurrencyCd
        ? poDataWrapper.SalesOrderCurrencyCd
        : "";
    prepredObject.HanaBatchId = poDataWrapper.BatchId ? poDataWrapper.BatchId : ""; //TWC4621-4282 -- Mapping batch id from hana
    if (isIaoFlag == 'true') {
        prepredObject.ActualInvoiceIndicator = 'POH';//Mapping ActualInvoiceIndicator whether it is PO Search/PO history-TWC4621-4719
    }
    prepredObject.poValidated = true; //added to enable/disable PO history button in stock rotation

    return prepredObject;
}
// End ---US : TWC4621-679 US TWC4621-680 US TWC4621-801 --Tushar Garg --- Method to prepare Wrapper,Which we show in UI

// Reusable methods to check the Spec Type --- User Story Number TWC4621-147--- Tushar Garg
function checkSpecType(that, objMMIDBUHierarchy, objMMIDBUHierarchyWrapper) {
    let isIaoFlag = that?.genericMessages.isIaoFlag;
    console.log('AAAAA check SpeccodeType >>> AC Or RC');
    if (
        objMMIDBUHierarchy &&
        objMMIDBUHierarchy.Item_Spec_Code__c &&
        objMMIDBUHierarchy.Item_Spec_Code__c ==
        that.genericMessages.Spec_Code_Message
    ) {
        objMMIDBUHierarchyWrapper.PCNDate = null;
        objMMIDBUHierarchyWrapper.Error =
            that.genericMessages.Spec_Type_Q_message;
    }
    if (
        objMMIDBUHierarchy &&
        objMMIDBUHierarchy.Item_Cust_Product_To_Order__c &&
        objMMIDBUHierarchy.Item_Cust_Product_To_Order__c ===
        that.genericMessages.Cust_Product_To_Order_msg
    ) {
        objMMIDBUHierarchyWrapper.PCNDate = null;
        if (objMMIDBUHierarchyWrapper.Error) {
            objMMIDBUHierarchyWrapper.Error = `${objMMIDBUHierarchyWrapper.Error} , ${that.genericMessages.CTO}`;
        } else {
            objMMIDBUHierarchyWrapper.Error = that.genericMessages.CTO;
        }
    }
    if (isIaoFlag !== 'true' && objMMIDBUHierarchy && ((objMMIDBUHierarchy.ICS_WR_Family_Name__c &&
        objMMIDBUHierarchy.ICS_WR_Family_Name__c.startsWith(that.genericMessages.ICS_WR_Family_Name_Msg)) ||
        (objMMIDBUHierarchy.ICS_WR_SBS_Name__c && (objMMIDBUHierarchy.ICS_WR_SBS_Name__c === that.genericMessages.WR_SBS_Name_Equals_CTO ||
            objMMIDBUHierarchy.ICS_WR_SBS_Name__c === that.genericMessages.WR_SBS_Name_Equals_CLOUDBLOCK)))) {
        objMMIDBUHierarchyWrapper.PCNDate = null;
        if (objMMIDBUHierarchyWrapper.Error) {
            objMMIDBUHierarchyWrapper.Error = `${objMMIDBUHierarchyWrapper.Error} , ${that.genericMessages.HPC}`;
        } else {
            objMMIDBUHierarchyWrapper.Error = that.genericMessages.HPC;
        }
    } else {
        if (!objMMIDBUHierarchyWrapper.Error) {
            if (
                objMMIDBUHierarchy &&
                objMMIDBUHierarchy.Item_Last_Return_Dates__c
            ) {
                objMMIDBUHierarchyWrapper.PCNDate = getDateString(objMMIDBUHierarchy.Item_Last_Return_Dates__c);
            }
            objMMIDBUHierarchyWrapper.Error = "";
        }
    }
    return objMMIDBUHierarchyWrapper;
}
// Wrapper for product validation
function productValidateWrapper(that, objMMIDBUHierarchyWrapper, item) {
    objMMIDBUHierarchyWrapper.disableRowBoxCondition = false;
    objMMIDBUHierarchyWrapper.returnQuantity =
        item.returnQuantity && item.returnQuantity ? item.returnQuantity : "";
    objMMIDBUHierarchyWrapper.returnPO =
        item.returnPO && item.returnPO ? item.returnPO : "";
    objMMIDBUHierarchyWrapper.debitReferenceNumber =
        item.debitReferenceNumber && item.debitReferenceNumber
            ? item.debitReferenceNumber
            : "";
    objMMIDBUHierarchyWrapper.creditPrice =
        item.creditPrice && item.creditPrice ? item.creditPrice : 0;
    objMMIDBUHierarchyWrapper.YMS2Price =
        item.YMS2Price && item.YMS2Price ? item.YMS2Price : "";
    objMMIDBUHierarchyWrapper.boxCondition =
        item.boxCondition && item.boxCondition
            ? item.boxCondition
            : that.genericMessages.Box_Closed_Product_sealed;
    objMMIDBUHierarchyWrapper.isReadOnlyBoxCondition =
        item.isReadOnlyBoxCondition;

    return objMMIDBUHierarchyWrapper;
}

//Start -- TWC4621-961 --- Agent UI ---  09/02/2023 -- formating date
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

//----------------------------------------------------------------
export {
    productValidateNextHandler,
    poHistoryHandler,
    getLOEDatesHandler,
    creditPriceNextBtnHandler,
    getCreditPriceHandler,
    allowMatrixNextBtnHandler,
    calculateAmmount,
    handleBackClickToLOE
};