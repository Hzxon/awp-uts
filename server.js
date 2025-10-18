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

// --- SIMULASI DATABASE ---
let users = { 'admin': { password: 'admin123', name: 'Admin Utama', role: 'admin' }, 'siswa': { password: 'siswa123', name: 'Siswa Rajin', role: 'student' }};
let students = [
    { id: 101, name: 'Ahmad Subagja', class: 'XII IPA 1', email: 'ahmad.s@email.com' },
    { id: 102, name: 'Budi Santoso', class: 'XI IPS 3', email: 'budi.s@email.com' },
    { id: 103, name: 'Citra Lestari', class: 'X-1', email: 'citra.l@email.com' }
];
let nextStudentId = 104;

// Middleware
const checkAuth = (req, res, next) => req.session.user ? next() : res.redirect('/login');
const checkAdmin = (req, res, next) => (req.session.user && req.session.user.role === 'admin') ? next() : res.status(403).send("Akses ditolak.");

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
      'SELECT username, password FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (!rows.length) {
      return res.render('pages/login', { error: 'Username tidak ditemukan' });
    }

    // ambil user pertama
    const user = rows[0];

    // bandingkan password plain
    if (user.password !== password) {
      return res.render('pages/login', { error: 'Password salah' });
    }

    // simpan sesi login
    req.session.user = { username: user.username };

    // redirect ke dashboard atau halaman utama
    return res.redirect('/');
  } catch (err) {
    console.error(err);
    return res.status(500).render('pages/login', { error: 'Terjadi kesalahan server' });
  }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
app.get('/', checkAuth, (req, res) => res.redirect('/dashboard'));
app.get('/dashboard', checkAuth, (req, res) => res.render('pages/dashboard', { user: req.session.user }));

// Mengirim data 'gems' ke halaman belajar-ai
app.get('/belajar-ai', checkAuth, (req, res) => {
    res.render('pages/belajar-ai', { user: req.session.user, gems: geminiGems });
});

// lihat daftar siswa
app.get('/students', /* checkAuth, */ async (req, res) => {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT id, name, `class`, email FROM ms_student ORDER BY id DESC');
  res.render('pages/students', { user: req.session.user, students: rows });
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
app.get('/master-siswa', checkAuth, checkAdmin, (req, res) => res.render('pages/master-siswa', { user: req.session.user, students: students }));
app.post('/master-siswa/add', checkAuth, checkAdmin, (req, res) => {
    const { name, class: studentClass, email } = req.body;
    if(name && studentClass && email) students.push({ id: nextStudentId++, name, class: studentClass, email });
    res.redirect('/master-siswa');
});
app.post('/master-siswa/edit/:id', checkAuth, checkAdmin, (req, res) => {
    const student = students.find(s => s.id == req.params.id);
    if (student) {
        student.name = req.body.name;
        student.class = req.body.class;
        student.email = req.body.email;
    }
    res.redirect('/master-siswa');
});
app.post('/master-siswa/delete/:id', checkAuth, checkAdmin, (req, res) => {
    students = students.filter(s => s.id != req.params.id);
    res.redirect('/master-siswa');
});
app.get('/laporan-nilai', checkAuth, (req, res) => {
    let { keyword } = req.query;
    let filteredStudents = students;
    if (keyword) {
        keyword = keyword.toLowerCase();
        filteredStudents = students.filter(s => s.name.toLowerCase().includes(keyword) || s.class.toLowerCase().includes(keyword));
    }
    res.render('pages/laporan-nilai', { user: req.session.user, students: filteredStudents, keyword: keyword || '' });
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

