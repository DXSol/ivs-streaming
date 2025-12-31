function authMiddleware(req, res, next) {
  // Production: validate JWT (Cognito / custom) + enforce entitlements.
  // For now: allow unauthenticated access in dev unless REQUIRE_AUTH=true.

  const requireAuth = String(process.env.REQUIRE_AUTH || '').toLowerCase() === 'true';

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (requireAuth && !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Attach minimal user context.
  req.user = token ? { token } : null;
  return next();
}

module.exports = { authMiddleware };
