export interface BillingConfig {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
  /**
   * The `code` of the Stripe integration configured in the Lago dashboard
   * (Settings > Integrations > Stripe). Confirmed against the real API:
   * without this, new customers are created with `billing_configuration
   * .payment_provider` left null even when `payment_provider: 'stripe'` is
   * sent, and checkout_url generation fails with "no_linked_payment_provider".
   * Optional here since usage-reporting/webhooks don't need it — only
   * checkout does, and createCustomer omits the field entirely if unset.
   */
  stripeProviderCode?: string;
}

/**
 * Billing (Lago) is an optional feature — most deployments won't have
 * LAGO_* env vars set, and that must not prevent the server from starting
 * or any other part of the app from working (mirrors how RAG_API_URL is
 * treated as optional elsewhere in this codebase). Returns null rather than
 * throwing so every call site can gracefully no-op when billing isn't
 * configured for this deployment.
 */
export function getBillingConfig(): BillingConfig | null {
  const apiUrl = process.env.LAGO_API_URL;
  const apiKey = process.env.LAGO_API_KEY;
  const webhookSecret = process.env.LAGO_WEBHOOK_SECRET;

  if (!apiUrl || !apiKey || !webhookSecret) {
    return null;
  }

  return { apiUrl, apiKey, webhookSecret, stripeProviderCode: process.env.LAGO_STRIPE_PROVIDER_CODE };
}
