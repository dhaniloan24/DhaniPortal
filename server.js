const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const required = ['DATABASE_URL', 'SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  console.error('See README.md before starting the app.');
  process.exit(1);
}
if (process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('ADMIN_PASSWORD_HASH must be a bcrypt hash. See README.md.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});
const secureCookies = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: secureCookies ? [] : null
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true, tableName: 'user_sessions' }),
  name: 'dhani.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: secureCookies, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 4 }
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(18).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const allowed = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'application/pdf': ['.pdf']
    };
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed[file.mimetype] && allowed[file.mimetype].includes(ext)) return cb(null, true);
    cb(new Error('Only JPG, PNG, or PDF files are allowed.'));
  }
});

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
app.use('/api/applications', publicLimiter);
app.use('/api/status', publicLimiter);

const schema = `
CREATE TABLE IF NOT EXISTS applications (
 id BIGSERIAL PRIMARY KEY,
 reference_no VARCHAR(24) UNIQUE NOT NULL,
 full_name VARCHAR(120) NOT NULL,
 phone VARCHAR(10) NOT NULL,
 email VARCHAR(254) NOT NULL,
 loan_type VARCHAR(30) NOT NULL,
 loan_amount NUMERIC(12,2) NOT NULL,
 tenure_months INTEGER NOT NULL,
 purpose TEXT NOT NULL,
 address TEXT NOT NULL,
 photo_file TEXT,
 signature_file TEXT,
 document_file TEXT,
 status VARCHAR(30) NOT NULL DEFAULT 'Received',
 approved_amount NUMERIC(12,2),
 admin_notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS applications_created_at_idx ON applications(created_at DESC);
`;
async function initDb() {
  await pool.query(schema);
}
function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function makeReference() {
  return 'DP' + new Date().toISOString().slice(2,10).replace(/-/g,'') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function emailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
async function sendEmail(to, subject, text) {
  const transport = emailTransport();
  if (!transport || !to || !process.env.MAIL_FROM) {
    console.warn('Email skipped: SMTP settings are not complete.');
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}
function adminOnly(req, res, next) {
  if (!req.session || !req.session.admin) return res.status(401).json({ error: 'Admin login required.' });
  next();
}
function safeApplication(row) {
  return {
    id: row.id, reference_no: row.reference_no, full_name: row.full_name, phone: row.phone,
    email: row.email, loan_type: row.loan_type, loan_amount: row.loan_amount,
    tenure_months: row.tenure_months, purpose: row.purpose, address: row.address,
    photo_file: row.photo_file, signature_file: row.signature_file, document_file: row.document_file,
    status: row.status, approved_amount: row.approved_amount, admin_notes: row.admin_notes,
    created_at: row.created_at, updated_at: row.updated_at
  };
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.post('/api/applications', upload.fields([
  { name: 'photo', maxCount: 1 }, { name: 'signature', maxCount: 1 }, { name: 'document', maxCount: 1 }
]), async (req, res) => {
  const body = req.body || {};
  const full_name = cleanText(body.full_name, 120);
  const phone = cleanText(body.phone, 10);
  const email = cleanText(body.email, 254).toLowerCase();
  const loan_type = cleanText(body.loan_type, 30);
  const loan_amount = Number(body.loan_amount);
  const tenure_months = Number(body.tenure_months);
  const purpose = cleanText(body.purpose, 1000);
  const address = cleanText(body.address, 500);
  const consent = body.consent === 'on' || body.consent === 'true';

  if (!full_name || !/^[6-9]\d{9}$/.test(phone) || !validEmail(email) ||
      !['Personal Loan','Business Loan','Home Loan'].includes(loan_type) ||
      !Number.isFinite(loan_amount) || loan_amount < 1000 || loan_amount > 100000000 ||
      !Number.isInteger(tenure_months) || tenure_months < 1 || tenure_months > 360 ||
      !purpose || !address || !consent) {
    return res.status(400).json({ error: 'Please check all required fields and consent.' });
  }
  const files = req.files || {};
  const photo = files.photo?.[0];
  const signature = files.signature?.[0];
  const document = files.document?.[0];
  if (!photo || !signature || !document) {
    for (const arr of Object.values(files)) for (const f of arr) fs.unlink(f.path, () => {});
    return res.status(400).json({ error: 'Please upload a photo, signature, and supporting document.' });
  }

  let reference_no = makeReference();
  try {
    // Retry only if the very unlikely random reference collides.
    for (let i = 0; i < 3; i++) {
      try {
        const result = await pool.query(
          `INSERT INTO applications
          (reference_no, full_name, phone, email, loan_type, loan_amount, tenure_months, purpose, address, photo_file, signature_file, document_file)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [reference_no, full_name, phone, email, loan_type, loan_amount, tenure_months, purpose, address,
           photo.filename, signature.filename, document.filename]
        );
        const appRow = result.rows[0];
        const message = `Dear ${full_name},\n\nYour loan application has been received.\nReference number: ${reference_no}\nCurrent status: Received\n\nThis is an acknowledgement of receipt only and is not a loan approval.`;
        await Promise.allSettled([
          sendEmail(email, `Dhani Portal application received: ${reference_no}`, message),
          sendEmail(process.env.ADMIN_NOTIFICATION_EMAIL, `New loan application: ${reference_no}`,
            `A new application was received.\nReference: ${reference_no}\nApplicant: ${full_name}\nLoan type: ${loan_type}\nRequested amount: ${loan_amount}`)
        ]);
        return res.status(201).json({ reference_no: appRow.reference_no, message: 'Application submitted successfully.' });
      } catch (e) {
        if (e.code === '23505' && i < 2) { reference_no = makeReference(); continue; }
        throw e;
      }
    }
  } catch (e) {
    console.error('Application save failed:', e);
    for (const f of [photo, signature, document]) if (f) fs.unlink(f.path, () => {});
    return res.status(500).json({ error: 'Could not save your application. Please try again later.' });
  }
});

app.post('/api/status', async (req, res) => {
  const reference_no = cleanText(req.body.reference_no, 24).toUpperCase();
  const phone = cleanText(req.body.phone, 10);
  if (!reference_no || !/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid reference number and registered mobile number.' });
  try {
    const result = await pool.query(
      `SELECT reference_no, full_name, loan_type, loan_amount, status, approved_amount, admin_notes, created_at, updated_at
       FROM applications WHERE reference_no=$1 AND phone=$2`,
      [reference_no, phone]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No matching application found. Check the reference number and registered mobile number.' });
    const a = result.rows[0];
    return res.json({
      reference_no: a.reference_no, applicant_name: a.full_name, loan_type: a.loan_type,
      requested_amount: a.loan_amount, status: a.status, approved_amount: a.approved_amount,
      update_message: a.admin_notes || null, submitted_at: a.created_at, updated_at: a.updated_at
    });
  } catch (e) {
    console.error('Status lookup failed:', e);
    return res.status(500).json({ error: 'Status lookup is temporarily unavailable.' });
  }
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || '');
  if (email !== process.env.ADMIN_EMAIL.toLowerCase() ||
      !(await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start secure session.' });
    req.session.admin = true;
    req.session.adminEmail = email;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Could not save session.' });
      res.json({ message: 'Logged in.' });
    });
  });
});
app.post('/api/admin/logout', adminOnly, (req, res) => req.session.destroy(() => {
  res.clearCookie('dhani.sid', { httpOnly: true, secure: secureCookies, sameSite: 'strict' });
  res.json({ message: 'Logged out.' });
}));
app.get('/api/admin/me', adminOnly, (req, res) => res.json({ email: req.session.adminEmail }));
app.get('/api/admin/applications', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC LIMIT 500');
    res.json(result.rows.map(safeApplication));
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Could not load applications.' });
  }
});
app.patch('/api/admin/applications/:id', adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body.status, 30);
  const allowedStatuses = ['Received','Under Review','Documents Required','Approved','Rejected','Disbursed'];
  const approvedRaw = req.body.approved_amount;
  const approved_amount = approvedRaw === '' || approvedRaw === null || approvedRaw === undefined ? null : Number(approvedRaw);
  const admin_notes = cleanText(req.body.admin_notes, 2000);
  if (!Number.isInteger(id) || id < 1 || !allowedStatuses.includes(status) ||
      (approved_amount !== null && (!Number.isFinite(approved_amount) || approved_amount < 0 || approved_amount > 100000000))) {
    return res.status(400).json({ error: 'Invalid update values.' });
  }
  try {
    const result = await pool.query(
      `UPDATE applications SET status=$1, approved_amount=$2, admin_notes=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [status, approved_amount, admin_notes, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Application not found.' });
    const a = result.rows[0];
    await Promise.allSettled([
      sendEmail(a.email, `Dhani Portal status update: ${a.reference_no}`,
        `Dear ${a.full_name},\n\nYour application ${a.reference_no} status is now: ${a.status}.\n${a.approved_amount ? `Approved amount recorded: ₹${a.approved_amount}\n` : ''}${a.admin_notes ? `Update: ${a.admin_notes}\n` : ''}\nThis message reflects the status recorded by the authorized administrator.`)
    ]);
    res.json({ application: safeApplication(a) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Could not update application.' });
  }
});
app.get('/api/admin/files/:id/:kind', adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const kindMap = { photo: 'photo_file', signature: 'signature_file', document: 'document_file' };
  const col = kindMap[req.params.kind];
  if (!Number.isInteger(id) || !col) return res.status(400).json({ error: 'Invalid file request.' });
  try {
    const result = await pool.query(`SELECT ${col} AS filename FROM applications WHERE id=$1`, [id]);
    if (!result.rowCount || !result.rows[0].filename) return res.status(404).json({ error: 'File not found.' });
    const filePath = path.join(UPLOAD_DIR, path.basename(result.rows[0].filename));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on storage.' });
    res.setHeader('Cache-Control', 'no-store');
    res.download(filePath, `${req.params.kind}-${id}${path.extname(filePath)}`);
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Could not retrieve file.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 5 MB or smaller.' : 'Upload limit exceeded.';
    return res.status(400).json({ error: message });
  }
  if (err) {
    if (err.message === 'Only JPG, PNG, or PDF files are allowed.') return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
  res.status(404).json({ error: 'Not found.' });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Dhani Portal server listening on port ${PORT}`));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
