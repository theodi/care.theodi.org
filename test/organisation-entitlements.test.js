const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmailDomain,
  normalizeMemberEmail,
  emailMatchesDomain,
  isSubscriptionActive,
  subscriptionLifecycleStatus,
  dateRangesOverlap,
} = require('../lib/organisationEntitlements');

describe('organisationEntitlements', () => {
  describe('normalizeMemberEmail', () => {
    it('lowercases and trims full addresses', () => {
      assert.equal(normalizeMemberEmail('  User@Example.COM '), 'user@example.com');
    });
  });

  describe('normalizeEmailDomain', () => {
    it('trims, lowercases, and strips leading @', () => {
      assert.equal(normalizeEmailDomain(' @Example.COM '), 'example.com');
      assert.equal(normalizeEmailDomain('@acme.org'), 'acme.org');
    });

    it('returns empty string for missing input', () => {
      assert.equal(normalizeEmailDomain(''), '');
      assert.equal(normalizeEmailDomain(null), '');
    });
  });

  describe('emailMatchesDomain', () => {
    it('matches when host equals normalised domain', () => {
      assert.equal(emailMatchesDomain('User@Example.COM', 'example.com'), true);
      assert.equal(emailMatchesDomain('user@example.com', '@Example.COM'), true);
    });

    it('rejects wrong host', () => {
      assert.equal(emailMatchesDomain('user@gmail.com', 'example.com'), false);
    });

    it('rejects email without @', () => {
      assert.equal(emailMatchesDomain('notanemail', 'example.com'), false);
    });
  });

  describe('dateRangesOverlap', () => {
    it('returns true when ranges overlap', () => {
      assert.equal(
        dateRangesOverlap('2025-01-01', '2025-12-31', '2025-06-01', '2026-01-01'),
        true
      );
    });

    it('returns false when ranges are disjoint', () => {
      assert.equal(
        dateRangesOverlap('2025-01-01', '2025-03-31', '2025-04-01', '2025-12-31'),
        false
      );
    });

    it('returns true when ranges only touch on a boundary', () => {
      assert.equal(
        dateRangesOverlap('2025-01-01', '2025-06-30', '2025-06-30', '2025-12-31'),
        true
      );
    });
  });

  describe('isSubscriptionActive', () => {
    it('returns false when subscription object is incomplete', () => {
      assert.equal(isSubscriptionActive(null), false);
      assert.equal(isSubscriptionActive({}), false);
      assert.equal(isSubscriptionActive({ startDate: new Date() }), false);
    });

    it('returns true when now is between start and end', () => {
      const now = Date.now();
      const sub = {
        startDate: new Date(now - 86400000),
        endDate: new Date(now + 86400000),
      };
      assert.equal(isSubscriptionActive(sub), true);
      assert.equal(subscriptionLifecycleStatus(sub), 'active');
    });

    it('returns false when now is before start', () => {
      const now = Date.now();
      const sub = {
        startDate: new Date(now + 86400000),
        endDate: new Date(now + 2 * 86400000),
      };
      assert.equal(isSubscriptionActive(sub), false);
      assert.equal(subscriptionLifecycleStatus(sub), 'expired');
    });

    it('returns false when now is after end', () => {
      const now = Date.now();
      const sub = {
        startDate: new Date(now - 2 * 86400000),
        endDate: new Date(now - 86400000),
      };
      assert.equal(isSubscriptionActive(sub), false);
      assert.equal(subscriptionLifecycleStatus(sub), 'expired');
    });
  });
});
