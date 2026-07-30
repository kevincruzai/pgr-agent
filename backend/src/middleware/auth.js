import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(user, extraClaims = {}) {
  return jwt.sign(
    { id: user.id, name: user.name, document_number: user.document_number, role: user.role, unit_id: user.unit_id, ...extraClaims },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'No autenticado' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token inválido' });
  }
}

export function requireAdmin(req, res, next) {
  if (!['admin', 'jefe_uacp'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Acceso denegado' });
  }
  next();
}

/** Solo la cuenta de administrador general (no jefe_uacp). */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Solo el administrador general puede realizar esta acción' });
  }
  next();
}
