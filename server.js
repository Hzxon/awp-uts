require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const { randomUUID } = require('crypto');
const { pool } = require('./db');
const api = require('./routes');
const { getCollection, writeDB } = require('./db');
const { getAllStudents, addStudent, updateStudent, deleteStudent } = require('./studentModel');

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const SESSION_SECRET = process.env.SESSION_SECRET || 'awp-uts-session-secret';
const STUDENT_COLLECTION = 'students';

app.set('trust proxy', 1);

const GEM_PERSONAS = {
  'tutor-cerdas': {
    name: 'Tutor Cerdas',
    prompt:
      'Anda adalah seorang tutor AI yang ramah dan cerdas. Jawab pertanyaan pengguna dalam Bahasa Indonesia. Jika pertanyaan tersebut bisa dijawab menggunakan "Teks Sumber" yang diberikan, prioritaskan informasi tersebut terlebih dahulu.'
  },
  'pakar-sejarah': {
    name: 'Pakar Sejarah',
    prompt:
      'Anda adalah sejarawan yang sangat ahli. Analisis pertanyaan pengguna dari sudut pandang historis. Gunakan gaya bahasa yang formal dan informatif.'
  },
  'asisten-kreatif': {
    name: 'Asisten Kreatif',
    prompt:
      'Anda adalah asisten AI yang kreatif. Olah informasi dari "Teks Sumber" menjadi gagasan unik, cerita pendek, atau penjelasan menarik.'
  }
};

const USERS = {
  admin: {
    password: process.env.ADMIN_PASSWORD || 'admin123',
    name: 'Administrator',
    role: 'admin'
  }
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use('/asset', express.static(path.join(__dirname, 'asset')));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// DEBUG: coba insert 1 baris sangat unik supaya tidak bentrok PK
app.get('/debug/insert-test', async (req, res) => {
  const { pool } = require('./db');
  const probe = `__probe_${Date.now()}`; // nama unik tiap klik

  try {
    const [result] = await pool.execute(
      'INSERT INTO ms_student (`name`, `class`, `email`) VALUES (?, ?, ?)',
      [probe, 'X-TEST', 'probe@example.com']
    );
    return res.json({ ok: true, inserted: { name: probe }, result });
  } catch (e) {
    // tampilkan info selengkap mungkin
    return res.status(500).json({
      ok: false,
      code: e.code,
      errno: e.errno,
      sqlState: e.sqlState,
      message: e.message,
      sqlMessage: e.sqlMessage,
      sql: e.sql
    });
  }
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('pages/login', { error: null });
});

app.get('/db-check', async (req, res) => {
  const diag = {};
  try {
    // 1) Cek variabel env ada/tidak (tanpa menampilkan isinya)
    diag.env = {
      hasHost: !!process.env.TIDB_HOST,
      hasPort: !!process.env.TIDB_PORT,
      hasUser: !!process.env.TIDB_USER,
      hasPass: !!process.env.TIDB_PASSWORD,
      hasDb:   !!process.env.TIDB_DATABASE,
      caLen:   (process.env.TIDB_CA || '').length
    };

    // 2) Coba ping koneksi
    const [[ping]] = await pool.query('SELECT 1 AS ok');
    diag.ping = ping;

    // 3) Hitung baris ms_student (boleh error kalau tabel belum ada, kita tangkap)
    const [[countRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM ms_student');
    diag.count = countRow.cnt;

    return res.status(200).send({ ok: true, diag });
  } catch (err) {
    diag.error = {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      errno: err?.errno,
      fatal: err?.fatal,
      sqlState: err?.sqlState,
      stack: err?.stack?.split('\n').slice(0, 3)  // 3 baris pertama
    };
    return res.status(500).send({ ok: false, diag });
  }
});


app.get('/env-check', (req, res) => {
  res.send({
    hasHost: !!process.env.TIDB_HOST,
    hasPort: !!process.env.TIDB_PORT,
    hasUser: !!process.env.TIDB_USER,
    hasPass: !!process.env.TIDB_PASSWORD,
    hasDb:   !!process.env.TIDB_DATABASE,
    caLen:   (process.env.TIDB_CA || '').length
  });
});


app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const record = USERS[username];

  if (!record || record.password !== password) {
    return res.status(401).render('pages/login', { error: 'Username atau password salah.' });
  }

  req.session.user = {
    username,
    name: record.name,
    role: record.role
  };

  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('pages/dashboard', { user: req.session.user });
});

app.get('/belajar-ai', requireAuth, (req, res) => {
  res.render('pages/belajar-ai', {
    user: req.session.user,
    gems: GEM_PERSONAS
  });
});

app.get('/students', requireAuth, (req, res) => res.redirect('/master-siswa'));

app.get('/master-siswa', requireAuth, asyncHandler(async (req, res) => {
  const students = await getAllStudents(); // dari TiDB
  res.render('pages/master-siswa', {
    user: req.session.user,
    students
  });
}));

app.post('/master-siswa/add', requireAuth, asyncHandler(async (req, res) => {
  const name  = (req.body.name  || '').trim();
  const cls   = (req.body.class || '').trim();
  const email = (req.body.email || '').trim();

  if (!name || !cls || !email) {
    return res.status(400).send('Semua field wajib diisi.');
  }

  try {
    await addStudent(name, cls, email);
    return res.redirect('/master-siswa');
  } catch (e) {
    if (e.code === 'DUPLICATE_NAME') {
      return res.status(409).send('Nama siswa sudah digunakan.');
    }
    console.error(e);
    return res.status(500).send('Gagal menambah data.');
  }
}));



app.post('/master-siswa/edit/:originalName', requireAuth, asyncHandler(async (req, res) => {
  const originalName = (req.params.originalName || '').trim();
  const name  = (req.body.name  || '').trim();
  const cls   = (req.body.class || '').trim();
  const email = (req.body.email || '').trim();

  if (!originalName || !name || !cls || !email) {
    return res.status(400).send('Semua field wajib diisi.');
  }

  try {
    await updateStudent(originalName, name, cls, email);
    return res.redirect('/master-siswa');
  } catch (e) {
    if (e.code === 'DUPLICATE_NAME') {
      return res.status(409).send('Nama baru sudah digunakan.');
    }
    if (e.code === 'NOT_FOUND') {
      return res.status(404).send('Data siswa tidak ditemukan.');
    }
    console.error('EDIT ERROR:', e);
    return res.status(500).send(`Gagal mengubah data. (${e.code || 'NO_CODE'}: ${e.message || 'no message'})`);
  }
}));

app.post('/master-siswa/delete/:name', requireAuth, asyncHandler(async (req, res) => {
  const name = (req.params.name || '').trim();
  if (!name) return res.status(400).send('Nama tidak valid.');

  try {
    await deleteStudent(name);
    return res.redirect('/master-siswa');
  } catch (e) {
    if (e.code === 'NOT_FOUND') {
      return res.status(404).send('Data siswa tidak ditemukan.');
    }
    console.error('DELETE ERROR:', e);
    return res.status(500).send(`Gagal menghapus data. (${e.code || 'NO_CODE'}: ${e.message || 'no message'})`);
  }
}));


app.get('/laporan-nilai', requireAuth, asyncHandler(async (req, res) => {
  const keywordRaw = (req.query.keyword || '').trim();
  const keyword = keywordRaw.toLowerCase();
  const { collection } = await getCollection(STUDENT_COLLECTION);

  const filtered = keyword
    ? collection.filter((student) => {
        return (
          student.name.toLowerCase().includes(keyword) ||
          (student.class || '').toLowerCase().includes(keyword) ||
          (student.email || '').toLowerCase().includes(keyword)
        );
      })
    : collection;

  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  res.render('pages/laporan-nilai', {
    user: req.session.user,
    students: sorted,
    keyword: keywordRaw
  });
}));

app.post('/api/ask-ai', requireAuth, asyncHandler(async (req, res) => {
  const { sourceText, question, gem } = req.body;
  if (!sourceText || !question) {
    return res.status(400).json({ error: 'Pertanyaan dan sumber teks tidak boleh kosong.' });
  }

  const selectedGem = GEM_PERSONAS[gem] || GEM_PERSONAS['tutor-cerdas'];
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.json({
      answer: 'Integrasi Gemini belum dikonfigurasi. Tambahkan GEMINI_API_KEY pada environment.'
    });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: `Teks Sumber:\n---\n${sourceText}\n---\nPertanyaan: ${question}` }] }],
    systemInstruction: { parts: [{ text: selectedGem.prompt }] }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody?.error?.message || 'Gagal mendapatkan jawaban dari layanan Gemini.';
    throw new Error(message);
  }

  const result = await response.json();
  const generatedText =
    result.candidates?.[0]?.content?.parts?.[0]?.text ||
    'Maaf, saya tidak dapat menemukan jawaban saat ini.';

  res.json({ answer: generatedText });
}));

app.use('/api', api);

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.accepts('html')) {
    res.status(500).send('Terjadi kesalahan pada server.');
  } else {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});

app.get('/debug/env', (req, res) => {
  res.json({ port_env: process.env.PORT, db_path: process.env.DB_PATH });
});
