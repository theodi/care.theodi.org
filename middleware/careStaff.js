function isCareStaffEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const host = email.split('@')[1];
  if (!host) return false;
  return host.toLowerCase() === 'theodi.org';
}

function ensureCareStaff(req, res, next) {
  const user = req.session.passport && req.session.passport.user;
  if (!user || !isCareStaffEmail(user.email)) {
    const error = new Error('Forbidden: CARE admin access is limited to @theodi.org accounts.');
    error.status = 403;
    return next(error);
  }
  next();
}

module.exports = { ensureCareStaff, isCareStaffEmail };
