// Import modul yang dibutuhkan
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

// Inisialisasi aplikasi Express
const app = express();
const port = 3000;

// Konfigurasi middleware
app.set('view engine', 'ejs'); // Set EJS sebagai view engine
app.set('views', path.join(__dirname, 'views')); // Tentukan direktori views
app.use(bodyParser.urlencoded({ extended: true })); // Untuk parsing body dari form
app.use(bodyParser.json()); // Untuk parsing JSON body dari API call

// Konfigurasi session untuk manajemen login
app.use(session({
    secret: 'kunci-rahasia-uts-project',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set 'true' jika menggunakan HTTPS
}));

// --- SIMULASI DATABASE (JSON) ---
// Sesuai kriteria soal, bisa menggunakan JSON atau MySQL
let users = {
    'admin': { password: 'admin123', name: 'Admin Utama', role: 'admin' },
    'siswa': { password: 'siswa123', name: 'Siswa Rajin', role: 'student' }
};

let students = [
    { id: 101, name: 'Ahmad Subagja', class: 'XII IPA 1', email: 'ahmad.s@email.com' },
    { id: 102, name: 'Budi Santoso', class: 'XI IPS 3', email: 'budi.s@email.com' },
    { id: 103, name: 'Citra Lestari', class: 'X-1', email: 'citra.l@email.com' }
];
let nextStudentId = 104;

// Middleware untuk proteksi route
const checkAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).send("Akses ditolak. Anda bukan Admin.");
    }
};


// --- ROUTING ---

// Halaman Login
app.get('/login', (req, res) => {
    res.render('pages/login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    // 1.a Validasi input tidak boleh kosong
    if (!username || !password) {
        return res.render('pages/login', { error: 'Username dan password harus diisi.' });
    }
    const user = users[username];
    // 1.b Informasi jika login gagal
    if (!user || user.password !== password) {
        return res.render('pages/login', { error: 'Username atau password salah.' });
    }
    // 1.c Login sukses, simpan data user ke session
    req.session.user = { username, name: user.name, role: user.role };
    res.redirect('/dashboard');
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});


// Halaman Utama (setelah login)
app.get('/', checkAuth, (req, res) => {
    res.redirect('/dashboard');
});

app.get('/dashboard', checkAuth, (req, res) => {
    res.render('pages/dashboard', { user: req.session.user });
});

// ===== FITUR BARU: Belajar dengan AI =====
app.get('/belajar-ai', checkAuth, (req, res) => {
    res.render('pages/belajar-ai', { user: req.session.user });
});

// API endpoint untuk berinteraksi dengan Gemini
app.post('/api/ask-ai', checkAuth, async (req, res) => {
    const { sourceText, question } = req.body;
    
    if (!question || !sourceText) {
        return res.status(400).json({ error: 'Pertanyaan dan sumber teks tidak boleh kosong.' });
    }

    try {
        // Ini adalah System Prompt, memberitahu AI perannya
        const systemPrompt = `Anda adalah seorang tutor AI yang ahli. Berdasarkan "Teks Sumber" yang saya berikan, jawab "Pertanyaan" dari pengguna dengan jelas dan informatif dalam Bahasa Indonesia. Fokuskan jawaban Anda hanya pada informasi yang ada di dalam Teks Sumber.`;
        
        // Gabungkan Teks Sumber dan Pertanyaan menjadi satu prompt
        const userQuery = `Teks Sumber:\n---\n${sourceText}\n---\nPertanyaan: ${question}`;
        
        const apiKey = ""; // API Key tidak diperlukan jika menggunakan model default di lingkungan ini
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
        };

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            throw new Error(`API call failed with status ${apiResponse.status}: ${errorBody}`);
        }

        const result = await apiResponse.json();
        const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya tidak dapat menemukan jawaban saat ini.";
        
        res.json({ answer: generatedText });

    } catch (error) {
        console.error('Error calling Gemini API:', error);
        res.status(500).json({ error: 'Terjadi kesalahan saat menghubungi AI.' });
    }
});


// Modul Master Siswa (CRUD)
app.get('/master-siswa', checkAuth, checkAdmin, (req, res) => {
    res.render('pages/master-siswa', { user: req.session.user, students: students });
});

// Create
app.post('/master-siswa/add', checkAuth, checkAdmin, (req, res) => {
    const { name, class: studentClass, email } = req.body;
    // 3.e Validasi
    if(name && studentClass && email){
        students.push({ id: nextStudentId++, name, class: studentClass, email });
    }
    res.redirect('/master-siswa');
});

// Update (hanya simulasi, data tidak disimpan permanen)
app.post('/master-siswa/edit/:id', checkAuth, checkAdmin, (req, res) => {
    const student = students.find(s => s.id == req.params.id);
    if (student) {
        student.name = req.body.name;
        student.class = req.body.class;
        student.email = req.body.email;
    }
    res.redirect('/master-siswa');
});

// Delete
app.post('/master-siswa/delete/:id', checkAuth, checkAdmin, (req, res) => {
    students = students.filter(s => s.id != req.params.id);
    res.redirect('/master-siswa');
});


// Modul Laporan
app.get('/laporan-nilai', checkAuth, (req, res) => {
    // 4.b Fitur filter/search
    let { keyword } = req.query;
    let filteredStudents = students;
    if (keyword) {
        keyword = keyword.toLowerCase();
        filteredStudents = students.filter(s => 
            s.name.toLowerCase().includes(keyword) || 
            s.class.toLowerCase().includes(keyword)
        );
    }
    res.render('pages/laporan-nilai', { user: req.session.user, students: filteredStudents, keyword: keyword || '' });
});

// Menjalankan server
app.listen(port, () => {
    console.log(`Aplikasi berjalan di http://localhost:${port}`);
});

