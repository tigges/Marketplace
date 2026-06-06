import { creditsToUsd } from "@appbazaar/core";

export function priceLabel(model: string, priceCredits: number): string {
  if (model === "free" || priceCredits <= 0) return "Free";
  return `${priceCredits} credits / call (~$${creditsToUsd(priceCredits).toFixed(3)})`;
}

export function creditLabel(credits: number): string {
  return `${credits.toLocaleString()} credits (~$${creditsToUsd(credits).toFixed(2)})`;
}

export const routerUrl = process.env.NEXT_PUBLIC_ROUTER_URL ?? "http://localhost:8888";
