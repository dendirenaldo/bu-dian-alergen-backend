import { createHash } from 'node:crypto';

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Deteksi format dari magic bytes (bukan dari nama/MIME klien). */
export function detectImageFormat(buf: Buffer): 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.toString('ascii', 0, 2) === 'BM') return 'bmp';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Format yang kompatibel untuk ekstensi yang diterima. */
export function formatMatchesExt(format: string | null, ext: string): boolean {
  if (!format) return false;
  const e = ext === 'jpg' ? 'jpeg' : ext;
  return format === e;
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Baca dimensi gambar tanpa dependensi biner (sharp/sharp-cli).
 * Mendukung PNG, JPEG, GIF, BMP, WEBP. Null bila format tak dikenali —
 * pemanggil harus memperlakukan null sebagai "tidak diketahui", bukan 0.
 */
export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length < 16) return null;
  try {
    // PNG
    if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // GIF
    if (buf.toString('ascii', 0, 3) === 'GIF') {
      const width = buf.readUInt16LE(6);
      const height = buf.readUInt16LE(8);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // BMP
    if (buf.toString('ascii', 0, 2) === 'BM') {
      const width = buf.readInt32LE(18);
      const height = Math.abs(buf.readInt32LE(22));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // WEBP
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X' && buf.length >= 30) {
        const width = 1 + buf.readUIntLE(24, 3);
        const height = 1 + buf.readUIntLE(27, 3);
        return { width, height };
      }
      if (chunk === 'VP8 ' && buf.length >= 30) {
        const width = buf.readUInt16LE(26) & 0x3fff;
        const height = buf.readUInt16LE(28) & 0x3fff;
        return { width, height };
      }
      if (chunk === 'VP8L' && buf.length >= 25) {
        const bits = buf.readUInt32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        return { width, height };
      }
      return null;
    }
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const size = buf.readUInt16BE(offset + 2);
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSof) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return width > 0 && height > 0 ? { width, height } : null;
        }
        if (size < 2) return null;
        offset += 2 + size;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Nama file aman & unik untuk penyimpanan (tanpa path dari klien). */
export function safeStoredFilename(prefix: string, originalName: string | undefined, mime: string | undefined, ext: string): string {
  const base = String(originalName ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\-_]/g, '_')
    .slice(0, 60)
    .replace(/^_+|_+$/g, '') || 'image';
  const rand = createHash('sha256')
    .update(`${Date.now()}-${Math.random()}-${prefix}`)
    .digest('hex')
    .slice(0, 10);
  void mime;
  return `${prefix}-${Date.now()}-${rand}-${base}.${ext}`;
}
