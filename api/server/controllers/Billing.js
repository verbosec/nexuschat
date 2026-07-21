const {
  getBillingConfig,
  createLagoClient,
  createProvisioning,
  createTopupCheckout,
  getCuratedPlans,
  getCuratedAddOns,
  computeNextRenewalDate,
} = require('@librechat/api');
const { findUser } = require('~/models');

const billingConfig = getBillingConfig();
const lagoClient = billingConfig ? createLagoClient(billingConfig) : null;
const provisioning = lagoClient ? createProvisioning({ lagoClient, findUser }) : null;
const topupCheckout = provisioning ? createTopupCheckout({ provisioning, lagoClient }) : null;

function requireBillingConfigured(res) {
  if (!lagoClient) {
    res.status(503).json({ error: 'Billing is not configured for this deployment' });
    return false;
  }
  return true;
}

async function getPlans(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const [lagoPlans, curated] = await Promise.all([lagoClient.listPlans(), getCuratedPlans()]);
  const lagoPlansByCode = new Map(lagoPlans.map((plan) => [plan.code, plan]));
  const plans = curated
    .map((entry) => {
      const lagoPlan = lagoPlansByCode.get(entry.code);
      if (!lagoPlan) {
        return null;
      }
      return {
        ...lagoPlan,
        tier: entry.tier,
        interval: entry.interval,
        tokenCredits: entry.tokenCredits,
        features: entry.features,
      };
    })
    .filter(Boolean);
  res.json(plans);
}

async function getTopups(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const [lagoAddOns, curated] = await Promise.all([lagoClient.listAddOns(), getCuratedAddOns()]);
  const lagoAddOnsByCode = new Map(lagoAddOns.map((addOn) => [addOn.code, addOn]));
  const topups = curated
    .map((entry) => {
      const lagoAddOn = lagoAddOnsByCode.get(entry.code);
      if (!lagoAddOn) {
        return null;
      }
      return { ...lagoAddOn, tokenCredits: entry.tokenCredits };
    })
    .filter(Boolean);
  res.json(topups);
}

async function getSubscription(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.json({ plan: 'free', interval: null, renewalDate: null });
  }
  const subscription = await lagoClient.getActiveSubscription(user.openidId);
  if (!subscription) {
    return res.json({ plan: 'free', interval: null, renewalDate: null });
  }
  const curatedPlan = getCuratedPlans().find((plan) => plan.code === subscription.planCode);
  const renewalDate = computeNextRenewalDate(
    subscription.startedAt,
    curatedPlan?.interval,
    new Date(),
  );
  res.json({
    plan: subscription.planCode,
    interval: curatedPlan?.interval ?? null,
    renewalDate: renewalDate ? renewalDate.toISOString() : null,
  });
}

async function deleteSubscription(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.status(404).json({ error: 'No active subscription to cancel' });
  }
  const subscription = await lagoClient.getActiveSubscription(user.openidId);
  if (!subscription) {
    return res.status(404).json({ error: 'No active subscription to cancel' });
  }
  await lagoClient.terminateSubscription(subscription.externalId);
  res.json({ success: true });
}

async function getInvoices(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.json([]);
  }
  const invoices = await lagoClient.listInvoices(user.openidId);
  res.json(invoices);
}

async function postCheckout(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const { planCode } = req.body ?? {};
  if (!planCode) {
    return res.status(400).json({ error: 'planCode is required' });
  }
  const externalCustomerId = await provisioning.ensureLagoCustomer(req.user.id);
  const session = await lagoClient.createCheckoutSession({ externalCustomerId, planCode });
  res.json({ url: session.url });
}

async function postTopupCheckout(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const { addOnCode } = req.body ?? {};
  if (!addOnCode) {
    return res.status(400).json({ error: 'addOnCode is required' });
  }
  const session = await topupCheckout.createTopupCheckoutSession(req.user.id, addOnCode);
  res.json({ url: session.url });
}

module.exports = {
  getPlans,
  getTopups,
  getSubscription,
  deleteSubscription,
  getInvoices,
  postCheckout,
  postTopupCheckout,
};
