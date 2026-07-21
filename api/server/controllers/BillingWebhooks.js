const { logger } = require('@librechat/data-schemas');
const {
  getBillingConfig,
  verifyWebhookSignature,
  handleLagoWebhook,
  getCuratedPlans,
  getCuratedAddOns,
} = require('@librechat/api');
const { findUser, upsertBalanceFields, findBalanceByUser } = require('~/models');

const billingConfig = getBillingConfig();

async function postLagoWebhook(req, res) {
  if (!billingConfig) {
    return res.status(503).json({ error: 'Billing is not configured for this deployment' });
  }

  const signature = req.headers['x-lago-signature'];
  const rawBody = req.rawBody?.toString('utf8') ?? '';

  if (!verifyWebhookSignature(rawBody, signature, billingConfig.webhookSecret)) {
    logger.warn('[BillingWebhooks] Rejected webhook with invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    await handleLagoWebhook(req.body, {
      findUserByOpenidId: (openidId) => findUser({ openidId }),
      upsertBalanceFields,
      getPlanCreditsAllowance: (planCode) => {
        const match = getCuratedPlans().find((plan) => plan.code === planCode);
        return match?.tokenCredits ?? 0;
      },
      getAddOnCreditsValue: (addOnCode) => {
        const match = getCuratedAddOns().find((addOn) => addOn.code === addOnCode);
        return match?.tokenCredits ?? 0;
      },
      getCurrentTokenCredits: async (userId) => {
        const balance = await findBalanceByUser(userId);
        return balance?.tokenCredits ?? 0;
      },
    });
    res.sendStatus(200);
  } catch (error) {
    logger.error('[BillingWebhooks] Failed to process webhook', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { postLagoWebhook };
