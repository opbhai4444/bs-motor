const { adb } = require('../db');
const fs   = require('fs');
const path = require('path');

const data = {
  stock_groups: adb.prepare(
    'SELECT name, parent FROM stock_groups ORDER BY name'
  ).all(),

  brands: adb.prepare(
    'SELECT name, p_less, s_less FROM brands ORDER BY name'
  ).all(),

  parts: adb.prepare(`
    SELECT name_en, name_hi, sku, category, brand, compatible_models,
           price, purchase_price, mrp, stock, unit, description, is_active
    FROM parts
    WHERE is_active = 1
    ORDER BY name_en
  `).all(),
};

const outPath = path.join(__dirname, '..', 'db', 'seed-data.json');
fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

console.log(`Seed exported to db/seed-data.json`);
console.log(`  ${data.parts.length} parts`);
console.log(`  ${data.brands.length} brands`);
console.log(`  ${data.stock_groups.length} stock groups`);
