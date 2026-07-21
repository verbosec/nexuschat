describe('billing config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reads LAGO_API_URL, LAGO_API_KEY, LAGO_WEBHOOK_SECRET from env', () => {
    process.env.LAGO_API_URL = 'http://lago.internal:3000';
    process.env.LAGO_API_KEY = 'test-key';
    process.env.LAGO_WEBHOOK_SECRET = 'test-secret';
    const { getBillingConfig } = require('./config');

    expect(getBillingConfig()).toEqual({
      apiUrl: 'http://lago.internal:3000',
      apiKey: 'test-key',
      webhookSecret: 'test-secret',
    });
  });

  it('returns null (does not throw) when required env vars are missing, so billing is gracefully optional', () => {
    delete process.env.LAGO_API_URL;
    delete process.env.LAGO_API_KEY;
    delete process.env.LAGO_WEBHOOK_SECRET;
    const { getBillingConfig } = require('./config');

    expect(getBillingConfig()).toBeNull();
  });

  it('returns null when only some of the required env vars are set', () => {
    process.env.LAGO_API_URL = 'http://lago.internal:3000';
    delete process.env.LAGO_API_KEY;
    delete process.env.LAGO_WEBHOOK_SECRET;
    const { getBillingConfig } = require('./config');

    expect(getBillingConfig()).toBeNull();
  });
});
