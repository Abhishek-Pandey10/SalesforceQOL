/********************************************************
//* @Component : r4c_AG_LineItemsResultTableUtill
//* @Author : Accellor
//* @CreatedBy : Syed Ahmed
//* @DateCreated :  18-May-2023
//* @Description : This is util component for line items table.
//* @LastModifiedDate : 13-Sept-2024
//* @LastModifiedBy :  Syed Ahmed
//* @ParentComponent :  r4c_AG_ViewSummary, r4c_AG_LineItemsResultRow, r4c_AG_LineItemsResultTable, r4c_AG_CaseHeaderLineItems, r4c_AG_TechinalIntakeHelper, r4c_AG_ExportToCsv, r4c_AG_StockRotationHelper, r4c_AG_QualityIntakeHelper, r4c_AG_ExceptionIntakeHelper, r4c_CX_QueryStockRotationAllowance, r4c_CX_QueryWarrentyProductInformation, r4c_CX_QuerySearchTable, r4c_SR_Allowance_EndDate_Modification
//* @ChildComponent : r4c_CX_QuerySearchUtill
//* @ApexController : R4C_AG_POSearch_Controller, R4C_PriceAPIYCS3_PICConsumingClass, R4C_API_POsearch_Con, R4C_EntAPI_UltDuplicateConsumingClass
/******************************************************************/
import getCreditPrice from "@salesforce/apexContinuation/R4C_PriceAPIYCS3_PICConsumingClass.invokeInitialRequest";
import poHistoryCheckV2 from "@salesforce/apexContinuation/R4C_API_POsearch_HANAConsumingClass.invokeInitialRequest";
import callHANAAPIContinuation from "@salesforce/apexContinuation/R4C_API_POsearch_Con.invokeInitialRequest";
import LightningConfirm from "lightning/confirm";
import LightningAlert from "lightning/alert";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getCaseWithUlt from "@salesforce/apex/R4C_AG_POSearch_Controller.getCaseWithUlt";
import getUltDuplicate from "@salesforce/apexContinuation/R4C_EntAPI_UltDuplicateConsumingClass.R4C_EntAPI_UltDuplicateConsuming";
import r4c_CustomLabels from "c/r4c_CustomLabels";
//import getNPRCODStatus from "@salesforce/apex/R4C_AG_POSearch_Controller.getNPRCODStatus";
import { fieldSorter } from "c/r4c_CX_QuerySearchUtill";
import continuationCallMMtoCPN from "@salesforce/apexContinuation/R4C_API_MM_To_CPN_Consuming.continuationCallMMtoCPN";
import vizIdpoHistoryCheck from "@salesforce/apexContinuation/R4C_API_POsearch_HANAConsumingClass.invokeInitialRequest";
import userLocale from "@salesforce/i18n/locale";
import getTzone from '@salesforce/apex/R4C_AG_TZone_Controller.getTzone';

let generateWarrantyRequestBody = (poSearchData, requestdetails, caseType, caseMode, duplicates, isPortal, caseRec, isECCLineItemEdit) => {
    let reqDetails = { ...requestdetails };
    let serviceTypeCode = caseType?.isTechnicalService() ? "801" : caseType?.isQualityService() ? "805" : "804";
    // let todayDate = new Date();
    let todayDate = `${new Date().getMonth() + 1 < 10 ? "0" + (new Date().getMonth() + 1) : new Date().getMonth() + 1}/${new Date().getDate() < 10 ? "0" + new Date().getDate() : new Date().getDate()}/${new Date().getFullYear()}`
    let randomnumber = new Date()
        .toJSON()
        .replaceAll(/-/g, "")
        .replaceAll(/:/g, "")
        .substring(0, 15);

    randomnumber += reqDetails.selectedsoldToCMF;
    randomnumber += "-" + stringGen(31 - randomnumber.length);
    //if query number is same for today then dont change
    console.log('41reqDetails.warrentyQueryNumber', JSON.stringify(reqDetails.warrentyQueryNumber))
    if (reqDetails.warrentyQueryNumber) {
        let dateString = reqDetails.warrentyQueryNumber.substring(0, 8);
        let year = dateString.substring(0, 4);
        let month = dateString.substring(4, 6);
        let day = dateString.substring(6, 8);
        // let newDate = new Date(year, +month - 1, day);
        let newDate = `${new Date(year, +month - 1, day).getMonth() + 1 < 10 ? "0" + (new Date(year, +month - 1, day).getMonth() + 1) : new Date(year, +month - 1, day).getMonth() + 1}/${new Date(year, +month - 1, day).getDate() < 10 ? "0" + new Date(year, +month - 1, day).getDate() : new Date(year, +month - 1, day).getDate()}/${new Date(year, +month - 1, day).getFullYear()}`
        if (((isPortal == true || isPortal == "true") && todayDate == newDate) || (caseRec?.Status == 'Submitted, Pending Action' && caseRec?.Origin == 'Web Portal')) {
            randomnumber = reqDetails.warrentyQueryNumber;
        }
        // if (todayDate == newDate && (isPortal == true || isPortal == "true")) {
        //   randomnumber = reqDetails.warrentyQueryNumber;
        // }
        else if (isPortal == false || isPortal == "false") {
            randomnumber = reqDetails.warrentyQueryNumber;
            let exsistingNumber = poSearchData.find(item => item?.warrantyResult?.QueryNumber);
            if (exsistingNumber?.length > 0) {
                randomnumber = exsistingNumber[0].warrantyResult?.QueryNumber;
            }

        }
    }
    console.log('66 ', poSearchData);
    return poSearchData
        .filter(({ selected, lineNumber, warrentyValidated, parentLineId }) => (selected || (isECCLineItemEdit && lineNumber > 4999)) && !warrentyValidated && parentLineId == null)
        .map((data) => {
            console.log('69 data-- ', isECCLineItemEdit, data.selected, ' - ', +data.lineNumber);
            let checkDate = new Date();
            //ULT Duplicate check
            let ult = data.ult?.match(/^[0-9]+$/) ? data?.ult : data?.ult?.trim()?.toUpperCase();
            data.isUltDuplicate = duplicates.indexOf(ult) > -1;
            data.ult = ult;
            if (caseMode == "Edit" && data?.warrantyResult?.warrentyCheckDate && ((isPortal == false || isPortal == "false") || (caseRec?.Origin == 'Web Portal' && caseRec?.Status == 'Submitted, Pending Action'))) {
                checkDate = new Date(data?.warrantyResult?.warrentyCheckDate);
            }
            let checkDateString = `${checkDate.getMonth() + 1 < 10
                ? "0" + (checkDate.getMonth() + 1)
                : checkDate.getMonth() + 1
                }/${checkDate.getDate() < 10
                    ? "0" + checkDate.getDate()
                    : checkDate.getDate()
                }/${checkDate.getFullYear()}`;

            let billingDate = new Date(data.BillingDate);

            let billingDateString = "";
            if (!isNaN(billingDate))
                billingDateString = `${billingDate.getMonth() + 1 < 10
                    ? "0" + (billingDate.getMonth() + 1)
                    : billingDate.getMonth() + 1
                    }/${billingDate.getDate() < 10
                        ? "0" + billingDate.getDate()
                        : billingDate.getDate()
                    }/${billingDate.getFullYear()}`;
            //TWC4621-1041 - Furqan - Fixing bug of warrenty requesting getting undefined value
            return {
                EntitlementCheckDate: checkDateString,
                RemedyTypeCode: reqDetails.remedyDetails.Sales_Issue_Remedy_Type_Code__c,
                CustomerReturnCaseNumber: "",
                ProdUniqueId: data?.ult || "",
                ReturnReasonCode: reqDetails.salesIssueReturnReasonCode,
                SalesOrganizationCode: reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c,
                DistributionChannelCode: reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c,
                OperationBusinessUnitCode: data?.Data?.ICS_WR_Operation_Business_Unit_Code__c || "",
                SpecCode: "",
                ProductFamily: data?.Data?.ICS_WR_Family_Name__c || "",
                ServiceTypeCode: serviceTypeCode,
                QueryNumber: randomnumber,
                ProductCode: data?.ProductCode || "",
                MaterialId: data?.MM || '',
                CaseSoldToPartyId: reqDetails.selectedsoldToCMF,
                BillingDate: billingDateString,
                ExcludeCattsIndicator: data.ult && (data?.ult?.match(/\W/) || data.ult?.length > 25) ? "Y" : "N"
            };
        });
}

let doPicAPIpriceCheck = async (that, mmList, cmf, salesOrgidList) => {
    let requestBody = {
        MMList: mmList,
        CMF: cmf,
        SalesOrgidList: salesOrgidList
    };

    that.loading(true);
    let result = await getCreditPrice({
        picReqWraperString: JSON.stringify(requestBody)
    })
    return result;
}
let MMCPNAPIcheck = async (mmList, cpnList, salesOrganisationCode, distributionChannelCode, selectedSoldTo) => {
    let apiRequestBody = {
        ItemIdsList: mmList,
        CustomerPartNbrList: cpnList,
        SalesOrganizationCd: salesOrganisationCode,
        DistributionChannelCd: distributionChannelCode,
        CustomerId: selectedSoldTo
    };
    console.log('132', JSON.stringify(apiRequestBody))
    let result = await continuationCallMMtoCPN({
        reqWrapperString: JSON.stringify(apiRequestBody)
    })
    console.log('result', JSON.stringify(result))
    return result;
}
let POsearchAPI = async (that, POlist, SOList, serviceType, startDate, endDate) => {

    let reqDetails = { ...that.requestdetails };
    const { isPsgCase, bagList, poHistoryBagsCMFList } = reqDetails;
    let bagAndcmf = JSON.parse(bagList);
    let soldToBagCmflst = JSON.parse(poHistoryBagsCMFList);
    if (!that?.isUcdoff) {
        soldToBagCmflst = soldToBagCmflst.map(i => {
            const bagAndCmf = !that?.isUcdoff ? i.split('+000_') : i.split('-');
            return bagAndCmf[1];
        });
        console.log('180soldToBagCmflst', soldToBagCmflst)
        if (!isPsgCase) {
            soldToBagCmflst.push(`${reqDetails?.sales_Area__c?.Customer_Sales_Organization__r?.Customer_Sales_Organization_Code__c}_${reqDetails?.sales_Area__c?.Customer_Disti_Channel__r?.Customer_Distribution_Channel_Code__c}_${reqDetails?.selectedsoldToCMF}`);
        } else {
            soldToBagCmflst.push(`****_**_${reqDetails?.selectedsoldToCMF}`);
        }
    } else {
        bagAndcmf.add(`9999-${reqDetails?.selectedsoldToCMF}`);
    }
    console.log('190soldToBagCmflst', soldToBagCmflst)
    let apiRequestBody = {
        availableCMFList: that?.isUcdoff ? bagAndcmf : [...new Set(soldToBagCmflst)],//requestdetails?.Sold_CMF__C,//Need to add all values
        poListbyInput: POlist,
        soListbyInput: SOList,
        mmListbyInput: [],
        serviceType: serviceType,
        startDate: startDate,
        endDate: endDate,
        CustomerBillingDocumentTypeCd: 'F2',
        apiType: 'SEARCH'
    };

    console.log('150POsearchAPI', JSON.stringify(apiRequestBody))
    console.log('2043POsearchAPI', apiRequestBody)
    let result = await poHistoryCheckV2({
        srequestwrapper: JSON.stringify(apiRequestBody)
    })
    console.log('result', JSON.stringify(result))
    return result;
}
let TzoneAPI = async (countryCodeMap, selectedCountryId, zip, statesCodeMap, state, city) => {
    let addressDetails = {};
    if (countryCodeMap.get(selectedCountryId)) {
        addressDetails.country = countryCodeMap.get(selectedCountryId);
        addressDetails.country = addressDetails.country.trim();
    } else {
        addressDetails.country = '';
    }

    if (zip) {
        addressDetails.pinCode = zip.replace(/^\s+|\s+$/g, '');
        addressDetails.pinCode = addressDetails.pinCode.trim();
    } else {
        addressDetails.pinCode = '';
    }

    if (statesCodeMap && statesCodeMap?.get(state)) {
        addressDetails.region = statesCodeMap.get(state);
        addressDetails.region = addressDetails.region.trim();
    } else {
        addressDetails.region = '';
    }
    if (city) {
        addressDetails.city = city.replace(/\s+/g, '');
        addressDetails.city = addressDetails.city.trim();
    } else {
        addressDetails.city = '';
    }
    let result = await getTzone({ tzoneReqWrapper: addressDetails });
    return result;
}

let getULTDuplicates = async (that, ultList, tiMsgs, reqDetails) => {
    console.log('isECCLineItemEdit-- ', that?.isECCLineItemEdit);
    console.log('getULTDuplicates ULT List ', ultList);
    let Bypass_R4C_Validations = that.genericMessages?.Bypass_R4C_Validations;
    that.poSearchData.forEach(item => {
        item.isUltInUse = false;
        item.isScraped = false;
        item.isLostInWarehouse = false;
        item.isLostInTransit = false;
        item.existingULTCaseNumbers = '';
    });

    // Call Apex method to get lines and sublines
    const dataWrapper = await getCaseWithUlt({
        ultList: ultList,
        soldTo: reqDetails.Sales_Issue_SoldTo_Customer__c,
        caseId: that?.caserec?.Id || ''
    });

    const lines = dataWrapper?.lines || [];
    const sublines = dataWrapper?.sublines || [];

    const caseIdToULTsMap = new Map();
    const processedULTCasePairs = new Set();
    const SFULTCaseNumbersMap = {};
    const SFULTCaseIdsMap = {};
    const duplicateULTs = [];

    // Populate ULTs from lines
    for (const line of lines) {
        const ult = (line?.Sales_Issue_Prd_Unique_Id__c || '').toUpperCase();
        const caseId = line?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
        if (!ult || !caseId) continue;
        if (!caseIdToULTsMap.has(caseId)) caseIdToULTsMap.set(caseId, []);
        caseIdToULTsMap.get(caseId).push(ult);
    }

    // Populate ULTs from sublines
    for (const subline of sublines) {
        const ult = (subline?.Sales_Issue_Serial_Number__c || '').toUpperCase();
        const caseId = subline?.Sales_Issue_Line_Number__r?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
        const lineULT = subline?.Sales_Issue_Line_Number__r?.Sales_Issue_Prd_Unique_Id__c;
        if (!ult || !caseId) continue;
        if (lineULT && lineULT.toUpperCase() === ult) continue; // avoid double count (duplication with parent line)
        if (!caseIdToULTsMap.has(caseId)) caseIdToULTsMap.set(caseId, []);
        caseIdToULTsMap.get(caseId).push(ult);
    }
    console.log('355caseIdToULTsMap', caseIdToULTsMap)
    const allRecords = [...lines, ...sublines];
    for (const obj of allRecords) {
        let ult, caseId, caseNumber;

        if (obj.hasOwnProperty('Sales_Issue_Prd_Unique_Id__c')) {
            // Line record
            ult = (obj?.Sales_Issue_Prd_Unique_Id__c || '').toUpperCase();
            caseId = obj?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
            caseNumber = obj?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__r?.CaseNumber;
        } else {
            // Subline record
            ult = (obj?.Sales_Issue_Serial_Number__c || '').toUpperCase();
            caseId = obj?.Sales_Issue_Line_Number__r?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__c;
            caseNumber = obj.Sales_Issue_Line_Number__r?.Sales_Issue_Cst_Return_Request_Number__r?.Sales_Issue_CaseNumber__r?.CaseNumber;
            const lineULT = obj.Sales_Issue_Line_Number__r?.Sales_Issue_Prd_Unique_Id__c;
            if (lineULT && lineULT.toUpperCase() === ult) continue; // avoid duplicate count
        }

        if (!ult || !caseId || !caseNumber) continue;
        if (!caseIdToULTsMap.has(caseId)) continue;
        const ultsInCase = caseIdToULTsMap.get(caseId) || [];
        const ultCount = ultsInCase.filter(u => u === ult).length;

        if (ultCount === 1 && caseId === that?.caserec?.Id) continue;

        if (ultCount > 1 || caseId !== that?.caserec?.Id) {
            const pairKey = `${ult}_${caseNumber}`;
            if (processedULTCasePairs.has(pairKey)) continue;
            processedULTCasePairs.add(pairKey);

            if (!that.isPortal) {
                SFULTCaseNumbersMap[ult] = SFULTCaseNumbersMap.hasOwnProperty(ult)
                    ? `${SFULTCaseNumbersMap[ult]},${caseNumber}`
                    : caseNumber;
                SFULTCaseIdsMap[ult] = SFULTCaseIdsMap.hasOwnProperty(ult)
                    ? `${SFULTCaseIdsMap[ult]},${caseId}`
                    : caseId;
            }

            if (!duplicateULTs.includes(ult)) duplicateULTs.push(ult);
        }
    }

    let hasDuplicates;

    if (!(that?.isECCLineItemEdit && Bypass_R4C_Validations == 'true') && duplicateULTs.length > 0) { //ECC lines performance testing commented
        that.poSearchData.forEach(item => {
            if (duplicateULTs.includes(item.ult) && item.selected) {
                if (that?.isECCLineItemEdit === true) {
                    const count = that.poSearchData.filter(d => d.selected && d.ult === item.ult).length;
                    if (SFULTCaseIdsMap[item.ult] === that?.caserec?.Id && count === 1) return;

                    item.isUltInUse = true;
                    item.isUltDuplicate = true;
                    item.existingULTCaseNumbers = `${item.ult} - ${SFULTCaseNumbersMap[item.ult]}`;
                    item.productStatus = false;
                    item.selected = false;
                    item.Error = true;
                    item.errorText = tiMsgs.uniqueULTErrorMsg;
                    hasDuplicates = true;
                } else {
                    item.isUltInUse = true;
                    item.isUltDuplicate = true;
                    if (!that.isPortal) {
                        item.existingULTCaseNumbers = `${item.ult} - ${SFULTCaseNumbersMap[item.ult]}`;
                    }
                    hasDuplicates = true;
                }
            }
        });

        that.loading(false);
    }

    const checkForScrapUlt = ultList.filter(item => !duplicateULTs.includes(item));
    console.log('duplicateUltAPI ULTscheckForScrapUlt', JSON.stringify(checkForScrapUlt));
    //Start - Duplicate ULT API Check
    let isDuplicateULTAPIFailed = false;
    if (checkForScrapUlt.length > 0) {
        that.loading(true);
        let duplicateUltRequestList = [];
        if (checkForScrapUlt.length > that?.genericMessages?.DuplicateULT_JS_Chunk_Size) {
            let spitRequestList = splitArrayIntoChunks(checkForScrapUlt, that?.genericMessages?.DuplicateULT_JS_Chunk_Size);
            for (let i = 0; i < spitRequestList.length; i++) {
                duplicateUltRequestList.push(getUltDuplicate({ ultList: spitRequestList[i] }));
            }
        }
        else {
            duplicateUltRequestList.push(getUltDuplicate({ ultList: checkForScrapUlt }));
        }
        await Promise.all(duplicateUltRequestList)
            .then(async (res) => {
                let response = res;
                if (typeof res === "string" || res instanceof String) {
                    response = JSON.parse(res);
                }
                const duplicateUltResponse = [];
                if (duplicateUltRequestList.length != 0) {
                    for (let i = 0; i < duplicateUltRequestList.length; i++) {
                        if (response[i]?.isError == true) {
                            throw new Error("Duplicate API Failure");
                        }
                        let duplicateultRes = response[i]?.apiResult;
                        if (typeof duplicateultRes === "string" || duplicateultRes instanceof String) {
                            duplicateultRes = JSON.parse(duplicateultRes);
                        }
                        duplicateUltResponse.push(...(duplicateultRes?.elements || []));
                    }
                }
                console.log('duplicateUltAPIResponse -- ', JSON.stringify(duplicateUltResponse))

                if (!(that?.isECCLineItemEdit && Bypass_R4C_Validations == 'true') && duplicateUltResponse.length > 0) { //ECC lines performance testing commented
                    let apiDupList = duplicateUltResponse.filter((data) => data.Duplicate_ULT == 'true').map((item) => item.PRODUCT_UNIQUE_ID);
                    let isScraped = duplicateUltResponse.filter((data) => data.ULT_SCRAPPED == 'true').map((item) => item.PRODUCT_UNIQUE_ID);
                    let isLostInWarehouse = duplicateUltResponse.filter((data) => data.Lost_In_Warehouse == 'true').map((item) => item.PRODUCT_UNIQUE_ID);
                    let isLostInTransit = duplicateUltResponse.filter((data) => data.Lost_In_Transit == 'true').map((item) => item.PRODUCT_UNIQUE_ID);
                    //Start - TWC4621-4623 -Display case numbers after Duplicate ULT check
                    let APIULTCaseNumbersMap = {};
                    if (that.isPortal === false) {
                        APIULTCaseNumbersMap = duplicateUltResponse.reduce((rec, obj) => {
                            const ult = obj?.PRODUCT_UNIQUE_ID;
                            //const rmaumber = obj?.CUSTOMER_RETURN_CASE_NBR_INTAKE === obj?.CUSTOMER_RETURN_CASE_NBR_RECEIPT ? obj?.CUSTOMER_RETURN_CASE_NBR_INTAKE : `${obj?.CUSTOMER_RETURN_CASE_NBR_INTAKE},${obj?.CUSTOMER_RETURN_CASE_NBR_RECEIPT}`;
                            const intakeRMA = obj?.CUSTOMER_RETURN_CASE_NBR_INTAKE || '';
                            const receiptRMA = obj?.CUSTOMER_RETURN_CASE_NBR_RECEIPT || '';
                            let rmaNumber = (intakeRMA && receiptRMA) ? (intakeRMA === receiptRMA ? intakeRMA : `${intakeRMA}, ${receiptRMA}`) : (intakeRMA || receiptRMA || '');
                            //let rmaumber = (intakeRMA != '' && receiptRMA != '' && intakeRMA === receiptRMA) ? receiptRMA : intakeRMA != ''? intakeRMA : '';
                            //rmaumber = (rmaumber != '' && receiptRMA != '') ? rmaumber + ', ' + receiptRMA : receiptRMA != '' ? receiptRMA : '';
                            if (!ult || !rmaNumber) {
                                return rec;
                            }

                            if (rec[ult]) {
                                rec[ult] += ',' + rmaNumber;
                            } else {
                                rec[ult] = rmaNumber;
                            }
                            return rec;
                        }, {});
                    }
                    console.log('APIULTCaseNumbersMap-- ', APIULTCaseNumbersMap);
                    //End - TWC4621-4623 -Display case numbers after Duplicate ULT check
                    that.poSearchData.forEach((item) => {
                        if (apiDupList.indexOf(item.ult) > -1) {
                            item.isUltInUse = true;
                        }
                        if (isScraped.indexOf(item.ult) > -1) {
                            item.isScraped = true;
                        }
                        if (isLostInWarehouse.indexOf(item.ult) > -1) {
                            item.isLostInWarehouse = true;
                        }
                        if (isLostInTransit.indexOf(item.ult) > -1) {
                            item.isLostInTransit = true;
                        }
                        if (item?.ult && that.isPortal === false && APIULTCaseNumbersMap[item.ult] && (item?.isUltInUse || item?.isScraped || item?.isLostInWarehouse || item?.isLostInTransit)) {
                            item.existingULTCaseNumbers = item.ult + ' - ' + APIULTCaseNumbersMap[item.ult];
                        }
                        if (that?.isECCLineItemEdit == true && (item.isUltInUse || item.isScraped || item.isLostInWarehouse || item.isLostInTransit)) { //Unexpected Lines Bug Fix - Samuel
                            item.productStatus = false;
                            item.selected = false;
                            item.Error = true;
                            item.errorText = tiMsgs.uniqueULTErrorMsg;
                        }
                    });

                    that.loading(false);
                    hasDuplicates = (that.poSearchData.some(i => i.selected && (i?.isUltInUse || i?.isScraped || i?.isLostInWarehouse || i?.isLostInTransit))) ? true : false;

                }
            }).catch((error) => {
                console.error('error', error)
                that.loading(false);
                that.showToast(that.labels.Error_Title, that.labels?.R4C_Duplicate_ULT_check_failed, "error");
                isDuplicateULTAPIFailed = true;
                hasDuplicates = true;
            })
    }
    //End - Duplicate ULT API Check
    if (!(that?.isECCLineItemEdit && Bypass_R4C_Validations == 'true') && hasDuplicates && !isDuplicateULTAPIFailed) {
        LightningAlert.open({
            message: that.isPortal === false ? that.poSearchData.filter(i => i?.isUltInUse || i?.isScraped || i?.isLostInWarehouse || i?.isLostInTransit).map(i => ' ' + i.existingULTCaseNumbers).join(";").replace(/(.{65})/g, "$1\n") : that.poSearchData.filter(i => i?.isUltInUse || i?.isScraped || i?.isLostInWarehouse || i?.isLostInTransit).map(i => ' ' + i.ult).join(",").replace(/(.{65})/g, "$1\n"),
            variant: "warning",
            label: tiMsgs.ultInUseHeader
        });
    }
    return hasDuplicates;

}

//after po history check adding PO related fields to the line item
let popuplateLineItemPopupData = (item, poHistoryData) => {
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
    // if (!item.salesOrderCOD || item.salesOrderCOD != poHistoryData.SalesOrderCreateDt)
    //   item.salesOrderCOD = poHistoryData.SalesOrderCreateDt ? poHistoryData.SalesOrderCreateDt : "";
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
        if (poHistoryData.ContraRevenueAdjustmentRequestlineNetPriceAmt) {
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
    //Manohar
    return { item: item, status: refresh };
}
let getDateString = (date) => {
    let dateValue = new Date(date);
    if (dateValue.toLocaleDateString() == 'Invalid Date') {
        return '';
    }
    return dateValue.toLocaleDateString(userLocale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });//dateValue.toLocaleDateString();
}


let getApexDateString = (date) => {
    //BUG Fix - Save Case
    if (!(date instanceof Date)) date = new Date(date);
    if (date.toLocaleDateString() == 'Invalid Date') return '';

    let day = date.getDate();
    if (day < 10) day = "0" + day;
    let month = date.getMonth() + 1;
    if (month < 10) month = "0" + month;
    return `${date.getFullYear()}-${month}-${day}`;
}
/**START - To Filter CMF Values based on Latest  CMF Added to BAG Date to avoid duplicates CMF for PO Histroy Performance   */// SHIPRA
let filterBAGList = (bagList) => {
    const cMFDateMap = new Map();
    bagList.forEach(entry => {
        let [date, salesOrg, distiChannel, cmfNumber] = entry.split('_');//Manohar -- TWC4621-4012 -- added distiChannel,salesOrg
        if (!cMFDateMap.has(`${salesOrg}_${distiChannel}_${cmfNumber}`) || new Date(date) > new Date(cMFDateMap.get(`${salesOrg}_${distiChannel}_${cmfNumber}`))) {
            cMFDateMap.set(`${salesOrg}_${distiChannel}_${cmfNumber}`, date);
        }
    });
    const result = Array.from(cMFDateMap.entries()).map(([cmfNumber, date]) => `${date}_${cmfNumber}`);
    return result;
}
/**END - To Filter CMF Values based on Latest  CMF Added to BAG Date to avoid duplicates CMF for PO Histroy Performance   */


let poHistoryCheck = async (that, poSearchData, requestdetails, caseType) => {
    //let count = 1;
    let poHistoryResultwithoutVIZID = [];
    let poHistoryResultwithVIZID = [];
    let sucessMMswithVIZID = [];
    let sucessMMswithoutVIZID = [];
    let reqDetails = { ...requestdetails };
    const { isPsgCase } = reqDetails; //PSG -- TWC4621-3907
    const { bagList, poHistoryBagsCMFList } = reqDetails;
    let bagAndcmf = JSON.parse(bagList);
    let soldToBagCmflst = JSON.parse(poHistoryBagsCMFList); //Manohar -- TWC4621-3538 -- PO History changes for CMFs based BAGs
    console.log('335soldToBagCmflst', JSON.stringify(soldToBagCmflst))
    if (!that?.isUcdoff) {
        soldToBagCmflst = filterBAGList(soldToBagCmflst);//To Filter CMF Values based on Latest  CMF Added to BAG Date to avoid duplicates CMF for PO Histroy Performance
        if (!isPsgCase) {
            soldToBagCmflst.push(`${r4c_CustomLabels.labels.R4C_Default_Time_Stamp}_${reqDetails.sales_Area__c.Customer_Sales_Organization__r.Customer_Sales_Organization_Code__c}_${reqDetails.sales_Area__c.Customer_Disti_Channel__r.Customer_Distribution_Channel_Code__c}_${reqDetails?.selectedsoldToCMF}`);
        } else {
            soldToBagCmflst.push(`${r4c_CustomLabels.labels.R4C_Default_Time_Stamp}_****_**_${reqDetails?.selectedsoldToCMF}`);
        }
    } else {
        bagAndcmf.push(`9999-${reqDetails?.selectedsoldToCMF}`);//TWC4621-3489 -- Manohar -- adding selected CMF with default bag 9999-selectedCM
    }
    console.log('343soldToBagCmflst', JSON.stringify(soldToBagCmflst))
    console.log('537 isECCLineItemEdit ', that?.isECCLineItemEdit);
    let reqWithoutVISID = that.poSearchData.filter((data) => ((data.selected && data.MM && !data.poValidated) || (!data.isPoHistoryValid && that?.isECCLineItemEdit == true && data.selected == false)) && data?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID');
    let reqWithVISIDforValidLines = that.poSearchData.filter((data) => data.selected && data?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && !data.poValidated);
    let reqWithVISIDforFailedLines = that.poSearchData.filter((data) => (data.VisIdbagError == true || (!data.isPoHistoryValid && that?.isECCLineItemEdit == true && data.selected == false)) && data.warrantyResult.ProdUniqueIdTypeCode == 'VISID');
    let reqWithVISID = [...reqWithVISIDforValidLines, ...reqWithVISIDforFailedLines];
    //Start --- TWC4621-3489 -- Manohar  --pass Items with Dates and SoldTo CMF
    let startDateMonths = 0;
    let endDateMonths = 0;
    if (caseType?.isStockRotation()) {
        startDateMonths = +that.genericMessages?.PO_Search_Stock_Rotation_Months;
    }
    else if (caseType?.isMiscellaneousService()) {
        startDateMonths = +that.genericMessages?.PO_Search_Technical_Intake_Months;
    }
    else if (caseType?.isAdminService()) {
        startDateMonths = +that.genericMessages?.PO_Search_Admin_Intake_Months;
    } else if (caseType?.isQualityService()) {
        startDateMonths = +that.genericMessages?.PO_Search_Quality_Intake_Months;
    } else if (caseType?.isExceptionService()) {
        startDateMonths = +that.genericMessages?.PO_Search_Exception_Intake_Months;
    }
    let startDate = getMMDateString(startDateMonths);
    let endDate = getMMDateString(endDateMonths);
    //End --- TWC4621-3489 -- Manohar  --pass Items with Dates and SoldTo CMF
    let nonVisidMMNumbers = [...new Set(reqWithoutVISID.map((item) => `${item.MM}_${startDate}${endDate}`))].filter((i) => i);//Manohar --TWC4621-3489
    let visidMMNumbers = [...new Set(reqWithVISID.map((item) => `${item.MM}_${startDate}_${endDate}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}`))].filter((i) => i);
    if (isPsgCase) { //PSG -- TWC4621-3857
        //non visids
        let oldMMlstForNonVisid = [...new Set(reqWithoutVISID.map((item) => ((item?.oldMM) ? `${item.oldMM}_${startDate}${endDate}` : null
        )))]?.filter((i) => i); // Filter out any null values
        nonVisidMMNumbers = [...nonVisidMMNumbers, ...oldMMlstForNonVisid];
        //Visids
        let oldMMlstForVisid = [...new Set(reqWithVISID.map((item) => ((item?.oldMM) ? `${item.oldMM}_${startDate}_${endDate}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}` : null
        )))]?.filter((i) => i); // Filter out any null values
        visidMMNumbers = [...visidMMNumbers, ...oldMMlstForVisid];
    }
    //while (count > 0) {
    //request for non VIZID lines
    let reqForNonVIZID = {
        mmListbyInput: nonVisidMMNumbers,
        poListbyInput: [],
        soListbyInput: [],
        availableCMFList: that?.isUcdoff ? bagAndcmf : soldToBagCmflst,
        CustomerBillingDocumentTypeCd: (that.poSearchData.some(i => i?.isExtended)) ? 'F2\',\'FV' : 'F2', //Added below code for filtering at HANA using CustomerBillingDocumentTypeCd based on EW lines
        apiType: 'BAG'
    };
    //request for VIZID lines
    let reqForVIZID = {
        availableCMFList: [],
        mmListbyInput: visidMMNumbers,
        poListbyInput: [],
        soListbyInput: [],
        CustomerBillingDocumentTypeCd: (that.poSearchData.some(i => i?.isExtended)) ? 'F2\',\'FV' : 'F2',
        apiType: 'VIZID'
    };

    console.log('Po Request for visid lines  ', reqForVIZID);
    console.log('Po Request for non visid lines ', reqForNonVIZID);
    //Start - TWC4621-4586 -- JS Chunking for bulk data
    const splitCount = +that.genericMessages.POHistory_JS_Chunk_Size || 600;
    const reqForNonVIZIDList = [];
    const reqForVIZIDList = [];
    const requestArrayOrder = [];
    const requestArray = [];
    let indexcount = 0;
    // 1. reqForNonVIZID
    if (reqForNonVIZID.mmListbyInput.length > splitCount) {
        const splitList = splitObjectArrayIntoChunks(reqForNonVIZID, 'mmListbyInput', splitCount);
        for (let i = 0; i < splitList.length; i++) {
            //reqForNonVIZIDList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArray.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArrayOrder.push({ label: 'reqForNonVIZID', index: indexcount++ });
        }
    }
    else if (reqForNonVIZID.mmListbyInput.length > 0) {
        //reqForNonVIZIDList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForNonVIZID) }));
        requestArray.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForNonVIZID) }));
        requestArrayOrder.push({ label: 'reqForNonVIZID', index: indexcount++ });
    }
    // 2. reqForVIZID
    if (reqForVIZID.mmListbyInput.length > splitCount) {
        const splitList = splitObjectArrayIntoChunks(reqForVIZID, 'mmListbyInput', splitCount);
        for (let i = 0; i < splitList.length; i++) {
            //reqForVIZIDList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArray.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(splitList[i]) }));
            requestArrayOrder.push({ label: 'reqForVIZID', index: indexcount++ });
        }

    }
    else if (reqForVIZID.mmListbyInput.length > 0) {
        //reqForVIZIDList.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForVIZID) }));
        requestArray.push(poHistoryCheckV2({ srequestwrapper: JSON.stringify(reqForVIZID) }));
        requestArrayOrder.push({ label: 'reqForVIZID', index: indexcount++ });
    }
    //End - TWC4621-4586 -- JS Chunking for bulk data
    await Promise.all(requestArray)
        .then(async (response) => {
            //Start -- TWC4621-4586 -- JS Chunking for bulk data
            let withVIZIDResponse = [];
            let withoutVIZIDResponse = [];

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
                if (label === 'reqForNonVIZID') {
                    withoutVIZIDResponse.push(...elements);
                } else if (label === 'reqForVIZID') {
                    withVIZIDResponse.push(...elements);
                }
            }

            console.log('withoutVIZIDResponse:', withoutVIZIDResponse);
            console.log('withVIZIDResponse:', withVIZIDResponse);
            //End -- TWC4621-4586 -- JS Chunking for bulk data
            let MMsPlus5yrswithVIZID = [];
            let MMsPlus5yrswithoutVIZID = [];
            poHistoryResultwithoutVIZID = [...poHistoryResultwithoutVIZID, ...(withoutVIZIDResponse || [])];
            if ((that?.caseType?.isExceptionService() || that?.caseType?.isQualityService()) && withVIZIDResponse.length > 0) {
                poHistoryResultwithVIZID = [...poHistoryResultwithVIZID, ...(withVIZIDResponse)];
            }
            //Start --TWC4621-4814  Commented the logic as part of this US -- PO Checks - For MRB QAN and FAC - for R4C and IAO we will make duration as 6 years
            /*that?.caseType?.isMiscellaneousService() || that?.caseType?.isAdminService() || that?.caseType?.isExceptionService() || that?.caseType?.isExceptionService() || that?.caseType?.isStockRotation() ? count = 0 : '';//Manohar -- TWC4621-2011 -- added if condition 2nd API call is not required for isMiscellaneousService as per functional flow   // TWC4621-2426
            if (that?.caseType?.isQualityService()) {
              let previousStartDate = startDate;
              let previousEndDate = endDate;
              startDate = getMMDateString(startDateMonths - 60);
              endDate = getMMDateString(endDateMonths - 60);
              await poSearchData.forEach(async (item) => {
                //Validating response data(poHistoryResultwithoutVIZID) for next callout for the no response lines
                let poDataWrapperwithoutVIZID = poHistoryResultwithoutVIZID.find((data) => {
                  return item.selected && (item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') && data.ItemId === item.MM && !sucessMMswithoutVIZID?.includes(item.MM);
                })
                if (isPsgCase && poDataWrapperwithoutVIZID === undefined) {//PSG -- TWC4621-3857
                  poHistoryResultwithoutVIZID.find((data) => {
                    return item.selected && (item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') && data.ItemId === item?.oldMM && !sucessMMswithoutVIZID?.includes(item.MM);
                  })
                }
                if (poDataWrapperwithoutVIZID !== undefined && item.selected && item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') {
                  sucessMMswithoutVIZID.push(item.MM);
                }
                else if (poDataWrapperwithoutVIZID === undefined && item.selected && item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID' && !sucessMMswithoutVIZID.includes(item.MM)) {
                  MMsPlus5yrswithoutVIZID.push(`${item.MM}_${startDate}${endDate}`);//Manohar --TWC4621-3489
                  if (isPsgCase) {//PSG -- TWC4621-3857
                    MMsPlus5yrswithoutVIZID.push(`${item.oldMM}_${startDate}${endDate}`);
                  }
                }
                //Validating response data(poHistoryResultwithVIZID) for next callout for the no response lines
                let poDataWrapperwithVIZID = poHistoryResultwithVIZID.find((data) => {
                  return (item.selected || item?.VisIdbagError) && item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' &&
                    `${item.MM}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}` == `${data.ItemId}_${data?.DeliveryNoteNbr?.padStart(10, "0")}` && !sucessMMswithVIZID?.includes(`${item.MM}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`);
                })
                if (isPsgCase && poDataWrapperwithVIZID === undefined) {
                  poDataWrapperwithVIZID = poHistoryResultwithVIZID.find((data) => {
                    return (item.selected || item?.VisIdbagError) && item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && `${item.oldMM}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}` == `${data.ItemId}_${data?.DeliveryNoteNbr?.padStart(10, "0")}` && !sucessMMswithVIZID?.includes(`${item.MM}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`);
                  })
                }
                if (poDataWrapperwithVIZID !== undefined && (item.selected || item?.VisIdbagError) && item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
                  sucessMMswithVIZID.push(`${item.MM}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`);
                }
                else if (poDataWrapperwithVIZID === undefined && (item.selected || item?.VisIdbagError) && item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && !sucessMMswithVIZID.includes(`${item.MM}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}`)) {
                  MMsPlus5yrswithVIZID.push(`${item.MM}_${startDate}_${endDate}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}`);
                  if (isPsgCase && item?.oldMM) { //PSG -- TWC4621-3857
                    MMsPlus5yrswithVIZID.push(`${item.oldMM}_${startDate}_${endDate}_${item?.warrantyResult?.EntitlementCMFSalesOrganizationCode}_${item?.warrantyResult?.EntitlementCMFDistributionChannelCode}_${item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0")}_${item?.warrantyResult?.EnttlSoldToPartyId?.padStart(10, "0")}`);
                  }
                }
      
              })
      
              //Confirmation alert to users for next callout
              if ((MMsPlus5yrswithoutVIZID.length > 0 || MMsPlus5yrswithVIZID.length > 0) && previousStartDate > 20170101) {
                let isconfirmed = await confirmAlertTousers();
                if (isconfirmed) {
                  nonVisidMMNumbers = MMsPlus5yrswithoutVIZID;
                  visidMMNumbers = MMsPlus5yrswithVIZID;
                  count++;
                } else {
                  count = 0;
                  let response = {
                    'poHistoryResultwithoutVIZID': poHistoryResultwithoutVIZID,
                    'poHistoryResultwithVIZID': poHistoryResultwithVIZID
                  }
                  return response;
                }
              }
              else {
      
                count = 0;
                let response = {
                  'poHistoryResultwithoutVIZID': poHistoryResultwithoutVIZID,
                  'poHistoryResultwithVIZID': poHistoryResultwithVIZID
                }
                return response;
              }
      
            }*/
            //End --TWC4621-4814  Commented the logic as part of this US -- PO Checks - For MRB QAN and FAC - for R4C and IAO we will make duration as 6 years
        })
        .catch((error) => {
            that.showToast(r4c_CustomLabels.labels.Error_Title, r4c_CustomLabels.labels.PO_history_check_failed, "error");
            console.error("error POHistory", error);
            //count = 0;
        });
    //}

    //sorting records - TWC4621-3525 -- syed

    poHistoryResultwithoutVIZID = poHistoryResultwithoutVIZID.toSorted((date1, date2) => { //Sorting PO response based on CustomerBillingDocumentDt
        if (date1.CustomerBillingDocumentDt == '' || date2.CustomerBillingDocumentDt == '') return 0;
        date1 = new Date(date1.CustomerBillingDocumentDt);
        date2 = new Date(date2.CustomerBillingDocumentDt);
        if (date1 < date2) return 1;
        return -1;
    });
    poHistoryResultwithVIZID = poHistoryResultwithVIZID.toSorted((date1, date2) => { //Sorting PO response based on CustomerBillingDocumentDt
        if (date1.CustomerBillingDocumentDt == '' || date2.CustomerBillingDocumentDt == '') return 0;
        date1 = new Date(date1.CustomerBillingDocumentDt);
        date2 = new Date(date2.CustomerBillingDocumentDt);
        if (date1 < date2) return 1;
        return -1;
    });
    let response = {
        'poHistoryResultwithoutVIZID': poHistoryResultwithoutVIZID,
        'poHistoryResultwithVIZID': poHistoryResultwithVIZID
    }
    return response;

}
function showToast(title, message, variant) {
    const event = new ShowToastEvent({
        title: title,
        message: message,
        variant: variant
    });
    this.dispatchEvent(event);
}
async function confirmAlertTousers() {
    let isconfirmed = false;
    await LightningConfirm.open({
        message: r4c_CustomLabels.labels.Prompt_message_for_PO_history_check_without_date_range,
        variant: r4c_CustomLabels.labels.Success_Message,
        label: r4c_CustomLabels.labels.Confirm_Message
    })
        .then((data) => {
            if (data) {
                isconfirmed = true;
            }
        })
    return isconfirmed;
}
function apexStringDate(range, date) {
    console.log('apexStringDate method called ' + range);
    let currentDate;
    if (date != null) {
        currentDate = new Date(date);
    } else {
        currentDate = new Date();
    }
    const year = currentDate.getFullYear() - range;
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    return formattedDate;
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

function splitObjectArrayIntoChunks(obj, key, chunkSize) {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) return [];

    const chunks = splitArrayIntoChunks(arr, chunkSize);

    return chunks.map(chunk => ({
        ...obj,
        [key]: chunk
    }));
}
function splitArrayIntoChunks(arr, len) {
    var chunks = [],
        i = 0,
        n = arr.length;
    while (i < n) {
        chunks.push(arr.slice(i, i += len));
    }
    return chunks;
}
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
export {
    splitArrayIntoChunks,
    stringGen,
    generateWarrantyRequestBody,
    getApexDateString,
    getDateString,
    doPicAPIpriceCheck,
    poHistoryCheck,
    popuplateLineItemPopupData,
    getULTDuplicates,
    filterBAGList,
    MMCPNAPIcheck,
    POsearchAPI,
    TzoneAPI,
    splitObjectArrayIntoChunks
}