/**
 * Renewal / entitlement rules - TypeScript version of server/test_renewal.py.
 * Can be run via: npm run test:renewal
 */

import {
  DAY_MS,
  PLAN_FREE,
  PLAN_PRO,
  SUB_ACTIVE,
  SUB_EXPIRED,
  computeNewExpiry,
  effectiveSubscription,
  formatDate,
  quotaRemaining,
} from './subscription.ts';

const T = 1_700_000_000_000; // fixed reference so tests are deterministic
const FREE_LIMIT = 25;

function assert(condition: boolean, msg?: string) {
  if (!condition) {
    throw new Error(msg || 'Assertion failed');
  }
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${expected}, got ${actual}`);
  }
}

export function runTests(): { passed: number; failed: number } {
  const tests: [string, () => void][] = [
    [
      'test_renewal_from_nothing',
      () => {
        assertEqual(computeNewExpiry(null, 30, T), T + 30 * DAY_MS);
      },
    ],
    [
      'test_renewal_when_expired_restarts_from_now',
      () => {
        const past = T - 10 * DAY_MS;
        assertEqual(computeNewExpiry(past, 30, T), T + 30 * DAY_MS);
      },
    ],
    [
      'test_renewal_when_active_extends_from_expiry',
      () => {
        const future = T + 12 * DAY_MS;
        assertEqual(computeNewExpiry(future, 30, T), future + 30 * DAY_MS);
      },
    ],
    [
      'test_renewal_never_shortens_an_expiry',
      () => {
        const farFuture = T + 400 * DAY_MS;
        assert(computeNewExpiry(farFuture, 30, T) >= farFuture);
      },
    ],
    [
      'test_expired_subscription_is_effectively_free',
      () => {
        const result = effectiveSubscription(
          PLAN_PRO,
          { status: SUB_ACTIVE, expiresAt: T - DAY_MS },
          FREE_LIMIT,
          T
        );
        assertEqual(result.plan, PLAN_FREE);
        assertEqual(result.status, SUB_EXPIRED);
        assert(!result.isPro);
        assertEqual(result.daysRemaining, FREE_LIMIT);
      },
    ],
    [
      'test_active_subscription_is_pro_and_unlimited',
      () => {
        const result = effectiveSubscription(
          PLAN_PRO,
          { status: SUB_ACTIVE, expiresAt: T + 10 * DAY_MS },
          FREE_LIMIT,
          T
        );
        assert(result.isPro);
        assertEqual(result.daysRemaining, 10);
        assertEqual(result.repliesLabel, 'UNLIMITED');
      },
    ],
    [
      'test_plan_pro_without_active_status_is_free',
      () => {
        const result = effectiveSubscription(PLAN_PRO, { status: 'none' }, FREE_LIMIT, T);
        assertEqual(result.plan, PLAN_FREE);
        assert(!result.isPro);
      },
    ],
    [
      'test_free_quota_requires_full_batch',
      () => {
        const free = effectiveSubscription(PLAN_FREE, null, FREE_LIMIT, T);
        assert(quotaRemaining(free, 0, FREE_LIMIT, 3));
        assert(!quotaRemaining(free, 23, FREE_LIMIT, 3));
        assert(quotaRemaining(free, 24, FREE_LIMIT, 1));
      },
    ],
    [
      'test_pro_quota_is_unlimited',
      () => {
        const pro = effectiveSubscription(
          PLAN_PRO,
          { status: SUB_ACTIVE, expiresAt: T + DAY_MS },
          FREE_LIMIT,
          T
        );
        assert(quotaRemaining(pro, 99_999, FREE_LIMIT, 50));
      },
    ],
    [
      'test_date_formatting',
      () => {
        assertEqual(formatDate(null), '-');
        assertEqual(formatDate(T).length, 10);
      },
    ],
  ];

  let passed = 0;
  let failed = 0;

  for (const [name, fn] of tests) {
    try {
      fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  FAIL  ${name}: ${err.message}`);
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
  return { passed, failed };
}

if (process.argv[1]?.endsWith('test_renewal.ts')) {
  const result = runTests();
  if (result.failed > 0) {
    process.exit(1);
  }
}
