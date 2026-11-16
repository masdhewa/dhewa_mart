import datetime as dt

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Dhewa_Mart", page_icon="🛒", layout="wide")


def rp(n):
    return "Rp{:,.0f}".format(n).replace(",", ".")


# ---------- Data awal (demo, disimpan di session) ----------
if "produk" not in st.session_state:
    st.session_state.produk = pd.DataFrame(
        [
            ["Beras 5kg", 68000, 65000, 3, 66000],
            ["Minyak 1L", 18000, 17000, 6, 17500],
            ["Gula 1kg", 17500, 16500, 5, 17000],
            ["Indomie Goreng", 3500, 3200, 40, 3400],
            ["Telur 1kg", 29000, 27500, 5, 28000],
            ["Kopi Sachet", 2000, 1800, 10, 1900],
        ],
        columns=["nama", "eceran", "grosir", "min_grosir", "member"],
    )
    st.session_state.member = pd.DataFrame(
        [["Bu Sari", "0812-0000-001", 12, 0], ["Pak Budi", "0813-0000-002", 40, 45000]],
        columns=["nama", "hp", "poin", "hutang"],
    )
    st.session_state.trx = []
    st.session_state.keranjang = {}
    st.session_state.struk = None

S = st.session_state
UMUM = "Umum (non-member)"


def harga(row, qty, is_member):
    if is_member:
        return int(row.member), "Member"
    if qty >= row.min_grosir:
        return int(row.grosir), "Grosir"
    return int(row.eceran), "Eceran"


st.title("🛒 Dhewa_Mart")
tab_kasir, tab_member, tab_hutang, tab_dash = st.tabs(["Kasir", "Member", "Hutang", "Dashboard"])

# ---------- KASIR ----------
with tab_kasir:
    kiri, kanan = st.columns([1.2, 1])
    with kiri:
        st.subheader("Produk")
        cari = st.text_input("Cari produk", "")
        df = S.produk[S.produk.nama.str.contains(cari, case=False)]
        for _, p in df.iterrows():
            c1, c2 = st.columns([3, 1])
            c1.markdown(f"**{p.nama}** · {rp(p.eceran)}  \nGrosir {rp(p.grosir)} (≥{p.min_grosir})")
            if c2.button("＋", key=f"add_{p.nama}"):
                S.keranjang[p.nama] = S.keranjang.get(p.nama, 0) + 1
                st.rerun()

    with kanan:
        st.subheader("Keranjang")
        pilih = st.selectbox("Pelanggan", [UMUM] + list(S.member.nama))
        is_member = pilih != UMUM
        baris, subtotal = [], 0
        for nama, qty in list(S.keranjang.items()):
            p = S.produk[S.produk.nama == nama].iloc[0]
            h, tipe = harga(p, qty, is_member)
            c1, c2 = st.columns([3, 2])
            c1.write(f"{nama} · {tipe}\n{rp(h)} × {qty}")
            q = c2.number_input("Qty", 0, 999, qty, key=f"q_{nama}", label_visibility="collapsed")
            if q != qty:
                if q == 0:
                    del S.keranjang[nama]
                else:
                    S.keranjang[nama] = q
                st.rerun()
            baris.append((nama, qty, h, h * qty))
            subtotal += h * qty
        if not baris:
            st.info("Belum ada barang.")

        diskon = 0
        if is_member:
            m = S.member[S.member.nama == pilih].iloc[0]
            if st.checkbox(f"Tukar poin ({int(m.poin)} poin = Rp100/poin)"):
                diskon = min(int(m.poin) * 100, subtotal)
        total = subtotal - diskon
        st.metric("Total", rp(total))
        metode = st.radio("Pembayaran", ["Tunai", "Hutang"], horizontal=True)
        uang = 0
        if metode == "Tunai":
            uang = st.number_input("Uang diterima", 0, step=1000)
            st.write("Kembalian:", rp(max(0, uang - total)))

        if st.button("Bayar & buat struk", type="primary", disabled=not baris):
            if metode == "Hutang" and not is_member:
                st.error("Hutang hanya untuk member.")
            elif metode == "Tunai" and uang < total:
                st.error("Uang diterima kurang.")
            else:
                poin_dapat = total // 10000 if is_member else 0
                if is_member:
                    i = S.member.index[S.member.nama == pilih][0]
                    S.member.loc[i, "poin"] += poin_dapat - diskon // 100
                    if metode == "Hutang":
                        S.member.loc[i, "hutang"] += total
                no = len(S.trx) + 1
                S.trx.append(
                    {"no": no, "waktu": dt.datetime.now(), "total": total, "metode": metode,
                     "pelanggan": pilih if is_member else "-", "item": baris}
                )
                teks = [f"DHEWA_MART", f"Struk #{no}  {dt.datetime.now():%d/%m/%Y %H:%M}", "-" * 28]
                for n, q, h, s in baris:
                    teks += [n, f"  {q} x {h:,} = {s:,}".replace(",", ".")]
                teks += ["-" * 28, f"Subtotal : {rp(subtotal)}"]
                if diskon:
                    teks.append(f"Tukar poin: -{rp(diskon)}")
                teks.append(f"TOTAL    : {rp(total)}")
                teks += [f"Tunai    : {rp(uang)}", f"Kembali  : {rp(uang - total)}"] if metode == "Tunai" else [f"HUTANG a.n. {pilih}"]
                if is_member:
                    teks.append(f"Poin +{poin_dapat}")
                teks += ["", "Terima kasih!"]
                S.struk = "\n".join(teks)
                S.keranjang = {}
                st.rerun()

    if S.struk:
        st.divider()
        st.subheader("Struk")
        st.code(S.struk, language=None)
        st.download_button("Unduh struk (.txt)", S.struk, file_name="struk.txt")
        isi = S.struk.replace("\n", "<br>").replace(" ", "&nbsp;")
        components.html(
            f'<button onclick="window.print()" style="padding:8px 14px">🖨️ Cetak struk</button>'
            f'<div style="font:12px monospace;width:58mm;margin-top:8px">{isi}</div>',
            height=420, scrolling=True,
        )

# ---------- MEMBER ----------
with tab_member:
    with st.form("fm", clear_on_submit=True):
        n = st.text_input("Nama")
        h = st.text_input("No. HP")
        if st.form_submit_button("Tambah member") and n:
            S.member.loc[len(S.member)] = [n, h, 0, 0]
            st.rerun()
    st.caption("Poin: 1 poin tiap belanja Rp10.000. Member otomatis dapat harga member.")
    st.dataframe(S.member, use_container_width=True, hide_index=True)

# ---------- HUTANG ----------
with tab_hutang:
    ada = S.member[S.member.hutang > 0]
    if ada.empty:
        st.success("Tidak ada hutang.")
    for i, m in ada.iterrows():
        c1, c2 = st.columns([3, 1])
        c1.write(f"**{m.nama}** — {rp(m.hutang)}")
        if c2.button("Lunasi", key=f"lunas_{i}"):
            S.member.loc[i, "hutang"] = 0
            st.rerun()

# ---------- DASHBOARD ----------
with tab_dash:
    hari_ini = [t for t in S.trx if t["waktu"].date() == dt.date.today()]
    a, b, c, d = st.columns(4)
    a.metric("Penjualan hari ini", rp(sum(t["total"] for t in hari_ini)))
    b.metric("Transaksi hari ini", len(hari_ini))
    c.metric("Total hutang", rp(S.member.hutang.sum()))
    d.metric("Member", len(S.member))
    if S.trx:
        df_t = pd.DataFrame(S.trx)
        df_t["tanggal"] = df_t.waktu.dt.date
        st.bar_chart(df_t.groupby("tanggal").total.sum())
        terjual = {}
        for t in S.trx:
            for n, q, _, _ in t["item"]:
                terjual[n] = terjual.get(n, 0) + q
        st.subheader("Produk terlaris")
        st.dataframe(pd.Series(terjual, name="terjual").sort_values(ascending=False), use_container_width=True)
        st.subheader("Transaksi terakhir")
        st.dataframe(df_t[["no", "waktu", "pelanggan", "metode", "total"]].tail(10), hide_index=True, use_container_width=True)
    else:
        st.info("Belum ada transaksi. Lakukan penjualan di tab Kasir.")
