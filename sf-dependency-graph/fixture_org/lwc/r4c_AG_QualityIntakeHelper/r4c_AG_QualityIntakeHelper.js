/******************************************************** 	
//* @Component Name: r4c_AG_QualityIntakeHelper 	
//* @Author :  	Manohar Reddy
//* @DateCreated :  18-May-2023	
//* @Description : This is Helper component for Quality Intake case. 	
//* @LastModifiedDate : 15-Jul-2024 	
//* @LastModifiedBy : Manohar Reddy. 	
//* @ParentComponent : r4c_AG_LineItemsResultTable
//* @ReferedComponents : r4c_CustomLabels, r4c_AG_TechinalIntakeHelper, r4c_AG_pochangepopup, r4c_AG_LineItemsResultTableUtill
//* @ApexController : R4C_POSearchUtil
/******************************************************************/

import ModalForPOChange from "c/r4c_AG_pochangepopup";
import r4c_CustomLabels from "c/r4c_CustomLabels";
import fetchmrbRefNumbers from "@salesforce/apex/R4C_POSearchUtil.fetchmrbRefNumbers";
import getMatrixRecord from "@salesforce/apex/R4C_BusinessRule_Service.getRule";
import { poHistoryCheck, getApexDateString, popuplateLineItemPopupData } from "c/r4c_AG_LineItemsResultTableUtill";
import { checkNPRMatrix, warrentyCheckNextHandler, invokeRefreshRowElement, validatedEWItemsBasedonParent } from "c/r4c_AG_TechinalIntakeHelper";
let r4cLabels = {
  cpnRequiredErrorMsg: r4c_CustomLabels.labels.TI_CPN_Requried,
  mmModelExsitingMMName: r4c_CustomLabels.labels.MMID,
  mmModelNewMMName: r4c_CustomLabels.labels.TI_New_MMID,
  poModelHeader: r4c_CustomLabels.labels.TI_PoModel_Header,
  poModelDescription: r4c_CustomLabels.labels.TI_PoModel_Description,
  poModelSubDescription: r4c_CustomLabels.labels.TI_PoModel_SubDescription,
  poModelExsitingPOName: r4c_CustomLabels.labels.PO_Number,
  poModelNewPOName: r4c_CustomLabels.labels.TI_PoModel_New_POName,
  missingMMErrorMsg: r4c_CustomLabels.labels.TI_MissingMM_ErrorMsg
};

//validating Mrb numbers and Po history check
let validateMRB = async (that) => {
  let reqDetails = that.requestdetails;
  const { isPsgCase } = reqDetails;
  //UI Validations for MRB Ref Number
  if (reqDetails?.salesIssueReturnReason === that.genericMessages?.QAN_MRB_PRT) {
    if (that.poSearchData.some((data) => data.selected && !data.mrbnumber)) {
      that.showToast(that.labels.Warning, that.labels?.Please_enter_required_mrb_ref_numbers, "warning");
      return;
    }
    if (that.poSearchData.some((data) => data.selected && data.mrbnumber && data.mrbnumber.length > 30)) {
      that.showToast(that.labels.Warning, that.labels.MRB_max_length_Toast_msg, "warning");
      return;
    }
    //Validate MRB Number from salesforce
    that.loading(true);
    let mmList = [...new Set(that.poSearchData.map((item) => item.selected == true && item.MM))].filter((i) => i);

    that.loading(true);
    //Pass MMlist to apex and get the MRB ref number and dates
    let todayDate = getApexDateString(new Date());
    await fetchmrbRefNumbers({ mmList: mmList })
      .then((mrbMatrixResult) => {
        that.poSearchData.forEach((item) => {
          /* checking MM in rule record */
          let result = mrbMatrixResult.filter((resp) => resp?.Sales_Issue_Item__r?.Name == item?.MM);
          if (item.selected && !item.mrbValidated) {
            let isdateValid = false;
            let mrbRefNumberDetails;
            //getting rule that has lowest priority
            if (result.length > 0 && result[0]?.Sales_Issue_MRB_Reference_Number__c?.toUpperCase() == item?.mrbnumber?.toUpperCase()) {
              mrbRefNumberDetails = result[0];
            }
            let endDate = mrbRefNumberDetails?.Sales_Issue_Valid_To__c ? mrbRefNumberDetails?.Sales_Issue_Valid_To__c : that.genericMessages?.Default_Sales_Issue_Valid_To_Value;
            if (mrbRefNumberDetails?.Sales_Issue_Valid_From__c <= todayDate && endDate >= todayDate) {
              isdateValid = true;
            }
            item.successText = mrbRefNumberDetails != undefined && isdateValid ? that.labels.Valid_MRB_Ref_Number : mrbRefNumberDetails != undefined && !isdateValid ? that.labels.R4C_MRB_Date_Expired : that.labels.Invalid_MRB_Ref_Number;
            item.errorText = item.successText;
            item.productStatus = mrbRefNumberDetails != undefined && isdateValid ? true : mrbRefNumberDetails != undefined && !isdateValid ? false : true;
            item.selected = item.productStatus;
            item.Error = mrbRefNumberDetails != undefined && isdateValid ? false : true;
            item.mrbValidated = !item.Error;
          }

        })
      })
      .catch(() => {
        that.showToast(that.labels.Error_Title, that.labels.Something_went_wrong_please_contact_super_user, "error", "dismissable");
      }).finally(() => {
        that.loading(false);
      });
  }
  if (that.genericMessages?.NCNR_Check == "true" && that.caseType.isExceptionService() && that.caseType.isNPRCredit()) {
    let productStatusNumericCodes = [];
    that.poSearchData.forEach((item) => {
      productStatusNumericCodes.push(item?.Data?.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c);
    })
    if (productStatusNumericCodes.length > 0) {
      console.log('Status Codes ', productStatusNumericCodes);
      let requestData = {
        Product_Status_code_c: productStatusNumericCodes
      }
      await getMatrixRecord({
        recordType: 'Sales_Issue_NCNR_Matrix',
        requestData: JSON.stringify(requestData)
      }).then((result) => {
        let ncnrMatrixResult = result;
        if (ncnrMatrixResult.length > 0) {
          that.poSearchData.forEach(item => {
            console.log('496', JSON.stringify(item))
            let record = ncnrMatrixResult.filter((resp) => resp?.Product_Status_Code__c == item?.Data?.Disti_Channel_Product_Statuses__r[0]?.Sales_Issue_Channel_StatusCode_Numeric__c &&
              resp?.Item_Custom_Indicator__c == item?.Data?.Item_Custom_Indicator__c &&
              resp?.NCNR_Flag__c == true);
            console.log('Filtered matrix ', record);
            if (record.length > 0 && item.selected == true) {
              item.productStatus = false;
              item.selected = false;
              item.Error = 'Material is non returnable';
            }
          })
        }
      }).catch((error) => {
        console.error(error);
        that.loading(false);
      });
    }
  }
  //If the selected line items are already validated in HANA , we will not check at hana api again
  if (!that.poSearchData.some((data) => data.selected == true && !data.poValidated)) {
    if (that.caseType.remedy == "NPR-Credit") {
      await checkNPRMatrix(that);
    }
    return;
  }
  let isIaoFlag = that?.genericMessages.isIaoFlag;//TWC4621-5161 -- added isIaoFlag for IAO conditions
  _BypassPOHistoryValidation(that);
  //POHistory Check
  let poHistoryResultwithVIZID = [];
  let poHistoryResultwithoutVIZID = [];
  let refreshPopUpUi = false;
  that.loading(true);
  await poHistoryCheck(that, that.poSearchData, reqDetails, that.caseType).then((response) => {
    poHistoryResultwithVIZID = response?.poHistoryResultwithVIZID || [];
    poHistoryResultwithoutVIZID = response?.poHistoryResultwithoutVIZID || [];
  })
    .catch((error) => {
      that.showToast(that.labels.Error_Title, that.labels.PO_history_check_failed, "error");
    })
    .finally(() => {
      that.loading(false);
    });
  await that.poSearchData.forEach((item) => {
    let poHistoryData = [];
    if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
      poHistoryData = poHistoryResultwithVIZID.filter((data) => {
        return (data.ItemId == item.MM && data?.DeliveryNoteNbr == item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0"));
      });
    } else {
      poHistoryData = poHistoryResultwithoutVIZID.filter((data) => {
        return (data.ItemId == item.MM && item.selected);
      })
    }
    if (isPsgCase && poHistoryData.length == 0) { //PSG -- TWC4621-3857
      if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
        poHistoryData = poHistoryResultwithVIZID.filter((data) => {
          return (data.ItemId == item.oldMM && data?.DeliveryNoteNbr == item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0"));
        });
      } else {
        poHistoryData = poHistoryResultwithoutVIZID.filter((data) => {
          return (data.ItemId == item.oldMM && item.selected);
        })
      }
    }
    //Needed in future
    //fetching latest PO number if we have multiple po's
    poHistoryData.sort((date1, date2) => {
      date1 = new Date(date1.CustomerBillingDocumentDt);
      date2 = new Date(date2.CustomerBillingDocumentDt);
      if (date1 < date2) return 1;
      return -1;
    });

    console.log('NCNR FLAG FROM PO ->', poHistoryData);
    if (isIaoFlag == 'true' && poHistoryData != undefined) { //TWC4621-5161 -- Ncnr Flag for Exception Intake
      poHistoryData.forEach(poresp => {
        if ((poresp?.NcnrFlag == 'X' || poresp?.NcnrFlag == 'Z')) {
          item.selected = false;
          item.productStatus = false;
          item.Error = true;
          item.errorText = 'Material is non returnable';
          item.isPoNumberEditable = false;
        }
      });
    }

    if ((item.selected || (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && item?.VisIdbagError)) && !item.poValidated) {

      //adding the hana response fields to the line item
      if (poHistoryData.length > 0 && poHistoryData !== undefined) {
        let popuplateStatus = popuplateLineItemPopupData(item, poHistoryData[0], isIaoFlag);
        refreshPopUpUi = popuplateStatus?.status;
        item = popuplateStatus?.item;
        item.poHistoryData = poHistoryData[0];
        item.isPoHistoryValid = true;
      } else {

        item.Error = true;
        item.errorText = that.genericMessages?.PO_History_not_found//'NO PO Found';
        item.isPoHistoryValid = false;
      }
      //CPN Check
      if (item.isCPNRequired && !item.customerItemNbr) {
        item.isPoHistoryValid = false;
        item.Error = true;
        item.errorText = r4cLabels.cpnRequiredErrorMsg;
      }
      //MM Check
      if (item.isMMRequired && !item.MM) {
        item.isPoHistoryValid = false;
        item.Error = true;
        item.errorText = r4cLabels.missingMMErrorMsg;
      }

      item.productStatus = item?.VisIdbagError ? false : item?.isPoHistoryValid;
      item.selected = item?.VisIdbagError ? false : item?.isPoHistoryValid;
      item.poValidated = true;
      //Start -- TWC4621-4002 -- set the staus as CPU_POH_Rejection for the failed line items if ult type is VISID
      if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID' && item.Error) {
        item.VisIdbagError = true;
        item.selected = false;
        item.lineitemStatus = that.genericMessages?.CPU_POH_Rejection;
      }
      //End -- TWC4621-4002 -- set the staus as CPU_POH_Rejection for the failed line items if ult type is VISID
    }
  })
  //refreshing popup data
  if (refreshPopUpUi) {
    invokeRefreshRowElement(that);
  }
  //PO change popup
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
      modelHeader: r4cLabels.poModelHeader,
      description: r4cLabels.poModelDescription,
      subDescription: r4cLabels.poModelSubDescription,
      columns: [
        { label: r4cLabels.mmModelExsitingMMName, fieldName: 'newMM' },
        { label: r4cLabels.poModelExsitingPOName, fieldName: 'oldPO' },
        { label: r4cLabels.poModelNewPOName, fieldName: 'newPO' },
      ],
      hideCancle: true,
      size: 'small',
    })
  }
  //NPR matrix check
  if (that.caseType.remedy === that.genericMessages?.Credit_NPR) {
    await checkNPRMatrix(that);
  }
  if ((that.caseType.isExceptionService() && reqDetails?.salesIssueReturnReason === that.genericMessages?.GRL_Exception)) {
    that.poSearchData = validatedEWItemsBasedonParent(that.poSearchData);
  }
}

///Next handlers
//Warrenty screen next handler
let warrentyScreenNextHandler = async (that) => {
  that.poSearchData.forEach((data) => {
    data.poValidated = data.CustomerPONumber && data.BillingDate && data?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID' ? true : false; // TWC4621-6310: don't bypass VisId, let it go through real POH
  });
  warrentyCheckNextHandler(that); //invoking technical intake function
};

//POhistory/Product validation screen next handler
let mrbRefNumberCheckNextHandler = (that) => {
  that.handleNextClick("step-4");
  that.backStage = "step-3";
  that.poSearchData.forEach((data, index) => {
    data.index = index + 1;
    data.display = data.selected;
    if (data.selected) {
      data.mrbDisabled = true;
    }
    if (!data.step4DisplayLock) {
      data.step3Data = true;
      data.step3DisplayLock = true;
    }
  });

  that.tecnincalIntakeButtons.showCreditPriceTable();
  if (that.isPortal == false || that.isPortal == 'false') {
    that.creditPriceCheck = that.poSearchData.some(item => (item?.price == 0 || +item?.YMS2Price == 0));
  }
  that.updateSelectAllCheckbox();
};

//Back handlers
//CreditPrice screen back handler
let backToMRBRefNumberScreenHandler = (that) => {
  that.handleNextClick("step-3");
  that.backStage = "step-2";
  that.poSearchData.forEach((data, index) => {
    if (data.mrbDisabled === true) {
      data.mrbDisabled = false;
    }
    data.index = index + 1;
    data.display = data.step3Data || data.selected;
  });
  that.tecnincalIntakeButtons.showPoHistoryTable();
  that.updateSelectAllCheckbox();
};
function _BypassPOHistoryValidation(that) { //TWC4621-4282 -- By pass PO history API if user already comples PO/SO search
  that.poSearchData = that.poSearchData.map((item) => {
    if (item?.CustomerPONumber && item?.BillingDate && !item?.warrantyCheck?.isMMChange
      && item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') { // TWC4621-6310: don't bypass VisId, let it go through real POH
      if ((item.selected && !item.poValidated) || (item.VisIdbagError == true)) {
        item.isPoHistoryValid = false;
        if (new Date(new Date().setFullYear(new Date().getFullYear() - (+that.genericMessages?.Po_Search_Date_Range))) <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= new Date()) {
          item.isPoHistoryValid = true;
        } else {
          item.Error = true;
          item.errorText = that.genericMessages?.PO_History_not_found;
        }
        item.productStatus = item.isPoHistoryValid;
        item.selected = item.isPoHistoryValid;
        item.poValidated = true;
      }
    }
    return item;
  })
}
// function _BypassPOHistoryValidation(that) { //TWC4621-4282 -- By pass PO history API if user already comples PO/SO search
//   that.poSearchData = that.poSearchData.map((item) => {
//     if (item?.CustomerPONumber && item?.BillingDate && !item?.warrantyCheck?.isMMChange) {
//       if ((item.selected && !item.poValidated) || (item.VisIdbagError == true)) {
//         item.isPoHistoryValid = false;
//         if (item?.warrantyResult?.ProdUniqueIdTypeCode != 'VISID') {
//           if (new Date(new Date().setFullYear(new Date().getFullYear() - (+that.genericMessages?.Po_Search_Date_Range))) <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= new Date()) {
//             item.isPoHistoryValid = true;
//           } else {
//             item.Error = true;
//             item.errorText = that.genericMessages?.PO_History_not_found;
//           }
//         } else if (item?.warrantyResult?.ProdUniqueIdTypeCode == 'VISID') {
//           if (new Date(new Date().setFullYear(new Date().getFullYear() - (+that.genericMessages?.Po_Search_Date_Range))) <= new Date(item?.BillingDate) && new Date(item?.BillingDate) <= new Date() && item?.warrantyResult?.DeliveryNoteNumber?.padStart(10, "0") == item?.deliveryNote?.padStart(10, "0")) {
//             item.isPoHistoryValid = true;
//           } else {
//             item.Error = true;
//             item.errorText = that.genericMessages?.PO_History_not_foundg;
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
export {
  validateMRB, mrbRefNumberCheckNextHandler, warrentyScreenNextHandler,
  backToMRBRefNumberScreenHandler, _BypassPOHistoryValidation
};