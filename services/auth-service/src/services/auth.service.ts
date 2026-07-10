import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomUUID, randomInt } from 'crypto';
import { db } from '../db';
import { config } from '../config';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: number;
  user_id: number;
  jti: string;
  expires_at: Date;
  revoked_at: Date | null;
}

// ── Passwords ─────────────────────────────────────────────────────────────────

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// ── JWT ───────────────────────────────────────────────────────────────────────

export function generateAccessToken(userId: number): string {
  return jwt.sign(
    { sub: String(userId), type: 'access' },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function generateRefreshToken(userId: number): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign(
    { sub: String(userId), jti, type: 'refresh' },
    config.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  return { token, jti };
}

export function generateGuestToken(): string {
  const guestId = -(randomInt(1, 2 ** 31));
  return jwt.sign(
    { sub: String(guestId), type: 'guest' },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function verifyAccessToken(token: string): { userId: number } {
  const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; type: string };
  if (payload.type !== 'access') throw new Error('Invalid token type');
  return { userId: Number(payload.sub) };
}

export function verifyRefreshToken(token: string): { userId: number; jti: string } {
  const payload = jwt.verify(token, config.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as {
    sub: string;
    jti: string;
    type: string;
  };
  if (payload.type !== 'refresh') throw new Error('Invalid token type');
  return { userId: Number(payload.sub), jti: payload.jti };
}

// ── Database ──────────────────────────────────────────────────────────────────

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const { rows } = await db.query<User>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
    [email, passwordHash]
  );
  return rows[0];
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await db.query<User>(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<User | null> {
  const { rows } = await db.query<User>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function saveRefreshToken(
  userId: number,
  jti: string,
  expiresAt: Date
): Promise<void> {
  await db.query(
    'INSERT INTO refresh_tokens (user_id, jti, expires_at) VALUES ($1, $2, $3)',
    [userId, jti, expiresAt]
  );
}

export async function findRefreshToken(jti: string): Promise<RefreshTokenRow | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    'SELECT * FROM refresh_tokens WHERE jti = $1',
    [jti]
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = $1',
    [jti]
  );
}
