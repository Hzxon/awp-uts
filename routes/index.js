const express = require('express');
const { randomUUID } = require('crypto');
const { getCollection, writeDB } = require('../db');

const router = express.Router();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/:collection', async (req, res, next) => {
  try {
    const name = req.params.collection.trim();
    if (!name) return res.status(400).json({ error: 'Nama koleksi wajib diisi.' });
    const { collection } = await getCollection(name);
    res.json(collection);
  } catch (err) {
    next(err);
  }
});

router.get('/:collection/:id', async (req, res, next) => {
  try {
    const name = req.params.collection.trim();
    const id = req.params.id;
    const { collection } = await getCollection(name);
    const item = collection.find((row) => row.id === id);
    if (!item) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/:collection', async (req, res, next) => {
  try {
    const name = req.params.collection.trim();
    if (!name) return res.status(400).json({ error: 'Nama koleksi wajib diisi.' });
    if (!isPlainObject(req.body)) {
      return res.status(400).json({ error: 'Payload harus berupa object JSON.' });
    }

    const { db, collection } = await getCollection(name);
    const now = new Date().toISOString();
    const newItem = {
      id: randomUUID(),
      ...req.body,
      createdAt: req.body.createdAt || now,
      updatedAt: req.body.updatedAt || now,
    };

    collection.push(newItem);
    await writeDB(db);
    res.status(201).json(newItem);
  } catch (err) {
    next(err);
  }
});

router.patch('/:collection/:id', async (req, res, next) => {
  try {
    const name = req.params.collection.trim();
    const id = req.params.id;
    if (!isPlainObject(req.body)) {
      return res.status(400).json({ error: 'Payload harus berupa object JSON.' });
    }

    const { db, collection } = await getCollection(name);
    const index = collection.findIndex((row) => row.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Data tidak ditemukan.' });
    }

    const current = collection[index];
    const updated = {
      ...current,
      ...req.body,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    collection[index] = updated;
    await writeDB(db);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:collection/:id', async (req, res, next) => {
  try {
    const name = req.params.collection.trim();
    const id = req.params.id;

    const { db, collection } = await getCollection(name);
    const index = collection.findIndex((row) => row.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Data tidak ditemukan.' });
    }

    const [removed] = collection.splice(index, 1);
    await writeDB(db);
    res.json({ ok: true, deleted: removed.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
