/**
 * 附件存储：R2 优先，没配 FILES 绑定时退回 KV。
 *
 * 只收 Word 与 PDF。不收 PPT / ZIP / 图片：课件请在 PowerPoint 里另存一份 PDF，
 * 站点不做格式转换，PDF 是唯一能在浏览器里直接翻页的格式。
 * 类型判定按扩展名 AND 文件头双检——只看扩展名，把 .exe 改名成 .pdf 就能混进来。
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const ALLOWED = [
  { mime: "application/pdf", exts: [".pdf"], label: "PDF" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    exts: [".docx"],
    label: "DOCX",
  },
  { mime: "application/msword", exts: [".doc"], label: "DOC" },
];

export const ACCEPT_ATTR = ".pdf,.docx,.doc";

/** 文件头：PDF 是 %PDF-，docx 是 zip 容器，doc 是 OLE 复合文档 */
const MAGIC = {
  "application/pdf": (bytes) =>
    bytes.length > 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d, // -
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (bytes) =>
    bytes.length > 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    bytes[2] === 0x03 &&
    bytes[3] === 0x04,
  "application/msword": (bytes) =>
    bytes.length > 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1,
};

/** 先按扩展名定类型，再按文件头确认；两者对不上就拒 */
export function sniffFileType(fileName) {
  const name = String(fileName || "").toLowerCase();
  return ALLOWED.find((rule) => rule.exts.some((ext) => name.endsWith(ext))) || null;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ok: true, mime: string} | {ok: false, reason: string}}
 */
export function verifyFileBytes(fileName, bytes) {
  const rule = sniffFileType(fileName);
  if (!rule) {
    return { ok: false, reason: "只收 Word（.docx / .doc）与 PDF（.pdf）" };
  }
  const check = MAGIC[rule.mime];
  if (!check || !check(bytes)) {
    return {
      ok: false,
      reason: `这个文件的内容不像 ${rule.label}，可能是把别的格式改了扩展名。请重新导出一次。`,
    };
  }
  return { ok: true, mime: rule.mime };
}

export function storageReady(env) {
  return Boolean(env.FILES);
}

export function storageKind(env) {
  return env.FILES ? "r2" : "kv";
}

function kvKey(key) {
  return `workfile:${key}`;
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {Promise<string>} 实际使用的存储类型
 */
export async function putBlob(env, key, bytes, mime) {
  if (env.FILES) {
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: mime || "application/octet-stream" },
    });
    return "r2";
  }
  if (!env.SESSIONS) throw Object.assign(new Error("存储未配置"), { status: 503 });
  await env.SESSIONS.put(kvKey(key), bytes);
  return "kv";
}

/** @returns {Promise<{bytes: ArrayBuffer|Uint8Array, storage: string}|null>} */
export async function getBlob(env, key, storage) {
  if (env.FILES && storage !== "kv") {
    const obj = await env.FILES.get(key);
    if (obj) {
      const bytes = await obj.arrayBuffer();
      return { bytes, storage: "r2" };
    }
  }
  const data = await env.SESSIONS?.get(kvKey(key), "arrayBuffer");
  if (!data) return null;
  return { bytes: data, storage: "kv" };
}

/** 按当初落库时记下的来源删；换了存储方式也不会误删到另一个位置 */
export async function deleteBlob(env, key, storage) {
  try {
    if (storage === "r2") {
      if (env.FILES) await env.FILES.delete(key);
    } else {
      await env.SESSIONS?.delete(kvKey(key));
    }
  } catch {
    /* 删不掉就留着，反正元信息已经清了 */
  }
}

/** 只有 PDF 给内嵌预览，Word 一律当附件下载 */
export function dispositionFor(mime, fileName, { inline = true } = {}) {
  const mode = inline && /^application\/pdf$/i.test(mime || "") ? "inline" : "attachment";
  const ascii = String(fileName || "download")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(String(fileName || "download"));
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
