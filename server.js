require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'bsmotor_secret_2024',
  resave: false,
  saveUninitialized: false,
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
