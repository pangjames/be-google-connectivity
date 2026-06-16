export interface SyncDateRangeOptions {
  hotelCode: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface AriPayload {
  hotelCode: string;
  xmlPayload: string;
  type: 'Transaction' | 'RateAmount' | 'Availability' | 'Inventory';
}
