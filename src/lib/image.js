/** 上传前的图片压缩：调研照片是手机原图，动辄 4–8MB，先压到能放进 D1 的体积 */

const MAX_EDGE = 1600;
const MAX_BYTES = 700_000;
const QUALITY_LADDER = [0.86, 0.78, 0.7, 0.6, 0.5];

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      // 手机竖拍的 EXIF 方向必须按 "from-image" 解，否则照片会躺倒
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return await createImageBitmap(file);
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码"));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function compressImage(file, { maxEdge = MAX_EDGE, maxBytes = MAX_BYTES } = {}) {
  const bitmap = await decode(file);
  const w = bitmap.width;
  const h = bitmap.height;
  if (!w || !h) throw new Error("图片无法解码");

  // 本来就不大、也不需要缩：原样上传，避免二次压缩再掉一层画质。
  // 只放行 JPEG / WebP——iPhone 的 HEIC 和 PNG 都走下面那条重编码的路径。
  const passThrough = ["image/jpeg", "image/webp"];
  if (
    file.size <= maxBytes &&
    Math.max(w, h) <= maxEdge &&
    passThrough.includes(file.type)
  ) {
    return { blob: file, width: w, height: h };
  }

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // WebP 优先：同等画质下比 JPEG 小，且保留透明（截图、示意图不掉底色）
  let blob = null;
  for (const quality of QUALITY_LADDER) {
    blob = await toBlob(canvas, "image/webp", quality);
    if (!blob) break;
    if (blob.size <= maxBytes) return { blob, width, height };
  }

  if (!blob) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0);
    for (const quality of QUALITY_LADDER) {
      blob = await toBlob(canvas, "image/jpeg", quality);
      if (!blob) break;
      if (blob.size <= maxBytes) return { blob, width, height };
    }
  }

  if (!blob) throw new Error("这张图压不下来，换一张试试");
  return { blob, width, height };
}
