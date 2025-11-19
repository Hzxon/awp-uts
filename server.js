require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const { randomUUID } = require('crypto');

const api = require('./routes');
const { getCollection, writeDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const SESSION_SECRET = process.env.SESSION_SECRET || 'awp-uts-session-secret';
const STUDENT_COLLECTION = 'students';
const PASSING_GRADE_FALLBACK = 75;

let LEARNING_MATERIALS = [
  {
    id: 'proklamasi',
    title: 'Proklamasi Kemerdekaan Indonesia',
    theme: 'Sejarah',
    sourceText: [
      'Proklamasi Kemerdekaan Indonesia dibacakan pada 17 Agustus 1945 oleh Soekarno dan Mohammad Hatta di kediaman Soekarno, Jalan Pegangsaan Timur No. 56, Jakarta.',
      'Naskah proklamasi diketik oleh Sayuti Melik dan ditandatangani atas nama bangsa Indonesia.',
      'Peristiwa ini menjadi titik awal lahirnya Republik Indonesia dan memicu perjuangan mempertahankan kemerdekaan.'
    ].join(' '),
    description: 'Mempelajari kronologi singkat dan makna proklamasi kemerdekaan.'
  },
  {
    id: 'sumpah-pemuda',
    title: 'Sumpah Pemuda 1928',
    theme: 'Sejarah',
    sourceText: [
      'Sumpah Pemuda diikrarkan pada 28 Oktober 1928 dalam Kongres Pemuda II di Batavia.',
      'Tiga bunyi sumpah menegaskan satu tanah air, satu bangsa, dan menjunjung tinggi bahasa persatuan yaitu Bahasa Indonesia.',
      'Momentum ini menjadi tonggak persatuan gerakan nasional Indonesia sebelum kemerdekaan.'
    ].join(' '),
    description: 'Mengulas isi dan dampak Sumpah Pemuda bagi persatuan bangsa.'
  },
  {
    id: 'ekosistem',
    title: 'Ekosistem dan Rantai Makanan',
    theme: 'IPA',
    sourceText: [
      'Ekosistem merupakan hubungan timbal balik antara makhluk hidup dengan lingkungannya.',
      'Rantai makanan menggambarkan aliran energi dari produsen ke konsumen hingga pengurai.',
      'Keseimbangan ekosistem dipengaruhi oleh kelimpahan tiap komponen dan interaksi antar makhluk hidup.'
    ].join(' '),
    description: 'Belajar konsep dasar ekosistem, rantai makanan, dan keseimbangan lingkungan.'
  }
];

let CUSTOM_MATERIALS = [];

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    value = trimmed;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function getPassingGrade() {
  const configured = toFiniteNumber(process.env.PASSING_GRADE);
  if (configured === null) return PASSING_GRADE_FALLBACK;
  return Math.max(0, Math.min(100, Math.round(configured)));
}

function computeSubjectStatus(score, explicitStatus, passingGrade) {
  const normalizedStatus = (explicitStatus || '').trim();
  if (normalizedStatus) return normalizedStatus;
  if (score === null) return 'Belum dinilai';
  return score >= passingGrade ? 'Lulus' : 'Remedial';
}

function normalizeSubjectEntry(subject, passingGrade, index = 0) {
  if (!subject || typeof subject !== 'object') return null;
  const name = (subject.name || '').trim() || '-';
  const score = clampScore(subject.score);
  const note = subject.note || subject.description || '';
  const status = computeSubjectStatus(score, subject.status, passingGrade);
  return { index, name, score, status, note };
}

function normalizeSubjectsList(subjects, passingGrade) {
  if (!Array.isArray(subjects)) return [];
  return subjects
    .map((subject, index) => normalizeSubjectEntry(subject, passingGrade, index))
    .filter(Boolean);
}

function ensureSubjectsArray(student) {
  if (!Array.isArray(student.subjects)) {
    student.subjects = [];
  }
  return student.subjects;
}

async function getStudentRecordByName(studentName) {
  const { db, collection } = await getCollection(STUDENT_COLLECTION);
  const index = collection.findIndex((item) => item.name === studentName);
  const student = index === -1 ? null : collection[index];
  return { db, collection, student, index };
}

app.set('trust proxy', 1);

const GEM_PERSONAS = {
  'tutor-cerdas': {
    name: 'Tutor Cerdas',
    prompt:
      'Anda adalah seorang tutor AI yang ramah dan cerdas. Jawab pertanyaan pengguna dalam Bahasa Indonesia. Jika pertanyaan tersebut bisa dijawab menggunakan "Teks Sumber" yang diberikan, prioritaskan informasi tersebut terlebih dahulu. Jika tidak ada teks sumber atau teks sumber tidak relevan, berikan penjelasan yang jelas dan mudah dipahami berdasarkan topik yang ditanyakan.'
  },
  'asisten-kreatif': {
    name: 'Asisten Kreatif',
    prompt:
      'Anda adalah asisten AI yang kreatif. Olah informasi dari "Teks Sumber" menjadi gagasan unik, cerita pendek, atau penjelasan menarik. Jika tidak ada teks sumber atau teks sumber tidak relevan, berikan gagasan unik, cerita pendek, atau penjelasan menarik berdasarkan topik yang ditanyakan.'
  },
  'asisten-remedial': {
    name: 'Asisten Remedial',
    prompt:
      'Anda adalah asisten AI yang berfokus pada remedial. Analisis pertanyaan pengguna dan berikan penjelasan yang jelas dan mudah dipahami. Jika tidak ada teks sumber atau teks sumber tidak relevan, berikan penjelasan yang jelas dan mudah dipahami berdasarkan topik yang ditanyakan.'
  },
  'quiz-bot': {
    name: 'Quiz Bot',
    prompt:
      'Anda adalah asisten AI yang berfokus pada pembuatan quiz. Analisis topik materi yang ditanyakan pengguna dan buatkan minimal 10 soal yang sesuai dengan materi yang ditanyakan. Setiap soal harus memiliki 4 pilihan jawaban dan hanya ada satu jawaban yang benar. Jangan berikan penjelasan atau informasi tambahan selain soal dan jawaban. Jika tidak ada teks sumber atau teks sumber tidak relevan, berikan soal dan jawaban berdasarkan topik yang ditanyakan. '
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

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('pages/login', { error: null });
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

app.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const { collection } = await getCollection(STUDENT_COLLECTION);
  const totalStudents = collection.length;

  const classSet = new Set(
    collection
      .map((student) => (student.class || '').trim())
      .filter(Boolean)
  );

  const parseNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const getTimestamp = (student) => {
    const raw = student?.updatedAt || student?.createdAt;
    const parsed = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatter = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const latestStudents = [...collection]
    .sort((a, b) => getTimestamp(b) - getTimestamp(a))
    .slice(0, 5)
    .map((student) => {
      const timestamp = getTimestamp(student);
      return {
        ...student,
        displayUpdated: timestamp ? formatter.format(timestamp) : '-'
      };
    });

  const parseOptionalNumber = (value) => {
    const raw = value ?? '';
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const trimmed = String(raw).trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const stats = {
    totalStudents,
    totalClasses: classSet.size,
    totalTeachers: parseOptionalNumber(process.env.TEACHER_COUNT),
    totalSubjects: parseOptionalNumber(process.env.SUBJECT_COUNT)
  };

  res.render('pages/dashboard', {
    user: req.session.user,
    stats,
    latestStudents
  });
}));

app.get('/belajar-ai', requireAuth, (req, res) => {
  const materials = [...LEARNING_MATERIALS, ...CUSTOM_MATERIALS];
  res.render('pages/belajar-ai', {
    user: req.session.user,
    gems: GEM_PERSONAS,
    materials,
    successMessage: req.query.success || null,
    selectedMaterialId: req.query.selected || null
  });
});

app.get('/belajar-ai/materials/new', requireAuth, (req, res) => {
  res.render('pages/belajar-ai-new-material', {
    user: req.session.user,
    error: req.query.error || null,
    form: {
      title: req.query.title || '',
      theme: req.query.theme || '',
      description: req.query.description || '',
      sourceText: req.query.sourceText || ''
    }
  });
});

app.get('/students', requireAuth, (req, res) => res.redirect('/master-siswa'));

app.post('/belajar-ai/materials', requireAuth, asyncHandler(async (req, res) => {
  const title = (req.body.title || '').trim();
  const theme = (req.body.theme || '').trim();
  const description = (req.body.description || '').trim();
  const sourceText = (req.body.sourceText || '').trim();

  if (!title || !sourceText) {
    const params = new URLSearchParams({
      error: 'Judul dan materi wajib diisi.',
      title,
      theme,
      description,
      sourceText
    });
    return res.redirect(`/belajar-ai/materials/new?${params.toString()}`);
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const newMaterial = {
    id,
    title,
    theme: theme || 'Umum',
    description: description || 'Materi tambahan pengguna',
    sourceText
  };

  CUSTOM_MATERIALS.push(newMaterial);

  return res.redirect(`/belajar-ai?success=${encodeURIComponent('Materi berhasil ditambahkan.')}&selected=${encodeURIComponent(id)}`);
}));

app.get('/nilai-siswa', requireAuth, asyncHandler(async (req, res) => {
  const { collection } = await getCollection(STUDENT_COLLECTION);
  const passingGrade = getPassingGrade();

  const summaries = collection
    .map((student) => {
      const subjects = normalizeSubjectsList(student.subjects, passingGrade);
      const totalSubjects = subjects.length;
      const scoreValues = subjects
        .map((s) => s.score)
        .filter((score) => score !== null && score !== undefined);

      const averageScore = scoreValues.length
        ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
        : null;

      const passedCount = subjects.filter((s) => s.status.toLowerCase() === 'lulus').length;
      const remedialCount = subjects.filter((s) => s.status.toLowerCase() === 'remedial').length;

      const latestUpdate = [student.updatedAt, student.createdAt]
        .map((value) => (value ? Date.parse(value) : NaN))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0] || null;

      return {
        student,
        subjects,
        totalSubjects,
        averageScore,
        passedCount,
        remedialCount,
        latestUpdate
      };
    })
    .sort((a, b) => {
      if (b.latestUpdate && a.latestUpdate) return b.latestUpdate - a.latestUpdate;
      if (b.latestUpdate) return 1;
      if (a.latestUpdate) return -1;
      return a.student.name.localeCompare(b.student.name, 'id', { sensitivity: 'base' });
    });

  res.render('pages/nilai-overview', {
    user: req.session.user,
    summaries,
    passingGrade
  });
}));

app.get('/master-siswa', requireAuth, asyncHandler(async (req, res) => {
  const { collection } = await getCollection(STUDENT_COLLECTION);
  const sorted = [...collection].sort((a, b) => a.name.localeCompare(b.name));
  res.render('pages/master-siswa', {
    user: req.session.user,
    students: sorted
  });
}));

app.post('/master-siswa/add', requireAuth, asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  const cls = (req.body.class || '').trim();
  const email = (req.body.email || '').trim();

  if (!name || !cls || !email) {
    return res.status(400).send('Semua field wajib diisi.');
  }

  const { db, collection } = await getCollection(STUDENT_COLLECTION);

  const duplicate = collection.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    return res.status(409).send('Nama siswa sudah digunakan.');
  }

  const now = new Date().toISOString();
  collection.push({
    id: randomUUID(),
    name,
    class: cls,
    email,
    subjects: [],
    createdAt: now,
    updatedAt: now
  });

  await writeDB(db);
  res.redirect('/master-siswa');
}));

app.post('/master-siswa/edit/:originalName', requireAuth, asyncHandler(async (req, res) => {
  const originalName = req.params.originalName;
  const name = (req.body.name || '').trim();
  const cls = (req.body.class || '').trim();
  const email = (req.body.email || '').trim();

  if (!name || !cls || !email) {
    return res.status(400).send('Semua field wajib diisi.');
  }

  const { db, collection } = await getCollection(STUDENT_COLLECTION);
  const index = collection.findIndex((s) => s.name === originalName);

  if (index === -1) {
    return res.status(404).send('Data siswa tidak ditemukan.');
  }

  if (originalName !== name) {
    const duplicate = collection.find(
      (s, i) => i !== index && s.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      return res.status(409).send('Nama baru sudah digunakan.');
    }
  }

  const current = collection[index];
  collection[index] = {
    ...current,
    name,
    class: cls,
    email,
    updatedAt: new Date().toISOString()
  };

  await writeDB(db);
  res.redirect('/master-siswa');
}));

app.post('/master-siswa/delete/:name', requireAuth, asyncHandler(async (req, res) => {
  const name = req.params.name;
  const { db, collection } = await getCollection(STUDENT_COLLECTION);
  const index = collection.findIndex((s) => s.name === name);

  if (index === -1) {
    return res.status(404).send('Data siswa tidak ditemukan.');
  }

  collection.splice(index, 1);
  await writeDB(db);
  res.redirect('/master-siswa');
}));

app.get('/master-siswa/:name/subjects', requireAuth, asyncHandler(async (req, res) => {
  const studentName = req.params.name;
  const { student } = await getStudentRecordByName(studentName);

  if (!student) {
    return res.status(404).send('Data siswa tidak ditemukan.');
  }

  const passingGrade = getPassingGrade();
  const subjects = normalizeSubjectsList(student.subjects, passingGrade);
  const message = {
    error: (req.query.error || '').toString(),
    success: (req.query.success || '').toString()
  };

  res.render('pages/nilai-siswa', {
    user: req.session.user,
    student,
    subjects,
    passingGrade,
    message
  });
}));

app.post('/master-siswa/:name/subjects', requireAuth, asyncHandler(async (req, res) => {
  const studentName = req.params.name;
  const { db, student } = await getStudentRecordByName(studentName);

  if (!student) {
    return res.status(404).send('Data siswa tidak ditemukan.');
  }

  const subjectName = (req.body.subjectName || '').trim();
  const note = (req.body.note || '').trim();
  const score = clampScore(req.body.score);
  const redirectBase = `/master-siswa/${encodeURIComponent(student.name)}/subjects`;

  if (!subjectName) {
    return res.redirect(`${redirectBase}?error=${encodeURIComponent('Nama mata pelajaran wajib diisi.')}`);
  }

  const subjects = ensureSubjectsArray(student);
  subjects.push({
    name: subjectName,
    score,
    note: note || undefined,
    updatedAt: new Date().toISOString()
  });

  student.updatedAt = new Date().toISOString();
  await writeDB(db);

  return res.redirect(`${redirectBase}?success=${encodeURIComponent('Mata pelajaran berhasil ditambahkan.')}`);
}));

app.post('/master-siswa/:name/subjects/:index/delete', requireAuth, asyncHandler(async (req, res) => {
  const studentName = req.params.name;
  const index = Number(req.params.index);
  const { db, student } = await getStudentRecordByName(studentName);

  if (!student) {
    return res.status(404).send('Data siswa tidak ditemukan.');
  }

  const redirectBase = `/master-siswa/${encodeURIComponent(student.name)}/subjects`;

  if (!Number.isInteger(index) || index < 0) {
    return res.redirect(`${redirectBase}?error=${encodeURIComponent('Data mata pelajaran tidak valid.')}`);
  }

  const subjects = ensureSubjectsArray(student);

  if (!subjects[index]) {
    return res.redirect(`${redirectBase}?error=${encodeURIComponent('Data mata pelajaran tidak ditemukan.')}`);
  }

  subjects.splice(index, 1);
  student.updatedAt = new Date().toISOString();
  await writeDB(db);

  return res.redirect(`${redirectBase}?success=${encodeURIComponent('Mata pelajaran berhasil dihapus.')}`);
}));

app.get('/laporan-nilai', requireAuth, asyncHandler(async (req, res) => {
  const keywordRaw = (req.query.keyword || '').trim();
  const keyword = keywordRaw.toLowerCase();
  const { collection } = await getCollection(STUDENT_COLLECTION);
  const passingGrade = getPassingGrade();

  const filteredStudents = collection.filter((student) => {
    if (!keyword) return true;
    const searchTargets = [
      student.name,
      student.class,
      student.email
    ];

    const subjects = normalizeSubjectsList(student.subjects, passingGrade);
    subjects.forEach((subject) => {
      searchTargets.push(subject.name, subject.status, subject.note);
      if (subject.score !== null && subject.score !== undefined) {
        searchTargets.push(String(subject.score));
      }
    });

    return searchTargets
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });

  const sortedStudents = [...filteredStudents].sort((a, b) =>
    a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
  );

  const reports = sortedStudents.map((student) => {
    const subjects = normalizeSubjectsList(student.subjects, passingGrade);
    const normalizedSubjects = subjects.length
      ? subjects
      : [{ index: null, name: '-', score: null, status: 'Belum ada penilaian', note: '' }];

    return { student, subjects: normalizedSubjects };
  });

  res.render('pages/laporan-nilai', {
    user: req.session.user,
    reports,
    keyword: keywordRaw,
    passingGrade
  });
}));

app.post('/api/ask-ai', requireAuth, asyncHandler(async (req, res) => {
  const { question, gem, materialId } = req.body;
  const selectedGem = GEM_PERSONAS[gem] || GEM_PERSONAS['tutor-cerdas'];
  const allMaterials = [...LEARNING_MATERIALS, ...CUSTOM_MATERIALS];
  const material = materialId ? allMaterials.find((item) => item.id === materialId) : null;
  const sourceText = material ? material.sourceText : (req.body.sourceText || '').trim();

  if (!question) {
    return res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
  }

  if (!sourceText) {
    return res.status(400).json({ error: 'Materi tidak ditemukan.' });
  }
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.json({
      answer: 'Integrasi Gemini belum dikonfigurasi. Tambahkan GEMINI_API_KEY pada environment.'
    });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.0-pro-001';
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
