const rateLimit = require('express-rate-limit');

function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message },
  });
}

const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many authentication attempts. Please try again later.',
});

const assistantLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Too many AI requests. Please try again later.',
});

const integrationApiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many integration API requests. Please try again later.',
});

module.exports = {
  authLimiter,
  assistantLimiter,
  integrationApiLimiter,
};
