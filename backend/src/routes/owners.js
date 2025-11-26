import express from 'express';
import supabase from '../db.js';

const router = express.Router();

// Get all owners
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('owners')
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Create owner
router.post('/', async (req, res) => {
  const { name, gstin, pan_number } = req.body;

  const { data, error } = await supabase
    .from('owners')
    .insert([{ name, gstin, pan_number }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

export default router;
