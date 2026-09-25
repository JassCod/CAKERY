'use strict';
// Fills the database with ~4 months of realistic demo data so every screen has something to show.
// Usage: npm run seed:demo            (refuses if data already exists)
//        npm run seed:demo -- --force (adds demo data anyway)
const bcrypt = require('bcryptjs');
const { db, tx } = require('../server/db');
const { today, addDays } = require('../server/util');

const force = process.argv.includes('--force');
if (!force && db.prepare('SELECT COUNT(*) AS n FROM items').get().n > 0) {
  console.log('Database already has items. Run with --force to add demo data anyway.');
  process.exit(0);
}

let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const between = (a, b) => Math.round(a + rnd() * (b - a));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const round = n => Math.round(n * 100) / 100;

const DAYS = 120;
const T = today();
const start = addDays(T, -DAYS);

tx(() => {
  // ---- staff ----
  const pw = bcrypt.hashSync('cakery123', 10);
  const staff = [
    ['Priya Sharma', 'manager', 'manager'], ['Rahul Verma', 'cashier', 'cashier'], ['Aman Gill', 'cook', 'cook'],
    ['Sunita Devi', 'kitchen', 'kitchen_staff'], ['Neha Kapoor', 'support', 'customer_service'],
  ];
  const ids = {};
  for (const [name, username, role] of staff) {
    const ex = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    ids[role] = ex ? ex.id : db.prepare('INSERT INTO users (name, username, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)')
      .run(name, username, pw, role, '98' + between(10000000, 99999999)).lastInsertRowid;
  }
  const owner = db.prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1").get().id;

  // ---- items ----
  const products = [
    ['Chocolate Truffle Pastry', 'Pastries', 35, 90], ['Black Forest Pastry', 'Pastries', 30, 80], ['Pineapple Pastry', 'Pastries', 25, 70],
    ['Red Velvet Pastry', 'Pastries', 40, 110], ['Butterscotch Pastry', 'Pastries', 28, 75], ['Cream Roll', 'Snacks', 12, 35],
    ['Chocolate Cake 1kg', 'Cakes', 380, 850], ['Black Forest Cake 1kg', 'Cakes', 320, 750], ['Fruit Cake 500g', 'Cakes', 150, 380],
    ['Veg Puff', 'Snacks', 10, 30], ['Paneer Puff', 'Snacks', 15, 45], ['Choco Chip Cookies (250g)', 'Cookies', 60, 160],
    ['Brownie', 'Pastries', 30, 90], ['Cup Cake', 'Pastries', 18, 50], ['Garlic Bread', 'Breads', 25, 70],
  ];
  const ingredients = [
    ['Maida (Flour)', 'Flour & Grains', 'kg', 38, 25], ['Sugar', 'Sugar & Sweeteners', 'kg', 44, 20], ['Butter', 'Dairy', 'kg', 520, 5],
    ['Fresh Cream', 'Dairy', 'litre', 210, 8], ['Eggs', 'Dairy', 'tray', 180, 4], ['Dark Compound Chocolate', 'Chocolate & Cocoa', 'kg', 340, 4],
    ['Cocoa Powder', 'Chocolate & Cocoa', 'kg', 480, 2], ['Pineapple Tin', 'Fruits & Nuts', 'pcs', 140, 6], ['Cherries', 'Fruits & Nuts', 'kg', 420, 1],
    ['Vanilla Essence', 'Flavours & Colours', 'bottle', 90, 3],
  ];
  const packaging = [['Cake Box 1kg', 'box', 18, 50], ['Pastry Box (single)', 'pcs', 4, 200], ['Carry Bag', 'pcs', 3, 150], ['Candles Pack', 'packet', 15, 20]];
  const insItem = db.prepare(`INSERT INTO items (name, sku, type, category, unit, cost_price, sell_price, stock_qty, reorder_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const productIds = products.map(([n, c, cost, price], i) => ({
    id: insItem.run(n, 'P' + String(i + 1).padStart(3, '0'), 'product', c, 'pcs', cost, price, between(0, 12), 0).lastInsertRowid, name: n, price, cake: c === 'Cakes',
  }));
  ingredients.forEach(([n, c, u, cost, reorder], i) => insItem.run(n, 'I' + String(i + 1).padStart(3, '0'), 'ingredient', c, u, cost, 0, i % 4 === 0 ? reorder - 1 : between(reorder + 2, reorder * 4), reorder));
  packaging.forEach(([n, u, cost, reorder], i) => insItem.run(n, 'K' + String(i + 1).padStart(3, '0'), 'packaging', 'Packaging', u, cost, 0, i === 1 ? 120 : between(reorder + 10, reorder * 3), reorder));

  // ---- vendors ----
  const vendorDefs = [
    ['Sharma Flour Mills', 'Flour & Grains', 'Mr. Sharma', 4000], ['Amul Dairy Distributor', 'Dairy', 'Vikas', 0],
    ['Choco World Supplies', 'Chocolate & Cocoa', 'Anita', 2500], ['PackRight Packaging', 'Packaging', 'Harpreet', 0], ['Indane Gas Agency', 'Gas', 'Office', 0],
  ];
  const vendors = vendorDefs.map(([name, cat, person, ob]) => ({
    id: db.prepare('INSERT INTO vendors (name, category, contact_person, phone, opening_balance, address) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, cat, person, '98' + between(10000000, 99999999), ob, 'Industrial Area, Phase 2').lastInsertRowid, name, cat,
  }));

  const insExp = db.prepare(`INSERT INTO expenses (date, category, amount, payment_mode, vendor_id, paid_to, description, source, created_by, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insBill = db.prepare('INSERT INTO vendor_bills (vendor_id, bill_no, bill_date, due_date, amount, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insPay = db.prepare(`INSERT INTO vendor_payments (vendor_id, bill_id, expense_id, date, amount, payment_mode, reference, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let billNo = 1000;

  const insClose = db.prepare(`INSERT OR IGNORE INTO daily_closings (date, opening_cash, cash_sales, online_sales, cash_counted, cash_handover, closed_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insProd = db.prepare(`INSERT INTO production_logs (date, item_id, qty_made, qty_sold, qty_wasted, made_by, sold_updated_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let drawer = 2000;

  for (let i = 0; i <= DAYS; i++) {
    const d = addDays(start, i);
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const growth = 1 + i / DAYS * 0.25;

    // daily small expenses
    const cashExp = [];
    const addExp = (cat, amt, mode, desc, paidTo) => { insExp.run(d, cat, amt, mode, null, paidTo || null, desc, 'manual', pick([ids.cashier, ids.manager]), null); if (mode === 'cash') cashExp.push(amt); };
    addExp('Staff Food', between(150, 400), 'cash', 'Staff lunch & tea');
    if (rnd() < 0.35) addExp('Transport', between(80, 350), 'cash', 'Auto / delivery charges', 'Local transport');
    if (rnd() < 0.2) addExp('Miscellaneous', between(50, 600), pick(['cash', 'online']), pick(['Cleaning supplies', 'Stationery', 'Pest control spray', 'Plumber']));
    if (rnd() < 0.15) addExp('Raw Materials', between(300, 1500), 'cash', pick(['Local market fruits', 'Extra eggs', 'Milk top-up']), 'Local market');
    if (d.endsWith('-01')) {
      addExp('Rent', 45000, 'online', 'Shop rent', 'Landlord');
      addExp('Salary & Wages', 98000, 'online', 'Monthly staff salaries', 'Staff');
    }
    if (d.endsWith('-10')) addExp('Electricity', between(9000, 14000), 'online', 'Electricity bill', 'PSPCL');
    if (d.endsWith('-15') && rnd() < 0.6) addExp('Marketing', between(1500, 5000), 'online', 'Instagram ads / flyers', 'Meta Ads');
    if (d.endsWith('-20')) addExp('Repairs & Maintenance', between(800, 4000), 'cash', 'Oven / fridge service', 'Technician');

    // vendor bills (credit purchases) & payments
    if (dow === 1 || dow === 4) {
      const v = vendors[dow === 1 ? 0 : 1];
      const amt = between(dow === 1 ? 6000 : 4000, dow === 1 ? 14000 : 9000);
      insBill.run(v.id, 'INV-' + (++billNo), d, addDays(d, 15), amt, dow === 1 ? 'Maida, sugar, grains' : 'Butter, cream, milk', ids.manager);
    }
    if (dow === 3 && rnd() < 0.7) insBill.run(vendors[2].id, 'CW-' + (++billNo), d, addDays(d, 21), between(5000, 12000), 'Compound chocolate, cocoa', ids.manager);
    if (i % 14 === 3) insBill.run(vendors[3].id, 'PR-' + (++billNo), d, addDays(d, 30), between(3000, 8000), 'Cake boxes, pastry boxes, bags', owner);
    if (i % 9 === 0) insBill.run(vendors[4].id, 'GAS-' + (++billNo), d, addDays(d, 5), 2 * 1850, '2 commercial cylinders', ids.cashier);

    if (d < addDays(T, -2) && (dow === 6 || dow === 2)) {
      for (const v of vendors) {
        const bal = db.prepare(`SELECT v.opening_balance + COALESCE((SELECT SUM(amount) FROM vendor_bills WHERE vendor_id = v.id),0)
          - COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE vendor_id = v.id),0) AS b FROM vendors v WHERE v.id = ?`).get(v.id).b;
        if (bal > 3000 && rnd() < 0.55) {
          const amt = round(Math.min(bal, Math.round(bal * (0.5 + rnd() * 0.4) / 100) * 100));
          const mode = amt > 8000 ? 'bank' : pick(['cash', 'online']);
          const e = insExp.run(d, 'Vendor Payment', amt, mode, v.id, v.name, `Payment to ${v.name}`, 'vendor_payment', ids.manager, null);
          insPay.run(v.id, null, e.lastInsertRowid, d, amt, mode, mode === 'bank' ? 'UTR' + between(100000, 999999) : null, ids.manager);
          if (mode === 'cash') cashExp.push(amt);
        }
      }
    }

    // production
    let valueSold = 0;
    if (i >= DAYS - 60) {
      for (const p of productIds) {
        if (p.cake && rnd() < 0.4) continue;
        const made = p.cake ? between(2, 6) : between(weekend ? 18 : 10, weekend ? 40 : 28);
        const isToday = d === T;
        const sold = isToday ? null : Math.min(made, Math.round(made * (0.72 + rnd() * 0.26)));
        const wasted = isToday ? 0 : Math.max(0, Math.round((made - sold) * rnd() * 0.5));
        insProd.run(d, p.id, made, sold, wasted, pick([ids.cook, ids.kitchen_staff]), isToday ? null : pick([ids.cashier, ids.customer_service]), null);
        valueSold += (sold || Math.round(made * 0.85)) * p.price;
      }
    }

    // closing (not today)
    if (d < T) {
      const base = (weekend ? 26000 : 17000) * growth * (0.85 + rnd() * 0.3);
      const sales = i >= DAYS - 60 ? Math.max(base, valueSold * 0.9) : base;
      const onlineShare = 0.45 + rnd() * 0.2 + i / DAYS * 0.1;
      const online = Math.round(sales * onlineShare / 10) * 10;
      const cash = Math.round((sales - online) / 10) * 10;
      const expected = drawer + cash - cashExp.reduce((a, b) => a + b, 0);
      const off = rnd() < 0.15 ? pick([-200, -100, -50, 50, 100]) : 0;
      const counted = expected + off;
      const handover = Math.max(0, Math.round((counted - 3000) / 100) * 100);
      insClose.run(d, drawer, cash, online, counted, handover, pick([ids.cashier, ids.manager]), off ? (off < 0 ? 'Short in drawer, checking' : 'Extra cash, customer change') : null);
      drawer = counted - handover;
    }
  }

  // ---- cake orders ----
  const names = ['Ananya', 'Rohit', 'Simran', 'Karan', 'Meera', 'Arjun', 'Pooja', 'Vikram', 'Isha', 'Dev', 'Tanvi', 'Harsh'];
  const cakes = [['Chocolate Truffle', '1 kg'], ['Black Forest', '1 kg'], ['Red Velvet Heart', '1.5 kg'], ['Photo Cake', '2 kg'], ['Pineapple', '500 g'], ['2-Tier Wedding Cake', '5 kg']];
  const insOrder = db.prepare(`INSERT INTO orders (order_no, customer_name, phone, item_desc, weight, flavour, message, delivery_date, delivery_time, total_amount, advance_paid, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let k = 0; k < 40; k++) {
    const offset = between(-45, 7);
    const d = addDays(T, offset);
    const [cake, wt] = pick(cakes);
    const total = between(6, 40) * 100;
    const status = offset < 0 ? (rnd() < 0.92 ? 'delivered' : 'cancelled') : offset === 0 ? pick(['in_kitchen', 'ready']) : pick(['pending', 'pending', 'in_kitchen']);
    const name = pick(names) + ' ' + pick(['Singh', 'Sharma', 'Mehta', 'Gupta', 'Kaur', 'Bansal']);
    insOrder.run(`ORD-${d.replace(/-/g, '').slice(2)}-${String(k + 1).padStart(3, '0')}`, name, '9' + between(100000000, 999999999), cake, wt,
      cake.includes('Chocolate') ? 'Chocolate' : pick(['Vanilla', 'Chocolate', 'Butterscotch', 'Fruit']), pick(['Happy Birthday!', 'Happy Anniversary', 'Congratulations', '']),
      d, pick(['11:00', '16:00', '18:30', '20:00']), total, Math.round(total * 0.5 / 100) * 100, status, ids.customer_service);
  }
});

console.log(`Demo data added for ${DAYS} days (${start} → ${T}).
Staff logins (password: cakery123):
  manager  · cashier  · cook  · kitchen  · support`);
