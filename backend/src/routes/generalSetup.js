import express from 'express';
import supabase from '../db.js';
import { getMonthStart } from '../utils/dateUtil.js';

const router = express.Router();

/**
 * ✅ Create General Setup
 * - Simple insert with normalized start_date
 */
router.post('/', async (req, res) => {
  let normalizedStart;
  try {
    normalizedStart = getMonthStart(req.body.start_date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const newSetup = {
    ...req.body,
    start_date: normalizedStart,
    end_date: null,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date()
  };

  const { data, error } = await supabase.from('general_setup').insert([newSetup]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

/**
 * ✅ Read Operations
 */
router.get('/', async (req, res) => {
  const { includeInactive } = req.query;
  let query = supabase.from('general_setup').select('*');

  if (!includeInactive || includeInactive === 'false') {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { includeInactive } = req.query;

  let query = supabase.from('general_setup').select('*').eq('entry_id', id);
  if (!includeInactive || includeInactive === 'false') {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Setup not found' });
  res.json(data);
});

/**
 * ✅ Update General Setup
 * - inPlace: true → update same row
 * - inPlace: false → mark old inactive and insert new active row
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { inPlace, ...updateFields } = req.body;
  const currentMonthDate = getMonthStart();

  const { data: currentSetup, error: fetchError } = await supabase
    .from('general_setup')
    .select('*')
    .eq('entry_id', id)
    .eq('status', 'active')
    .single();
  if (fetchError || !currentSetup) return res.status(404).json({ error: 'Active setup not found' });

  if (inPlace) {
    if (updateFields.start_date) {
      try {
        updateFields.start_date = getMonthStart(updateFields.start_date);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const { data, error } = await supabase
      .from('general_setup')
      .update({ ...updateFields, updated_at: new Date() })
      .eq('entry_id', id)
      .eq('status', 'active')
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ type: 'inPlace', general_setup: data[0] });
  } else {
    // Mark old inactive
    await supabase.from('general_setup')
      .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
      .eq('entry_id', id);

    const { entry_id, ...setupWithoutId } = currentSetup;
    const newSetup = {
      ...setupWithoutId,
      ...updateFields,
      start_date: currentMonthDate,
      end_date: null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase.from('general_setup').insert([newSetup]).select();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ type: 'versioned', general_setup: data[0] });
  }
});

/**
 * ✅ Delete General Setup
 * - Marks setup inactive with end_date
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const currentMonthDate = getMonthStart();

  const { data, error } = await supabase
    .from('general_setup')
    .update({ status: 'inactive', end_date: currentMonthDate, updated_at: new Date() })
    .eq('entry_id', id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Setup not found' });

  res.json({ success: true, general_setup: data[0] });
});

export default router;
