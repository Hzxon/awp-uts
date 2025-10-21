// db.js
const fs = require('fs');
const mysql = require('mysql2/promise');

function loadCA() {
  // Prioritas: pakai file kalau disediakan
  if (process.env.TIDB_CA_FILE && fs.existsSync(process.env.TIDB_CA_FILE)) {
    return fs.readFileSync(process.env.TIDB_CA_FILE, 'utf8');
  }
  // Fallback: TIDB_CA dengan \n yang di-escape
  if (process.env.TIDB_CA) {
    return process.env.TIDB_CA.replace(/\\n/g, '\n');
  }
  return '';
}

const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  ssl: {
    minVersion: 'TLSv1.2',
    ca: loadCA(),
    rejectUnauthorized: true
  },
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = { pool };
