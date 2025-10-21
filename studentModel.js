// studentModel.js
const { pool } = require('./db');

async function getAllStudents() {
  const [rows] = await pool.query(
    'SELECT name, class, email FROM ms_student ORDER BY name ASC'
  );
  return rows;
}

async function addStudent(name, className, email) {
  // Cek duplikat (case-insensitive pakai COLLATE)
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM ms_student WHERE name COLLATE utf8mb4_general_ci = ?',
    [name]
  );
  if (row.cnt > 0) {
    const err = new Error('Nama siswa sudah digunakan.');
    err.code = 'DUPLICATE_NAME';
    throw err;
  }

  // Insert
  await pool.execute(
    'INSERT INTO ms_student (name, class, email) VALUES (?, ?, ?)',
    [name, className, email]
  );
}

async function updateStudent(originalName, name, className, email) {
  // Cek: kalau ganti nama, pastikan tidak bentrok (case-insensitive)
  if (originalName.toLowerCase() !== name.toLowerCase()) {
    const [[dup]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM ms_student WHERE LOWER(`name`) = LOWER(?)',
      [name]
    );
    if (dup.cnt > 0) {
      const err = new Error('Nama baru sudah digunakan.');
      err.code = 'DUPLICATE_NAME';
      throw err;
    }
  }

  // Update (sekalian rename PK dari originalName -> name)
  const [res] = await pool.execute(
    'UPDATE ms_student SET `name`=?, `class`=?, `email`=? WHERE `name`=?',
    [name, className, email, originalName]
  );

  // Jika baris tidak ditemukan
  if (res.affectedRows === 0) {
    const err = new Error('Data siswa tidak ditemukan.');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

async function deleteStudent(name) {
  const [res] = await pool.execute(
    'DELETE FROM ms_student WHERE `name` = ?',
    [name]
  );
  if (res.affectedRows === 0) {
    const err = new Error('Data siswa tidak ditemukan.');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

// Escape karakter spesial untuk LIKE: % _ \  →  di-escape jadi \% \_ \\
function escapeLike(raw) {
  return raw.replace(/([_%\\])/g, '\\$1');
}

// Cari siswa berdasarkan keyword (opsional). Urutkan by name ASC.
function escapeLike(raw) {
  // Escape %, _ dan \ agar tidak jadi wildcard tak sengaja
  return raw.replace(/([_%\\])/g, '\\$1');
}

async function searchStudents(keywordRaw) {
  const q = (keywordRaw || '').trim();

  if (!q) {
    const [rows] = await pool.query(
      'SELECT `name`, `class`, `email` FROM ms_student ORDER BY `name` ASC'
    );
    return rows;
  }

  const pat = `%${escapeLike(q)}%`;
  const sql =
    'SELECT `name`, `class`, `email` ' +
    'FROM ms_student ' +
    "WHERE `name`  LIKE ? ESCAPE '\\\\' " +   // <-- single quotes di SQL; \\ di JS → \ di SQL
    "   OR `class` LIKE ? ESCAPE '\\\\' " +
    "   OR `email` LIKE ? ESCAPE '\\\\' " +
    'ORDER BY `name` ASC';

  const [rows] = await pool.query(sql, [pat, pat, pat]);
  return rows;
}


module.exports = {
  getAllStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  searchStudents,     // <— pastikan diekspor
};




