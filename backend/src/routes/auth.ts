import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { pool } from '../db/pool';
import { signAccessToken, verifyAccessToken } from '../auth/jwt';
import { sendPasswordResetEmail } from '../services/email.service';
import { env } from '../config/env';

const router = Router();

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(6),
});

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  email: z.string().email('Invalid email format').min(1, 'Email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  mobile: z.string().min(10, 'Mobile number must be at least 10 digits').max(20, 'Mobile number is too long'),
  country: z.string().max(50).optional().or(z.literal('')),
  address: z.string().max(500, 'Address must be less than 500 characters').optional().or(z.literal('')),
});

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters').optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  address: z.string().max(500, 'Address must be less than 500 characters').optional().or(z.literal('')),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { email, password } = parsed.data;

  const result = await pool.query(
    'SELECT id, name, email, password_hash, role, mobile, country, address FROM users WHERE email = $1 OR mobile = $1',
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return res.json({
    accessToken,
    user: { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      name: user.name,
      mobile: user.mobile,
      country: user.country,
      address: user.address,
    },
  });
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    const errorMessage = firstError.message || 'Invalid request data';
    return res.status(400).json({ error: errorMessage });
  }

  const { name, email, password, mobile, country, address } = parsed.data;

  const existingMobile = await pool.query('SELECT id FROM users WHERE mobile = $1', [mobile]);
  if (existingMobile.rows[0]) {
    return res.status(409).json({ error: 'Mobile number already registered' });
  }

  if (email) {
    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows[0]) {
      return res.status(409).json({ error: 'Email already registered' });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const created = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, mobile, country, address)
     VALUES ($1,$2,$3,'viewer',$4,$5,$6)
     RETURNING id, name, email, role, mobile, country, address`,
    [name, email || null, passwordHash, mobile, country || null, address || null]
  );

  const user = created.rows[0];
  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email || user.mobile,
    role: user.role,
  });

  return res.status(201).json({
    accessToken,
    user: { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      name: user.name,
      mobile: user.mobile,
      country: user.country,
      address: user.address,
    },
  });
});

router.put('/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const { name, email, address } = parsed.data;
  const userId = payload.sub;

  if (email && email !== '') {
    const existingEmail = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );
    if (existingEmail.rows[0]) {
      return res.status(409).json({ error: 'Email already in use by another account' });
    }
  }

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (email !== undefined) {
    updates.push(`email = $${paramIndex++}`);
    values.push(email || null);
  }
  if (address !== undefined) {
    updates.push(`address = $${paramIndex++}`);
    values.push(address || null);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(userId);
  const result = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} 
     RETURNING id, name, email, role, mobile, country, address`,
    values
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      mobile: user.mobile,
      country: user.country,
      address: user.address,
    },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.put('/change-password', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request. New password must be at least 6 characters.' });
  }

  const { currentPassword, newPassword } = parsed.data;
  const userId = payload.sub;

  const result = await pool.query(
    'SELECT id, password_hash FROM users WHERE id = $1',
    [userId]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isCurrentPasswordValid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [newPasswordHash, userId]
  );

  return res.json({ message: 'Password changed successfully' });
});

// Forgot password - request password reset
const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

router.post('/forgot-password', async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  const { email } = parsed.data;

  // Find user by email
  const result = await pool.query(
    'SELECT id, email FROM users WHERE email = $1',
    [email]
  );

  const user = result.rows[0];
  
  if (!user) {
    console.log(`[Auth] Password reset requested for non-existent email: ${email}`);
    return res.status(404).json({ error: 'No account found with this email address. Please check the email or register a new account.' });
  }

  try {
    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Invalidate any existing tokens for this user
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );

    // Store the token
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );

    // Build reset URL
    const resetUrl = `${env.app.frontendUrl}/reset-password?token=${resetToken}`;

    // Send email
    const emailSent = await sendPasswordResetEmail(email, resetToken, resetUrl);
    
    if (!emailSent) {
      console.error(`[Auth] Failed to send password reset email to: ${email}`);
      return res.status(500).json({ error: 'Failed to send password reset email. Please try again later.' });
    }

    console.log(`[Auth] Password reset email sent to: ${email}`);
    return res.json({ message: 'Password reset link has been sent to your email address.' });
  } catch (err) {
    console.error('[Auth] Error in forgot password:', err);
    return res.status(500).json({ error: 'An error occurred. Please try again later.' });
  }
});

// Reset password - set new password using token
const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

router.post('/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return res.status(400).json({ error: firstError.message || 'Invalid request' });
  }

  const { token, newPassword } = parsed.data;

  try {
    // Find valid token
    const tokenResult = await pool.query(
      `SELECT id, user_id, expires_at, used_at 
       FROM password_reset_tokens 
       WHERE token = $1`,
      [token]
    );

    const tokenRecord = tokenResult.rows[0];

    if (!tokenRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    if (tokenRecord.used_at) {
      return res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update user's password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, tokenRecord.user_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
      [tokenRecord.id]
    );

    console.log(`[Auth] Password reset successful for user: ${tokenRecord.user_id}`);
    return res.json({ message: 'Password has been reset successfully. You can now login with your new password.' });
  } catch (err) {
    console.error('[Auth] Error in reset password:', err);
    return res.status(500).json({ error: 'An error occurred. Please try again later.' });
  }
});

// Verify reset token - check if token is valid
router.get('/verify-reset-token', async (req, res) => {
  const token = req.query.token as string;

  if (!token) {
    return res.status(400).json({ valid: false, error: 'Token is required' });
  }

  try {
    const tokenResult = await pool.query(
      `SELECT id, expires_at, used_at 
       FROM password_reset_tokens 
       WHERE token = $1`,
      [token]
    );

    const tokenRecord = tokenResult.rows[0];

    if (!tokenRecord) {
      return res.json({ valid: false, error: 'Invalid reset link' });
    }

    if (tokenRecord.used_at) {
      return res.json({ valid: false, error: 'This reset link has already been used' });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.json({ valid: false, error: 'This reset link has expired' });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error('[Auth] Error verifying reset token:', err);
    return res.status(500).json({ valid: false, error: 'An error occurred' });
  }
});

// GET /auth/payment-summary - Get user's total payments
router.get('/payment-summary', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = payload.sub;

  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total_paid_paise
       FROM payments 
       WHERE user_id = $1 AND status = 'success'`,
      [userId]
    );

    const totalPaidPaise = parseInt(result.rows[0].total_paid_paise, 10);

    return res.json({
      totalPaidPaise,
      totalPaidRupees: totalPaidPaise / 100,
    });
  } catch (err) {
    console.error('[Auth] Error getting payment summary:', err);
    return res.status(500).json({ error: 'Failed to get payment summary' });
  }
});

export default router;
