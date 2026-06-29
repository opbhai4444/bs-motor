const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const adminPath = path.join(__dirname, 'database', 'admin.db');
if (!fs.existsSync(adminPath)) {
  console.error('admin.db not found — start the server first to create it.');
  process.exit(1);
}

const adb = new Database(adminPath, { readonly: true });

const stock_groups = adb.prepare('SELECT name, parent FROM stock_groups').all();
const brands       = adb.prepare('SELECT name FROM brands').all();
const parts        = adb.prepare(`
  SELECT name_en, name_hi, sku, category, brand, compatible_models,
         price, purchase_price, stock, unit, description, is_active
  FROM parts WHERE is_active = 1
`).all();

adb.close();

const seedFile = path.join(__dirname, 'db', 'seed-data.json');
fs.writeFileSync(seedFile, JSON.stringify({ stock_groups, brands, parts }, null, 2));

console.log(`Seed exported: ${parts.length} parts, ${stock_groups.length} groups, ${brands.length} brands`);
console.log(`Saved to db/seed-data.json`);
console.log(`\nNext steps:`);
console.log(`  git add db/seed-data.json`);
console.log(`  git commit -m "update inventory seed"`);
console.log(`  git push`);
console.log(`  Then Manual Deploy on Render`);
