const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);
const AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/aac",
]);

export type MediaMagicValidation =
  | { ok: true; detected: string }
  | { ok: false; detected: string | null; reason: string };

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function detectMediaMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    return "video/mp4";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) return "video/webm";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return "audio/wav";
  }
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    [0xf1, 0xf2, 0xf3, 0xf9, 0xfb].includes(bytes[1])
  ) return bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2
    ? "audio/mpeg"
    : "audio/aac";
  return null;
}

export function validateMediaMagicBytes(
  bytes: Uint8Array,
  declaredMime: string,
): MediaMagicValidation {
  const normalized = declaredMime.toLowerCase();
  const detected = detectMediaMime(bytes);
  if (!detected) {
    return { ok: false, detected: null, reason: "无法识别文件签名" };
  }
  const declaredGroup = IMAGE_TYPES.has(normalized)
    ? "image"
    : VIDEO_TYPES.has(normalized)
      ? "video"
      : AUDIO_TYPES.has(normalized)
        ? "audio"
        : null;
  // ISO Base Media File Format is shared by MP4 video and M4A/MP4 audio.
  // The first bytes identify the container, not whether it has a video track,
  // so both declared media families are valid here. ffprobe performs the
  // deeper stream validation later in video/audio pipelines.
  if (
    detected === "video/mp4" &&
    ["video/mp4", "video/quicktime", "video/x-m4v", "audio/mp4", "audio/x-m4a"].includes(
      normalized,
    )
  ) {
    return { ok: true, detected };
  }
  const detectedGroup = detected.split("/")[0];
  if (!declaredGroup || declaredGroup !== detectedGroup) {
    return {
      ok: false,
      detected,
      reason: `文件内容与声明类型 ${declaredMime} 不一致`,
    };
  }
  if (declaredGroup === "image") {
    const jpegAliases = new Set(["image/jpeg", "image/jpg"]);
    if (detected !== normalized && !(detected === "image/jpeg" && jpegAliases.has(normalized))) {
      return { ok: false, detected, reason: `图片签名为 ${detected}，与声明类型不一致` };
    }
  }
  if (normalized === "video/webm" && detected !== "video/webm") {
    return { ok: false, detected, reason: "WebM 文件签名不匹配" };
  }
  return { ok: true, detected };
}

export async function validateFileMagicBytes(file: File): Promise<MediaMagicValidation> {
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return validateMediaMagicBytes(header, file.type);
}

export const SUPPORTED_IMAGE_MIME_TYPES = IMAGE_TYPES;
