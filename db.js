// db.js — koneksi mysql2/promise (mendukung lokal & serverless)
const mysql = require('mysql2/promise');
const fs = require('fs');

let cachedPool = global._mysqlPool;

async function getPool() {
  if (cachedPool) return cachedPool;

  const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SSL, DB_CA, DB_CA_FILE } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) {
    throw new Error('Missing DB env vars (DB_HOST, DB_USER, DB_PASS, DB_NAME).');
  }

  // Pilih sumber sertifikat TLS:
  let ssl;
  if (DB_SSL === 'false' || DB_SSL === '0') {
    ssl = undefined; // (TiDB Cloud biasanya butuh TLS, jadi ini jarang dipakai)
  } else if (DB_CA && DB_CA.trim().length > 0) {
    ssl = { ca: DB_CA }; // untuk hosting (Vercel), simpan isi CA di env
  } else if (DB_CA_FILE && fs.existsSync(DB_CA_FILE)) {
    ssl = { ca: fs.readFileSync(DB_CA_FILE, 'utf8') }; // untuk lokal: pakai path file .pem
  } else {
    ssl = { rejectUnauthorized: true }; // fallback
  }

  cachedPool = await mysql.createPool({
    host: DB_HOST,
    port: DB_PORT ? Number(DB_PORT) : 4000,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl
  });

  global._mysqlPool = cachedPool;
  return cachedPool;
}

module.exports = { getPool };
