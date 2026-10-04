import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const secret = process.env.JWT_SECRET;
if (!secret || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET exige pelo menos 32 bytes');
const options = { issuer: 'alfa-gestao', audience: 'alfa-api' };
const claims = z.object({ sub: z.string().uuid(), school_id: z.string().uuid() });
export function issueToken(user) {
  return jwt.sign({ sub: user.id, school_id: user.school_id, role: user.role }, secret,
    { ...options, algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}
export function verifyToken(token) {
  return claims.parse(jwt.verify(token, secret, { ...options, algorithms: ['HS256'] }));
}
