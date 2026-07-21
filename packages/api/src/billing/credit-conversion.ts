/**
 * Marketed "credits" (pricing doc Sections 6-7) are a different unit from
 * LibreChat's internal `tokenCredits` (1,000 tokenCredits = $0.001 USD).
 * This fixed multiplier is the single place that conversion happens —
 * changing it must be a deliberate migration of existing balances, not a
 * live config flip (see spec's Error Handling section).
 */
const TOKEN_CREDITS_PER_MARKETED_CREDIT = 200;

export function convertMarketedCreditsToTokenCredits(marketedCredits: number): number {
  return marketedCredits * TOKEN_CREDITS_PER_MARKETED_CREDIT;
}
