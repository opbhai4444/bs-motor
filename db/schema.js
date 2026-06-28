const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'bsmotor.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Users (admin + consumers)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'consumer',  -- 'admin' | 'consumer'
    lang TEXT NOT NULL DEFAULT 'en',
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Parts / Inventory
  CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_en TEXT NOT NULL,
    name_hi TEXT NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    category TEXT,
    brand TEXT,
    compatible_models TEXT,   -- comma-separated car models
    price REAL NOT NULL,
    purchase_price REAL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'pc',
    image TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Orders
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    consumer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|confirmed|shipped|delivered|cancelled
    payment_status TEXT DEFAULT 'pending',   -- pending|paid|failed
    payment_method TEXT,
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (consumer_id) REFERENCES users(id)
  );

  -- Order Items
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
  );

  -- Cart
  CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consumer_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(consumer_id, part_id),
    FOREIGN KEY (consumer_id) REFERENCES users(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
  );

  -- Ratings / Reviews
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consumer_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(consumer_id, part_id),
    FOREIGN KEY (consumer_id) REFERENCES users(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
  );

  -- Enquiries / Contact
  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',  -- open|resolved
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Accounts / Ledger (Tally-like)
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- asset|liability|income|expense|equity
    group_name TEXT,
    opening_balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Journal Entries
  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_no TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    narration TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Journal Lines (double-entry)
  CREATE TABLE IF NOT EXISTS journal_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    FOREIGN KEY (entry_id) REFERENCES journal_entries(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  -- Stock Purchases
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no TEXT,
    supplier TEXT,
    date TEXT NOT NULL,
    total REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
  );

  -- Stock Groups (Tally-style hierarchy)
  CREATE TABLE IF NOT EXISTS stock_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    parent TEXT DEFAULT 'Primary',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Brands
  CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Phone OTPs (backend-generated, no SMS provider needed in dev)
  CREATE TABLE IF NOT EXISTS otps (
    phone TEXT PRIMARY KEY,
    otp   TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// Seed default admin if not exists
const bcrypt = require('bcryptjs');
const admin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (name, email, phone, password, role)
              VALUES (?, ?, ?, ?, ?)`).run('Admin', 'admin@bsmotor.com', '9999999999', hash, 'admin');
  console.log('Default admin created: admin@bsmotor.com / admin123');
}

// Seed default accounts chart
const acctCount = db.prepare('SELECT COUNT(*) as c FROM accounts').get();
if (acctCount.c === 0) {
  const accounts = [
    ['Cash', 'asset', 'Current Assets'],
    ['Bank', 'asset', 'Current Assets'],
    ['Stock / Inventory', 'asset', 'Current Assets'],
    ['Accounts Receivable', 'asset', 'Current Assets'],
    ['Accounts Payable', 'liability', 'Current Liabilities'],
    ['Sales', 'income', 'Revenue'],
    ['Purchase', 'expense', 'Cost of Goods'],
    ['Rent Expense', 'expense', 'Operating Expenses'],
    ['Salary Expense', 'expense', 'Operating Expenses'],
    ['Miscellaneous Expense', 'expense', 'Operating Expenses'],
    ['Owner Equity', 'equity', 'Capital'],
  ];
  const ins = db.prepare('INSERT INTO accounts (name, type, group_name) VALUES (?, ?, ?)');
  accounts.forEach(a => ins.run(...a));
}

module.exports = db;
