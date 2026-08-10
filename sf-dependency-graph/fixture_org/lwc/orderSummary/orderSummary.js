import { LightningElement, api } from 'lwc';
import getAccountDetail from '@salesforce/apex/AccountController.getAccountDetail';

export default class OrderSummary extends LightningElement {
    @api orderId;
}
