/**
 * Subscription arithmetic for ShiPu WP.
 *
 * Pure functions only - no external I/O.
 * See firebase/schema.md for the renewal contract (idea.txt item 15).
 */

export const DAY_MS = 86_400_000;

export const PLAN_FREE = 'free';
export const PLAN_PRO = 'pro';

export const SUB_NONE = 'none';
export const SUB_ACTIVE = 'active';
export const SUB_EXPIRED = 'expired';

export const PAY_PENDING = 'pending';
export const PAY_VERIFIED = 'verified';
export const PAY_REJECTED = 'rejected';

export function nowMs(): number {
  return Date.now();
}

export function formatDate(epochMs?: number | null): string {
  if (!epochMs) return '-';
  const d = new Date(epochMs);
  return d.toISOString().split('T')[0];
}

/**
 * Return the new `expiresAt` after a verified purchase.
 *
 * Critical renewal rule:
 * An active subscription extends from its existing expiry, never from today,
 * so renewal never deletes days already paid for.
 * An expired (or absent) subscription restarts from now.
 */
export function computeNewExpiry(
  currentExpiresAt: number | null | undefined,
  durationDays: number,
  referenceMs?: number | null
): number {
  const reference = referenceMs ?? nowMs();
  const durationMs = Math.max(1, durationDays) * DAY_MS;
  const base = Math.max(reference, Number(currentExpiresAt || 0));
  return base + durationMs;
}

export interface EffectiveSubscription {
  plan: string;
  status: string;
  startedAt: number | null;
  expiresAt: number | null;
  daysRemaining: number;
  isPro: boolean;
  repliesLabel: string;
  expiresLabel: string;
}

/**
 * Derive the plan a user is actually entitled to right now.
 */
export function effectiveSubscription(
  plan?: string | null,
  subscription?: { status?: string; startedAt?: number | null; expiresAt?: number | null } | null,
  freeDailyReplies: number = 25,
  referenceMs?: number | null
): EffectiveSubscription {
  const reference = referenceMs ?? nowMs();
  const sub = subscription || {};
  const status = sub.status || SUB_NONE;
  const expiresAt = sub.expiresAt ?? null;

  if (plan !== PLAN_PRO || status !== SUB_ACTIVE) {
    return {
      plan: PLAN_FREE,
      status: plan === PLAN_FREE ? SUB_ACTIVE : status,
      startedAt: null,
      expiresAt: null,
      daysRemaining: freeDailyReplies,
      isPro: false,
      repliesLabel: '',
      expiresLabel: '-',
    };
  }

  // A pro entitlement whose expiry has passed is effectively free again
  if (!expiresAt || expiresAt <= reference) {
    return {
      plan: PLAN_FREE,
      status: SUB_EXPIRED,
      startedAt: sub.startedAt ?? null,
      expiresAt: expiresAt,
      daysRemaining: freeDailyReplies,
      isPro: false,
      repliesLabel: '',
      expiresLabel: formatDate(expiresAt),
    };
  }

  const remaining = expiresAt - reference;
  const daysRemaining = Math.max(0, Math.ceil(remaining / DAY_MS));

  return {
    plan: PLAN_PRO,
    status: SUB_ACTIVE,
    startedAt: sub.startedAt ?? null,
    expiresAt: expiresAt,
    daysRemaining,
    isPro: true,
    repliesLabel: 'UNLIMITED',
    expiresLabel: formatDate(expiresAt),
  };
}

/**
 * True when another AI reply is allowed right now (idea.txt item 25).
 * Pro is unlimited. Free must have budget for all replies in batch.
 */
export function quotaRemaining(
  subscription: EffectiveSubscription,
  repliesUsed: number,
  freeDailyReplies: number = 25,
  repliesNeeded: number = 1
): boolean {
  if (subscription.isPro) {
    return true;
  }
  return Math.max(0, freeDailyReplies - repliesUsed) >= repliesNeeded;
}
