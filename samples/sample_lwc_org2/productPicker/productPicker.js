import { LightningElement } from 'lwc';

export default class ProductPicker extends LightningElement {
    selected = null;

    handleChange(event) {
        this.selected = event.target.value;
    }
}
