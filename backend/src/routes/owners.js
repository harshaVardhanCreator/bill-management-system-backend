import express from 'express';
import supabase from '../db.js';

const router = express.Router();

// ✅ Create Owner
router.post('/', async (req, res) => {
  const { data, error } = await supabase
    .from('owners')
    .insert([req.body])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// ✅ Fetch all Owners
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('owners').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ✅ Fetch Owner by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('owners')
    .select('*')
    .eq('owner_id', id)
    .single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// ✅ Update Owner (in-place)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('owners')
    .update(req.body)
    .eq('owner_id', id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// ✅ Delete Owner (hard delete, or you can choose soft delete)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('owners').delete().eq('owner_id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
