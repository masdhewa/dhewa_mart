// DhewaMart — API kasir (Cloudflare Worker + D1)
// Develop Program By Nurman Catra
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
class HttpErr extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const PUB = ['store', 'addr', 'phone', 'footer', 'kasirs', 'pointPer', 'pointVal', 'minRedeem', 'qris', 'qrisImg'];
const NUMK = ['pointPer', 'pointVal', 'minRedeem'];
const int = v => Math.max(0, Math.round(Number(v) || 0));
const str = (v, n = 200) => String(v ?? '').slice(0, n);

async function secret(db) { return db.prepare("SELECT v FROM meta WHERE k='secret'").first('v'); }
async function makeToken(db) { const exp = Date.now() + 12 * 36e5; return exp + '.' + await hmac(await secret(db), 'adm.' + exp); }
async function isAdmin(req, db) {
  const a = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = a.split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  return sig === await hmac(await secret(db), 'adm.' + exp);
}
async function getSettings(db) {
  const { results } = await db.prepare('SELECT k,v FROM settings').all();
  const s = {}; for (const r of results) s[r.k] = r.v; return s;
}
function pubSettings(s, admin) {
  const o = {};
  for (const k of PUB) o[k] = k === 'kasirs' ? JSON.parse(s[k] || '[]') : NUMK.includes(k) ? Number(s[k]) : (s[k] || '');
  if (admin) o.adminU = s.admin_u;
  return o;
}
const mapTrx = (t, items) => ({
  id: t.id, no: t.no, date: t.date, items, sub: t.sub, disc: t.disc, ptsUsed: t.pts_used, total: t.total, method: t.method, paid: t.paid,
  kasir: t.kasir, member: t.member_id, memberName: t.member_name || '', earn: t.earn, ptsAfter: t.pts_after, demo: !!t.demo
});

async function bootstrap(req, db) {
  const admin = await isAdmin(req, db);
  const since = Date.now() - 365 * 864e5;
  const [c, p, m, t, it] = await db.batch([
    db.prepare('SELECT id,name,ico FROM categories ORDER BY sort,rowid'),
    db.prepare('SELECT * FROM products ORDER BY created_at DESC'),
    db.prepare('SELECT * FROM members ORDER BY joined DESC'),
    db.prepare('SELECT * FROM trx WHERE date>=? ORDER BY date DESC').bind(since),
    db.prepare('SELECT ti.* FROM trx_items ti JOIN trx t ON t.id=ti.trx_id WHERE t.date>=?').bind(since),
  ]);
  const byTrx = {};
  for (const i of it.results) (byTrx[i.trx_id] ||= []).push({ id: i.product_id, name: i.name, cat: i.cat, price: i.price, cost: i.cost, qty: i.qty });
  return J({
    admin,
    set: pubSettings(await getSettings(db), admin),
    cats: c.results,
    products: p.results.map(x => ({ ...x, sku: x.sku || '', ico: x.ico || '', img: x.img || '' })),
    members: m.results,
    trx: t.results.map(x => mapTrx(x, byTrx[x.id] || [])),
  });
}

async function login(body, db) {
  const s = await getSettings(db);
  const u = str(body.u, 60), p = str(body.p, 100);
  const sec = await secret(db);
  const stored = s.admin_p || '';
  let ok = false;
  if (u === s.admin_u) {
    if (stored.startsWith('plain:')) {
      ok = p === stored.slice(6);
      if (ok) await db.prepare("UPDATE settings SET v=? WHERE k='admin_p'").bind('sha:' + await sha(sec + p)).run();
    } else ok = stored === 'sha:' + await sha(sec + p);
  }
  if (!ok) throw new HttpErr('Username / password salah', 401);
  return J({ token: await makeToken(db) });
}

async function createTrx(d, db) {
  const items = (Array.isArray(d.items) ? d.items : []).map(x => ({ id: str(x.id, 60), qty: int(x.qty) })).filter(x => x.qty > 0);
  if (!items.length) throw new HttpErr('Keranjang kosong');
  const ph = items.map(() => '?').join(',');
  const { results: prods } = await db.prepare(`SELECT * FROM products WHERE id IN (${ph})`).bind(...items.map(i => i.id)).all();
  const P = Object.fromEntries(prods.map(p => [p.id, p]));
  let sub = 0;
  for (const i of items) {
    const p = P[i.id];
    if (!p) throw new HttpErr('Produk tidak ditemukan, muat ulang halaman', 409);
    if (p.stock < i.qty) throw new HttpErr(`Stok ${p.name} tinggal ${p.stock}`, 409);
    sub += p.price * i.qty;
  }
  const s = await getSettings(db);
  const pointPer = Number(s.pointPer) || 10000, pointVal = Number(s.pointVal) || 100, minRedeem = Number(s.minRedeem) || 0;
  const m = d.member ? await db.prepare('SELECT * FROM members WHERE id=?').bind(str(d.member, 60)).first() : null;
  let pts = 0, disc = 0;
  if (m && d.usePts && m.points >= minRedeem) { pts = Math.min(m.points, Math.floor(sub / pointVal)); disc = pts * pointVal; }
  const total = sub - disc;
  const earn = m ? Math.floor(total / pointPer) : 0;
  const method = d.method === 'Tunai' ? 'Tunai' : 'QRIS';
  const paid = method === 'Tunai' ? int(d.paid) : total;
  if (paid < total) throw new HttpErr('Uang diterima kurang');
  const seq = await db.prepare("UPDATE meta SET v=CAST(v AS INTEGER)+1 WHERE k='seq' RETURNING v").first('v');
  const id = crypto.randomUUID();
  const no = 'TRX' + String(seq).padStart(5, '0');
  const date = Date.now();
  const ptsAfter = m ? m.points - pts + earn : 0;
  const kasir = str(d.kasir, 60);
  const st = [
    db.prepare('INSERT INTO trx(id,no,date,sub,disc,pts_used,total,method,paid,kasir,member_id,member_name,earn,pts_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, no, date, sub, disc, pts, total, method, paid, kasir, m ? m.id : null, m ? m.name : '', earn, ptsAfter),
  ];
  for (const i of items) {
    const p = P[i.id];
    st.push(db.prepare('INSERT INTO trx_items(trx_id,product_id,name,cat,price,cost,qty) VALUES(?,?,?,?,?,?,?)').bind(id, p.id, p.name, p.cat, p.price, p.cost || 0, i.qty));
    st.push(db.prepare('UPDATE products SET stock=stock-? WHERE id=?').bind(i.qty, p.id));
  }
  if (m) st.push(db.prepare('UPDATE members SET points=points-?+? WHERE id=?').bind(pts, earn, m.id));
  await db.batch(st);
  const trx = mapTrx({ id, no, date, sub, disc, pts_used: pts, total, method, paid, kasir, member_id: m ? m.id : null, member_name: m ? m.name : '', earn, pts_after: ptsAfter },
    items.map(i => { const p = P[i.id]; return { id: p.id, name: p.name, cat: p.cat, price: p.price, cost: p.cost || 0, qty: i.qty }; }));
  return J({ trx, stocks: items.map(i => ({ id: i.id, stock: P[i.id].stock - i.qty })), member: m ? { id: m.id, points: ptsAfter } : null });
}

const ADMIN_OPS = new Set(['member.delete', 'product.save', 'product.delete', 'product.restock', 'cat.add', 'cat.delete', 'settings.save', 'kasir.set', 'qrisImg', 'trx.deleteDemo']);

async function doOp(req, body, db) {
  const { op, data: d = {} } = body;
  const admin = await isAdmin(req, db);
  if (ADMIN_OPS.has(op) && !admin) throw new HttpErr('Sesi admin habis, silakan login lagi', 401);
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  switch (op) {
    case 'trx': return createTrx(d, db);
    case 'member.add': {
      const phone = str(d.phone, 30);
      if (!str(d.name).trim()) throw new HttpErr('Nama member wajib diisi');
      if (phone && await db.prepare('SELECT 1 FROM members WHERE phone=?').bind(phone).first()) throw new HttpErr('No. HP sudah terdaftar');
      await run('INSERT INTO members(id,name,phone,points,joined) VALUES(?,?,?,0,?)', str(d.id, 60) || crypto.randomUUID(), str(d.name, 80), phone, Date.now());
      break;
    }
    case 'member.update': {
      const phone = str(d.phone, 30);
      if (phone && await db.prepare('SELECT 1 FROM members WHERE phone=? AND id<>?').bind(phone, str(d.id, 60)).first()) throw new HttpErr('No. HP sudah dipakai member lain');
      await run('UPDATE members SET name=?,phone=? WHERE id=?', str(d.name, 80), phone, str(d.id, 60));
      if (admin && d.points != null) await run('UPDATE members SET points=? WHERE id=?', int(d.points), str(d.id, 60));
      break;
    }
    case 'member.delete': await run('DELETE FROM members WHERE id=?', str(d.id, 60)); break;
    case 'product.save': {
      if (!str(d.name).trim() || !int(d.price)) throw new HttpErr('Nama & harga jual wajib diisi');
      await run(`INSERT INTO products(id,name,cat,price,cost,stock,min,sku,ico,img,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,cat=excluded.cat,price=excluded.price,cost=excluded.cost,stock=excluded.stock,min=excluded.min,sku=excluded.sku,ico=excluded.ico,img=excluded.img`,
        str(d.id, 60) || crypto.randomUUID(), str(d.name, 120), str(d.cat, 60), int(d.price), int(d.cost), int(d.stock), int(d.min), str(d.sku, 60), str(d.ico, 16), str(d.img, 400000), Date.now());
      break;
    }
    case 'product.delete': await run('DELETE FROM products WHERE id=?', str(d.id, 60)); break;
    case 'product.restock': await run('UPDATE products SET stock=stock+? WHERE id=?', int(d.qty), str(d.id, 60)); break;
    case 'cat.add': await run('INSERT INTO categories(id,name,ico,sort) VALUES(?,?,?,(SELECT IFNULL(MAX(sort),0)+1 FROM categories))', str(d.id, 60) || crypto.randomUUID(), str(d.name, 60), str(d.ico, 16)); break;
    case 'cat.delete': {
      if (await db.prepare('SELECT 1 FROM products WHERE cat=?').bind(str(d.id, 60)).first()) throw new HttpErr('Kategori masih dipakai produk');
      await run('DELETE FROM categories WHERE id=?', str(d.id, 60)); break;
    }
    case 'kasir.set': await run("INSERT OR REPLACE INTO settings(k,v) VALUES('kasirs',?)", JSON.stringify((d.kasirs || []).map(k => str(k, 40)).filter(Boolean))); break;
    case 'qrisImg': await run("INSERT OR REPLACE INTO settings(k,v) VALUES('qrisImg',?)", str(d.img, 1500000)); break;
    case 'settings.save': {
      const kv = {
        store: str(d.store, 80) || 'DhewaMart', addr: str(d.addr), phone: str(d.phone, 40), footer: str(d.footer),
        pointPer: String(int(d.pointPer) || 10000), pointVal: String(int(d.pointVal) || 100), minRedeem: String(int(d.minRedeem)), qris: str(d.qris, 1000),
      };
      if (str(d.adminU, 60).trim()) kv.admin_u = str(d.adminU, 60).trim();
      if (d.adminP) { if (String(d.adminP).length < 4) throw new HttpErr('Password minimal 4 karakter'); kv.admin_p = 'sha:' + await sha(await secret(db) + String(d.adminP)); }
      await db.batch(Object.entries(kv).map(([k, v]) => db.prepare('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)').bind(k, v)));
      break;
    }
    case 'trx.deleteDemo': await db.batch([db.prepare('DELETE FROM trx_items WHERE trx_id IN (SELECT id FROM trx WHERE demo=1)'), db.prepare('DELETE FROM trx WHERE demo=1')]); break;
    default: throw new HttpErr('Operasi tidak dikenal: ' + op);
  }
  return J({ ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      const db = env.DB;
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') return await bootstrap(req, db);
      if (req.method !== 'POST') throw new HttpErr('Method tidak diizinkan', 405);
      const body = await req.json().catch(() => { throw new HttpErr('Body JSON tidak valid'); });
      if (url.pathname === '/api/login') return await login(body, db);
      if (url.pathname === '/api/op') return await doOp(req, body, db);
      throw new HttpErr('Endpoint tidak ditemukan', 404);
    } catch (e) {
      return J({ error: e.message || 'Server error' }, e.status || 500);
    }
  },
};
