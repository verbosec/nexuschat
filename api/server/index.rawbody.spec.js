const express = require('express');
const request = require('supertest');

describe('raw body capture for webhook signature verification', () => {
  it('exposes req.rawBody as a Buffer matching the exact request bytes, alongside parsed req.body', async () => {
    const app = express();
    app.use(
      express.json({
        limit: '3mb',
        verify: (req, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.post('/echo', (req, res) => {
      res.json({ bodyType: typeof req.body, rawBodyIsBuffer: Buffer.isBuffer(req.rawBody) });
    });

    const payload = { webhook: { webhook_type: 'subscription.started' } };
    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(response.body).toEqual({ bodyType: 'object', rawBodyIsBuffer: true });
  });
});
