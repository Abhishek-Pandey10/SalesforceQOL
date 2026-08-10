import { LightningElement, wire } from 'lwc';
import getAccounts from '@salesforce/apex/AccountController.getAccounts';

export default class AccountCard extends LightningElement {
    @wire(getAccounts) accounts;
}
