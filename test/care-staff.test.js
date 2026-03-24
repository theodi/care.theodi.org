const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCareStaffEmail, ensureCareStaff } = require('../middleware/careStaff');

describe('careStaff', () => {
  describe('isCareStaffEmail', () => {
    it('accepts theodi.org addresses case-insensitively on host', () => {
      assert.equal(isCareStaffEmail('a@theodi.org'), true);
      assert.equal(isCareStaffEmail('x@THEODI.ORG'), true);
    });

    it('rejects other domains and invalid input', () => {
      assert.equal(isCareStaffEmail('a@example.com'), false);
      assert.equal(isCareStaffEmail('not-an-email'), false);
      assert.equal(isCareStaffEmail(''), false);
      assert.equal(isCareStaffEmail(null), false);
    });

    it('does not treat subdomains as staff', () => {
      assert.equal(isCareStaffEmail('a@mail.theodi.org'), false);
    });
  });

  describe('ensureCareStaff', () => {
    it('calls next() when user is @theodi.org', () => {
      const req = {
        session: { passport: { user: { email: 'staff@theodi.org' } } },
      };
      let called = false;
      ensureCareStaff(req, {}, (err) => {
        called = true;
        assert.equal(err, undefined);
      });
      assert.equal(called, true);
    });

    it('passes 403 error when user is wrong domain', () => {
      const req = { session: { passport: { user: { email: 'x@example.com' } } } };
      let called = false;
      ensureCareStaff(req, {}, (err) => {
        called = true;
        assert.ok(err);
        assert.equal(err.status, 403);
      });
      assert.equal(called, true);
    });
  });
});
