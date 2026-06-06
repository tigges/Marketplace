/**
 * Revenue splits. The platform takes a fee between 5% and 10%; the remainder
 * is credited to the connector/agent creator's earnings balance. Payouts are
 * settled manually via Stripe Connect in the MVP.
 */

export const MIN_PLATFORM_FEE_BPS = 500; // 5%
export const MAX_PLATFORM_FEE_BPS = 1000; // 10%
export const DEFAULT_PLATFORM_FEE_BPS = 1000; // 10%

export interface RevenueSplit {
  /** Total charged to the caller, in credits. */
  grossCredits: number;
  /** Platform's cut, in credits. */
  platformFeeCredits: number;
  /** Creator's earnings, in credits. */
  creatorCredits: number;
  feeBps: number;
}

export function clampFeeBps(feeBps: number): number {
  return Math.min(MAX_PLATFORM_FEE_BPS, Math.max(MIN_PLATFORM_FEE_BPS, Math.round(feeBps)));
}

/**
 * Split `grossCredits` between platform and creator. The platform fee is
 * rounded up (favouring the platform on sub-credit fractions) and the creator
 * receives the exact remainder, so the two halves always sum to the gross.
 */
export function computeSplit(grossCredits: number, feeBps: number = DEFAULT_PLATFORM_FEE_BPS): RevenueSplit {
  const bps = clampFeeBps(feeBps);
  const platformFeeCredits = Math.ceil((grossCredits * bps) / 10_000);
  const creatorCredits = grossCredits - platformFeeCredits;
  return { grossCredits, platformFeeCredits, creatorCredits, feeBps: bps };
}
