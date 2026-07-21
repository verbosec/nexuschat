import { convertMarketedCreditsToTokenCredits } from './credit-conversion';

describe('convertMarketedCreditsToTokenCredits', () => {
  it('converts marketed credits to internal tokenCredits using the configured rate', () => {
    // Rate is fixed at 1 marketed credit = 200 tokenCredits (see credit-conversion.ts for rationale)
    expect(convertMarketedCreditsToTokenCredits(5000)).toBe(1_000_000);
    expect(convertMarketedCreditsToTokenCredits(0)).toBe(0);
  });
});
