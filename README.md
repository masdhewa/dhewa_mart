# DhewaMart — Aplikasi Kasir

Aplikasi kasir (POS) DhewaMart: tampilan Android untuk transaksi, tampilan laptop untuk dashboard, member & poin, pembayaran QRIS / tunai, login admin untuk kelola produk, harga & stok.

**Stack:** Cloudflare Workers (static assets + API) + Cloudflare D1 (SQL).

```
public/index.html   → tampilan aplikasi
src/worker.js       → API (/api/bootstrap, /api/login, /api/op)
schema.sql          → struktur tabel + data awal
wrangler.toml       → konfigurasi Worker & binding D1 (DB)
```

## Deploy
Cloudflare Dashboard → Workers & Pages → Create → **Import a repository** → pilih `masdhewa/dhewa_mart` → Deploy.
Setiap push ke `main` otomatis deploy ulang.

Database D1 `dhewamart` sudah dibuat & diisi `schema.sql`.

## Login admin awal
`admin` / `admin123` — segera ganti di menu Pengaturan.

---
Develop Program By Nurman Catra
