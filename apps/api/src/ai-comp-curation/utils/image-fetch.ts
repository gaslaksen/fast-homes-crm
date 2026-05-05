import sharp from 'sharp';
import axios from 'axios';

export interface ResizedImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 80;
const FETCH_TIMEOUT_MS = 8000;

// Fetch an image URL, resize to MAX_DIMENSION longest side, re-encode as
// JPEG q80, return base64 + media type. Throws on any failure — callers
// use Promise.allSettled and downgrade affected comps to text-only.
export async function fetchAndResize(url: string): Promise<ResizedImage> {
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: FETCH_TIMEOUT_MS,
    // Don't follow redirects to non-HTTP schemes; default axios behavior is fine.
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const buf = Buffer.from(res.data);

  const resized = await sharp(buf)
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return {
    base64: resized.toString('base64'),
    mediaType: 'image/jpeg',
  };
}
