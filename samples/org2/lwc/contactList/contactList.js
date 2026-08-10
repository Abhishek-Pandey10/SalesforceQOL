import { LightningElement, wire, api } from 'lwc';
import getContacts from '@salesforce/apex/ContactController.getContacts';

export default class ContactList extends LightningElement {
    @api accountId;

    @wire(getContacts, { accountId: '$accountId' }) contacts;

    get contactCount() {
        return this.contacts?.data?.length ?? 0;
    }
}
