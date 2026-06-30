require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { adb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    adb.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid  TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      exp  INTEGER NOT NULL
    )`);
  }
  get(sid, cb) {
    try {
      const row = adb.prepare('SELECT sess FROM sessions WHERE sid=? AND exp>?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch(e) { cb(null, null); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7*24*3600000;
      adb.prepare('INSERT OR REPLACE INTO sessions (sid,sess,exp) VALUES (?,?,?)').run(sid, JSON.stringify(sess), exp);
      cb(null);
    } catch(e) { cb(e); }
  }
  destroy(sid, cb) {
    try { adb.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb(null); }
    catch(e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7*24*3600000;
      adb.prepare('UPDATE sessions SET exp=? WHERE sid=?').run(exp, sid);
      if (cb) cb(null);
    } catch(e) { if (cb) cb(e); }
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET || 'bsmotor_secret_2024',
  resave: true,
  saveUninitialized: false,
  rolling: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/consumer', require('./routes/consumer'));
app.use('/api/admin', require('./routes/admin'));

// Page routes
app.get('/admin*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/consumer*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'consumer', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

app.listen(PORT, () => {
  console.log(`\n🔧 BS Motors running at http://localhost:${PORT}`);
  console.log(`   Admin Panel  → http://localhost:${PORT}/admin`);
  console.log(`   Consumer     → http://localhost:${PORT}/consumer`);
  console.log(`   Default Admin: admin@bsmotor.com / admin123\n`);
});
