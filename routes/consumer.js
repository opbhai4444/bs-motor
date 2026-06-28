const express = require('express');
const { adb, cdb } = require('../db');
const router = express.Router();

const requireConsumer = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ ok: false, message: 'Login required' });
  next();
};

// ── PARTS (live in admin DB; ratings joined from consumer DB via adb's cdb alias) ──
router.get('/parts', (req, res) => {
  const { q, category, brand, model } = req.query;
  let sql = 'SELECT p.*, COALESCE(AVG(r.rating),0) as avg_rating, COUNT(r.id) as review_count FROM parts p LEFT JOIN cdb.ratings r ON r.part_id=p.id WHERE p.is_active=1';
  const params = [];
  if (q)       { sql += ' AND (p.name_en LIKE ? OR p.name_hi LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)'; const lq = `%${q}%`; params.push(lq,lq,lq,lq); }
  if (category){ sql += ' AND p.category=?'; params.push(category); }
  if (brand)   { sql += ' AND p.brand=?';    params.push(brand); }
  if (model)   { sql += ' AND p.compatible_models LIKE ?'; params.push(`%${model}%`); }
  sql += ' GROUP BY p.id ORDER BY p.name_en';
  res.json(adb.prepare(sql).all(...params));
});

router.get('/parts/:id', (req, res) => {
  const part = adb.prepare('SELECT p.*, COALESCE(AVG(r.rating),0) as avg_rating FROM parts p LEFT JOIN cdb.ratings r ON r.part_id=p.id WHERE p.id=? GROUP BY p.id').get(req.params.id);
  if (!part) return res.status(404).json({ ok: false });
  // reviews join consumer users for name, both in consumer DB via cdb connection
  const reviews = cdb.prepare('SELECT r.*, u.name as user_name FROM ratings r JOIN users u ON u.id=r.consumer_id WHERE r.part_id=? ORDER BY r.created_at DESC').all(req.params.id);
  res.json({ ...part, reviews });
});

router.get('/filters', (req, res) => {
  const categories = adb.prepare('SELECT DISTINCT category FROM parts WHERE is_active=1 AND category IS NOT NULL').all().map(r => r.category);
  const brands     = adb.prepare('SELECT DISTINCT brand    FROM parts WHERE is_active=1 AND brand    IS NOT NULL').all().map(r => r.brand);
  res.json({ categories, brands });
});

// ── CART (lives in consumer DB; parts joined from admin DB via cdb's adb alias) ──
router.get('/cart', requireConsumer, (req, res) => {
  const items = cdb.prepare(`
    SELECT c.id, c.qty, p.id as part_id, p.name_en, p.name_hi, p.price, p.stock, p.image
    FROM cart c JOIN adb.parts p ON p.id=c.part_id
    WHERE c.consumer_id=?`).all(req.session.user.id);
  res.json(items);
});

router.post('/cart', requireConsumer, (req, res) => {
  const { part_id, qty } = req.body;
  const part = adb.prepare('SELECT id, stock FROM parts WHERE id=? AND is_active=1').get(part_id);
  if (!part)              return res.json({ ok: false, message: 'Part not found' });
  if (part.stock < qty)   return res.json({ ok: false, message: 'Insufficient stock' });
  cdb.prepare('INSERT INTO cart (consumer_id,part_id,qty) VALUES (?,?,?) ON CONFLICT(consumer_id,part_id) DO UPDATE SET qty=excluded.qty')
    .run(req.session.user.id, part_id, qty || 1);
  res.json({ ok: true });
});

router.delete('/cart/:part_id', requireConsumer, (req, res) => {
  cdb.prepare('DELETE FROM cart WHERE consumer_id=? AND part_id=?').run(req.session.user.id, req.params.part_id);
  res.json({ ok: true });
});

// ── ORDERS (stored in admin DB so admin can manage them) ───────────────────────
router.post('/orders', requireConsumer, (req, res) => {
  const { payment_method, notes } = req.body;
  // Read cart (consumer DB) joined with parts prices/stock (admin DB via cdb's adb alias)
  const cartItems = cdb.prepare(`
    SELECT c.qty, p.id as part_id, p.price, p.stock
    FROM cart c JOIN adb.parts p ON p.id=c.part_id
    WHERE c.consumer_id=?`).all(req.session.user.id);
  if (!cartItems.length) return res.json({ ok: false, message: 'Cart is empty' });
  for (const item of cartItems) {
    if (item.stock < item.qty) return res.json({ ok: false, message: `Insufficient stock for part #${item.part_id}` });
  }
  const subtotal = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
  const order_no = 'BSM' + Date.now();
  const order    = adb.prepare('INSERT INTO orders (order_no,consumer_id,subtotal,total,payment_method,notes) VALUES (?,?,?,?,?,?)')
    .run(order_no, req.session.user.id, subtotal, subtotal, payment_method || 'cash', notes || null);
  const insItem  = adb.prepare('INSERT INTO order_items (order_id,part_id,qty,unit_price,total) VALUES (?,?,?,?,?)');
  const updStock = adb.prepare('UPDATE parts SET stock = stock - ? WHERE id=?');
  for (const item of cartItems) {
    insItem.run(order.lastInsertRowid, item.part_id, item.qty, item.price, item.price * item.qty);
    updStock.run(item.qty, item.part_id);
  }
  cdb.prepare('DELETE FROM cart WHERE consumer_id=?').run(req.session.user.id);
  res.json({ ok: true, order_no });
});

router.get('/orders', requireConsumer, (req, res) => {
  res.json(adb.prepare('SELECT * FROM orders WHERE consumer_id=? ORDER BY created_at DESC').all(req.session.user.id));
});

router.get('/orders/:order_no', requireConsumer, (req, res) => {
  const order = adb.prepare('SELECT * FROM orders WHERE order_no=? AND consumer_id=?').get(req.params.order_no, req.session.user.id);
  if (!order) return res.status(404).json({ ok: false });
  const items = adb.prepare('SELECT oi.*, p.name_en, p.name_hi, p.image FROM order_items oi JOIN parts p ON p.id=oi.part_id WHERE oi.order_id=?').all(order.id);
  res.json({ ...order, items });
});

// ── RATINGS (consumer DB) ──────────────────────────────────────────────────────
router.post('/ratings', requireConsumer, (req, res) => {
  const { part_id, rating, review } = req.body;
  cdb.prepare('INSERT INTO ratings (consumer_id,part_id,rating,review) VALUES (?,?,?,?) ON CONFLICT(consumer_id,part_id) DO UPDATE SET rating=excluded.rating, review=excluded.review')
    .run(req.session.user.id, part_id, rating, review || null);
  res.json({ ok: true });
});

// ── ENQUIRY (admin DB — admin handles these) ───────────────────────────────────
router.post('/enquiry', (req, res) => {
  const { name, phone, email, message } = req.body;
  if (!name || !message) return res.json({ ok: false, message: 'Name and message required' });
  adb.prepare('INSERT INTO enquiries (name,phone,email,message) VALUES (?,?,?,?)').run(name, phone || null, email || null, message);
  res.json({ ok: true, message: 'Enquiry submitted!' });
});

// ── PROFILE (consumer DB) ──────────────────────────────────────────────────────
router.get('/profile', requireConsumer, (req, res) => {
  res.json(cdb.prepare('SELECT id,name,email,phone,address,lang,created_at FROM users WHERE id=?').get(req.session.user.id));
});

router.put('/profile', requireConsumer, (req, res) => {
  const { name, phone, address, lang } = req.body;
  cdb.prepare('UPDATE users SET name=?,phone=?,address=?,lang=? WHERE id=?').run(name, phone, address, lang, req.session.user.id);
  req.session.user.name = name;
  res.json({ ok: true });
});

module.exports = router;
