// middleware/auth.js
import jwt from 'jsonwebtoken';

/**
 * Extracts and verifies JWT, attaches payload to req.user
 */
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Role gate with superadmin bypass
 */
export function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'superadmin') return next();
    if (!allowed.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/**
 * Scope helpers to enforce organization/owner/tenant context
 */
export function requireOrgScope(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  if (!req.user.organization_id) return res.status(403).json({ error: 'No organization scope' });
  next();
}

export function requireOwnerScope(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  if (!req.user.organization_id || !req.user.owner_id) {
    return res.status(403).json({ error: 'No owner scope' });
  }
  next();
}

export function requireTenantScope(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  if (!req.user.organization_id || !req.user.owner_id || !req.user.tenant_id) {
    return res.status(403).json({ error: 'No tenant scope' });
  }
  next();
}
