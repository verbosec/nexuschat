import axios, { AxiosInstance } from 'axios';
import { logger } from '@librechat/data-schemas';
import type { BillingConfig } from './config';
import type {
  LagoCustomer,
  LagoPlan,
  LagoSubscription,
  LagoAddOn,
  LagoCheckoutSession,
  LagoInvoice,
  SendUsageEventInput,
} from './types';

export interface LagoClient {
  createCustomer(input: { externalId: string; name: string }): Promise<LagoCustomer>;
  getPlan(code: string): Promise<LagoPlan>;
  listPlans(): Promise<LagoPlan[]>;
  createSubscription(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoSubscription>;
  sendUsageEvent(input: SendUsageEventInput): Promise<void>;
  listAddOns(): Promise<LagoAddOn[]>;
  createCheckoutSession(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoCheckoutSession>;
  createAddOnCheckoutSession(input: {
    externalCustomerId: string;
    addOnCode: string;
  }): Promise<LagoCheckoutSession>;
  getActiveSubscription(
    externalCustomerId: string,
  ): Promise<{ planCode: string; externalId: string; startedAt: string } | null>;
  terminateSubscription(externalId: string): Promise<void>;
  listInvoices(externalCustomerId: string): Promise<LagoInvoice[]>;
}

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    return data?.message ?? data?.error ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createLagoClient(config: BillingConfig): LagoClient {
  const http: AxiosInstance = axios.create({
    baseURL: config.apiUrl,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    // Confirmed against the real self-hosted instance: checkout_url generation
    // calls out to Stripe synchronously and can take upwards of 15-20s, well
    // past a typical 10s API timeout.
    timeout: 30_000,
  });

  async function createCustomer(input: {
    externalId: string;
    name: string;
  }): Promise<LagoCustomer> {
    try {
      const { data } = await http.post('/api/v1/customers', {
        customer: {
          external_id: input.externalId,
          name: input.name,
          // Links the customer to the org's configured Stripe integration.
          // All three fields are required — confirmed against the real API:
          // without sync_with_provider: true, Lago accepts payment_provider
          // and payment_provider_code but silently leaves
          // billing_configuration.payment_provider null, and checkout_url
          // generation fails with "no_linked_payment_provider".
          ...(config.stripeProviderCode
            ? {
                billing_configuration: {
                  payment_provider: 'stripe',
                  payment_provider_code: config.stripeProviderCode,
                  sync_with_provider: true,
                },
              }
            : {}),
        },
      });
      return { lagoId: data.customer.lago_id, externalId: data.customer.external_id };
    } catch (error) {
      logger.error('[lago-client] createCustomer failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function getPlan(code: string): Promise<LagoPlan> {
    try {
      const { data } = await http.get(`/api/v1/plans/${code}`);
      return {
        code: data.plan.code,
        name: data.plan.name,
        amountCents: data.plan.amount_cents,
        amountCurrency: data.plan.amount_currency,
      };
    } catch (error) {
      logger.error(`[lago-client] getPlan(${code}) failed`, error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function listPlans(): Promise<LagoPlan[]> {
    try {
      const { data } = await http.get('/api/v1/plans');
      return (data.plans ?? []).map(
        (plan: { code: string; name: string; amount_cents: number; amount_currency: string }) => ({
          code: plan.code,
          name: plan.name,
          amountCents: plan.amount_cents,
          amountCurrency: plan.amount_currency,
        }),
      );
    } catch (error) {
      logger.error('[lago-client] listPlans failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function createSubscription(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoSubscription> {
    try {
      const { data } = await http.post('/api/v1/subscriptions', {
        subscription: { external_customer_id: input.externalCustomerId, plan_code: input.planCode },
      });
      return {
        lagoId: data.subscription.lago_id,
        externalCustomerId: data.subscription.external_customer_id,
        planCode: data.subscription.plan_code,
        status: data.subscription.status,
      };
    } catch (error) {
      logger.error('[lago-client] createSubscription failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function sendUsageEvent(input: SendUsageEventInput): Promise<void> {
    try {
      await http.post('/api/v1/events', {
        event: {
          transaction_id: input.transactionId,
          external_customer_id: input.externalCustomerId,
          code: input.billableMetricCode,
          properties: input.properties,
        },
      });
    } catch (error) {
      logger.error('[lago-client] sendUsageEvent failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function listAddOns(): Promise<LagoAddOn[]> {
    try {
      const { data } = await http.get('/api/v1/add_ons');
      return (data.add_ons ?? []).map(
        (addOn: { code: string; name: string; amount_cents: number; amount_currency: string }) => ({
          code: addOn.code,
          name: addOn.name,
          amountCents: addOn.amount_cents,
          amountCurrency: addOn.amount_currency,
        }),
      );
    } catch (error) {
      logger.error('[lago-client] listAddOns failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function createCheckoutSession(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoCheckoutSession> {
    try {
      const { data } = await http.post(`/api/v1/customers/${input.externalCustomerId}/checkout_url`, {
        plan_code: input.planCode,
      });
      return { url: data.customer.checkout_url };
    } catch (error) {
      logger.error('[lago-client] createCheckoutSession failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function createAddOnCheckoutSession(input: {
    externalCustomerId: string;
    addOnCode: string;
  }): Promise<LagoCheckoutSession> {
    try {
      const { data } = await http.post(`/api/v1/customers/${input.externalCustomerId}/checkout_url`, {
        add_on_code: input.addOnCode,
      });
      return { url: data.customer.checkout_url };
    } catch (error) {
      logger.error('[lago-client] createAddOnCheckoutSession failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function getActiveSubscription(
    externalCustomerId: string,
  ): Promise<{ planCode: string; externalId: string; startedAt: string } | null> {
    try {
      const { data } = await http.get('/api/v1/subscriptions', {
        params: { external_customer_id: externalCustomerId, 'status[]': 'active' },
      });
      const subscription = data.subscriptions?.[0];
      return subscription
        ? {
            planCode: subscription.plan_code,
            externalId: subscription.external_id,
            startedAt: subscription.started_at,
          }
        : null;
    } catch (error) {
      logger.error('[lago-client] getActiveSubscription failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function terminateSubscription(externalId: string): Promise<void> {
    try {
      await http.delete(`/api/v1/subscriptions/${externalId}`);
    } catch (error) {
      logger.error('[lago-client] terminateSubscription failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function listInvoices(externalCustomerId: string): Promise<LagoInvoice[]> {
    try {
      const { data } = await http.get('/api/v1/invoices', {
        params: { external_customer_id: externalCustomerId },
      });
      return (data.invoices ?? []).map(
        (invoice: {
          lago_id: string;
          issuing_date: string;
          total_amount_cents: number;
          currency: string;
          status: string;
          payment_status: string;
          file_url: string;
        }) => ({
          id: invoice.lago_id,
          issuingDate: invoice.issuing_date,
          totalCents: invoice.total_amount_cents,
          currency: invoice.currency,
          status: invoice.status,
          paymentStatus: invoice.payment_status,
          fileUrl: invoice.file_url,
        }),
      );
    } catch (error) {
      logger.error('[lago-client] listInvoices failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  return {
    createCustomer,
    getPlan,
    listPlans,
    createSubscription,
    sendUsageEvent,
    listAddOns,
    createCheckoutSession,
    createAddOnCheckoutSession,
    getActiveSubscription,
    terminateSubscription,
    listInvoices,
  };
}
