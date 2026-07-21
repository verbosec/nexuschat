import { logger } from '@librechat/data-schemas';

export interface CuratedPlan {
  code: string;
  tier: string;
  interval: 'monthly' | 'annual';
  tokenCredits: number;
  features?: string[];
}

export interface CuratedAddOn {
  code: string;
  tokenCredits: number;
}

/**
 * `LAGO_PLANS_CONFIG` / `LAGO_ADDONS_CONFIG` are the single source of truth for
 * which Lago plans/add-ons are curated for display and how many token credits
 * each grants. This replaces the hardcoded lookup tables that used to live
 * directly in BillingWebhooks.js. Malformed or unset config degrades to an
 * empty list rather than throwing, so a misconfigured deployment shows no
 * plans instead of crashing (mirrors getBillingConfig's optional-feature
 * pattern elsewhere in this module).
 */
export function getCuratedPlans(): CuratedPlan[] {
  const raw = process.env.LAGO_PLANS_CONFIG;
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as CuratedPlan[];
  } catch (error) {
    logger.error('[plans-config] Failed to parse LAGO_PLANS_CONFIG', error);
    return [];
  }
}

export function getCuratedAddOns(): CuratedAddOn[] {
  const raw = process.env.LAGO_ADDONS_CONFIG;
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as CuratedAddOn[];
  } catch (error) {
    logger.error('[plans-config] Failed to parse LAGO_ADDONS_CONFIG', error);
    return [];
  }
}
