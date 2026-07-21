export interface LagoCustomer {
  lagoId: string;
  externalId: string;
}

export interface LagoPlan {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
  tier?: string;
  interval?: 'monthly' | 'annual';
  tokenCredits?: number;
  features?: string[];
}

export interface LagoSubscription {
  lagoId: string;
  externalCustomerId: string;
  planCode: string;
  status: string;
}

export interface LagoAddOn {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
  tokenCredits?: number;
}

export interface LagoCheckoutSession {
  url: string;
}

export interface LagoInvoice {
  id: string;
  issuingDate: string;
  totalCents: number;
  currency: string;
  status: string;
  paymentStatus: string;
  fileUrl: string;
}

export interface SendUsageEventInput {
  transactionId: string;
  externalCustomerId: string;
  billableMetricCode: string;
  properties: Record<string, string>;
}
