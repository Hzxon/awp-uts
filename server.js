// Muat environment variables dari file .env
require('dotenv').config();

// Import modul yang dibutuhkan
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

// Inisialisasi aplikasi Express
const app = express();
const { getPool } = require('./db');
const port = 3000;

// Konfigurasi middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Konfigurasi session
app.use(session({
    secret: 'kunci-rahasia-uts-project',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- SIMULASI GEMINI GEMS ---
// Kumpulan persona/prompt yang bisa dipilih oleh pengguna
const geminiGems = {
    'tutor-cerdas': {
        name: 'Tutor Cerdas',
        prompt: `Anda adalah seorang tutor AI yang ramah dan cerdas. Jawab pertanyaan pengguna dalam Bahasa Indonesia. Jika pertanyaan tersebut bisa dijawab menggunakan "Teks Sumber" yang diberikan, prioritaskan untuk menjawab berdasarkan teks tersebut. Jika tidak, jawablah pertanyaan tersebut berdasarkan pengetahuan umum Anda.`
    },
    'pakar-sejarah': {
        name: 'Pakar Sejarah',
        prompt: `Anda adalah seorang sejarawan yang sangat ahli. Analisis pertanyaan pengguna dari sudut pandang historis. Berikan jawaban yang mendalam dan detail. Selalu prioritaskan informasi dari "Teks Sumber" jika relevan. Jika tidak, gunakan pengetahuan sejarah Anda yang luas. Gunakan gaya bahasa yang formal dan informatif.`
    },
    'asisten-kreatif': {
        name: 'Asisten Kreatif',
        prompt: `Anda adalah asisten AI yang imajinatif dan kreatif. Jawab pertanyaan pengguna dengan cara yang unik dan menarik. Jika "Teks Sumber" ada, gunakan sebagai titik awal untuk eksplorasi kreatif, misalnya dengan membuat cerita pendek, puisi, atau ide-ide brainstorming yang berhubungan dengan teks tersebut. Jangan takut untuk berpikir di luar kotak.`
    }
};


// Middleware
const checkAuth = (req, res, next) =>
  req.session.user ? next() : res.redirect('/login');

const checkAdmin = (req, res, next) =>
  (req.session.user && req.session.user.username === 'admin')
    ? next()
    : res.status(403).send('Akses ditolak.');

// --- ROUTING ---
app.get('/login', (req, res) => res.render('pages/login', { error: null }));

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.render('pages/login', { error: 'Username dan password wajib diisi' });
    }

    const pool = await getPool();
    const [rows] = await pool.query(
      'SELECT username, password, role FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (!rows.length) {
      return res.render('pages/login', { error: 'Username tidak ditemukan' });
    }

    const user = rows[0];

    if (user.password !== password) {
      return res.render('pages/login', { error: 'Password salah' });
    }

    req.session.user = { username: user.username, role: user.role };

    return res.redirect('/');
  } catch (err) {
    console.error(err);
    return res.status(500).render('pages/login', { error: 'Terjadi kesalahan server' });
  }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/', checkAuth, (req, res) => {
  res.render('pages/dashboard', { user: req.session.user });
});


app.get('/dashboard', checkAuth, (req, res) => res.render('pages/dashboard', { user: req.session.user }));

// Mengirim data 'gems' ke halaman belajar-ai
app.get('/belajar-ai', checkAuth, (req, res) => {
    res.render('pages/belajar-ai', { user: req.session.user, gems: geminiGems });
});

// lihat daftar siswa
app.get('/students', (req, res) => res.redirect('/master-siswa'));



// TAMBAH siswa → simpan ke DB
app.post('/master-siswa/add', checkAuth, async (req, res) => {
  const { name, class: cls, email } = req.body;
  if (!name || !cls || !email) return res.status(400).send('Semua field wajib diisi');
  const pool = await getPool();
  try {
    await pool.query('INSERT INTO ms_student (name, `class`, email) VALUES (?, ?, ?)', [name, cls, email]);
    res.redirect('/master-siswa');
  } catch (e) {
    if (String(e).toLowerCase().includes('duplicate')) {
      return res.status(409).send('Nama sudah terdaftar. Gunakan nama lengkap lain.');
    }
    console.error(e);
    res.status(500).send('Gagal menambah data.');
  }
});


// EDIT siswa → update ke DB
app.post('/master-siswa/edit/:name', checkAuth, async (req, res) => {
  const oldName = req.params.name;
  const { name: newName, class: cls, email } = req.body;
  if (!newName || !cls || !email) return res.status(400).send('Semua field wajib diisi');

  const pool = await getPool();
  try {
    await pool.query('UPDATE ms_student SET name = ?, `class` = ?, email = ? WHERE name = ?', [newName, cls, email, oldName]);
    res.redirect('/master-siswa');
  } catch (e) {
    if (String(e).toLowerCase().includes('duplicate')) {
      return res.status(409).send('Nama baru sudah dipakai. Pilih nama lain.');
    }
    console.error(e);
    res.status(500).send('Gagal mengubah data.');
  }
});



// HAPUS siswa → delete di DB
app.post('/master-siswa/delete/:name', checkAuth, async (req, res) => {
  const { name } = req.params;
  const pool = await getPool();
  await pool.query('DELETE FROM ms_student WHERE name = ?', [name]);
  res.redirect('/master-siswa');
});



// LAPORAN NILAI (list + search) — dari DB
app.get('/laporan-nilai', checkAuth, async (req, res) => {
  const keywordRaw = (req.query.keyword || '').trim();

  const pool = await getPool();

  // Jika keyword kosong → tampilkan semua
  if (!keywordRaw) {
    const [rows] = await pool.query(
      'SELECT name, `class`, email FROM ms_student ORDER BY name ASC'
    );
    return res.render('pages/laporan-nilai', {
      user: req.session.user,
      students: rows,
      keyword: ''
    });
  }

  // Jika ada keyword → LIKE di name/class/email
  const like = `%${keywordRaw}%`;
  const [rows] = await pool.query(
    `SELECT name, \`class\`, email
     FROM ms_student
     WHERE name  LIKE ?
        OR \`class\` LIKE ?
        OR email LIKE ?
     ORDER BY name ASC`,
    [like, like, like]
  );

  res.render('pages/laporan-nilai', {
    user: req.session.user,
    students: rows,
    keyword: keywordRaw
  });
});




// API endpoint untuk berinteraksi dengan Gemini
app.post('/api/ask-ai', checkAuth, async (req, res) => {
    const { sourceText, question, gem } = req.body; // Menerima 'gem' dari frontend
    if (!question || !sourceText) return res.status(400).json({ error: 'Pertanyaan dan sumber teks tidak boleh kosong.' });

    try {
        // Memilih prompt berdasarkan 'gem' yang dipilih, atau gunakan default 'tutor-cerdas'
        const selectedGem = geminiGems[gem] || geminiGems['tutor-cerdas'];
        const systemPrompt = selectedGem.prompt;
        
        const userQuery = `Teks Sumber:\n---\n${sourceText}\n---\nPertanyaan: ${question}`;
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY tidak ditemukan.");
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.json(); 
            console.error("API Error Body:", JSON.stringify(errorBody, null, 2));
            throw new Error(`Panggilan API gagal: ${errorBody.error.message}`);
        }

        const result = await apiResponse.json();
        const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya tidak dapat menemukan jawaban saat ini.";
        res.json({ answer: generatedText });

    } catch (error) {
        console.error('Error saat memanggil Gemini API:', error);
        res.status(500).json({ error: error.message || 'Terjadi kesalahan internal.' });
    }
});

// Rute Modul Lainnya (tidak berubah)
app.get('/master-siswa', checkAuth, async (req, res) => {
  const pool = await getPool();
  const [rows] = await pool.query(
  'SELECT name, `class`, email FROM ms_student ORDER BY name ASC'
);

  res.render('pages/master-siswa', { user: req.session.user, students: rows });
});


app.get('/debug/db', async (req, res) => {
  try {
    const pool = await getPool();
    const [r] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, result: r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Menjalankan server
app.listen(port, () => console.log(`Aplikasi berjalan di http://localhost:${port}`));

