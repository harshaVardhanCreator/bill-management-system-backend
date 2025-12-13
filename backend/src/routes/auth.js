// routes/auth.js
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import supabase from '../db.js';

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return { email: payload.email, google_id: payload.sub };
}

/**
 * Google login:
 * - Verifies id_token
 * - Bootstraps first user as superadmin
 * - Otherwise creates minimal user (no role escalation)
 * - Returns JWT with role and scope claims
 */
router.post('/login/google', async (req, res) => {
  try {
    const { id_token } = req.body;
    if (!id_token) return res.status(400).json({ error: 'id_token required' });

    const { email, google_id } = await verifyGoogleToken(id_token);

    // Lookup existing user
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);
    let user = existing?.[0];

    if (!user) {
      // Bootstrap: first user becomes superadmin
      const { count } = await supabase.from('users').select('user_id', { count: 'exact', head: true });
      const role = (count === 0) ? 'superadmin' : 'tenant'; // default minimal role
      const { data: created, error: insertErr } = await supabase
        .from('users')
        .insert([{ google_id, email, role }])
        .select();
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      user = created[0];
    }

    const token = jwt.sign({
      sub: user.user_id,
      role: user.role,
      email: user.email,
      organization_id: user.organization_id || null,
      owner_id: user.owner_id || null,
      tenant_id: user.tenant_id || null
    }, process.env.JWT_SECRET, { expiresIn: '8h' });

    res.json({ token, user });
  } catch (e) {
    res.status(401).json({ error: 'Google login failed' });
  }
});

export default router;
