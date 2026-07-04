# Panduan Mengisi Google Spreadsheet — Tekongan

Semua konten game (teks, peran, lokasi, tempat persembunyian, status) ditarik
dari Google Spreadsheet yang sudah di-*Publish to Web* sebagai CSV. Anda bisa
mengubah konten tanpa menyentuh kode.

## 1. Persiapan sekali saja
1. Buka spreadsheet sumber.
2. **File → Share → Publish to web** → pilih **Entire document**, format **Comma-separated values (.csv)** → **Publish**.
3. Pastikan setiap tab punya GID yang sudah didaftarkan di
   `src/lib/sheets.ts` (lihat komentar `GIDS`). Untuk menambah tab baru:
   buka tab itu, salin angka di URL setelah `#gid=`, lalu tambahkan ke object
   `GIDS`.

## 2. Struktur tiap tab

> Baris pertama = HEADER (akan diabaikan oleh aplikasi). Mulai data dari baris ke-2.

### Tab `Localization` — teks UI
Kolom A = `key`, kolom B = `value` (bahasa Jawa/Indonesia).

| key | value |
|---|---|
| app_title | TEKONGAN |
| btn_create | Gawe Room |
| msg_caught | KENA TEKONG! |
| footer | Dikembangkan oleh Arsepat |

Daftar key lengkap ada di `DEFAULTS.localization` di `src/lib/sheets.ts`.
Key yang tidak diisi akan jatuh ke nilai default.

### Tab `Roles` — peran pemain
Kolom A = `id`, B = `name`.

| id | name |
|---|---|
| seeker | Penjaga |
| hider | Pemain |

> Jangan ubah `id`, hanya ubah `name`.

### Tab `Venues` — lokasi permainan
Kolom A = `id`, B = `name`.

| id | name |
|---|---|
| kampung | Kampung |
| sekolah | Sekolahan |
| sawah | Pinggir Sawah |

`id` venue dipakai sebagai foreign key di tab `Spots`.

### Tab `Spots` — tempat persembunyian
Kolom A = `id` (unik), B = `venueId` (harus cocok dengan id di tab Venues),
C = `text` (label yang tampil, boleh emoji).

| id | venueId | text |
|---|---|---|
| k1 | kampung | 🌳 Wit Gedhang |
| s1 | sekolah | 📚 Perpus |
| w1 | sawah   | 🌾 Galengan |

Tambah baris baru kapan saja; aplikasi otomatis menampilkannya.

### Tab `GameStatus` — label status pemain
Kolom A = `key`, B = `value`. Dipakai untuk tampilan hasil & share WhatsApp.

| key | value |
|---|---|
| safe | Slamet |
| caught | Kena Tekong |
| waiting | Lagi Ndelik |

## 3. Cek hasil
1. Setelah edit, tunggu ±1 menit (cache publish Google).
2. Refresh aplikasi (pull-to-refresh dimatikan, gunakan tombol reload browser).
3. Konten baru langsung tampil. Jika tab gagal di-fetch, aplikasi memakai
   nilai default agar game tetap bisa jalan.

## 4. Tips
- **Jangan ganti nama kolom `id`** — itu kunci internal.
- **Emoji aman** dipakai di kolom `text`, `name`, `value`.
- Untuk menambah venue baru: tambah row di `Venues`, lalu tambah minimal 6
  spot di `Spots` dengan `venueId` yang sama.
