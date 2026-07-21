import { computeNextRenewalDate } from './renewal';

describe('computeNextRenewalDate', () => {
  it("advances a monthly subscription to next month when today is past this month's anniversary", () => {
    const startedAt = '2026-01-11T00:00:00Z';
    const now = new Date('2026-07-15T00:00:00Z');
    expect(computeNextRenewalDate(startedAt, 'monthly', now)).toEqual(
      new Date('2026-08-11T00:00:00Z'),
    );
  });

  it("keeps this month's anniversary when today is before it", () => {
    const startedAt = '2026-01-11T00:00:00Z';
    const now = new Date('2026-07-05T00:00:00Z');
    expect(computeNextRenewalDate(startedAt, 'monthly', now)).toEqual(
      new Date('2026-07-11T00:00:00Z'),
    );
  });

  it("advances an annual subscription to next year when today is past this year's anniversary", () => {
    const startedAt = '2025-08-11T00:00:00Z';
    const now = new Date('2026-07-15T00:00:00Z');
    expect(computeNextRenewalDate(startedAt, 'annual', now)).toEqual(
      new Date('2026-08-11T00:00:00Z'),
    );
  });

  it('returns null when startedAt is missing or interval is unrecognized', () => {
    expect(computeNextRenewalDate(undefined, 'monthly', new Date())).toBeNull();
    expect(computeNextRenewalDate('2026-01-11T00:00:00Z', undefined, new Date())).toBeNull();
  });
});
