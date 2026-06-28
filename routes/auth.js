const express = require('express');
const bcrypt  = require('bcryptjs');
const { adb, cdb } = require('../db');
const router  = express.Router();

// Email + password login — tries admin DB first, then consumer DB
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  let user = adb.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) user = cdb.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.json({ ok: false, message: 'Invalid email or password' });
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ ok: true, role: user.role });
});

// Consumer self-registration (email + password)
router.post('/register', (req, res) => {
  const { name, email, phone, password, address } = req.body;
  if (!name || !email || !password) return res.json({ ok: false, message: 'Fill all required fields' });
  if (cdb.prepare('SELECT id FROM users WHERE email=?').get(email))
    return res.json({ ok: false, message: 'Email already registered' });
  cdb.prepare('INSERT INTO users (name,email,phone,password,address,role) VALUES (?,?,?,?,?,?)')
    .run(name, email, phone || null, bcrypt.hashSync(password, 10), address || null, 'consumer');
  res.json({ ok: true, message: 'Registered successfully! Please login.' });
});

// ── Phone OTP ─────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return '+91' + digits.slice(-10);
}

router.post('/send-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.json({ ok: false, message: 'Enter a valid phone number' });

  const otp     = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000;
  cdb.prepare('INSERT OR REPLACE INTO otps (phone,otp,expires_at) VALUES (?,?,?)').run(phone, otp, expires);
  console.log(`[OTP] ${phone} → ${otp}`);

  const key = process.env.FAST2SMS_KEY;
  if (key) {
    try {
      const ten = phone.replace(/\D/g, '').slice(-10);
      const r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'q', message: `Your BS Motors OTP is ${otp}. Valid for 5 minutes.`, numbers: ten, flash: 0 })
      });
      const data = await r.json();
      if (!data.return) {
        console.error('[Fast2SMS]', data);
        return res.json({ ok: false, message: 'SMS delivery failed — check Fast2SMS key' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('[Fast2SMS error]', e.message);
      return res.json({ ok: false, message: 'SMS error: ' + e.message });
    }
  }
  res.json({ ok: true, _otp: otp });
});

router.post('/verify-otp', (req, res) => {
  const { otp } = req.body;
  const phone = normalizePhone(req.body.phone);
  if (!phone || !otp) return res.json({ ok: false, message: 'Phone and OTP required' });

  const row = cdb.prepare('SELECT * FROM otps WHERE phone=?').get(phone);
  if (!row)                   return res.json({ ok: false, message: 'No OTP sent to this number' });
  if (row.otp !== otp.trim()) return res.json({ ok: false, message: 'Incorrect OTP' });
  if (Date.now() > row.expires_at) {
    cdb.prepare('DELETE FROM otps WHERE phone=?').run(phone);
    return res.json({ ok: false, message: 'OTP expired — request a new one' });
  }
  cdb.prepare('DELETE FROM otps WHERE phone=?').run(phone);

  let user = cdb.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user) {
    const fakeEmail = phone.replace(/\D/g, '') + '@phone.bsmotor';
    try {
      cdb.prepare('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)')
        .run('User ' + phone.slice(-4), fakeEmail, phone, bcrypt.hashSync(Math.random().toString(36).slice(2) + Date.now(), 10), 'consumer');
    } catch(_) {}
    user = cdb.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  }
  if (!user) return res.json({ ok: false, message: 'Account error — try again' });

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

// Firebase social/phone login — creates or finds consumer, opens session
router.post('/firebase-login', (req, res) => {
  const { name, email, phone } = req.body;
  if (!email && !phone) return res.json({ ok: false, message: 'No identifier provided' });
  try {
    let user = email
      ? cdb.prepare('SELECT * FROM users WHERE email=?').get(email)
      : cdb.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    if (!user) {
      cdb.prepare('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)')
        .run(name || 'User', email || null, phone || null,
             bcrypt.hashSync(Math.random().toString(36).slice(2) + Date.now(), 10), 'consumer');
      user = email
        ? cdb.prepare('SELECT * FROM users WHERE email=?').get(email)
        : cdb.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ ok: true, user: req.session.user });
  } catch(e) {
    res.json({ ok: false, message: e.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.json({ ok: false });
  res.json({ ok: true, user: req.session.user });
});

module.exports = router;
