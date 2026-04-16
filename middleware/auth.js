function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  const accept = req.get('Accept') || '';
  if (accept.includes('application/json')) {
    const error = new Error('Unauthorized access');
    error.status = 401;
    return next(error);
  }
  // For browser flows, redirect to the home page where login is advertised.
  return res.redirect('/');
}

module.exports = {
  ensureAuthenticated,
};

