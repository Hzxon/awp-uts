const fs = require('fs/promises');
const path = require('path');

// Default lokal: tulis ke db.json di root project.
// Di Railway: set env DB_PATH ke `/app/data/db.json`
const DEFAULT_DB = path.join(__dirname, 'db.json');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB;

async function readDB() {
  try {
    const txt = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(txt || '{}');
  } catch (err) {
    if (err.code === 'ENOENT') {
      await ensureDirFor(DB_PATH);
      await writeDB({});
      return {};
    }
    throw err;
  }
}

async function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

async function writeDB(obj) {
  const tmpPath = DB_PATH + '.tmp';
  await ensureDirFor(DB_PATH);
  await fs.writeFile(tmpPath, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmpPath, DB_PATH);
}

async function getCollection(name) {
  const db = await readDB();
  if (!db[name]) db[name] = [];
  return { db, collection: db[name] };
}

module.exports = { readDB, writeDB, getCollection, DB_PATH };
