import { LightningElement, api } from 'lwc';

export default class AccountCard extends LightningElement {
    @api accountId;

    get hasAccount() {
        return !!this.accountId;
    }
}
