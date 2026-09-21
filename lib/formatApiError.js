/**
 * Turn thrown errors into HTTP status + JSON body for API clients.
 * Logs full stack for unexpected errors.
 */

function duplicateKeyMessage(err) {
  const keys = err.keyPattern ? Object.keys(err.keyPattern) : [];
  if (keys.includes('emailLower') && (keys.includes('tenantId') || keys.includes('subscriptionId'))) {
    return 'That email is already a member of this organisation.';
  }
  if (keys.includes('subscriptionId') && keys.includes('userId')) {
    return (
      'Database still has an old unique index on subscriptionId + userId. ' +
      'New members use email, so every row without userId counts as the same key. ' +
      'Run: node scripts/fix-organisation-membership-indexes.cjs'
    );
  }
  if (keys.length) {
    return `A record already exists for: ${keys.join(', ')}.`;
  }
  return 'A record with those details already exists.';
}

function validationMessages(err) {
  if (!err.errors) return err.message;
  return Object.values(err.errors)
    .map((e) => e.message)
    .join('; ');
}

/**
 * @param {Error} err
 * @returns {{ statusCode: number, body: Record<string, unknown> }}
 */
function formatApiError(err) {
  if (err && err.status && typeof err.message === 'string') {
    return {
      statusCode: err.status,
      body: {
        message: err.message,
        ...(err.code ? { code: err.code } : {}),
      },
    };
  }

  if (err && err.name === 'ValidationError') {
    return {
      statusCode: 400,
      body: {
        message: validationMessages(err),
        code: 'VALIDATION_ERROR',
        fields: err.errors ? Object.keys(err.errors) : [],
      },
    };
  }

  if (err && err.name === 'CastError') {
    return {
      statusCode: 400,
      body: {
        message: `Invalid ${err.path || 'value'}: ${String(err.value)}`,
        code: 'CAST_ERROR',
      },
    };
  }

  if (err && err.code === 11000) {
    return {
      statusCode: 409,
      body: {
        message: duplicateKeyMessage(err),
        code: 'DUPLICATE_KEY',
      },
    };
  }

  const isProd = process.env.NODE_ENV === 'production';
  const body = {
    message: isProd
      ? 'Something went wrong. If this continues, contact support with the time of the request.'
      : err.message || 'Internal Server Error',
    code: 'INTERNAL_ERROR',
  };
  if (!isProd && err.stack) {
    body.stack = err.stack.split('\n').map((l) => l.trim());
  }
  return { statusCode: 500, body };
}

module.exports = { formatApiError };
