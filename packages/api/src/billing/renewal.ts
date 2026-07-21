export function computeNextRenewalDate(
  startedAt: string | undefined,
  interval: 'monthly' | 'annual' | undefined,
  now: Date,
): Date | null {
  if (!startedAt || !interval) {
    return null;
  }

  const started = new Date(startedAt);
  const candidate = new Date(started);
  const step = interval === 'monthly' ? 1 : 12;

  while (candidate.getTime() <= now.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + step);
  }

  return candidate;
}
