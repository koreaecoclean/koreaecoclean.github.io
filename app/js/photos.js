/**
 * photos.js — turns a camera/gallery file into two compressed JPEG data URLs:
 * a full-size copy (max 1600px, quality .78) and a 480px thumbnail for grids.
 *
 * Everything happens on the device, before anything is stored, so a 4MB phone
 * photo becomes ~180KB and the app stays inside the browser storage quota.
 */

export const MAX_EDGE = 1600;
export const THUMB_EDGE = 480;
export const FULL_QUALITY = 0.78;
export const THUMB_QUALITY = 0.62;

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('사진을 읽지 못했습니다. 다른 사진으로 시도해 주세요.'));
    image.src = url;
  });
}

/** Decode a File/Blob into something drawable, honouring EXIF rotation. */
async function decode(source) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch (error) {
      /* fall through to <img> */
    }
    try {
      return await createImageBitmap(source);
    } catch (error) {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(source);
  try {
    return await loadImageElement(url);
  } finally {
    // The bitmap has copied the pixels by now.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawScaled(source, maxEdge) {
  const sourceWidth = source.width || source.naturalWidth || 0;
  const sourceHeight = source.height || source.naturalHeight || 0;
  if (!sourceWidth || !sourceHeight) throw new Error('사진 크기를 확인할 수 없습니다.');

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);

  return { canvas, width, height };
}

export function dataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const base64 = String(dataUrl).split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{dataUrl: string, thumb: string, width: number, height: number, bytes: number}>}
 */
export async function preparePhoto(file) {
  if (!file) throw new Error('사진 파일이 없습니다.');
  if (file.type && !/^image\//.test(file.type)) {
    throw new Error('이미지 파일만 올릴 수 있습니다.');
  }
  if (file.size && file.size > 40 * 1024 * 1024) {
    throw new Error('40MB 이하 사진만 올릴 수 있습니다.');
  }

  const source = await decode(file);
  try {
    const full = drawScaled(source, MAX_EDGE);
    const thumb = drawScaled(source, THUMB_EDGE);
    const dataUrl = full.canvas.toDataURL('image/jpeg', FULL_QUALITY);
    const thumbUrl = thumb.canvas.toDataURL('image/jpeg', THUMB_QUALITY);
    return {
      dataUrl,
      thumb: thumbUrl,
      width: full.width,
      height: full.height,
      bytes: dataUrlBytes(dataUrl),
    };
  } finally {
    if (source && typeof source.close === 'function') source.close();
  }
}

/**
 * Fetch one of the bundled sample photos and run it through the real pipeline —
 * this is how the demo fills a report without a camera.
 */
export async function prepareSamplePhoto(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error('샘플 사진을 불러오지 못했습니다.');
  const blob = await response.blob();
  return preparePhoto(blob);
}

/**
 * Canvas-only placeholder used when no network/camera is available and the
 * sample photo cannot be fetched — keeps the demo free of broken images.
 */
export function makePlaceholderPhoto({ title = '현장 사진', subtitle = '' } = {}) {
  const width = 1200;
  const height = 900;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#14532d');
  gradient.addColorStop(0.62, '#0d3a22');
  gradient.addColorStop(1, '#082615');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(140, 191, 79, .28)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.arc(width * 0.82, height * 0.16, 120 + i * 62, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(140, 191, 79, .92)';
  ctx.fillRect(90, 92, 46, 6);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 62px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillText(title, 90, 200, width - 180);

  if (subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '400 34px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillText(subtitle, 90, 258, width - 180);
  }

  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = '400 28px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillText('코리아 에코크린 데모 이미지', 90, height - 90);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return {
    dataUrl,
    thumb: dataUrl,
    width,
    height,
    bytes: dataUrlBytes(dataUrl),
  };
}
