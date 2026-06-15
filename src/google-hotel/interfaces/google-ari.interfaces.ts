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

export interface LiveQueryRequest {
  hotelCode: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
}

export interface LiveQueryResponse {
  hotelCode: string;
  checkIn: string;
  checkOut: string;
  options: {
    roomTypeCode: string;
    ratePlanCode: string;
    totalAmountAfterTax: number;
    available: boolean;
  }[];
}
