import express from 'express';
import supabase from '../db.js';

const router = express.Router();


/**
 * ✅ Create Monthly Reading
 * - Requires valid tenant (active) and valid meter (active)
 * - Calculates previous month
 * - Fetches last current_reading to use as this month's previous_reading
 * - If previous month data missing → return error to client
 */
router.post('/', async (req, res) => {
  const { tenant_id, meter_id, month, current_reading, rate_per_unit } = req.body;

  // 1. Fetch active tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('status', 'active')
    .single();
  if (tenantError || !tenant) return res.status(404).json({ error: 'Active tenant not found' });

  // 2. Validate meter exists and is active
  const { data: meter, error: meterError } = await supabase
    .from('power_meters')
    .select('*')
    .eq('meter_id', meter_id)
    .eq('status', 'active')
    .single();
  if (meterError || !meter) return res.status(404).json({ error: 'Active meter not found' });

  // 3. Calculate previous month date string
  const inputMonth = new Date(month);
  if (isNaN(inputMonth)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM-DD.' });
  }
  const prevMonth = new Date(inputMonth.getFullYear(), inputMonth.getMonth() - 1, 1);
  const prevMonthStr = prevMonth.toISOString().split('T')[0];

  // 4. Fetch last reading for this meter (previous month)
  const { data: lastReading, error: lastError } = await supabase
    .from('monthly_readings')
    .select('*')
    .eq('meter_id', meter_id)
    .eq('month', prevMonthStr)
    .single();

  if (lastError || !lastReading) {
    // ❌ No previous month data entered
    return res.status(400).json({ 
      error: `Previous month (${prevMonthStr}) reading not found. Please enter that first.` 
    });
  }

  // 5. Use lastReading.current_reading as previous_reading
  const previous_reading = lastReading.current_reading;

  // 6. Insert new monthly reading
  const { data, error } = await supabase.from('monthly_readings').insert([{
    tenant_id,
    tenant_version: tenant.tenant_version,
    meter_id,
    month,
    previous_reading,
    current_reading,
    rate_per_unit,
    created_at: new Date(),
    updated_at: new Date()
  }]).select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});


router.get('/', async (req, res) => {
  const { tenantId, meterId, startMonth, endMonth, includeInactive } = req.query;

  let query = supabase.from('monthly_readings').select('*');

  // 🔹 Tenant filter
  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  // 🔹 Meter filter
  if (meterId) {
    query = query.eq('meter_id', meterId);
  }

  // 🔹 Month range filter
  if (startMonth && endMonth) {
    query = query.gte('month', startMonth).lte('month', endMonth);
  }

  // 🔹 Active/inactive filter
//   if (!includeInactive || includeInactive === 'false') {
//     // join with tenants and meters to ensure active status
//     query = query.eq('status', 'active');
//   }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('monthly_readings').select('*').eq('reading_id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Monthly reading not found' });
    res.json(data);
});

/**
 * ✅ Update Monthly Reading
 * - Always inPlace update (no versioning)
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updateFields = req.body;

  // Fetch current reading
  const { data: currentReading, error: fetchError } = await supabase
    .from('monthly_readings')
    .select('*')
    .eq('reading_id', id)
    .single();
  if (fetchError || !currentReading) {
    return res.status(404).json({ error: 'Monthly reading not found' });
  }

  // Perform inPlace update
  const { data, error } = await supabase
    .from('monthly_readings')
    .update({ ...updateFields })
    .eq('reading_id', id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ type: 'inPlace', monthly_readings: data[0] });
});


/**
 * ✅ Delete Monthly Reading
 * - Hard delete (since readings are transactional)
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    const { error } = await supabase.from('monthly_readings').delete().eq('reading_id', id);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
});

export default router;
