import { LightningElement, api } from 'lwc';

export default class DashboardTile extends LightningElement {
    @api metricLabel;
    @api metricValue;
}
