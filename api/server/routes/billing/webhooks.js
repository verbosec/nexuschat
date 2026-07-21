const express = require('express');
const router = express.Router();
const { postLagoWebhook } = require('../../controllers/BillingWebhooks');

router.post('/lago', postLagoWebhook);

module.exports = router;
