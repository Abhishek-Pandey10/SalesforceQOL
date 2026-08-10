import { LightningElement, api } from 'lwc';
import getContacts from '@salesforce/apex/ContactController.getContacts';

export default class ContactList extends LightningElement {
    @api accountId;
    contacts;

    connectedCallback() {
        getContacts({ accountId: this.accountId })
            .then((data) => { this.contacts = data; })
            .catch((error) => { console.error(error); });
    }
}
