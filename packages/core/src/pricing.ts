import type { Pricing } from "./manifest.js";

/** 1 credit == $0.001 (a tenth of a US cent). Integer credits everywhere. */
export const CREDIT_USD = 0.001;

export function creditsToUsd(credits: number): number {
  return Math.round(credits * CREDIT_USD * 100) / 100;
}

export function usdToCredits(usd: number): number {
  return Math.round(usd / CREDIT_USD);
}

/** Price of a single successful call for the given pricing model, in credits. */
export function callPriceCredits(pricing: Pricing): number {
  return pricing.model === "free" ? 0 : pricing.priceCredits;
}
