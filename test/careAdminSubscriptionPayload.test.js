const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCreatePayload,
  validateSubscriptionPeriodPayload,
  parseSubscriptionDateRange,
} = require('../lib/careAdminSubscriptionPayload');

function validBody(overrides = {}) {
  return {
    organisationName: 'Acme',
    emailDomain: 'acme.com',
    initialAdminEmail: 'admin@acme.com',
    planTier: 'silver',
    seatLimit: '10',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    amount: '99.5',
    ...overrides,
  };
}

describe('careAdminSubscriptionPayload', () => {
  describe('validateCreatePayload', () => {
    it('returns seatLimit, amount, and parsed dates for a valid body', () => {
      const out = validateCreatePayload(validBody());
      assert.equal(out.seatLimit, 10);
      assert.equal(out.amount, 99.5);
      assert.ok(out.startDate instanceof Date);
      assert.ok(out.endDate instanceof Date);
      assert.ok(out.endDate >= out.startDate);
    });

    it('accepts gold plan', () => {
      const out = validateCreatePayload(validBody({ planTier: 'gold' }));
      assert.equal(out.seatLimit, 10);
    });

    it('rejects missing required fields', () => {
      assert.throws(() => validateCreatePayload(validBody({ organisationName: '' })), {
        message: /Missing required field: organisationName/,
      });
    });

    it('rejects invalid planTier', () => {
      assert.throws(() => validateCreatePayload(validBody({ planTier: 'platinum' })), {
        message: /planTier must be silver or gold/,
      });
    });

    it('rejects non-positive seatLimit', () => {
      assert.throws(() => validateCreatePayload(validBody({ seatLimit: '0' })), {
        message: /seatLimit must be a positive integer/,
      });
      assert.throws(() => validateCreatePayload(validBody({ seatLimit: 'x' })), {
        message: /seatLimit must be a positive integer/,
      });
    });

    it('rejects negative amount', () => {
      assert.throws(() => validateCreatePayload(validBody({ amount: '-1' })), {
        message: /amount must be a non-negative number/,
      });
    });

    it('rejects endDate before startDate', () => {
      assert.throws(
        () =>
          validateCreatePayload(
            validBody({ startDate: '2025-12-31', endDate: '2025-01-01' })
          ),
        { message: /endDate must be on or after startDate/ }
      );
    });
  });

  describe('validateSubscriptionPeriodPayload', () => {
    it('returns parsed values for renewal body (no org name/domain)', () => {
      const out = validateSubscriptionPeriodPayload({
        planTier: 'gold',
        seatLimit: '5',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        amount: '0',
      });
      assert.equal(out.seatLimit, 5);
      assert.equal(out.amount, 0);
    });

    it('rejects missing planTier', () => {
      assert.throws(
        () =>
          validateSubscriptionPeriodPayload({
            seatLimit: '5',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            amount: '0',
          }),
        { message: /Missing required field: planTier/ }
      );
    });
  });

  describe('parseSubscriptionDateRange', () => {
    it('uses UTC start of day and end of day', () => {
      const { startDate, endDate } = parseSubscriptionDateRange({
        startDate: '2025-06-15',
        endDate: '2025-06-15',
      });
      assert.equal(startDate.toISOString(), '2025-06-15T00:00:00.000Z');
      assert.equal(endDate.toISOString(), '2025-06-15T23:59:59.999Z');
    });
  });
});
