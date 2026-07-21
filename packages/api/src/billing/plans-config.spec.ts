import { getCuratedPlans, getCuratedAddOns } from './plans-config';

describe('getCuratedPlans', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('parses LAGO_PLANS_CONFIG into curated plan entries', () => {
    process.env.LAGO_PLANS_CONFIG = JSON.stringify([
      { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
      { code: 'nexus_premium_annual', tier: 'premium', interval: 'annual', tokenCredits: 5000 },
      { code: 'nexus_ultimate', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
      { code: 'nexus_ultimate_annual', tier: 'ultimate', interval: 'annual', tokenCredits: 30000 },
    ]);

    expect(getCuratedPlans()).toEqual([
      { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
      { code: 'nexus_premium_annual', tier: 'premium', interval: 'annual', tokenCredits: 5000 },
      { code: 'nexus_ultimate', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
      { code: 'nexus_ultimate_annual', tier: 'ultimate', interval: 'annual', tokenCredits: 30000 },
    ]);
  });

  it('parses per-plan feature bullets when provided', () => {
    process.env.LAGO_PLANS_CONFIG = JSON.stringify([
      {
        code: 'nexus_premium',
        tier: 'premium',
        interval: 'monthly',
        tokenCredits: 5000,
        features: ['Everything in Free', 'Higher usage limits'],
      },
    ]);

    expect(getCuratedPlans()).toEqual([
      {
        code: 'nexus_premium',
        tier: 'premium',
        interval: 'monthly',
        tokenCredits: 5000,
        features: ['Everything in Free', 'Higher usage limits'],
      },
    ]);
  });

  it('returns an empty array when LAGO_PLANS_CONFIG is unset', () => {
    delete process.env.LAGO_PLANS_CONFIG;
    expect(getCuratedPlans()).toEqual([]);
  });

  it('returns an empty array when LAGO_PLANS_CONFIG is invalid JSON', () => {
    process.env.LAGO_PLANS_CONFIG = 'not json';
    expect(getCuratedPlans()).toEqual([]);
  });
});

describe('getCuratedAddOns', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('parses LAGO_ADDONS_CONFIG into curated add-on entries', () => {
    process.env.LAGO_ADDONS_CONFIG = JSON.stringify([
      { code: 'starter', tokenCredits: 1000 },
      { code: 'growth', tokenCredits: 2500 },
      { code: 'power', tokenCredits: 7500 },
    ]);

    expect(getCuratedAddOns()).toEqual([
      { code: 'starter', tokenCredits: 1000 },
      { code: 'growth', tokenCredits: 2500 },
      { code: 'power', tokenCredits: 7500 },
    ]);
  });

  it('returns an empty array when LAGO_ADDONS_CONFIG is unset', () => {
    delete process.env.LAGO_ADDONS_CONFIG;
    expect(getCuratedAddOns()).toEqual([]);
  });
});
