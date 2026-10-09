// MediaDrop — procesamiento local de medios en un documento Offscreen.
// Todo queda local en el navegador. No se envían frames a servicios externos.

const PREVIEW_MAX_WIDTH = 320;
const PREVIEW_MAX_HEIGHT = 180;
const PREVIEW_WEBP_QUALITY = 0.74;

const DIRECT_LOAD_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 15_000;
const VIDEO_LOAD_TIMEOUT_MS = 8_000;

const RANGE_BYTES = 12 * 1024 * 1024;
const MAX_FULL_VIDEO_BYTES = 52 * 1024 * 1024;
const MAX_PREVIEW_DATA_URL_LENGTH = 750_000;

const SEEK_MIN_SECONDS = 0.18;
const SEEK_MAX_SECONDS = 2.5;
const SEEK_FRACTIONS = [0.12, 0.28, 0.5];

// Canvas reutilizables. La captura y el muestreo son síncronos, así que pueden
// compartir instancias entre trabajos sin mezclar frames y sin generar basura
// para el GC en cada intento de preview.
const FRAME_CAPTURE_CANVAS = document.createElement("canvas");
const FRAME_CAPTURE_CONTEXT = FRAME_CAPTURE_CANVAS.getContext("2d", {
  alpha: false,
  desynchronized: true,
  willReadFrequently: true
});
const FRAME_SAMPLE_CANVAS = document.createElement("canvas");
FRAME_SAMPLE_CANVAS.width = 32;
FRAME_SAMPLE_CANVAS.height = 18;
const FRAME_SAMPLE_CONTEXT = FRAME_SAMPLE_CANVAS.getContext("2d", { willReadFrequently: true });

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function once(target, eventName, timeoutMs = VIDEO_LOAD_TIMEOUT_MS) {
  return withTimeout(new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`video ${eventName} failed`));
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  }), timeoutMs, eventName);
}

function makeVideo() {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.controls = false;
  video.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.append(video);
  return video;
}

function destroyVideo(video, objectUrl = null) {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {}
  video.remove();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

function previewDimensions(sourceWidth, sourceHeight) {
  const scale = Math.min(
    1,
    PREVIEW_MAX_WIDTH / sourceWidth,
    PREVIEW_MAX_HEIGHT / sourceHeight
  );
  return {
    width: Math.max(2, Math.round(sourceWidth * scale)),
    height: Math.max(2, Math.round(sourceHeight * scale))
  };
}

function frameLooksUseful(context) {
  try {
    if (!FRAME_SAMPLE_CONTEXT) return true;

    FRAME_SAMPLE_CONTEXT.drawImage(context.canvas, 0, 0, 32, 18);
    const data = FRAME_SAMPLE_CONTEXT.getImageData(0, 0, 32, 18).data;

    let min = 255;
    let max = 0;
    let sum = 0;
    let pixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = (data[i] * 0.2126) + (data[i + 1] * 0.7152) + (data[i + 2] * 0.0722);
      min = Math.min(min, luminance);
      max = Math.max(max, luminance);
      sum += luminance;
      pixels += 1;
    }

    const average = pixels ? sum / pixels : 0;

    // Reject only frames that are essentially a uniform black/blank screen.
    return (max - min) >= 6 || average >= 7;
  } catch {
    return true;
  }
}

function captureFrame(video) {
  const sourceWidth = Number(video.videoWidth || 0);
  const sourceHeight = Number(video.videoHeight || 0);
  if (sourceWidth < 2 || sourceHeight < 2) return null;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;

  const { width, height } = previewDimensions(sourceWidth, sourceHeight);
  const canvas = FRAME_CAPTURE_CANVAS;
  const context = FRAME_CAPTURE_CONTEXT;
  if (!context) return null;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  try {
    context.drawImage(video, 0, 0, width, height);
    if (!frameLooksUseful(context)) return null;

    const dataUrl = canvas.toDataURL("image/webp", PREVIEW_WEBP_QUALITY);
    if (!dataUrl.startsWith("data:image/webp")) return null;
    if (dataUrl.length > MAX_PREVIEW_DATA_URL_LENGTH) return null;
    return {
      previewUrl: dataUrl,
      width: sourceWidth,
      height: sourceHeight,
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    };
  } catch {
    return null;
  }
}

async function seekAndCapture(video) {
  // First try whatever frame Chromium already decoded.
  let preview = captureFrame(video);
  if (preview) return preview;

  const duration = Number(video.duration);
  const canSeek = Number.isFinite(duration) && duration > 0.3;
  if (!canSeek) return null;

  const candidates = [];
  for (const fraction of SEEK_FRACTIONS) {
    candidates.push(
      Math.min(
        Math.max(SEEK_MIN_SECONDS, duration * fraction),
        Math.min(SEEK_MAX_SECONDS, Math.max(SEEK_MIN_SECONDS, duration - 0.08))
      )
    );
  }

  for (const target of [...new Set(candidates.map((value) => Math.round(value * 100) / 100))]) {
    try {
      if (Math.abs(video.currentTime - target) > 0.04) {
        video.currentTime = target;
        await once(video, "seeked", 4_000);
      }
      preview = captureFrame(video);
      if (preview) return preview;
    } catch {
      // Try another point in the same video.
    }
  }

  return null;
}

async function previewFromRemoteVideo(url) {
  const video = makeVideo();
  video.crossOrigin = "anonymous";

  try {
    video.src = url;
    await once(video, "loadeddata", DIRECT_LOAD_TIMEOUT_MS);
    return await seekAndCapture(video);
  } catch {
    return null;
  } finally {
    destroyVideo(video);
  }
}

async function readResponseWithLimit(response, byteLimit, abortController) {
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > byteLimit) {
    abortController.abort();
    throw new Error("video too large");
  }

  if (!response.body?.getReader) {
    const blob = await response.blob();
    if (blob.size > byteLimit) throw new Error("video too large");
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > byteLimit) {
      abortController.abort();
      try { await reader.cancel(); } catch {}
      throw new Error("video too large");
    }
    chunks.push(value);
  }

  const contentType = response.headers.get("content-type") || "video/mp4";
  return new Blob(chunks, { type: contentType });
}

async function fetchVideoBlob(url, { rangeOnly = false } = {}) {
  const abortController = new AbortController();
  const headers = new Headers();
  const byteLimit = rangeOnly ? RANGE_BYTES : MAX_FULL_VIDEO_BYTES;
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

  if (rangeOnly) {
    headers.set("Range", `bytes=0-${RANGE_BYTES - 1}`);
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      credentials: "include",
      cache: "force-cache",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: abortController.signal
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (contentType && !contentType.startsWith("video/") && !contentType.includes("octet-stream")) {
      abortController.abort();
      throw new Error("not a direct video response");
    }

    const blob = await readResponseWithLimit(response, byteLimit, abortController);

    return {
      blob,
      partial: response.status === 206,
      contentRange: response.headers.get("content-range") || ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function previewFromBlob(blob) {
  if (!(blob instanceof Blob) || blob.size < 1024) return null;

  const objectUrl = URL.createObjectURL(blob);
  const video = makeVideo();

  try {
    video.src = objectUrl;
    await once(video, "loadeddata", VIDEO_LOAD_TIMEOUT_MS);
    return await seekAndCapture(video);
  } catch {
    return null;
  } finally {
    destroyVideo(video, objectUrl);
  }
}

function totalBytesFromContentRange(value) {
  const match = String(value || "").match(/\/(\d+)\s*$/);
  const total = Number(match?.[1] || 0);
  return Number.isFinite(total) ? total : 0;
}

function readVideoMetadata(video) {
  const width = Number(video.videoWidth || 0);
  const height = Number(video.videoHeight || 0);
  if (width < 1 || height < 1) return null;

  return {
    width,
    height,
    duration: Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : null
  };
}

async function videoMetadataFromRemoteUrl(url) {
  const video = makeVideo();

  try {
    // Do NOT set crossOrigin here. We are only reading intrinsic metadata,
    // which works on many sites/CDNs even when canvas frame extraction is
    // blocked by CORS.
    video.src = url;
    await once(video, "loadedmetadata", VIDEO_LOAD_TIMEOUT_MS);
    return readVideoMetadata(video);
  } catch {
    return null;
  } finally {
    destroyVideo(video);
  }
}

async function videoMetadataFromBlob(blob) {
  if (!(blob instanceof Blob) || blob.size < 1024) return null;

  const objectUrl = URL.createObjectURL(blob);
  const video = makeVideo();

  try {
    video.src = objectUrl;
    await once(video, "loadedmetadata", VIDEO_LOAD_TIMEOUT_MS);
    return readVideoMetadata(video);
  } catch {
    return null;
  } finally {
    destroyVideo(video, objectUrl);
  }
}

async function getVideoMetadata(url) {
  // 1. Fast path: load the actual URL just far enough to expose metadata.
  const direct = await videoMetadataFromRemoteUrl(url);
  if (direct) return direct;

  // 2. Try only the initial range for fast-start MP4/WebM.
  try {
    const ranged = await fetchVideoBlob(url, { rangeOnly: true });
    const rangedMetadata = await videoMetadataFromBlob(ranged.blob);
    if (rangedMetadata) return rangedMetadata;

    const totalBytes = totalBytesFromContentRange(ranged.contentRange);
    if (totalBytes > MAX_FULL_VIDEO_BYTES) return null;
  } catch {}

  // 3. Bounded full-file fallback for normal direct video files.
  try {
    const full = await fetchVideoBlob(url, { rangeOnly: false });
    return await videoMetadataFromBlob(full.blob);
  } catch {
    return null;
  }
}

async function generatePreview(url) {
  // 1. Cheapest path: let the hidden video element decode the URL directly.
  const direct = await previewFromRemoteVideo(url);
  if (direct) return direct;

  // 2. Fetch only the beginning of the file. Fast-start MP4/WebM files often
  // contain enough metadata + early frames for a useful preview.
  try {
    const ranged = await fetchVideoBlob(url, { rangeOnly: true });
    const rangedPreview = await previewFromBlob(ranged.blob);
    if (rangedPreview) return rangedPreview;

    const totalBytes = totalBytesFromContentRange(ranged.contentRange);
    if (totalBytes > MAX_FULL_VIDEO_BYTES) return null;
  } catch {
    // Continue to the bounded full-file fallback.
  }

  // 3. Last fallback for normal direct files: fetch the complete video, but
  // never allow the worker to buffer a huge file.
  try {
    const full = await fetchVideoBlob(url, { rangeOnly: false });
    return await previewFromBlob(full.blob);
  } catch {
    return null;
  }
}


async function imageDimensionsFromDirectUrl(url) {
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";

  const loaded = new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image load failed"));
  });

  image.src = url;
  await withTimeout(loaded, 8_000, "image metadata");

  const width = Number(image.naturalWidth || 0);
  const height = Number(image.naturalHeight || 0);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

async function imageDimensionsFromFetchedBlob(url) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 12_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "force-cache",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: abortController.signal
    });

    if (!response.ok) return null;

    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 30 * 1024 * 1024) return null;

    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > 30 * 1024 * 1024) return null;

    const objectUrl = URL.createObjectURL(blob);
    try {
      return await imageDimensionsFromDirectUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getImageDimensions(url) {
  try {
    const direct = await imageDimensionsFromDirectUrl(url);
    if (direct) return direct;
  } catch {}

  return await imageDimensionsFromFetchedBlob(url);
}


// ---------------------------------------------------------------------------
// HLS download worker
// ---------------------------------------------------------------------------

const HLS_MAX_BYTES = 768 * 1024 * 1024;
const HLS_FETCH_CONCURRENCY = 5;
const HLS_REQUEST_TIMEOUT_MS = 22_000;

const RANGED_MEDIA_MAX_BYTES = 768 * 1024 * 1024;
const RANGED_MEDIA_CHUNK_BYTES = 8 * 1024 * 1024;
const RANGED_MEDIA_CONCURRENCY = 4;
const RANGED_MEDIA_TIMEOUT_MS = 24_000;
const REMOTE_PROBE_RANGE_START = 0;
const REMOTE_PROBE_RANGE_END = 0;
const REMOTE_MIN_VALID_VIDEO_BYTES = 96 * 1024;
const streamBlobUrls = new Set();

function parseRemoteContentRange(value) {
  const match = String(value || "").match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!match) return { start: 0, end: 0, total: 0, valid: false };
  return {
    start: Number(match[1]) || 0,
    end: Number(match[2]) || 0,
    total: match[3] === "*" ? 0 : (Number(match[3]) || 0),
    valid: true
  };
}

function rangedRequestUrl(rawUrl, start, end) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes("googlevideo.com")) {
      url.searchParams.set("range", `${start}-${end}`);
      return { url: url.href, headers: new Headers() };
    }
  } catch {}

  const headers = new Headers();
  headers.set("Range", `bytes=${start}-${end}`);
  return { url: rawUrl, headers };
}

async function probeRemoteMedia(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RANGED_MEDIA_TIMEOUT_MS);
  const request = rangedRequestUrl(url, REMOTE_PROBE_RANGE_START, REMOTE_PROBE_RANGE_END);

  try {
    // Pedir un solo byte obliga a los CDNs de streaming a revelar el tamaño
    // total mediante Content-Range sin descargar accidentalmente una respuesta
    // auxiliar diminuta como si fuera el archivo completo.
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      credentials: "include",
      cache: "no-cache",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);
    const contentRange = parseRemoteContentRange(response.headers.get("content-range"));
    const responseBytes = Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : (contentRange.valid ? Math.max(0, contentRange.end - contentRange.start + 1) : 0);
    const totalBytes = contentRange.total > 0 ? contentRange.total : responseBytes;

    try { await response.body?.cancel(); } catch {}

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      responseBytes,
      totalBytes,
      partial: response.status === 206 || contentRange.valid,
      hasContentRange: contentRange.valid
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteRange(rawUrl, start, end) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RANGED_MEDIA_TIMEOUT_MS);
  const request = rangedRequestUrl(rawUrl, start, end);

  try {
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      credentials: "include",
      cache: "no-cache",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status} al descargar un rango del video.`);
    }

    const contentRange = parseRemoteContentRange(response.headers.get("content-range"));
    if (contentRange.valid && contentRange.start !== start) {
      throw new Error("El servidor devolvió un rango distinto al solicitado.");
    }

    const buffer = await response.arrayBuffer();
    const expected = end - start + 1;
    if (buffer.byteLength !== expected) {
      throw new Error(`Rango incompleto: ${buffer.byteLength} de ${expected} bytes.`);
    }
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function assembleRangedMedia(url, expectedTotalBytes, tabId, mediaId, extension = "mp4") {
  notifyHlsProgress(tabId, mediaId, 1, "probe");

  const probe = await probeRemoteMedia(url);
  if (!probe?.ok) throw new Error(`La fuente del video respondió HTTP ${probe?.status || 0}.`);
  const probeType = String(probe.contentType || "").toLowerCase();
  if (probeType.startsWith("audio/")) {
    throw new Error("La fuente resuelta es audio, no video.");
  }
  if (probeType && !probeType.startsWith("video/") && !probeType.includes("octet-stream")) {
    throw new Error(`La fuente respondió ${probeType}; no es una pista de video.`);
  }

  const totalBytes = Math.max(Number(expectedTotalBytes || 0), Number(probe.totalBytes || 0));
  if (!(totalBytes > REMOTE_MIN_VALID_VIDEO_BYTES)) {
    throw new Error("La fuente es demasiado pequeña para ser el video completo.");
  }
  if (totalBytes > RANGED_MEDIA_MAX_BYTES) {
    throw new Error("El video supera el límite de 768 MB para reconstrucción local.");
  }

  const ranges = [];
  for (let start = 0; start < totalBytes; start += RANGED_MEDIA_CHUNK_BYTES) {
    ranges.push({
      start,
      end: Math.min(totalBytes - 1, start + RANGED_MEDIA_CHUNK_BYTES - 1)
    });
  }

  let completedBytes = 0;
  const buffers = await mapConcurrent(
    ranges,
    RANGED_MEDIA_CONCURRENCY,
    async (range) => {
      const buffer = await fetchRemoteRange(url, range.start, range.end);
      completedBytes += buffer.byteLength;
      notifyHlsProgress(
        tabId,
        mediaId,
        3 + (completedBytes / totalBytes) * 94,
        "ranges"
      );
      return buffer;
    }
  );

  const safeExtension = ["mp4", "webm", "mov", "m4v", "ogv"].includes(String(extension).toLowerCase())
    ? String(extension).toLowerCase()
    : "mp4";
  const mime = String(probe.contentType || "").startsWith("video/")
    ? probe.contentType.split(";")[0]
    : (safeExtension === "webm" ? "video/webm" : "video/mp4");

  const blob = new Blob(buffers, { type: mime });
  if (blob.size !== totalBytes) {
    throw new Error(`El video reconstruido quedó incompleto: ${blob.size} de ${totalBytes} bytes.`);
  }

  const blobUrl = URL.createObjectURL(blob);
  streamBlobUrls.add(blobUrl);
  notifyHlsProgress(tabId, mediaId, 99, "ready");

  return {
    blobUrl,
    extension: safeExtension,
    mime,
    size: blob.size
  };
}

function hlsAttributes(raw) {
  const result = {};
  const source = String(raw || "");
  let token = "";
  let quoted = false;
  const parts = [];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(token);
      token = "";
    } else {
      token += char;
    }
  }
  if (token) parts.push(token);

  for (const part of parts) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    const key = part.slice(0, equals).trim().toUpperCase();
    let value = part.slice(equals + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[key] = value;
  }

  return result;
}

function absoluteHlsUrl(rawUrl, baseUrl) {
  try {
    return new URL(String(rawUrl || "").trim(), baseUrl).href;
  } catch {
    return null;
  }
}

function parseResolution(value) {
  const match = String(value || "").match(/^(\d+)x(\d+)$/i);
  if (!match) return { width: 0, height: 0, pixels: 0 };
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { width, height, pixels: width * height };
}

async function fetchHlsText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HLS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-cache",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`HLS HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes("#EXTM3U")) throw new Error("La URL no devolvió una playlist HLS válida.");
    if (text.length > 8_000_000) throw new Error("La playlist HLS es demasiado grande.");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function parseMasterPlaylist(text, playlistUrl) {
  const lines = String(text || "").split(/\r?\n/);
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    const attributes = hlsAttributes(line.slice(line.indexOf(":") + 1));
    let nextIndex = index + 1;
    while (nextIndex < lines.length && (!lines[nextIndex].trim() || lines[nextIndex].trim().startsWith("#"))) {
      nextIndex += 1;
    }

    const child = lines[nextIndex]?.trim();
    const url = child ? absoluteHlsUrl(child, playlistUrl) : null;
    if (!url) continue;

    const resolution = parseResolution(attributes.RESOLUTION);
    const bandwidth = Number(attributes["AVERAGE-BANDWIDTH"] || attributes.BANDWIDTH || 0);

    variants.push({
      url,
      width: resolution.width,
      height: resolution.height,
      pixels: resolution.pixels,
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0
    });
  }

  variants.sort((a, b) =>
    (b.pixels - a.pixels)
    || (b.bandwidth - a.bandwidth)
  );

  return variants;
}

async function resolveHlsMediaPlaylist(url, depth = 0) {
  if (depth > 3) throw new Error("Demasiados niveles de playlist HLS.");

  const text = await fetchHlsText(url);
  if (!text.includes("#EXT-X-STREAM-INF")) {
    return { url, text };
  }

  const variants = parseMasterPlaylist(text, url);
  if (!variants.length) throw new Error("No se encontró una variante reproducible en el stream.");

  return resolveHlsMediaPlaylist(variants[0].url, depth + 1);
}

function parseIv(value, sequenceNumber) {
  if (value) {
    const clean = String(value).replace(/^0x/i, "").padStart(32, "0").slice(-32);
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return bytes;
  }

  const bytes = new Uint8Array(16);
  let valueBig = BigInt(Math.max(0, sequenceNumber));
  for (let index = 15; index >= 0; index -= 1) {
    bytes[index] = Number(valueBig & 0xffn);
    valueBig >>= 8n;
  }
  return bytes;
}

function parseByteRange(value, implicitOffset = 0) {
  const match = String(value || "").match(/^(\d+)(?:@(\d+))?$/);
  if (!match) return null;
  const length = Number(match[1]);
  const offset = match[2] ? Number(match[2]) : implicitOffset;
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset) || offset < 0) return null;
  return { offset, length };
}

function parseHlsMediaPlaylist(text, playlistUrl) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];
  let mediaSequence = 0;
  let segmentIndex = 0;
  let pendingByteRange = null;
  let currentKey = null;
  let currentMapSignature = "";
  let lastByteRangeEnd = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = Number(line.slice(line.indexOf(":") + 1).trim()) || 0;
      continue;
    }

    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = hlsAttributes(line.slice(line.indexOf(":") + 1));
      const method = String(attrs.METHOD || "").toUpperCase();

      if (!method || method === "NONE") {
        currentKey = null;
        continue;
      }

      if (method !== "AES-128") {
        throw new Error(`Cifrado HLS ${method} no compatible.`);
      }

      const keyUrl = absoluteHlsUrl(attrs.URI, playlistUrl);
      if (!keyUrl) throw new Error("La clave HLS no tiene una URL válida.");

      currentKey = {
        method,
        url: keyUrl,
        iv: attrs.IV || null
      };
      continue;
    }

    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = hlsAttributes(line.slice(line.indexOf(":") + 1));
      const mapUrl = absoluteHlsUrl(attrs.URI, playlistUrl);
      if (!mapUrl) continue;

      const signature = `${mapUrl}|${attrs.BYTERANGE || ""}`;
      if (signature !== currentMapSignature) {
        currentMapSignature = signature;
        entries.push({
          kind: "map",
          url: mapUrl,
          range: parseByteRange(attrs.BYTERANGE, 0),
          key: currentKey,
          sequence: mediaSequence + segmentIndex
        });
      }
      continue;
    }

    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingByteRange = line.slice(line.indexOf(":") + 1).trim();
      continue;
    }

    if (line.startsWith("#")) continue;

    const segmentUrl = absoluteHlsUrl(line, playlistUrl);
    if (!segmentUrl) continue;

    let range = null;
    if (pendingByteRange) {
      range = parseByteRange(pendingByteRange, lastByteRangeEnd);
      pendingByteRange = null;
      if (range) lastByteRangeEnd = range.offset + range.length;
    } else {
      lastByteRangeEnd = 0;
    }

    entries.push({
      kind: "segment",
      url: segmentUrl,
      range,
      key: currentKey,
      sequence: mediaSequence + segmentIndex
    });

    segmentIndex += 1;
  }

  if (!entries.some((entry) => entry.kind === "segment")) {
    throw new Error("El stream no contiene segmentos descargables.");
  }

  return entries;
}

async function fetchHlsBinary(entry) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HLS_REQUEST_TIMEOUT_MS);
  const headers = new Headers();

  if (entry.range) {
    const end = entry.range.offset + entry.range.length - 1;
    headers.set("Range", `bytes=${entry.range.offset}-${end}`);
  }

  try {
    const response = await fetch(entry.url, {
      method: "GET",
      headers,
      credentials: "include",
      cache: "force-cache",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Segmento HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error("Segmento HLS vacío.");
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHlsKey(url, cache) {
  if (cache.has(url)) return cache.get(url);

  const promise = (async () => {
    const buffer = await fetchHlsBinary({ url, range: null });
    if (buffer.byteLength !== 16) {
      throw new Error("La clave AES-128 del stream no tiene 16 bytes.");
    }
    return crypto.subtle.importKey(
      "raw",
      buffer,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
  })();

  cache.set(url, promise);
  return promise;
}

async function decryptHlsEntry(buffer, entry, keyCache) {
  if (!entry.key) return buffer;

  const key = await fetchHlsKey(entry.key.url, keyCache);
  const iv = parseIv(entry.key.iv, entry.sequence);

  try {
    return await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      key,
      buffer
    );
  } catch {
    throw new Error("No fue posible descifrar un segmento AES-128 del stream.");
  }
}

function notifyHlsProgress(tabId, mediaId, percent, stage = "assembling") {
  chrome.runtime.sendMessage({
    type: "STREAM_ASSEMBLY_PROGRESS",
    tabId,
    mediaId,
    percent: Math.max(0, Math.min(99, Math.round(percent))),
    stage
  }).catch(() => {});
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );

  return results;
}

function hlsOutputInfo(entries) {
  const urls = entries.map((entry) => entry.url.toLowerCase());
  const fragmentedMp4 = entries.some((entry) => entry.kind === "map")
    || urls.some((url) => /\.(?:m4s|mp4)(?:$|[?#])/i.test(url));

  return fragmentedMp4
    ? { mime: "video/mp4", extension: "mp4" }
    : { mime: "video/mp2t", extension: "ts" };
}

async function assembleHls(url, tabId, mediaId) {
  notifyHlsProgress(tabId, mediaId, 1, "playlist");

  const mediaPlaylist = await resolveHlsMediaPlaylist(url);
  const entries = parseHlsMediaPlaylist(mediaPlaylist.text, mediaPlaylist.url);
  const keyCache = new Map();
  let totalBytes = 0;
  let completed = 0;

  const buffers = await mapConcurrent(
    entries,
    HLS_FETCH_CONCURRENCY,
    async (entry) => {
      const encrypted = await fetchHlsBinary(entry);
      const decoded = await decryptHlsEntry(encrypted, entry, keyCache);

      totalBytes += decoded.byteLength;
      if (totalBytes > HLS_MAX_BYTES) {
        throw new Error("El stream supera el límite de 768 MB para ensamblado local.");
      }

      completed += 1;
      notifyHlsProgress(
        tabId,
        mediaId,
        4 + (completed / entries.length) * 90,
        "segments"
      );

      return decoded;
    }
  );

  notifyHlsProgress(tabId, mediaId, 94, "prepare");

  const output = hlsOutputInfo(entries);
  let blob;
  let extension;
  let mime;

  if (output.extension === "ts") {
    notifyHlsProgress(tabId, mediaId, 95, "transmux");

    if (!globalThis.MediaDropTsToMp4?.transmux) {
      throw new Error("El convertidor MPEG-TS → MP4 no está disponible.");
    }

    const result = globalThis.MediaDropTsToMp4.transmux(
      buffers.map((buffer) => new Uint8Array(buffer))
    );

    blob = new Blob(result.parts, { type: "video/mp4" });
    extension = "mp4";
    mime = "video/mp4";
  } else {
    // HLS fMP4 already uses an MP4 container. Keep the initialization/media
    // fragments and simply join them into one downloadable MP4 file.
    blob = new Blob(buffers, { type: "video/mp4" });
    extension = "mp4";
    mime = "video/mp4";
  }

  const blobUrl = URL.createObjectURL(blob);
  streamBlobUrls.add(blobUrl);

  notifyHlsProgress(tabId, mediaId, 99, "ready");

  return {
    blobUrl,
    extension,
    mime,
    size: blob.size
  };
}

function revokeStreamBlob(blobUrl) {
  if (!streamBlobUrls.has(blobUrl)) return;
  streamBlobUrls.delete(blobUrl);
  try { URL.revokeObjectURL(blobUrl); } catch {}
}

function safeBlobDownloadName(rawName, extension) {
  const fallback = `video-${Date.now()}.${extension}`;
  const name = String(rawName || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  if (!name) return fallback;

  const base = name.replace(/\.[a-z0-9]{2,8}$/i, "").trim() || "video";
  return `${base}.${extension}`;
}

function triggerBlobDownload(blobUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
  }

  // Keep the Blob URL alive long enough for Chromium to start consuming it,
  // then release the potentially large assembled video from memory.
  setTimeout(() => revokeStreamBlob(blobUrl), 60_000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  if (message?.target !== "media-drop-offscreen") return false;

  if (message?.type === "REVOKE_STREAM_BLOB") {
    revokeStreamBlob(String(message.blobUrl || ""));
    sendResponse({ ok: true });
    return false;
  }

  const rawUrl = String(message.url || "");
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    sendResponse({ ok: false, error: "URL inválida" });
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    sendResponse({ ok: false, error: "Protocolo no compatible" });
    return false;
  }

  if (message?.type === "PROBE_REMOTE_MEDIA") {
    probeRemoteMedia(parsed.href)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || error)
      }));
    return true;
  }

  if (message?.type === "DOWNLOAD_RANGED_MEDIA") {
    assembleRangedMedia(
      parsed.href,
      Number(message.expectedTotalBytes || 0),
      Number(message.tabId),
      String(message.mediaId || ""),
      String(message.extension || "mp4")
    )
      .then((result) => {
        const filename = safeBlobDownloadName(message.filename, result.extension || "mp4");
        triggerBlobDownload(result.blobUrl, filename);
        sendResponse({
          ok: true,
          started: true,
          filename,
          size: result.size,
          extension: result.extension
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || error)
      }));
    return true;
  }

  if (message?.type === "DOWNLOAD_HLS") {
    assembleHls(parsed.href, Number(message.tabId), String(message.mediaId || ""))
      .then((result) => {
        const filename = safeBlobDownloadName(
          message.filename,
          result.extension || "ts"
        );
        triggerBlobDownload(result.blobUrl, filename);
        sendResponse({
          ok: true,
          started: true,
          filename,
          size: result.size,
          extension: result.extension
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || error)
      }));
    return true;
  }

  if (message?.type === "ASSEMBLE_HLS") {
    assembleHls(parsed.href, Number(message.tabId), String(message.mediaId || ""))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || error)
      }));
    return true;
  }

  if (message?.type === "GENERATE_VIDEO_PREVIEW") {
    generatePreview(parsed.href)
      .then((result) => {
        if (!result?.previewUrl) {
          sendResponse({ ok: false, error: "No fue posible decodificar un frame" });
          return;
        }
        sendResponse({
          ok: true,
          previewUrl: result.previewUrl,
          width: result.width || 0,
          height: result.height || 0,
          duration: Number.isFinite(result.duration) ? result.duration : null
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });

    return true;
  }

  if (message?.type === "GET_VIDEO_METADATA") {
    getVideoMetadata(parsed.href)
      .then((metadata) => {
        if (!metadata?.width || !metadata?.height) {
          sendResponse({ ok: false, error: "No fue posible leer la resolución del video" });
          return;
        }

        sendResponse({
          ok: true,
          width: metadata.width,
          height: metadata.height,
          duration: Number.isFinite(metadata.duration) ? metadata.duration : null
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });

    return true;
  }

  if (message?.type === "GET_IMAGE_DIMENSIONS") {
    getImageDimensions(parsed.href)
      .then((dimensions) => {
        if (!dimensions?.width || !dimensions?.height) {
          sendResponse({ ok: false, error: "No fue posible leer la resolución" });
          return;
        }
        sendResponse({ ok: true, ...dimensions });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });

    return true;
  }

  return false;
});
