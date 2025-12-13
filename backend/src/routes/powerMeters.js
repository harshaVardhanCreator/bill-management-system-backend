import express from 'express';
import supabase from '../db.js';
import { getMonthStart } from '../utils/dateUtil.js';

const router = express.Router();

/**
 * ✅ Create Power Meter
 * - Versions tenant (increment count)
 * - Inserts new meter tied to new tenant_version
 * - Also seeds monthly_readings with initial values
 */
router.post('/', async (req, res) => {
  let startDate;
  const currentMonthDate = getMonthStart();
  try {
    startDate = getMonthStart(req.body.start_date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { tenant_id, start_date, initial_reading, ...meterFields } = req.body;

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

  // Create new tenant version with incremented count
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id,
    tenant_version: tenant_version + 1,
    start_date: currentMonthDate,
    power_meter_count: (tenant.power_meter_count || 0) + 1,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  // Insert new meter tied to new tenant_version
  const { data: meter, error: meterError } = await supabase.from('power_meters').insert([{
    tenant_id,
    tenant_version: newTenantRow[0].tenant_version,
    start_date: startDate,
    initial_reading, // store initial reading in meter table
    ...meterFields,
    status: 'active'
  }]).select();
  if (meterError) return res.status(500).json({ error: meterError.message });

  const newMeter = meter[0];

  // Calculate previous month (one month before provided month)
  const inputMonth = new Date(start_date);
  if (isNaN(inputMonth)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM-DD.' });
  }
  const prevMonth = new Date(inputMonth);
  prevMonth.setMonth(prevMonth.getMonth() - 1);

  // Insert baseline monthly_readings row
  const { data: reading, error: readingError } = await supabase.from('monthly_readings').insert([{
    tenant_id,
    tenant_version: newTenantRow[0].tenant_version,
    meter_id: newMeter.meter_id,
    month: prevMonth.toISOString().split('T')[0], // YYYY-MM-DD
    previous_reading: initial_reading,
    current_reading: initial_reading,
    created_at: new Date(),
    updated_at: new Date()
  }]).select();
  if (readingError) return res.status(500).json({ error: readingError.message });

  res.json({ meter: newMeter, tenant: newTenantRow[0], initialMonthlyReading: reading[0] });
});

/**
 * ✅ Read Operations
 */
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('power_meters').select('*').eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('power_meters').select('*').eq('meter_id', id).eq('status', 'active').single();
  if (error || !data) return res.status(404).json({ error: 'Active meter not found' });
  res.json(data);
});

/**
 * ✅ Update Power Meter
 * - Always inPlace update
 * - Special handling if start_date changes
 * - start_date update allowed only if exactly 1 monthly_readings record exists for this meter
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { inPlace, ...updateFields } = req.body;
  const currentMonthDate = getMonthStart();

  // Fetch current meter
  const { data: currentMeter, error: fetchError } = await supabase
    .from('power_meters')
    .select('*')
    .eq('meter_id', id)
    .eq('status', 'active')
    .single();
  if (fetchError || !currentMeter) {
    return res.status(404).json({ error: 'Active meter not found' });
  }

  // Special handling: start_date can only be updated inPlace
  if (updateFields.start_date && !inPlace) {
    return res.status(400).json({ error: 'start_date update is only allowed for inPlace updates, not versioned updates' });
  }

  if (inPlace) {
    // If start_date is being updated, enforce monthly_readings count check
    if (
      (updateFields.start_date && updateFields.start_date !== currentMeter.start_date) ||
      (updateFields.initial_reading && updateFields.initial_reading !== currentMeter.initial_reading)
    ) {
      if (updateFields.start_date) {
        try {
          updateFields.start_date = getMonthStart(updateFields.start_date);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }
      const { count, error: countError } = await supabase
        .from('monthly_readings')
        .select('*', { count: 'exact', head: true })
        .eq('meter_id', id);

      if (countError) return res.status(500).json({ error: 'Failed to check monthly readings count' });
      if (count !== 1) {
        return res.status(400).json({ error: 'start_date update only allowed when exactly 1 monthly_readings record exists for this meter' });
      }

      // Update meter
      const { data: updatedMeter, error: updateError } = await supabase
        .from('power_meters')
        .update({ ...updateFields, updated_at: new Date() })
        .eq('meter_id', id)
        .select();
      if (updateError) return res.status(500).json({ error: updateError.message });

      // Calculate previous month
      const newStart = new Date(updatedMeter[0].start_date);
      if (isNaN(newStart)) {
        return res.status(400).json({ error: 'Invalid start_date format. Use YYYY-MM-DD.' });
      }
      const prevMonth = new Date(newStart);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      const prevMonthStr = prevMonth.toISOString().split('T')[0];

      // Update baseline monthly_readings
      const { data: updatedReading, error: readingError } = await supabase
        .from('monthly_readings')
        .update({
          month: prevMonthStr,
          previous_reading: updatedMeter[0].initial_reading,
          current_reading: updatedMeter[0].initial_reading,
          updated_at: new Date()
        })
        .eq('meter_id', id)
        .select();
      if (readingError) {
        return res.status(500).json({ error: 'Meter updated, but failed to update monthly_readings: ' + readingError.message });
      }

      return res.json({ type: 'inPlace', meter: updatedMeter[0], monthly_reading: updatedReading[0] });
    }

    // Normal inPlace update
    const { data, error } = await supabase
      .from('power_meters')
      .update({ ...updateFields, updated_at: new Date() })
      .eq('meter_id', id)
      .eq('status', 'active')
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'inPlace', meter: data[0] });
  } else {
    // Versioned update (start_date not allowed here)
    const { meter_id, ...meterWithoutId } = currentMeter;
    await supabase.from('power_meters')
      .update({ status: 'inactive', end_date: currentMonthDate })
      .eq('meter_id', id);

    const newMeter = {
      ...meterWithoutId,
      ...updateFields,
      start_date: currentMonthDate,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase.from('power_meters').insert([newMeter]).select();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ type: 'versioned', meter: data[0] });
  }
});


/**
 * ✅ Delete Power Meter
 * - Marks meter inactive
 * - Versions tenant (decrement count)
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const currentMonthDate = getMonthStart();

  const { data: meter, error: meterError } = await supabase
    .from('power_meters')
    .select('*')
    .eq('meter_id', id)
    .eq('status', 'active')
    .single();
  if (meterError || !meter) return res.status(404).json({ error: 'Active meter not found' });

  // Mark meter inactive
  await supabase.from('power_meters')
    .update({ status: 'inactive', end_date: currentMonthDate })
    .eq('meter_id', id);

  // Fetch tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', meter.tenant_id)
    .eq('status', 'active')
    .single();
  if (tenantError || !tenant) return res.status(404).json({ error: 'Active tenant not found' });

  // Inactivate old tenant
  await supabase.from('tenants')
    .update({ status: 'inactive', end_date: currentMonthDate })
    .eq('tenant_id', tenant.tenant_id)
    .eq('status', 'active');

  const { data: updatedMeter } = await supabase
    .from('power_meters')
    .select('*')
    .eq('meter_id', id)
    .single();

  // Create new tenant version with decremented count
  const { tenant_version, ...tenantWithoutVersion } = tenant;
  const newTenant = {
    ...tenantWithoutVersion,
    tenant_id: tenant.tenant_id,
    tenant_version: tenant_version + 1,
    power_meter_count: Math.max((tenant.power_meter_count || 0) - 1, 0),
    start_date: currentMonthDate,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data: newTenantRow, error: newTenantError } = await supabase.from('tenants').insert([newTenant]).select();
  if (newTenantError) return res.status(500).json({ error: newTenantError.message });

  res.json({ success: true, updatedMeter, tenant: newTenantRow[0] });
});

export default router;
