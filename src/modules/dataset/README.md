# Modul Dataset

Kurasi → validasi → review → ekspor. Backend adalah otoritas aturan.

## Alur status

```
draft → pending_review → verified → approved
  ↑          ↓                ↓
  └── needs_correction ←──────┘
         ↓
      rejected / archived
```

Transisi tidak sah → `409 INVALID_STATUS_TRANSITION`. Lihat
`dataset.constants.ts`.

## Endpoint admin (`/api/v1/dataset-items`)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | List + filter: `status` (koma), `label`, `source`, `acquisitionSource`, `category`, `allergen`, `ocrStatus`, `quality`, `duplicate`, `exportEligible`, `from`, `to`, `search`, sort, paginasi |
| POST | `/` | Buat record manual (`CreateDatasetItemDto`) |
| GET | `/:id` | Detail |
| GET | `/:id/history` | Riwayat audit record |
| PATCH | `/:id` | Update parsial + transisi status |
| PATCH | `/:id/review` | `submit/verify/approve/reject/request_correction/archive/restore` |
| POST | `/:id/image` | Unggah gambar (JPG/PNG/WEBP/GIF/BMP, ≤5 MB), hitung SHA-256 + dimensi |
| PATCH | `/:id/verify` | Shorthand verify |
| PATCH | `/:id/unverify` | Kembalikan ke `needs_correction` |
| DELETE | `/:id` | Hapus record + berkas gambar |
| GET | `/statistics` | Statistik operasional + distribusi + tren 14 hari |

## Ekspor

| Method | Path | Keterangan |
|---|---|---|
| GET | `/export` | CSV/JSON lama (kompatibel; default verified+approved) |
| GET | `/download` | ZIP format lama (`dataset.csv`, manifest, images, split.json) |
| GET | `/download/estimate` | Estimasi ZIP lama |
| POST | `/exports/preview` | Pratinjau profil baru |
| POST | `/exports` | Hasilkan ZIP berprofil + simpan riwayat |
| GET | `/exports` | Riwayat ekspor |
| GET | `/exports/:id/download` | Unduh ulang |

Profil: `raw`, `nlp`, `image_classification`, `multimodal`.
Dokumentasi lengkap: `docs/DATASET_EXPORT.md`.

## Kontribusi pengguna

`POST /api/v1/detections/:id/contribute` (pemilik atau admin) membuat record
`draft` dengan `source=user_submission` / `acquisition_source=user_scan`.
Satu deteksi hanya boleh punya satu record (`409 ALREADY_CONTRIBUTED`).

## Validasi (ringkas)

- teks & nama produk wajib saat review;
- alergen harus ada di master `allergens.name`;
- `gold_label=safe` + alergen positif → error konflik;
- anotasi kosong → error kecuali manusia menyatakan sudah memeriksa
  (`annotationSource=human` + `annotatedAt`);
- confidence 0..1, severity valid;
- duplikat teks (md5) → warning + `duplicateOf` (kanonik = id terkecil);
- gambar: MIME, ukuran, checksum, dimensi.

Hasil disimpan di `validation_errors` dan `quality_status`
(`ok|warning|error`).

## Migrasi

```bash
npm run build
npm run db:migrate
```

- `20261001000000-dataset-platform.ts` — kolom metadata + index + ENUM→VARCHAR.
- `20261001000001-dataset-exports.ts` — riwayat ekspor.

Idempoten dan non-destruktif. Untuk pengembangan tanpa MySQL:
`DB_DIALECT=sqlite DB_STORAGE=./.dev/dev.sqlite DB_SYNC=true`.
