# Remi COKDO

Sebuah aplikasi permainan kartu Remi (Rummy) multipemain (*multiplayer*) modern yang mengimplementasikan variasi aturan khusus: **Joker Tiruan (Wild Card)** dan sistem **Sanksi Kena Umpan (Feed Punishment)**. Proyek ini dibangun dengan arsitektur *Serverless* menggunakan Next.js, Firebase, dan Vercel.

## 🚀 Fitur Utama

1. **Sistem Kartu Sakti (Wild Card / Joker Tiruan)**
   - Menggunakan 52 kartu standar tanpa Joker bawaan.
   - 1 kartu diacak di awal ronde sebagai "Kartu Sakti" (misal: 2 Love).
   - Semua kartu dengan nilai tersebut otomatis menjadi Wild Card yang bisa menyamar menjadi kartu apa saja dalam kombinasi Kelompok (Set) maupun Seri (Run).

2. **Mesin Validasi Kombinasi Pintar (Smart Meld Engine)**
   - Validasi otomatis untuk kombinasi Set (Triple) dan Run (Seri berurutan se-daun).
   - Fitur *Smart Fit* untuk menempatkan Wild Card pada opsi yang menghasilkan poin tertinggi bagi pemain.

3. **Sistem Bonus Poin Tutup Kartu**
   - Hadiah poin besar berdasarkan kartu terakhir yang dibuang untuk menutup permainan (Rummy):
     - 1 Kartu Sakti (Single Joker): **+500 Poin (Jackpot)**
     - 2 Kartu Sakti: **+50 Poin**
     - Kartu As (A): **+150 Poin**
     - Kartu Gambar (J, Q, K): **+100 Poin**
     - Kartu Angka (2-10): Plus sesuai nominal angka kartu.

4. **Logika Sanksi "Kena Umpan / Tembak"**
   - Melacak riwayat buangan kartu secara *real-time*.
   - Jika Pemain B menutup kartu (*Rummy*) menggunakan kartu hasil buangan terakhir Pemain A, maka Pemain A langsung dikenakan sanksi **pemotongan poin instan** sesuai nilai kartu penutup Pemain B.
   - Poin diizinkan bernilai **negatif (minus)**.
   - Diproses dengan aman di sisi server menggunakan *Firebase Cloud Functions*.

5. **Manajemen Meja & Akses Tamu (Bypass Login)**
   - Pemain terdaftar dapat membuat meja privat dan membagikan *Dynamic Link*.
   - Pengguna baru/belum login yang mengeklik link akan otomatis dibuatkan akun *Anonymous/Guest* via *Firebase Auth* untuk langsung bermain tanpa hambatan registrasi.

6. **Klasemen Ganda (Leaderboard)**
   - **Klasemen Meja:** Sinkronisasi skor *real-time* antar-pemain dari ronde ke ronde di meja yang aktif. Data dihapus saat meja bubar.
   - **Klasemen Umum (Global):** Peringkat permanen berbasis Firestore untuk pemain terdaftar dengan filter Top Score Harian, Mingguan, dan Sepanjang Masa.

## 🛠️ Stack Teknologi

- **Frontend & UI:** [Next.js (App Router)](https://nextjs.org/) + TypeScript
- **Styling:** Tailwind CSS
- **Backend & Database:** 
  - Firebase Authentication (Google, Apple, & Anonymous Login)
  - Firebase Realtime Database (Untuk sinkronisasi kartu & game state di meja)
  - Cloud Firestore (Untuk data pengguna & Klasemen Umum Global)
  - Firebase Cloud Functions (Untuk logika game, skor ronde, dan sanksi umpan)
- **Hosting & CI/CD:** GitHub terintegrasi otomatis dengan [Vercel](https://vercel.com/)

## 📂 Struktur Folder Proyek

```text
├── apps/
│   ├── web/                         # Aplikasi Frontend Next.js
│   │   ├── src/
│   │   │   ├── app/                 # App Router (Pages, Link Undangan /join)
│   │   │   ├── components/          # Komponen UI (Meja Game, Kartu, Papan Skor)
│   │   │   ├── hooks/               # Custom Hooks untuk Firebase Realtime DB
│   │   │   └── lib/                 # Konfigurasi Firebase Client SDK
│   │   ├── package.json
│   │   └── tailwind.config.js
│   │
│   └── functions/                   # Backend Firebase Cloud Functions
│       ├── src/
│       │   ├── index.ts             # Entry point Cloud Functions
│       │   ├── gameLogic.ts         # Validasi kartu sakti & perhitungan sanksi umpan
│       │   └── leaderboard.ts       # Manajemen update skor global
│       ├── package.json
│       └── tsconfig.json
│
├── firestore.rules                  # Keamanan Database Firestore
├── database.rules.json              # Keamanan Realtime Database
└── README.md
```

## ⚙️ Cara Memulai Pengembangan (Lokal)

### Prasyarat
- Node.js versi 18 atau lebih baru
- Firebase CLI terinstal (`npm install -g firebase-tools`)

### Langkah-langkah
1. **Clone repositori ini:**
   ```bash
   git clone https://github.com/username/remi-wildcard-game.git
   cd remi-wildcard-game
   ```

2. **Instal dependensi untuk Frontend dan Functions:**
   ```bash
   # Di root project
   npm install
   cd apps/functions && npm install
   ```

3. **Konfigurasi Variabel Lingkungan (.env):**
   Buat file `.env.local` di dalam folder `apps/web/` dan masukkan konfigurasi Firebase Web App Anda:
   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
   NEXT_PUBLIC_FIREBASE_DATABASE_URL=your_database_url
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   ```

4. **Jalankan Firebase Emulator (Lokal):**
   Untuk menguji backend Cloud Functions dan Realtime DB secara lokal tanpa memakan kuota cloud production:
   ```bash
   firebase emulators:start
   ```

5. **Jalankan Aplikasi Frontend:**
   Buka terminal baru di folder `apps/web/`:
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:3000`.

## 🔒 Keamanan & Integritas Game

Seluruh perhitungan skor ronde, penentuan pemenang, dan eksekusi pengurangan poin akibat sanksi **Kena Umpan** wajib dilakukan melalui fungsi *Cloud Functions* (`calculateRoundScores`). Sisi *frontend* hanya mengirimkan sinyal aksi, sedangkan validasi mutlak dilakukan di sisi *server* untuk mencegah kecurangan/manipulasi data di sisi *client*.

---
Dibuat dengan 💻 untuk komunitas pecinta game kartu remi tradisional Indonesia.
