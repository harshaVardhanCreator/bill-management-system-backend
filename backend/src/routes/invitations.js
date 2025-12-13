// routes/invitations.js
import express from 'express';
import crypto from 'crypto';
import supabase from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * Create invitation:
 * - superadmin can invite orgadmin
 * - orgadmin/superadmin can invite owner
 * - owner/orgadmin/superadmin can invite tenant
 * - Stores token with 7-day expiry
 */
router.post('/invite', requireAuth, async (req, res) => {
  const { role, email, organization_id, owner_id, tenant_id } = req.body;
  const invokerRole = req.user.role;

  if (!['orgadmin', 'owner', 'tenant'].includes(role)) {
    return res.status(400).json({ error: 'Invalid invite role' });
  }
  if (role === 'orgadmin' && invokerRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmin can invite orgadmin' });
  }
  if (role === 'owner' && !['orgadmin', 'superadmin'].includes(invokerRole)) {
    return res.status(403).json({ error: 'Only orgadmin/superadmin can invite owner' });
  }
  if (role === 'tenant' && !['owner', 'orgadmin', 'superadmin'].includes(invokerRole)) {
    return res.status(403).json({ error: 'Only owner/orgadmin/superadmin can invite tenant' });
  }

  // Scope requirements
  if (role !== 'orgadmin' && !organization_id) {
    return res.status(400).json({ error: 'organization_id required' });
  }
  if (role === 'tenant' && !owner_id) {
    return res.status(400).json({ error: 'owner_id required for tenant' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .insert([{
      email,
      role,
      organization_id: organization_id || null,
      owner_id: owner_id || null,
      tenant_id: tenant_id || null,
      token,
      expires_at,
      created_by: req.user.sub
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invite: data[0] });
});

/**
 * Accept invitation:
 * - Requires Google login (req.user.email)
 * - Validates token, expiry, email match
 * - Promotes role and assigns scope
 */
router.post('/accept', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  const { data: invites } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', token)
    .eq('accepted', false)
    .limit(1);

  const invite = invites?.[0];
  if (!invite) return res.status(400).json({ error: 'Invalid or used invite' });
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Invite expired' });
  }
  if (invite.email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: 'Invite email mismatch' });
  }

  const updates = { role: invite.role };
  if (invite.organization_id) updates.organization_id = invite.organization_id;
  if (invite.owner_id) updates.owner_id = invite.owner_id;
  if (invite.tenant_id) updates.tenant_id = invite.tenant_id;

  const { error: updateErr } = await supabase
    .from('users')
    .update(updates)
    .eq('email', req.user.email);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  await supabase
    .from('invitations')
    .update({ accepted: true })
    .eq('invite_id', invite.invite_id);

  res.json({ success: true });
});

export default router;
