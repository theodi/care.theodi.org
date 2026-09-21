/**
 * Validates POST /subscriptions bodies. Pure logic — unit-test friendly.
 */

function parseSubscriptionDateRange(body) {
  const startDate = new Date(`${body.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${body.endDate}T23:59:59.999Z`);
  return { startDate, endDate };
}

function validateCreatePayload(body) {
  const required = [
    'organisationName',
    'emailDomain',
    'initialAdminEmail',
    'planTier',
    'seatLimit',
    'startDate',
    'endDate',
    'amount',
  ];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      const err = new Error(`Missing required field: ${k}`);
      err.status = 400;
      throw err;
    }
  }
  if (!['silver', 'gold'].includes(body.planTier)) {
    const err = new Error('planTier must be silver or gold');
    err.status = 400;
    throw err;
  }
  const seatLimit = parseInt(body.seatLimit, 10);
  if (Number.isNaN(seatLimit) || seatLimit < 1) {
    const err = new Error('seatLimit must be a positive integer');
    err.status = 400;
    throw err;
  }
  const amount = Number(body.amount);
  if (Number.isNaN(amount) || amount < 0) {
    const err = new Error('amount must be a non-negative number');
    err.status = 400;
    throw err;
  }
  const { startDate, endDate } = parseSubscriptionDateRange(body);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    const err = new Error('Invalid startDate or endDate');
    err.status = 400;
    throw err;
  }
  if (endDate < startDate) {
    const err = new Error('endDate must be on or after startDate');
    err.status = 400;
    throw err;
  }
  return { seatLimit, amount, startDate, endDate };
}

/** New subscription period on an existing tenant (renewal / add period). */
function validateSubscriptionPeriodPayload(body) {
  const required = ['planTier', 'seatLimit', 'startDate', 'endDate', 'amount'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      const err = new Error(`Missing required field: ${k}`);
      err.status = 400;
      throw err;
    }
  }
  if (!['silver', 'gold'].includes(body.planTier)) {
    const err = new Error('planTier must be silver or gold');
    err.status = 400;
    throw err;
  }
  const seatLimit = parseInt(body.seatLimit, 10);
  if (Number.isNaN(seatLimit) || seatLimit < 1) {
    const err = new Error('seatLimit must be a positive integer');
    err.status = 400;
    throw err;
  }
  const amount = Number(body.amount);
  if (Number.isNaN(amount) || amount < 0) {
    const err = new Error('amount must be a non-negative number');
    err.status = 400;
    throw err;
  }
  const { startDate, endDate } = parseSubscriptionDateRange(body);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    const err = new Error('Invalid startDate or endDate');
    err.status = 400;
    throw err;
  }
  if (endDate < startDate) {
    const err = new Error('endDate must be on or after startDate');
    err.status = 400;
    throw err;
  }
  return { seatLimit, amount, startDate, endDate };
}

module.exports = {
  parseSubscriptionDateRange,
  validateCreatePayload,
  validateSubscriptionPeriodPayload,
};
