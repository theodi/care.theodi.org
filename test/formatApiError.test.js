const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { formatApiError } = require('../lib/formatApiError');

describe('formatApiError', () => {
  it('uses status and message for operational errors', () => {
    const err = new Error('Not allowed');
    err.status = 403;
    const { statusCode, body } = formatApiError(err);
    assert.equal(statusCode, 403);
    assert.equal(body.message, 'Not allowed');
  });

  it('maps ValidationError to 400', () => {
    const err = new Error('Validation failed');
    err.name = 'ValidationError';
    err.errors = {
      email: { message: 'Email invalid' },
    };
    const { statusCode, body } = formatApiError(err);
    assert.equal(statusCode, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.ok(String(body.message).includes('Email invalid'));
    assert.deepEqual(body.fields, ['email']);
  });

  it('maps duplicate key on org membership to friendly text', () => {
    const err = new Error('E11000');
    err.code = 11000;
    err.keyPattern = { subscriptionId: 1, emailLower: 1 };
    const { statusCode, body } = formatApiError(err);
    assert.equal(statusCode, 409);
    assert.equal(body.code, 'DUPLICATE_KEY');
    assert.ok(String(body.message).includes('already'));
  });

  it('maps legacy subscriptionId+userId duplicate to fix-script hint', () => {
    const err = new Error('E11000');
    err.code = 11000;
    err.keyPattern = { subscriptionId: 1, userId: 1 };
    const { body } = formatApiError(err);
    assert.ok(String(body.message).includes('old unique index'));
    assert.ok(String(body.message).includes('fix-organisation-membership-indexes'));
  });

  describe('INTERNAL_ERROR in non-production', () => {
    let prev;
    before(() => {
      prev = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
    });
    after(() => {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    });

    it('includes message and stack lines for unknown errors', () => {
      const err = new Error('Something broke in Foo');
      const { statusCode, body } = formatApiError(err);
      assert.equal(statusCode, 500);
      assert.equal(body.code, 'INTERNAL_ERROR');
      assert.equal(body.message, 'Something broke in Foo');
      assert.ok(Array.isArray(body.stack));
    });
  });
});
