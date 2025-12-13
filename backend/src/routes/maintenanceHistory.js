import express from 'express';
import supabase from '../db.js';
import { getMonthStart } from '../utils/dateUtil.js';

const router = express.Router();

/**
 * ✅ Create Maintenance History
 * - Only allowed if tenant.maintenance_required = false
 * - Flips maintenance_required to true in new tenant version
 */
router.post('/', async (req, res) => {
  const { tenant_id, start_date, ...maintenanceFields } = req.body;

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

  // Only create if maintenance_required = false
  if (tenant.maintenance_required) {
    return res.status(400).json({ error: 'Maintenance history already exists for this tenant' });
  }

  // Inactivate old tenant
  await supabase.from('tenants')
    .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
    .eq('tenant_id', tenant_id)
    .eq('status', 'active');

  // Create new tenant version with maintenance_required = true
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id,
    tenant_version: tenant_version + 1,
    maintenance_required: true,
    start_date: currentMonthDate,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Insert new maintenance history tied to new tenant_version
  const { data: maintenanceHistory, error: maintenanceError } = await supabase.from('maintenance_history').insert([{
    tenant_id,
    tenant_version: newTenantRow[0].tenant_version,
    start_date: normalizedStart,
    end_date: null,
    ...maintenanceFields,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  }]).select();
  if (maintenanceError) return res.status(500).json({ error: maintenanceError.message });

  res.json({ maintenance_history: maintenanceHistory[0], tenant: newTenantRow[0] });
});

/**
 * ✅ Read Operations
 */
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('maintenance_history').select('*').eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('maintenance_history').select('*').eq('maintenance_id', id).eq('status', 'active').single();
  if (error || !data) return res.status(404).json({ error: 'Active maintenance history not found' });
  res.json(data);
});

/**
 * ✅ Update Maintenance History
 * - inPlace: true → update same row
 * - inPlace: false → mark old inactive and insert new active row (same tenant_version)
 * - ⚠️ start_date can be updated in both cases
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { inPlace, ...updateFields } = req.body;

  const { data: currentMaintenance, error: fetchError } = await supabase
    .from('maintenance_history')
    .select('*')
    .eq('maintenance_id', id)
    .eq('status', 'active')
    .single();
  if (fetchError || !currentMaintenance) return res.status(404).json({ error: 'Active maintenance history not found' });

  if (updateFields.start_date) {
    try {
      updateFields.start_date = getMonthStart(updateFields.start_date);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (inPlace) {
    const { data, error } = await supabase
      .from('maintenance_history')
      .update({ ...updateFields, updated_at: new Date() })
      .eq('maintenance_id', id)
      .eq('status', 'active')
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'inPlace', maintenance_history: data[0] });
  } else {
    await supabase.from('maintenance_history').update({ status: 'inactive', end_date: getMonthStart() }).eq('maintenance_id', id);

    const { maintenance_id, ...maintenanceWithoutId } = currentMaintenance;
    const newMaintenance = {
      ...maintenanceWithoutId,
      ...updateFields,
      end_date: null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase.from('maintenance_history').insert([newMaintenance]).select();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ type: 'versioned', maintenance_history: data[0] });
  }
});

/**
 * ✅ Delete Maintenance History
 * - Only allowed if tenant.maintenance_required = true
 * - Marks maintenance history inactive
 * - Flips maintenance_required back to false in new tenant version
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const currentMonthDate = getMonthStart();

  const { data: maintenance, error: maintenanceError } = await supabase
    .from('maintenance_history')
    .select('*')
    .eq('maintenance_id', id)
    .eq('status', 'active')
    .single();
  if (maintenanceError || !maintenance) return res.status(404).json({ error: 'Active maintenance history not found' });

  // Fetch tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', maintenance.tenant_id)
    .eq('status', 'active')
    .single();
  if (tenantError || !tenant) return res.status(404).json({ error: 'Active tenant not found' });

  // Only delete if maintenance_required = true
  if (!tenant.maintenance_required) {
    return res.status(400).json({ error: 'No maintenance history exists for this tenant' });
  }

  // Mark maintenance history inactive
  await supabase.from('maintenance_history').update({ status: 'inactive', end_date: currentMonthDate }).eq('maintenance_id', id);

  // Inactivate old tenant
  await supabase.from('tenants').update({ status: 'inactive', end_date: currentMonthDate }).eq('tenant_id', tenant.tenant_id).eq('status', 'active');

  // Create new tenant version with maintenance_required = false
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id: tenant.tenant_id,
    tenant_version: tenant_version + 1,
    maintenance_required: false,
    start_date: currentMonthDate,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Re-fetch updated maintenance row to show inactive status
  const { data: updatedMaintenance } = await supabase.from('maintenance_history').select('*').eq('maintenance_id', id).single();

  res.json({ success: true, maintenance_history: updatedMaintenance, tenant: newTenantRow[0] });
});

export default router;
