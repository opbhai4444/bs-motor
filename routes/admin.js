const express = require('express');
const { adb } = require('../db');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const toTitleCase = s => s ? s.trim().replace(/\b\w/g, c => c.toUpperCase()) : s;

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ ok: false, message: 'Admin only' });
  next();
};

// Dashboard stats — consumer count comes from cdb (attached)
router.get('/stats', requireAdmin, (req, res) => {
  const totalParts     = adb.prepare('SELECT COUNT(*) as c FROM parts WHERE is_active=1').get().c;
  const totalOrders    = adb.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders  = adb.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").get().c;
  const totalCustomers = adb.prepare('SELECT COUNT(*) as c FROM cdb.users').get().c;
  const todaySales     = adb.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE date(created_at)=date('now') AND payment_status='paid'").get().s;
  const monthSales     = adb.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now') AND payment_status='paid'").get().s;
  const lowStock       = adb.prepare('SELECT COUNT(*) as c FROM parts WHERE stock <= 5 AND is_active=1').get().c;
  const recentOrders   = adb.prepare('SELECT o.*, u.name as customer_name FROM orders o JOIN cdb.users u ON u.id=o.consumer_id ORDER BY o.created_at DESC LIMIT 5').all();
  res.json({ totalParts, totalOrders, pendingOrders, totalCustomers, todaySales, monthSales, lowStock, recentOrders });
});

// ── INVENTORY ──────────────────────────────────────────────────────────────────
router.get('/parts', requireAdmin, (req, res) => {
  const { q, category, brand, low_stock } = req.query;
  let sql = 'SELECT * FROM parts WHERE 1=1';
  const params = [];
  if (q)         { sql += ' AND (name_en LIKE ? OR sku LIKE ? OR brand LIKE ?)'; const lq = `%${q}%`; params.push(lq, lq, lq); }
  if (category)  { sql += ' AND category=?'; params.push(category); }
  if (brand)     { sql += ' AND brand=?'; params.push(brand); }
  if (low_stock) { sql += ' AND stock <= 5'; }
  sql += ' ORDER BY name_en';
  res.json(adb.prepare(sql).all(...params));
});

router.post('/parts', requireAdmin, upload.single('image'), (req, res) => {
  const { name_en, name_hi, sku, category, brand, compatible_models, price, purchase_price, stock, unit, description } = req.body;
  if (!name_en) return res.json({ ok: false, message: 'Item name is required' });
  if (!sku)     return res.json({ ok: false, message: 'Part number (SKU) is required' });
  if (!price)   return res.json({ ok: false, message: 'Selling price is required' });
  const finalSku = sku;
  const image    = req.file ? '/uploads/' + req.file.filename : null;
  try {
    adb.prepare(`INSERT INTO parts (name_en,name_hi,sku,category,brand,compatible_models,price,purchase_price,stock,unit,image,description)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(toTitleCase(name_en), toTitleCase(name_hi) || toTitleCase(name_en), finalSku,
           category || null, brand || null, compatible_models || null,
           parseFloat(price), parseFloat(purchase_price || 0), parseInt(stock || 0),
           unit || 'pc', image, description || null);
    res.json({ ok: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: false, message: 'Part No. already exists — use a unique Part No.' });
    res.json({ ok: false, message: e.message });
  }
});

router.put('/parts/:id', requireAdmin, upload.single('image'), (req, res) => {
  const { name_en, name_hi, sku, category, brand, compatible_models, price, purchase_price, stock, unit, description, is_active } = req.body;
  const existing = adb.prepare('SELECT * FROM parts WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false });
  const image = req.file ? '/uploads/' + req.file.filename : existing.image;
  try {
    adb.prepare(`UPDATE parts SET name_en=?,name_hi=?,sku=?,category=?,brand=?,compatible_models=?,
      price=?,purchase_price=?,stock=?,unit=?,image=?,description=?,is_active=? WHERE id=?`)
      .run(toTitleCase(name_en) || existing.name_en, toTitleCase(name_hi) || existing.name_hi,
           sku || existing.sku, category || existing.category, brand || existing.brand,
           compatible_models || existing.compatible_models,
           parseFloat(price || existing.price), parseFloat(purchase_price || existing.purchase_price),
           parseInt(stock || existing.stock), unit || existing.unit, image,
           description || existing.description, is_active != null ? parseInt(is_active) : existing.is_active,
           req.params.id);
    res.json({ ok: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: false, message: 'Part No. already exists — use a unique Part No.' });
    res.json({ ok: false, message: e.message });
  }
});

router.delete('/parts/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    adb.prepare('DELETE FROM cdb.cart    WHERE part_id=?').run(id);
    adb.prepare('DELETE FROM cdb.ratings WHERE part_id=?').run(id);
    adb.prepare('DELETE FROM order_items  WHERE part_id=?').run(id);
    adb.prepare('DELETE FROM purchase_items WHERE part_id=?').run(id);
    adb.prepare('DELETE FROM parts WHERE id=?').run(id);
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, message: e.message });
  }
});

// ── ORDERS ─────────────────────────────────────────────────────────────────────
router.get('/orders', requireAdmin, (req, res) => {
  const { status, from, to, q } = req.query;
  let sql = 'SELECT o.*, u.name as customer_name, u.phone as customer_phone FROM orders o JOIN cdb.users u ON u.id=o.consumer_id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND o.status=?'; params.push(status); }
  if (from)   { sql += ' AND date(o.created_at)>=?'; params.push(from); }
  if (to)     { sql += ' AND date(o.created_at)<=?'; params.push(to); }
  if (q)      { sql += ' AND (o.order_no LIKE ? OR u.name LIKE ?)'; const lq = `%${q}%`; params.push(lq, lq); }
  sql += ' ORDER BY o.created_at DESC';
  res.json(adb.prepare(sql).all(...params));
});

router.get('/orders/:id', requireAdmin, (req, res) => {
  const order = adb.prepare('SELECT o.*, u.name as customer_name, u.phone, u.email, u.address FROM orders o JOIN cdb.users u ON u.id=o.consumer_id WHERE o.id=?').get(req.params.id);
  if (!order) return res.status(404).json({ ok: false });
  const items = adb.prepare('SELECT oi.*, p.name_en, p.name_hi, p.sku FROM order_items oi JOIN parts p ON p.id=oi.part_id WHERE oi.order_id=?').all(order.id);
  res.json({ ...order, items });
});

router.put('/orders/:id/status', requireAdmin, (req, res) => {
  const { status, payment_status } = req.body;
  adb.prepare('UPDATE orders SET status=?, payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(status, payment_status || 'pending', req.params.id);
  res.json({ ok: true });
});

// ── CUSTOMERS (read from consumer DB via cdb alias) ────────────────────────────
router.get('/customers', requireAdmin, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total),0) as total_spent FROM cdb.users u LEFT JOIN orders o ON o.consumer_id=u.id WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'; const lq = `%${q}%`; params.push(lq, lq, lq); }
  sql += ' GROUP BY u.id ORDER BY u.name';
  res.json(adb.prepare(sql).all(...params));
});

router.get('/customers/:id', requireAdmin, (req, res) => {
  const u = adb.prepare('SELECT id,name,email,phone,address,created_at FROM cdb.users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ ok: false });
  const orders = adb.prepare('SELECT * FROM orders WHERE consumer_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...u, orders });
});

// ── ENQUIRIES ──────────────────────────────────────────────────────────────────
router.get('/enquiries', requireAdmin, (req, res) => {
  res.json(adb.prepare('SELECT * FROM enquiries ORDER BY created_at DESC').all());
});

router.put('/enquiries/:id', requireAdmin, (req, res) => {
  adb.prepare('UPDATE enquiries SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});

// ── PURCHASES ──────────────────────────────────────────────────────────────────
router.get('/purchases', requireAdmin, (req, res) => {
  res.json(adb.prepare('SELECT * FROM purchases ORDER BY date DESC').all());
});

router.post('/purchases', requireAdmin, (req, res) => {
  const { bill_no, supplier, date, notes, items } = req.body;
  const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const pur = adb.prepare('INSERT INTO purchases (bill_no,supplier,date,total,notes) VALUES (?,?,?,?,?)')
    .run(bill_no || null, supplier || null, date, total, notes || null);
  const insItem  = adb.prepare('INSERT INTO purchase_items (purchase_id,part_id,qty,unit_price,total) VALUES (?,?,?,?,?)');
  const updStock = adb.prepare('UPDATE parts SET stock = stock + ? WHERE id=?');
  for (const item of items) {
    insItem.run(pur.lastInsertRowid, item.part_id, item.qty, item.unit_price, item.unit_price * item.qty);
    updStock.run(item.qty, item.part_id);
  }
  res.json({ ok: true });
});

// ── ACCOUNTS ──────────────────────────────────────────────────────────────────
router.get('/accounts', requireAdmin, (req, res) => {
  res.json(adb.prepare(`
    SELECT a.*,
      COALESCE(SUM(jl.debit),0)  as total_debit,
      COALESCE(SUM(jl.credit),0) as total_credit,
      a.opening_balance + COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) as balance
    FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id
    GROUP BY a.id ORDER BY a.type, a.name`).all());
});

router.post('/accounts', requireAdmin, (req, res) => {
  const { name, type, group_name, opening_balance } = req.body;
  adb.prepare('INSERT INTO accounts (name,type,group_name,opening_balance) VALUES (?,?,?,?)')
    .run(name, type, group_name || null, parseFloat(opening_balance || 0));
  res.json({ ok: true });
});

router.get('/journal', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT je.*, GROUP_CONCAT(a.name) as accounts FROM journal_entries je LEFT JOIN journal_lines jl ON jl.entry_id=je.id LEFT JOIN accounts a ON a.id=jl.account_id WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND je.date >= ?'; params.push(from); }
  if (to)   { sql += ' AND je.date <= ?'; params.push(to); }
  sql += ' GROUP BY je.id ORDER BY je.date DESC';
  res.json(adb.prepare(sql).all(...params));
});

router.get('/journal/:id', requireAdmin, (req, res) => {
  const entry = adb.prepare('SELECT * FROM journal_entries WHERE id=?').get(req.params.id);
  if (!entry) return res.status(404).json({ ok: false });
  const lines = adb.prepare('SELECT jl.*, a.name as account_name, a.type FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?').all(req.params.id);
  res.json({ ...entry, lines });
});

router.post('/journal', requireAdmin, (req, res) => {
  const { date, narration, lines } = req.body;
  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    return res.json({ ok: false, message: 'Debit must equal Credit' });
  const entry_no = 'JNL' + Date.now();
  const entry = adb.prepare('INSERT INTO journal_entries (entry_no,date,narration) VALUES (?,?,?)').run(entry_no, date, narration || null);
  const ins   = adb.prepare('INSERT INTO journal_lines (entry_id,account_id,debit,credit) VALUES (?,?,?,?)');
  for (const l of lines) ins.run(entry.lastInsertRowid, l.account_id, parseFloat(l.debit) || 0, parseFloat(l.credit) || 0);
  res.json({ ok: true, entry_no });
});

// ── REPORTS ────────────────────────────────────────────────────────────────────
router.get('/reports/sales', requireAdmin, (req, res) => {
  const { from, to, group } = req.query;
  const g   = group || 'day';
  const fmt = g === 'month' ? '%Y-%m' : g === 'year' ? '%Y' : '%Y-%m-%d';
  let sql = `SELECT strftime('${fmt}', o.created_at) as period, COUNT(*) as orders, SUM(o.total) as revenue FROM orders o WHERE o.payment_status='paid'`;
  const params = [];
  if (from) { sql += ' AND date(o.created_at)>=?'; params.push(from); }
  if (to)   { sql += ' AND date(o.created_at)<=?'; params.push(to); }
  sql += ' GROUP BY period ORDER BY period';
  res.json(adb.prepare(sql).all(...params));
});

router.get('/reports/top-parts', requireAdmin, (req, res) => {
  res.json(adb.prepare(`
    SELECT p.name_en, p.sku, SUM(oi.qty) as qty_sold, SUM(oi.total) as revenue
    FROM order_items oi JOIN parts p ON p.id=oi.part_id
    JOIN orders o ON o.id=oi.order_id WHERE o.payment_status='paid'
    GROUP BY oi.part_id ORDER BY qty_sold DESC LIMIT 10`).all());
});

router.get('/reports/profit-loss', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let salesSql = "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='paid'";
  let purSql   = "SELECT COALESCE(SUM(total),0) as s FROM purchases WHERE 1=1";
  const p1 = [], p2 = [];
  if (from) { salesSql += ' AND date(created_at)>=?'; purSql += ' AND date>=?'; p1.push(from); p2.push(from); }
  if (to)   { salesSql += ' AND date(created_at)<=?'; purSql += ' AND date<=?'; p1.push(to);   p2.push(to); }
  const sales     = adb.prepare(salesSql).get(...p1).s;
  const purchases = adb.prepare(purSql).get(...p2).s;
  const expenses  = adb.prepare("SELECT COALESCE(SUM(jl.debit),0) as s FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.type='expense'").get().s;
  res.json({ sales, purchases, expenses, gross_profit: sales - purchases, net_profit: sales - purchases - expenses });
});

router.get('/reports/stock', requireAdmin, (req, res) => {
  res.json(adb.prepare('SELECT *, (stock * purchase_price) as stock_value FROM parts WHERE is_active=1 ORDER BY stock ASC').all());
});

// ── STOCK GROUPS ───────────────────────────────────────────────────────────────
router.get('/groups', requireAdmin, (req, res) => {
  res.json(adb.prepare('SELECT * FROM stock_groups ORDER BY name').all());
});

router.post('/groups', requireAdmin, (req, res) => {
  const { name, parent } = req.body;
  if (!name) return res.json({ ok: false, message: 'Name required' });
  try {
    adb.prepare('INSERT INTO stock_groups (name,parent) VALUES (?,?)').run(toTitleCase(name), parent || 'Primary');
    res.json({ ok: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: false, message: 'Group already exists' });
    res.json({ ok: false, message: e.message });
  }
});

router.put('/groups/:id', requireAdmin, (req, res) => {
  const { name, parent } = req.body;
  if (!name) return res.json({ ok: false, message: 'Name required' });
  try {
    adb.prepare('UPDATE stock_groups SET name=?,parent=? WHERE id=?').run(toTitleCase(name), parent || 'Primary', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: false, message: 'Group name already exists' });
    res.json({ ok: false, message: e.message });
  }
});

router.delete('/groups/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const grp = adb.prepare('SELECT * FROM stock_groups WHERE id=?').get(id);
    if (!grp) return res.json({ ok: false, message: 'Group not found' });
    const fallback = grp.parent || 'Primary';
    adb.prepare('UPDATE stock_groups SET parent=? WHERE parent=?').run(fallback, grp.name);
    adb.prepare('UPDATE parts SET category=? WHERE category=?').run(fallback, grp.name);
    adb.prepare('DELETE FROM stock_groups WHERE id=?').run(id);
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, message: e.message });
  }
});

// ── BRANDS ─────────────────────────────────────────────────────────────────────
router.get('/brands', requireAdmin, (req, res) => {
  res.json(adb.prepare('SELECT name FROM brands ORDER BY name').all().map(r => r.name));
});

router.post('/brands', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ ok: false, message: 'Name required' });
  try {
    adb.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)').run(toTitleCase(name));
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, message: e.message });
  }
});

module.exports = router;
