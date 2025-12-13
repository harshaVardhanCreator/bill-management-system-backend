import express from 'express';
import supabase from '../db.js';
import { getMonthStart } from '../utils/dateUtil.js';

const router = express.Router();

/**
 * ✅ Create Water History
 * - Only allowed if tenant.water_required = false
 * - Flips water_required to true in new tenant version
 */
router.post('/', async (req, res) => {
  const { tenant_id, start_date, ...waterFields } = req.body;

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

  // Only create if water_required = false
  if (tenant.water_required) {
    return res.status(400).json({ error: 'Water history already exists for this tenant' });
  }

  // Inactivate old tenant
  await supabase.from('tenants')
    .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
    .eq('tenant_id', tenant_id)
    .eq('status', 'active');

  // Create new tenant version with water_required = true
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id,
    tenant_version: tenant_version + 1,
    water_required: true,
    start_date: currentMonthDate,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Insert new water history tied to new tenant_version
  const { data: waterHistory, error: waterError } = await supabase.from('water_history').insert([{
    tenant_id,
    tenant_version: newTenantRow[0].tenant_version,
    start_date: normalizedStart,
    end_date: null,
    ...waterFields,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  }]).select();
  if (waterError) return res.status(500).json({ error: waterError.message });

  res.json({ water_history: waterHistory[0], tenant: newTenantRow[0] });
});

/**
 * ✅ Read Operations
 */
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('water_history').select('*').eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('water_history').select('*').eq('water_id', id).eq('status', 'active').single();
  if (error || !data) return res.status(404).json({ error: 'Active water history not found' });
  res.json(data);
});

/**
 * ✅ Update Water History
 * - inPlace: true → update same row
 * - inPlace: false → mark old inactive and insert new active row (same tenant_version)
 * - ⚠️ Unlike meters/rent, start_date can be updated in both cases
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { inPlace, ...updateFields } = req.body;

  const { data: currentWater, error: fetchError } = await supabase
    .from('water_history')
    .select('*')
    .eq('water_id', id)
    .eq('status', 'active')
    .single();
  if (fetchError || !currentWater) return res.status(404).json({ error: 'Active water history not found' });

  if (updateFields.start_date) {
    try {
      updateFields.start_date = getMonthStart(updateFields.start_date);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (inPlace) {
    const { data, error } = await supabase
      .from('water_history')
      .update({ ...updateFields, updated_at: new Date() })
      .eq('water_id', id)
      .eq('status', 'active')
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'inPlace', water_history: data[0] });
  } else {
    await supabase.from('water_history').update({ status: 'inactive', end_date: getMonthStart() }).eq('water_id', id);

    const { water_id, ...waterWithoutId } = currentWater;
    const newWater = {
      ...waterWithoutId,
      ...updateFields,
      end_date: null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase.from('water_history').insert([newWater]).select();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ type: 'versioned', water_history: data[0] });
  }
});

/**
 * ✅ Delete Water History
 * - Only allowed if tenant.water_required = true
 * - Marks water history inactive
 * - Flips water_required back to false in new tenant version
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const currentMonthDate = getMonthStart();

  const { data: water, error: waterError } = await supabase
    .from('water_history')
    .select('*')
    .eq('water_id', id)
    .eq('status', 'active')
    .single();
  if (waterError || !water) return res.status(404).json({ error: 'Active water history not found' });

  // Fetch tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', water.tenant_id)
    .eq('status', 'active')
    .single();
  if (tenantError || !tenant) return res.status(404).json({ error: 'Active tenant not found' });

  // Only delete if water_required = true
  if (!tenant.water_required) {
    return res.status(400).json({ error: 'No water history exists for this tenant' });
  }

  // Mark water history inactive
  await supabase.from('water_history').update({ status: 'inactive', end_date: currentMonthDate }).eq('water_id', id);

  // Inactivate old tenant
  await supabase.from('tenants').update({ status: 'inactive', end_date: currentMonthDate }).eq('tenant_id', tenant.tenant_id).eq('status', 'active');

  // Create new tenant version with water_required = false
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id: tenant.tenant_id,
    tenant_version: tenant_version + 1,
    water_required: false,
    start_date: currentMonthDate,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Re-fetch updated water row to show inactive status
  const { data: updatedWater } = await supabase.from('water_history').select('*').eq('water_id', id).single();

  res.json({ success: true, water_history: updatedWater, tenant: newTenantRow[0] });
});

export default router;