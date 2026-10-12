import dotenv from "dotenv";
import {
  extractToken,
  verifyToken,
  normalizeUserContext,
} from "../../utils/jwtVerify.js";
dotenv.config();

/**
 * Middleware de autenticación estricta con verificación criptográfica RS256 (CRIT-01, CRIT-02)
 */
async function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      status: "Error",
      message: "No se proporcionó un token de acceso",
    });
  }

  try {
    const decoded = verifyToken(token);
    const user = normalizeUserContext(decoded);

    if (!user) {
      return res.status(401).json({
        status: "Error",
        message: "Token inválido: identificador de usuario no encontrado",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      status: "Error",
      message: "No se proporcionó un token de acceso válido",
    });
  }
}

/**
 * Control de acceso basado en roles (RBAC)
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status: "Error",
        message: "No tienes los privilegios necesarios para realizar esta acción",
      });
    }
    next();
  };
}

/**
 * Requiere rol administrador
 */
function requireAdmin(req, res, next) {
  return requireRole(["admin"])(req, res, next);
}

/**
 * Control de acceso basado en propiedad (ABAC / Anti-IDOR)
 */
function requireOwnership(getOwnerId) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: "Error",
        message: "No autenticado",
      });
    }

    if (req.user.role === "admin") {
      return next();
    }

    const targetOwnerId = String(getOwnerId(req) || "");
    const currentUserId = String(req.user.id || req.user.userId || "");

    if (!targetOwnerId || targetOwnerId !== currentUserId) {
      return res.status(403).json({
        status: "Error",
        message: "No tienes autorización para acceder a este recurso",
      });
    }

    next();
  };
}

export const utilsAuthentication = {
  authenticate,
  requireRole,
  requireAdmin,
  requireOwnership,
};

export default utilsAuthentication;
