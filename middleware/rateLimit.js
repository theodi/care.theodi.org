const rateLimit = require('express-rate-limit');

function createLimiter({ windowMs, max, message, skip }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message },
    ...(skip ? { skip } : {}),
  });
}

/** Progress polls under /assistant. These must not consume the AI request budget. */
function isAssistantStatusPoll(req) {
  if (!req || req.method !== 'GET') return false;
  const path = typeof req.path === 'string' ? req.path : '';
  return /\/status\/[^/]+$/.test(path);
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
  skip: isAssistantStatusPoll,
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
  isAssistantStatusPoll,
};
