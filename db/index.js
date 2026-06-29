const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const adminPath    = path.join(dbDir, 'admin.db');
const consumerPath = path.join(dbDir, 'consumer.db');

const adb = new Database(adminPath);
const cdb = new Database(consumerPath);

[adb, cdb].forEach(d => {
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
});

// Cross-attach so queries can reference cdb.* on adb and adb.* on cdb
adb.prepare('ATTACH DATABASE ? AS cdb').run(consumerPath);
cdb.prepare('ATTACH DATABASE ? AS adb').run(adminPath);

// ── Admin DB ──────────────────────────────────────────────────────────────────
adb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    UNIQUE NOT NULL,
    password   TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS parts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name_en           TEXT NOT NULL,
    name_hi           TEXT NOT NULL,
    sku               TEXT UNIQUE,
    category          TEXT,
    brand             TEXT,
    compatible_models TEXT,
    price             REAL NOT NULL,
    purchase_price    REAL DEFAULT 0,
    stock             INTEGER NOT NULL DEFAULT 0,
    unit              TEXT DEFAULT 'pc',
    image             TEXT,
    description       TEXT,
    is_active         INTEGER DEFAULT 1,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no       TEXT UNIQUE NOT NULL,
    consumer_id    INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    payment_status TEXT DEFAULT 'pending',
    payment_method TEXT,
    subtotal       REAL DEFAULT 0,
    discount       REAL DEFAULT 0,
    total          REAL DEFAULT 0,
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    part_id    INTEGER NOT NULL,
    qty        INTEGER NOT NULL,
    unit_price REAL    NOT NULL,
    total      REAL    NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (part_id)  REFERENCES parts(id)
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no    TEXT,
    supplier   TEXT,
    date       TEXT NOT NULL,
    total      REAL DEFAULT 0,
    paid       REAL DEFAULT 0,
    notes      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    part_id     INTEGER NOT NULL,
    qty         INTEGER NOT NULL,
    unit_price  REAL    NOT NULL,
    total       REAL    NOT NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id),
    FOREIGN KEY (part_id)     REFERENCES parts(id)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,
    group_name      TEXT,
    opening_balance REAL DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_no     TEXT UNIQUE NOT NULL,
    date         TEXT NOT NULL,
    narration    TEXT,
    voucher_type TEXT DEFAULT 'journal',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS journal_lines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id   INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    debit      REAL DEFAULT 0,
    credit     REAL DEFAULT 0,
    FOREIGN KEY (entry_id)   REFERENCES journal_entries(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS stock_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    parent     TEXT DEFAULT 'Primary',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS brands (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT,
    email      TEXT,
    message    TEXT NOT NULL,
    status     TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing journal_entries to add voucher_type if missing
try { adb.exec("ALTER TABLE journal_entries ADD COLUMN voucher_type TEXT DEFAULT 'journal'"); } catch(e) {}

// Seed default admin
if (!adb.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
  adb.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)')
    .run('Admin', 'admin@bsmotor.com', bcrypt.hashSync('admin123', 10), 'admin');
  console.log('Default admin created: admin@bsmotor.com / admin123');
}

// Seed default accounts chart
if (adb.prepare('SELECT COUNT(*) as c FROM accounts').get().c === 0) {
  const ins = adb.prepare('INSERT INTO accounts (name,type,group_name) VALUES (?,?,?)');
  [
    ['Cash',                 'asset',     'Current Assets'],
    ['Bank',                 'asset',     'Current Assets'],
    ['Stock / Inventory',    'asset',     'Current Assets'],
    ['Accounts Receivable',  'asset',     'Current Assets'],
    ['Accounts Payable',     'liability', 'Current Liabilities'],
    ['Sales',                'income',    'Revenue'],
    ['Purchase',             'expense',   'Cost of Goods'],
    ['Rent Expense',         'expense',   'Operating Expenses'],
    ['Salary Expense',       'expense',   'Operating Expenses'],
    ['Miscellaneous Expense','expense',   'Operating Expenses'],
    ['Owner Equity',         'equity',    'Capital'],
  ].forEach(a => ins.run(...a));
}

// Seed catalog from snapshot on a fresh DB (e.g. first deploy) — never overwrites existing data
if (adb.prepare('SELECT COUNT(*) as c FROM parts').get().c === 0) {
  const seedFile = path.join(__dirname, 'seed-data.json');
  if (fs.existsSync(seedFile)) {
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const insGroup = adb.prepare('INSERT OR IGNORE INTO stock_groups (name,parent) VALUES (?,?)');
    (seed.stock_groups || []).forEach(g => insGroup.run(g.name, g.parent || 'Primary'));
    const insBrand = adb.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
    (seed.brands || []).forEach(b => insBrand.run(b.name));
    const insPart = adb.prepare(`INSERT INTO parts
      (name_en,name_hi,sku,category,brand,compatible_models,price,purchase_price,stock,unit,description,is_active)
      VALUES (@name_en,@name_hi,@sku,@category,@brand,@compatible_models,@price,@purchase_price,@stock,@unit,@description,@is_active)`);
    adb.transaction(() => (seed.parts || []).forEach(p => insPart.run(p)))();
    console.log(`Catalog seeded from snapshot: ${(seed.parts || []).length} parts`);
  }
}

// ── Consumer DB ───────────────────────────────────────────────────────────────
cdb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE,
    phone      TEXT UNIQUE,
    password   TEXT,
    role       TEXT NOT NULL DEFAULT 'consumer',
    lang       TEXT NOT NULL DEFAULT 'en',
    address    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cart (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    consumer_id INTEGER NOT NULL,
    part_id     INTEGER NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 1,
    added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(consumer_id, part_id),
    FOREIGN KEY (consumer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    consumer_id INTEGER NOT NULL,
    part_id     INTEGER NOT NULL,
    rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    review      TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(consumer_id, part_id),
    FOREIGN KEY (consumer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS otps (
    phone      TEXT PRIMARY KEY,
    otp        TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

module.exports = { adb, cdb };
