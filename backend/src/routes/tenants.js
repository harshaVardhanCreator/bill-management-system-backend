import express from 'express';
import supabase from '../db.js';
import { getMonthStart } from '../utils/dateUtil.js';

const router = express.Router();

/**
 * ✅ Create Tenant
 * Always created as active, starts at version 1
 * start_date normalized to first day of month
 */
router.post('/', async (req, res) => {
  let startDate;
  try {
    startDate = getMonthStart(req.body.start_date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { data, error } = await supabase
    .from('tenants')
    .insert([{ ...req.body, status: 'active', tenant_version: 1, start_date: startDate }])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

/**
 * ✅ Fetch all tenants (only active, latest version)
 */
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * ✅ Search tenants by name (only active, latest version)
 */
router.get('/search/:query', async (req, res) => {
  const { query } = req.params;
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .ilike('name', `${query}%`)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * ✅ Fetch tenant by ID (latest active version)
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', id)
    .eq('status', 'active')
    .order('tenant_version', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Active tenant not found' });
  res.json(data);
});

/**
 * ✅ Update Tenant
 * - inPlace: true → Type 1 (update latest version in place)
 * - inPlace: false → Type 2 (preserve history, create new version)
 * - end_date set to current month start for old version
 * - start_date normalized for new version
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { inPlace, ...updateFields } = req.body;

  const { data: currentTenant, error: fetchError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', id)
    .eq('status', 'active')
    .order('tenant_version', { ascending: false })
    .limit(1)
    .single();

  if (fetchError || !currentTenant) {
    return res.status(404).json({ error: 'Active tenant not found' });
  }

  const currentMonthDate = getMonthStart();

  if (inPlace) {
    // ✅ Type 1: Update in place
    let newStartDate;
    if (updateFields.start_date) {
      try {
        newStartDate = getMonthStart(updateFields.start_date);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const { data, error } = await supabase
      .from('tenants')
      .update({ ...updateFields, ...(newStartDate && { start_date: newStartDate }), updated_at: new Date() })
      .eq('tenant_id', id)
      .eq('tenant_version', currentTenant.tenant_version)
      .eq('status', 'active')
      .select();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'inPlace', tenant: data[0] });
  } else {
    // ✅ Type 2: Preserve history
    await supabase
      .from('tenants')
      .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
      .eq('tenant_id', id)
      .eq('tenant_version', currentTenant.tenant_version)
      .eq('status', 'active');

    const { tenant_version, ...tenantWithoutVersion } = currentTenant;
    let newStartDate;
    try {
      newStartDate = updateFields.start_date ? getMonthStart(updateFields.start_date) : currentMonthDate;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const newTenant = {
      ...tenantWithoutVersion,
      ...updateFields,
      tenant_version: tenant_version + 1,
      status: 'active',
      start_date: newStartDate,
      end_date: null,
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('tenants')
      .insert([newTenant])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'versioned', tenant: data[0] });
  }
});

/**
 * ✅ Soft Delete Tenant
 * Marks latest active version inactive and sets end_date
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const { data: currentTenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', id)
    .eq('status', 'active')
    .order('tenant_version', { ascending: false })
    .limit(1)
    .single();

  if (!currentTenant) return res.status(404).json({ error: 'Active tenant not found' });

  const currentMonthDate = getMonthStart();

  const { data, error } = await supabase
    .from('tenants')
    .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
    .eq('tenant_id', id)
    .eq('tenant_version', currentTenant.tenant_version)
    .eq('status', 'active')
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, tenant: data[0] });
});

export default router;
