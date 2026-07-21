const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../../middleware/');
const {
  getPlans,
  getTopups,
  getSubscription,
  deleteSubscription,
  getInvoices,
  postCheckout,
  postTopupCheckout,
} = require('../../controllers/Billing');

router.get('/plans', requireJwtAuth, getPlans);
router.get('/topups', requireJwtAuth, getTopups);
router.get('/subscription', requireJwtAuth, getSubscription);
router.delete('/subscription', requireJwtAuth, deleteSubscription);
router.get('/invoices', requireJwtAuth, getInvoices);
router.post('/checkout', requireJwtAuth, postCheckout);
router.post('/topups/checkout', requireJwtAuth, postTopupCheckout);

module.exports = router;
