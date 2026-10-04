import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { unauthorized } from '../../shared/errors.js';

// Audiências separadas: um token do portal do responsável nunca é aceito
// nas rotas da equipe escolar, e vice-versa.
const STAFF_AUDIENCE = 'alfa:staff';
const PORTAL_AUDIENCE = 'alfa:portal';
const ISSUER = 'alfa-gestao-escolar';

type TokenPayload = { sub: string; school_id: string };

function sign(payload: TokenPayload & Record<string, unknown>, audience: string, expiresIn: string) {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    audience,
    issuer: ISSUER,
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

function verify(token: string, audience: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience,
      issuer: ISSUER,
    });

    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string' || typeof decoded.school_id !== 'string') {
      throw unauthorized();
    }

    return { sub: decoded.sub, school_id: decoded.school_id };
  } catch {
    throw unauthorized();
  }
}

export const signStaffToken = (payload: TokenPayload & { role: string }) =>
  sign(payload, STAFF_AUDIENCE, env.JWT_EXPIRES_IN);
export const verifyStaffToken = (token: string) => verify(token, STAFF_AUDIENCE);

export const signPortalToken = (payload: TokenPayload) =>
  sign(payload, PORTAL_AUDIENCE, env.PORTAL_JWT_EXPIRES_IN);
export const verifyPortalToken = (token: string) => verify(token, PORTAL_AUDIENCE);

export function extractBearer(header: string | undefined): string {
  const match = header?.match(/^Bearer ([^\s]+)$/);
  if (!match) throw unauthorized();
  return match[1];
}

export const generateOpaqueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
