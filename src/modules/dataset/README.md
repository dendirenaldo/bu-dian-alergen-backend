# Modul Dataset — Kurasi → Ekspor → Training

Alur: tarik → koreksi → verify → export → gabung → train.

1. Tarik: `PUT /detections/admin/dataset/:detectionId` (prefill OCR/gold_label/alergen; idempoten — bila sudah ada return existing).
2. Koreksi: `PATCH /dataset-items/:id` (`corrected_text` 1..5000, `gold_label` safe|unsafe, `corrected_allergens[]` nama wajib ∈ master `allergens.name` else 422 `UNKNOWN_ALLERGEN`, `severity` low|medium|high|critical, `confidence` 0..1, `notes` maks 2000, `status` draft|verified). `PATCH :id/verify` / `:id/unverify` set `verified_by/at`.
3. Verify: hanya `status=verified` ikut export/download default; `draft` hanya bila `?status=draft` eksplisit.
4. Export: `GET /dataset-items/export?status&label&format=csv|json` → CSV header persis `text,label_id,label` (koma, quote-escape, utf-8, trailing `\n`); mapping 0=safe, 1=unsafe.
5. Unduh: `GET /dataset-items/download?status&label&includeLabels&includeImages&includeSplit` → ZIP `dataset_<yyyymmdd>_<n>items.zip`: `dataset.csv` + `manifest.csv` (11 kolom + `file_found`) + `images/<id>.<ext>` dari `./uploads` (hilang → `file_found=false`, tanpa fallback) + `split.json` (seed 42, Fisher-Yates, union-find detection-group + md5 teks, 70/15/15 per komponen, groupBy `detection_id||id`, `keyColumns:[id]`, `duplicateGroups` md5 cap 50, `coverage{groups,components,uniqueTexts,total,duplicateIds}`, `components`, `audit` disjoint 6 baris, `sessions{train,val,test}`, `preflight{disjoint,hasTestImages,missingImages,duplicateGroups,duplicateGroupsCapped,frozenConflict}`) + `README.txt`.
6. Estimasi: `GET /dataset-items/download/estimate` → `{bytes,fileCount,breakdown}`. Throttle export/download 5/mnt. Audit `dataset.*` di `audit_logs` (no-op bila tabel belum ada).

## Gabung ke train_real

`dataset.csv` (delimiter `,`) di-append ke `train_real.csv`:

```bash
CSV_DELIMITER="," python scripts/rebuild_split.py --csv-input gabungan.csv --out-dir ./artifacts/bert/input
```

Catatan: train default `CSV_DELIMITER=";"` (lihat `ml-training/.env.example:8`, `app/config.py:130-132`) — wajib set `CSV_DELIMITER=","` saat gabung. Kolom `nama_produk` absen → disintesis `produk_{i}`; grouping produk andalkan `split.json` backend. Jangan campur holdout ke train.

Contoh valid (`text,label_id,label`):

```csv
text,label_id,label
Air mineral murni,0,safe
"Susu bubuk, mengandung ""kacang"" dan whey",1,unsafe
```
