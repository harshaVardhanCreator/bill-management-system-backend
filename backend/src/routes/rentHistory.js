import express from 'express';
import supabase from '../db.js';
import { getMonthStart } from '../utils/dateUtil.js';

const router = express.Router();

/**
 * ✅ Create Rent History
 * - Versions tenant (increment rent_portion_count)
 * - Inserts new rent history tied to new tenant_version
 */
router.post('/', async (req, res) => {
  const { tenant_id, start_date, ...rentFields } = req.body;

  let normalizedStart;
  const currentMonthDate = getMonthStart();
  try {
    normalizedStart = getMonthStart(start_date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Fetch active tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('status', 'active')
    .single();
  if (tenantError || !tenant) return res.status(404).json({ error: 'Active tenant not found' });

  // Inactivate old tenant
  await supabase.from('tenants')
    .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
    .eq('tenant_id', tenant_id)
    .eq('status', 'active');

  // Create new tenant version with incremented rent_portion_count
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id,
    tenant_version: tenant_version + 1,
    rent_portion_count: (tenant.rent_portion_count || 0) + 1,
    start_date: currentMonthDate,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Insert new rent history tied to new tenant_version
  const { data: rentHistory, error: rentError } = await supabase.from('rent_history').insert([{
    tenant_id,
    tenant_version: newTenantRow[0].tenant_version,
    start_date: normalizedStart,
    end_date: null,
    ...rentFields,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  }]).select();
  if (rentError) return res.status(500).json({ error: rentError.message });

  res.json({ rent_history: rentHistory[0], tenant: newTenantRow[0] });
});

/**
 * ✅ Read Operations
 */
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('rent_history').select('*').eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('rent_history').select('*').eq('rent_id', id).eq('status', 'active').single();
  if (error || !data) return res.status(404).json({ error: 'Active rent history not found' });
  res.json(data);
});

/**
 * ✅ Update Rent History
 * - inPlace: true → update same row
 * - inPlace: false → mark old inactive and insert new active row (same tenant_version)
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { inPlace, ...updateFields } = req.body;
  const currentMonthDate = getMonthStart();

  const { data: currentRent, error: fetchError } = await supabase
    .from('rent_history')
    .select('*')
    .eq('rent_id', id)
    .eq('status', 'active')
    .single();
  if (fetchError || !currentRent) return res.status(404).json({ error: 'Active rent history not found' });

  if (inPlace) {
    if (updateFields.start_date) {
      try {
        updateFields.start_date = getMonthStart(updateFields.start_date);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const { data, error } = await supabase
      .from('rent_history')
      .update({ ...updateFields, updated_at: new Date() })
      .eq('rent_id', id)
      .eq('status', 'active')
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'inPlace', rent_history: data[0] });
  } else {
    await supabase.from('rent_history')
      .update({ status: 'inactive', end_date: currentMonthDate })
      .eq('rent_id', id);

    const { rent_id, ...rentWithoutId } = currentRent;
    const newRent = {
      ...rentWithoutId,
      ...updateFields,
      start_date: currentMonthDate,
      end_date: null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase.from('rent_history').insert([newRent]).select();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ type: 'versioned', rent_history: data[0] });
  }
});

/**
 * ✅ Delete Rent History
 * - Marks rent history inactive
 * - Versions tenant (decrement rent_portion_count)
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const currentMonthDate = getMonthStart();

  const { data: rent, error: rentError } = await supabase
    .from('rent_history')
    .select('*')
    .eq('rent_id', id)
    .eq('status', 'active')
    .single();
  if (rentError || !rent) return res.status(404).json({ error: 'Active rent history not found' });

  // Mark rent history inactive
  await supabase.from('rent_history')
    .update({ status: 'inactive', end_date: currentMonthDate })
    .eq('rent_id', id);

  // Fetch tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', rent.tenant_id)
    .eq('status', 'active')
    .single();
  if (tenantError || !tenant) return res.status(404).json({ error: 'Active tenant not found' });

  // Inactivate old tenant
  await supabase.from('tenants')
    .update({ status: 'inactive', end_date: currentMonthDate })
    .eq('tenant_id', tenant.tenant_id)
    .eq('status', 'active');

  // Create new tenant version with decremented count
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id: tenant.tenant_id,
    tenant_version: tenant_version + 1,
    rent_portion_count: Math.max((tenant.rent_portion_count || 0) - 1, 0),
    start_date: currentMonthDate,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Re-fetch updated rent row to show inactive status
  const { data: updatedRent } = await supabase.from('rent_history').select('*').eq('rent_id', id).single();

  res.json({ success: true, rent_history: updatedRent, tenant: newTenantRow[0] });
});

export default router;