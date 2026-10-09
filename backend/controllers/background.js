const mediaByTab = new Map();
const mediaFramesByTab = new Map();
const panelPorts = new Set();
const activeDownloads = new Map();
const responseHeaderValueCache = new WeakMap();

const MAX_MEDIA_PER_TAB = 500;
const MAX_UPSERT_ITEMS = 500;
const MAX_URL_LENGTH = 16_384;
const MAX_PREVIEW_DATA_URL_LENGTH = 750_000;
const MAX_TEXT_LENGTH = 220;
const MAX_FILENAME_LENGTH = 180;
const PROGRESS_POLL_MS = 350;
const DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY = "downloadedImageHistoryV1";
const DOWNLOADED_IMAGE_HISTORY_MAX_ITEMS = 2000;

// Resolución de streams: evita asociar el reproductor real con respuestas
// auxiliares diminutas (init/range) o con la pista de audio de servicios DASH.
const STREAM_TINY_RESOURCE_BYTES = 96 * 1024;
const STREAM_LONG_MEDIA_SECONDS = 20;
const STREAM_SIZE_SCORE_CAP = 1_400;
const STREAM_MIN_VALID_DOWNLOAD_BYTES = 96 * 1024;
const STREAM_MAX_CANDIDATE_ATTEMPTS = 8;
const GOOGLEVIDEO_TOTAL_BYTES_PARAM = "clen";
const GOOGLEVIDEO_RANGE_PARAM = "range";

// Fallback universal para reproductores MSE/blob (YouTube incluido). En vez de
// perseguir URLs firmadas, MediaDrop graba directamente el MediaStream que
// expone el <video> real de la pestaña de origen. Es más lento (1x), pero evita
// manifests, rangos efímeros, firmas y pistas DASH separadas.
const PLAYER_CAPTURE_READY_TIMEOUT_MS = 20_000;
const PLAYER_CAPTURE_READY_POLL_MS = 300;
const PLAYER_CAPTURE_CLOSE_DELAY_MS = 60_000;
const PLAYER_CAPTURE_FAILURE_CLOSE_DELAY_MS = 1_500;

// Compatibilidad Chromium / Microsoft Edge.
// Edge permite restringir el acceso permanente a sitios, por lo que al abrir
// MediaDrop usamos activeTab + scripting como respaldo para cargar el detector.
const CONTENT_SCRIPT_PATH = "frontend/src/services/content.js";
const CONTENT_SCRIPT_READY_DELAY_MS = 80;
const CONTENT_SCRIPT_INJECTION_RETRIES = 2;

const OFFSCREEN_PREVIEW_PATH = "backend/services/offscreen.html";

// La barra de Chrome no expone su color mediante una API pública. La
// preferencia CSS es un indicador aproximado; el ajuste manual es un respaldo.
import {
  applyActionIcon, reportDetectedScheme, installIconPreferenceListener,
  CHROME_SCHEME_MESSAGE
} from "../config/icon-theme.js";
const MEDIA_DROP_CHROME_SCHEME_MESSAGE = CHROME_SCHEME_MESSAGE;
const PREVIEW_REQUEST_TIMEOUT_MS = 26_000;
const MAX_CONCURRENT_VIDEO_PREVIEWS = 2;
const VIDEO_PREVIEW_RETRY_DELAY_MS = 1_200;

const videoPreviewQueue = [];
const videoPreviewJobs = new Map();
let activeVideoPreviewJobs = 0;

const videoMetadataQueue = [];
const videoMetadataJobs = new Map();
let activeVideoMetadataJobs = 0;
const MAX_CONCURRENT_VIDEO_METADATA = 4;

const imageMetadataQueue = [];
const imageMetadataJobs = new Map();
let activeImageMetadataJobs = 0;
const MAX_CONCURRENT_IMAGE_METADATA = 4;

let creatingOffscreenDocument = null;
let downloadedImageHistoryWriteQueue = Promise.resolve();

const SAFE_MEDIA_TYPES = new Set(["image", "video"]);
const SAFE_IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "avif", "gif", "svg", "bmp", "tif", "tiff"
]);
const SAFE_VIDEO_EXTENSIONS = new Set([
  "mp4", "webm", "mov", "m4v", "ogv"
]);
const SAFE_STREAM_FORMATS = new Set([
  "m3u8", "mpd", "stream", "blob"
]);
function ownExtensionSender(sender) {
  // runtime.onMessage es el canal interno de la extensión. Aun así, cuando el
  // navegador informa un ID lo verificamos. Algunas versiones/contextos de
  // Chromium pueden omitirlo, especialmente entre content scripts y workers.
  return !sender?.id || sender.id === chrome.runtime.id;
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function safeDownloadUrl(rawUrl, mediaType) {
  if (typeof rawUrl !== "string") return null;

  if (/^data:/i.test(rawUrl)) {
    if (mediaType !== "image" || rawUrl.length > 2_000_000) return null;
    if (!/^data:image\/(?:jpeg|jpg|png|webp|avif|gif|bmp|svg\+xml)(?:;[^,]*)?,/i.test(rawUrl)) return null;
    return rawUrl;
  }

  if (rawUrl.length > MAX_URL_LENGTH) return null;
  return safeHttpUrl(rawUrl);
}

function safeBlobVideoUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > MAX_URL_LENGTH) return null;
  if (!rawUrl.startsWith("blob:")) return null;

  try {
    const inner = new URL(rawUrl.slice(5));
    if (!["http:", "https:"].includes(inner.protocol)) return null;
    return rawUrl;
  } catch {
    return null;
  }
}

function safeMediaUrl(rawUrl, mediaType, downloadable) {
  if (mediaType === "video" && downloadable === false) {
    const blobUrl = safeBlobVideoUrl(rawUrl);
    if (blobUrl) return blobUrl;
  }

  return safeDownloadUrl(rawUrl, mediaType);
}

function safePreviewUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  if (/^data:/i.test(rawUrl)) {
    if (rawUrl.length > MAX_PREVIEW_DATA_URL_LENGTH) return null;
    if (!/^data:image\/(?:jpeg|jpg|png|webp|avif|gif|bmp|svg\+xml)(?:;[^,]*)?,/i.test(rawUrl)) return null;
    return rawUrl;
  }

  return safeHttpUrl(rawUrl);
}

function sameDocumentOrigin(itemPageUrl, senderUrl) {
  if (!itemPageUrl || !senderUrl) return false;
  try {
    return new URL(itemPageUrl).origin === new URL(senderUrl).origin;
  } catch {
    return false;
  }
}

function sanitizeMediaItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;

  const type = cleanText(rawItem.type, 16).toLowerCase();
  if (!SAFE_MEDIA_TYPES.has(type)) return null;

  const requestedFormat = cleanText(rawItem.format, 12).toLowerCase().replace(/^\./, "");
  const requestedStream = type === "video"
    && (
      rawItem.streaming === true
      || rawItem.downloadable === false
      || SAFE_STREAM_FORMATS.has(requestedFormat)
      || String(rawItem.url || "").startsWith("blob:")
    );

  const downloadable = requestedStream ? false : rawItem.downloadable !== false;
  const url = safeMediaUrl(rawItem.url, type, downloadable);
  if (!url) return null;

  const expectedId = mediaId(type, url);
  if (typeof rawItem.id !== "string" || rawItem.id !== expectedId) return null;

  const format = requestedFormat;
  const allowedFormats = type === "video"
    ? new Set([...SAFE_VIDEO_EXTENSIONS, ...SAFE_STREAM_FORMATS])
    : SAFE_IMAGE_EXTENSIONS;
  const safeFormat = allowedFormats.has(format)
    ? format
    : (
      type === "video"
        ? (url.startsWith("blob:") ? "blob" : "video")
        : "image"
    );

  const width = Number(rawItem.width);
  const height = Number(rawItem.height);
  const duration = Number(rawItem.duration);

  return {
    id: expectedId,
    type,
    url,
    previewUrl: safePreviewUrl(rawItem.previewUrl),
    previewSource: cleanText(rawItem.previewSource, 40) || null,
    resolutionSource: cleanText(rawItem.resolutionSource, 48) || null,
    width: Number.isFinite(width) ? Math.max(0, Math.min(100_000, Math.round(width))) : 0,
    height: Number.isFinite(height) ? Math.max(0, Math.min(100_000, Math.round(height))) : 0,
    duration: Number.isFinite(duration) ? Math.max(0, Math.min(604_800, Math.round(duration))) : null,
    detectedAt: Number.isFinite(Number(rawItem.detectedAt))
      ? Math.max(0, Number(rawItem.detectedAt))
      : Date.now(),
    format: safeFormat,
    originalFilename: cleanText(rawItem.originalFilename, MAX_FILENAME_LENGTH) || null,
    title: cleanText(rawItem.title, MAX_TEXT_LENGTH) || (type === "video" ? "Video" : "Imagen"),
    source: cleanText(rawItem.source, 40) || "unknown",
    streaming: type === "video" && (
      requestedStream
      || SAFE_STREAM_FORMATS.has(safeFormat)
      || url.startsWith("blob:")
    ),
    streamKind: type === "video" && requestedStream
      ? cleanText(rawItem.streamKind || safeFormat, 16).toLowerCase()
      : null,
    downloadable,
    networkContentType: cleanText(rawItem.networkContentType, 96).toLowerCase() || null,
    networkResponseBytes: Number.isFinite(Number(rawItem.networkResponseBytes))
      ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(rawItem.networkResponseBytes))))
      : 0,
    networkTotalBytes: Number.isFinite(Number(rawItem.networkTotalBytes))
      ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(rawItem.networkTotalBytes))))
      : 0,
    networkPartial: rawItem.networkPartial === true,
    pageUrl: safeHttpUrl(rawItem.pageUrl) || ""
  };
}

let progressTimer = null;
let progressPollInFlight = false;

function previewJobKey(tabId, mediaId) {
  return `${tabId}:${mediaId}`;
}

function hasGeneratedVideoPreview(item) {
  return item?.type === "video"
    && typeof item.previewUrl === "string"
    && item.previewUrl.startsWith("data:image/")
    && /frame/i.test(String(item.previewSource || ""));
}

function hasIntrinsicVideoResolution(item) {
  if (!item || item.type !== "video" || !(item.width > 0) || !(item.height > 0)) return false;
  return /video-metadata|offscreen-video|decoded-frame/i.test(String(item.resolutionSource || ""));
}

async function ensureOffscreenPreviewDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("El navegador no admite documentos Offscreen.");
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PREVIEW_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length) return;
  } else if (globalThis.clients?.matchAll) {
    // Chromium 109–115 no expone runtime.getContexts(). Evita intentar crear
    // un segundo documento Offscreen cuando ya existe uno en esas versiones.
    const clients = await globalThis.clients.matchAll();
    if (clients.some((client) => client.url === offscreenUrl)) return;
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_PREVIEW_PATH,
    reasons: ["BLOBS", "MATCH_MEDIA"],
    justification: "Generar miniaturas de videos y detectar la preferencia de aspecto claro u oscuro de Chrome."
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

function withPreviewTimeout(promise, timeoutMs = PREVIEW_REQUEST_TIMEOUT_MS) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Preview timeout")), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function requestOffscreenVideoPreview(url) {
  await ensureOffscreenPreviewDocument();

  const response = await withPreviewTimeout(chrome.runtime.sendMessage({
    target: "media-drop-offscreen",
    type: "GENERATE_VIDEO_PREVIEW",
    url
  }));

  if (!response?.ok) return null;

  const previewUrl = safePreviewUrl(response.previewUrl);
  if (!previewUrl) return null;

  return {
    previewUrl,
    width: Number.isFinite(Number(response.width)) ? Math.max(0, Math.round(Number(response.width))) : 0,
    height: Number.isFinite(Number(response.height)) ? Math.max(0, Math.round(Number(response.height))) : 0,
    duration: Number.isFinite(Number(response.duration)) ? Math.max(0, Number(response.duration)) : null
  };
}

function publishVideoPreview(tabId, mediaId, result, source = "offscreen-video-frame") {
  if (!Number.isInteger(tabId) || !mediaId || !result?.previewUrl) return false;

  const store = getTabStore(tabId);
  const current = store.get(mediaId);
  if (!current || current.type !== "video") return false;

  const safePreview = safePreviewUrl(result.previewUrl);
  if (!safePreview) return false;

  const updated = {
    ...current,
    previewUrl: safePreview,
    previewSource: source,
    resolutionSource: result.width > 0 && result.height > 0
      ? "offscreen-video-decoded-frame"
      : current.resolutionSource,
    width: result.width || current.width || 0,
    height: result.height || current.height || 0,
    duration: Number.isFinite(result.duration) && result.duration > 0
      ? result.duration
      : current.duration
  };

  store.set(mediaId, updated);
  postToPanels(tabId, { type: "MEDIA_UPSERTS", items: [updated] });

  sendToPage(tabId, {
    type: "MEDIA_DROP_VIDEO_PREVIEW",
    mediaId,
    previewUrl: safePreview,
    previewSource: source,
    width: updated.width,
    height: updated.height,
    duration: updated.duration
  });

  return true;
}

async function runVideoPreviewJob(job) {
  const { tabId, mediaId } = job;
  const key = previewJobKey(tabId, mediaId);

  try {
    const current = getTabStore(tabId).get(mediaId);
    if (!current || current.type !== "video" || !current.downloadable) return;
    if (hasGeneratedVideoPreview(current)) return;

    const url = safeHttpUrl(current.url);
    if (!url) return;

    const result = await requestOffscreenVideoPreview(url);
    if (result?.previewUrl) {
      publishVideoPreview(tabId, mediaId, result, "offscreen-video-frame");
    }
  } catch {
    // Preview generation is best-effort. Detection/download remain available.
  } finally {
    videoPreviewJobs.delete(key);
  }
}

function drainVideoPreviewQueue() {
  while (
    activeVideoPreviewJobs < MAX_CONCURRENT_VIDEO_PREVIEWS
    && videoPreviewQueue.length
  ) {
    const job = videoPreviewQueue.shift();
    activeVideoPreviewJobs += 1;

    runVideoPreviewJob(job)
      .finally(() => {
        activeVideoPreviewJobs -= 1;
        setTimeout(drainVideoPreviewQueue, 0);
      });
  }
}

function queueVideoPreview(tabId, item, delayMs = 0) {
  if (!Number.isInteger(tabId) || !item || item.type !== "video") return;
  if (!item.downloadable || hasGeneratedVideoPreview(item)) return;

  const url = safeHttpUrl(item.url);
  if (!url) return;

  const format = String(item.format || "").toLowerCase();
  if (["m3u8", "mpd", "stream"].includes(format)) return;

  const key = previewJobKey(tabId, item.id);
  if (videoPreviewJobs.has(key)) return;

  videoPreviewJobs.set(key, true);

  const enqueue = () => {
    videoPreviewQueue.push({ tabId, mediaId: item.id });
    drainVideoPreviewQueue();
  };

  if (delayMs > 0) setTimeout(enqueue, delayMs);
  else enqueue();
}

async function requestOffscreenVideoMetadata(url) {
  await ensureOffscreenPreviewDocument();

  const response = await withPreviewTimeout(chrome.runtime.sendMessage({
    target: "media-drop-offscreen",
    type: "GET_VIDEO_METADATA",
    url
  }), 20_000);

  if (!response?.ok) return null;

  const width = Number(response.width);
  const height = Number(response.height);
  const duration = Number(response.duration);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }

  return {
    width: Math.min(100_000, Math.round(width)),
    height: Math.min(100_000, Math.round(height)),
    duration: Number.isFinite(duration) && duration > 0
      ? Math.min(604_800, duration)
      : null
  };
}

function publishVideoMetadata(tabId, mediaId, metadata) {
  if (!Number.isInteger(tabId) || !mediaId || !metadata) return false;

  const store = getTabStore(tabId);
  const current = store.get(mediaId);
  if (!current || current.type !== "video") return false;

  const updated = {
    ...current,
    width: metadata.width,
    height: metadata.height,
    duration: Number.isFinite(metadata.duration) && metadata.duration > 0
      ? metadata.duration
      : current.duration,
    resolutionSource: "offscreen-video-metadata"
  };

  store.set(mediaId, updated);
  postToPanels(tabId, { type: "MEDIA_UPSERTS", items: [updated] });

  sendToPage(tabId, {
    type: "MEDIA_DROP_VIDEO_METADATA",
    mediaId,
    width: updated.width,
    height: updated.height,
    duration: updated.duration,
    resolutionSource: updated.resolutionSource
  });

  return true;
}

async function runVideoMetadataJob(job) {
  const key = previewJobKey(job.tabId, job.mediaId);

  try {
    const current = getTabStore(job.tabId).get(job.mediaId);
    if (!current || current.type !== "video" || !current.downloadable) return;
    if (hasIntrinsicVideoResolution(current)) return;

    const url = safeHttpUrl(current.url);
    if (!url) return;

    const metadata = await requestOffscreenVideoMetadata(url);
    if (metadata) publishVideoMetadata(job.tabId, job.mediaId, metadata);
  } catch {
    // Metadata lookup is best-effort and never blocks detection/download.
  } finally {
    videoMetadataJobs.delete(key);
  }
}

function drainVideoMetadataQueue() {
  while (
    activeVideoMetadataJobs < MAX_CONCURRENT_VIDEO_METADATA
    && videoMetadataQueue.length
  ) {
    const job = videoMetadataQueue.shift();
    activeVideoMetadataJobs += 1;

    runVideoMetadataJob(job)
      .finally(() => {
        activeVideoMetadataJobs -= 1;
        Promise.resolve().then(drainVideoMetadataQueue);
      });
  }
}

function queueVideoMetadata(tabId, item) {
  if (!Number.isInteger(tabId) || !item || item.type !== "video") return;
  if (!item.downloadable || hasIntrinsicVideoResolution(item)) return;

  const url = safeHttpUrl(item.url);
  if (!url) return;

  const format = String(item.format || "").toLowerCase();
  if (["m3u8", "mpd", "stream"].includes(format)) return;

  const key = previewJobKey(tabId, item.id);
  if (videoMetadataJobs.has(key)) return;

  videoMetadataJobs.set(key, true);
  videoMetadataQueue.push({ tabId, mediaId: item.id });
  drainVideoMetadataQueue();
}

async function requestOffscreenImageDimensions(url) {
  await ensureOffscreenPreviewDocument();

  const response = await withPreviewTimeout(chrome.runtime.sendMessage({
    target: "media-drop-offscreen",
    type: "GET_IMAGE_DIMENSIONS",
    url
  }), 18_000);

  if (!response?.ok) return null;

  const width = Number(response.width);
  const height = Number(response.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;

  return {
    width: Math.min(100_000, Math.round(width)),
    height: Math.min(100_000, Math.round(height))
  };
}

function publishImageDimensions(tabId, mediaId, dimensions) {
  if (!Number.isInteger(tabId) || !mediaId || !dimensions) return false;

  const store = getTabStore(tabId);
  const current = store.get(mediaId);
  if (!current || current.type !== "image") return false;

  const updated = {
    ...current,
    width: dimensions.width,
    height: dimensions.height,
    resolutionSource: "offscreen-original-image"
  };

  store.set(mediaId, updated);
  postToPanels(tabId, { type: "MEDIA_UPSERTS", items: [updated] });

  sendToPage(tabId, {
    type: "MEDIA_DROP_IMAGE_DIMENSIONS",
    mediaId,
    width: updated.width,
    height: updated.height
  });

  return true;
}

async function runImageMetadataJob(job) {
  const key = previewJobKey(job.tabId, job.mediaId);

  try {
    const current = getTabStore(job.tabId).get(job.mediaId);
    if (!current || current.type !== "image") return;
    if (current.width > 0 && current.height > 0) return;

    const url = safeHttpUrl(current.url);
    if (!url) return;

    const dimensions = await requestOffscreenImageDimensions(url);
    if (dimensions) publishImageDimensions(job.tabId, job.mediaId, dimensions);
  } catch {
    // Best-effort only.
  } finally {
    imageMetadataJobs.delete(key);
  }
}

function drainImageMetadataQueue() {
  while (
    activeImageMetadataJobs < MAX_CONCURRENT_IMAGE_METADATA
    && imageMetadataQueue.length
  ) {
    const job = imageMetadataQueue.shift();
    activeImageMetadataJobs += 1;

    runImageMetadataJob(job)
      .finally(() => {
        activeImageMetadataJobs -= 1;
        Promise.resolve().then(drainImageMetadataQueue);
      });
  }
}

function queueImageMetadata(tabId, item) {
  if (!Number.isInteger(tabId) || !item || item.type !== "image") return;
  if (item.width > 0 && item.height > 0) return;

  const url = safeHttpUrl(item.url);
  if (!url) return;

  const key = previewJobKey(tabId, item.id);
  if (imageMetadataJobs.has(key)) return;

  imageMetadataJobs.set(key, true);
  imageMetadataQueue.push({ tabId, mediaId: item.id });
  drainImageMetadataQueue();
}

function getTabStore(tabId) {
  if (!mediaByTab.has(tabId)) {
    mediaByTab.set(tabId, new Map());
  }
  return mediaByTab.get(tabId);
}

function getTabFrameOwners(tabId) {
  if (!mediaFramesByTab.has(tabId)) {
    mediaFramesByTab.set(tabId, new Map());
  }
  return mediaFramesByTab.get(tabId);
}

function rememberMediaFrame(tabId, mediaId, frameId) {
  if (!Number.isInteger(frameId) || frameId < 0 || !mediaId) return;
  const owners = getTabFrameOwners(tabId);
  if (!owners.has(mediaId)) owners.set(mediaId, new Set());
  owners.get(mediaId).add(frameId);
}

function clearTabMedia(tabId) {
  mediaByTab.set(tabId, new Map());
  mediaFramesByTab.delete(tabId);
}

function clearFrameMedia(tabId, frameId) {
  if (!Number.isInteger(frameId) || frameId < 0) return false;

  const store = getTabStore(tabId);
  const owners = mediaFramesByTab.get(tabId);
  if (!owners) return false;

  let changed = false;

  for (const [mediaId, frames] of [...owners]) {
    if (!frames.delete(frameId)) continue;

    if (!frames.size) {
      owners.delete(mediaId);
      if (store.delete(mediaId)) changed = true;
    }
  }

  if (!owners.size) mediaFramesByTab.delete(tabId);
  return changed;
}

function trimTabStore(tabId, store) {
  const owners = mediaFramesByTab.get(tabId);

  while (store.size > MAX_MEDIA_PER_TAB) {
    const firstKey = store.keys().next().value;
    store.delete(firstKey);
    owners?.delete(firstKey);
  }

  if (owners && !owners.size) mediaFramesByTab.delete(tabId);
}

function postToPanels(tabId, message) {
  for (const port of panelPorts) {
    if (port.__mediaDropTabId !== tabId) continue;
    try {
      port.postMessage(message);
    } catch {
      panelPorts.delete(port);
    }
  }
}

function sendToPage(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Las páginas internas de Edge y pestañas cerradas no aceptan content scripts.
  });
}

function upsertMedia(tabId, items, frameId = null) {
  if (!Number.isInteger(tabId)) return;

  const store = getTabStore(tabId);
  const accepted = [];
  const candidates = Array.isArray(items) ? items.slice(0, MAX_UPSERT_ITEMS) : [];

  for (const rawItem of candidates) {
    const item = sanitizeMediaItem(rawItem);
    if (!item) continue;

    const previous = store.get(item.id);
    const merged = previous ? { ...previous, ...item } : item;

    if (
      previous
      && hasGeneratedVideoPreview(previous)
      && !hasGeneratedVideoPreview(item)
    ) {
      merged.previewUrl = previous.previewUrl;
      merged.previewSource = previous.previewSource;
    }

    if (
      previous
      && hasIntrinsicVideoResolution(previous)
      && !hasIntrinsicVideoResolution(item)
    ) {
      merged.width = previous.width;
      merged.height = previous.height;
      merged.duration = previous.duration;
      merged.resolutionSource = previous.resolutionSource;
    }

    // Los upserts del DOM no conocen los headers de red. No deben borrar la
    // evidencia Content-Range/tamaño que capturó webRequest para ese recurso.
    if (previous && previous.networkTotalBytes > 0 && !(item.networkTotalBytes > 0)) {
      merged.networkContentType = previous.networkContentType;
      merged.networkResponseBytes = previous.networkResponseBytes;
      merged.networkTotalBytes = previous.networkTotalBytes;
      merged.networkPartial = previous.networkPartial;
    }

    store.set(item.id, merged);
    rememberMediaFrame(tabId, item.id, frameId);
    accepted.push(merged);

    if (merged.type === "video" && !hasGeneratedVideoPreview(merged)) {
      queueVideoPreview(tabId, merged, VIDEO_PREVIEW_RETRY_DELAY_MS);
    }

    if (merged.type === "video" && !hasIntrinsicVideoResolution(merged)) {
      queueVideoMetadata(tabId, merged);
    }

    if (merged.type === "image" && (!merged.width || !merged.height)) {
      queueImageMetadata(tabId, merged);
    }
  }

  trimTabStore(tabId, store);

  if (accepted.length) {
    postToPanels(tabId, { type: "MEDIA_UPSERTS", items: accepted });
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function contentScriptIsReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "MEDIA_DROP_PING"
    });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (!Number.isInteger(tabId)) return false;
  if (await contentScriptIsReady(tabId)) return true;

  // La inyección estática del manifest continúa siendo la ruta principal.
  // Este bloque es un fallback para Edge cuando el acceso al sitio se concede
  // únicamente al invocar la acción de la extensión (activeTab).
  for (let attempt = 0; attempt < CONTENT_SCRIPT_INJECTION_RETRIES; attempt += 1) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [CONTENT_SCRIPT_PATH]
      });
      await wait(CONTENT_SCRIPT_READY_DELAY_MS);
      if (await contentScriptIsReady(tabId)) return true;
    } catch {
      // edge://, chrome://, tiendas de extensiones y otras páginas protegidas
      // no permiten inyección. Se reporta mediante PAGE_UNAVAILABLE abajo.
    }
  }

  return false;
}

async function refreshSnapshot(tabId) {
  postToPanels(tabId, {
    type: "MEDIA_SNAPSHOT",
    items: [...getTabStore(tabId).values()]
  });

  for (const download of activeDownloads.values()) {
    if (download.tabId === tabId) broadcastDownload(download);
  }

  try {
    const ready = await ensureContentScript(tabId);
    if (!ready) throw new Error("CONTENT_SCRIPT_UNAVAILABLE");

    const response = await chrome.tabs.sendMessage(tabId, {
      type: "MEDIA_DROP_GET_SNAPSHOT"
    });

    if (response?.items) {
      upsertMedia(tabId, response.items);
      postToPanels(tabId, {
        type: "MEDIA_SNAPSHOT",
        items: [...getTabStore(tabId).values()],
        page: response.page
      });
    }
  } catch {
    postToPanels(tabId, {
      type: "PAGE_UNAVAILABLE",
      reason: "Esta página no permite que una extensión analice su contenido."
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  // onConnect es el canal interno; onConnectExternal gestiona conexiones de
  // terceros. Solo rechazamos un ID cuando el navegador sí lo proporciona y
  // no coincide con el de MediaDrop.
  if (
    port.name !== "media-drop-panel"
    || (port.sender?.id && port.sender.id !== chrome.runtime.id)
  ) {
    try { port.disconnect(); } catch {}
    return;
  }

  panelPorts.add(port);

  port.onMessage.addListener((message) => {
    if (message?.type === "SUBSCRIBE_TAB" && Number.isInteger(message.tabId)) {
      port.__mediaDropTabId = message.tabId;
      refreshSnapshot(message.tabId);
    }
  });

  port.onDisconnect.addListener(() => panelPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!ownExtensionSender(sender) || !message || typeof message !== "object") return false;

  const senderTabId = sender.tab?.id;

  if (message.type === MEDIA_DROP_CHROME_SCHEME_MESSAGE) {
    // Solo el offscreen propio puede publicar la preferencia detectada.
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PREVIEW_PATH) || typeof message.dark !== "boolean") {
      sendResponse({ ok: false });
      return false;
    }
    reportDetectedScheme(message.dark)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "STREAM_ASSEMBLY_PROGRESS") {
    const tabId = Number(message.tabId);
    const mediaId = cleanText(message.mediaId, 120);
    const percent = Number(message.percent);

    if (
      sender.url === chrome.runtime.getURL(OFFSCREEN_PREVIEW_PATH)
      && Number.isInteger(tabId)
      && mediaId
    ) {
      const progress = {
        type: "DOWNLOAD_PROGRESS",
        mediaId,
        state: "in_progress",
        percent: Number.isFinite(percent)
          ? Math.max(0, Math.min(99, Math.round(percent)))
          : null
      };

      postToPanels(tabId, progress);
      sendToPage(tabId, progress);
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "MEDIA_DROP_PLAYER_CAPTURE_PROGRESS" && Number.isInteger(senderTabId)) {
    const sourceTabId = Number(message.sourceTabId);
    const mediaId = cleanText(message.mediaId, 120);
    const percent = Number(message.percent);

    if (Number.isInteger(sourceTabId) && mediaId) {
      const progress = {
        type: "DOWNLOAD_PROGRESS",
        mediaId,
        state: "in_progress",
        percent: Number.isFinite(percent)
          ? Math.max(0, Math.min(99, Math.round(percent)))
          : null
      };
      postToPanels(sourceTabId, progress);
      sendToPage(sourceTabId, progress);
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "MEDIA_DROP_PLAYER_CAPTURE_COMPLETE" && Number.isInteger(senderTabId)) {
    const sourceTabId = Number(message.sourceTabId);
    const mediaId = cleanText(message.mediaId, 120);

    if (Number.isInteger(sourceTabId) && mediaId) {
      broadcastSyntheticDownload(sourceTabId, mediaId, "complete", 100);
    }

    if (senderTabId !== sourceTabId) {
      closeCaptureTabLater(senderTabId, PLAYER_CAPTURE_CLOSE_DELAY_MS);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "MEDIA_DROP_PLAYER_CAPTURE_FAILED" && Number.isInteger(senderTabId)) {
    const sourceTabId = Number(message.sourceTabId);
    const mediaId = cleanText(message.mediaId, 120);
    const error = cleanText(message.error || "No fue posible capturar el reproductor.", 220);

    if (Number.isInteger(sourceTabId) && mediaId) {
      broadcastSyntheticDownload(sourceTabId, mediaId, "interrupted", null, error);
    }

    if (senderTabId !== sourceTabId) {
      closeCaptureTabLater(senderTabId, PLAYER_CAPTURE_FAILURE_CLOSE_DELAY_MS);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "MEDIA_UPSERTS" && Number.isInteger(senderTabId)) {
    const items = Array.isArray(message.items)
      ? message.items.filter((item) => sameDocumentOrigin(item?.pageUrl, sender.url))
      : [];
    upsertMedia(senderTabId, items, sender.frameId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "REQUEST_VIDEO_PREVIEW" && Number.isInteger(senderTabId)) {
    const mediaId = cleanText(message.mediaId, 120);
    const current = getTabStore(senderTabId).get(mediaId);

    if (
      !current
      || current.type !== "video"
      || !current.downloadable
      || !sameDocumentOrigin(current.pageUrl, sender.url)
    ) {
      sendResponse({ ok: false });
      return false;
    }

    if (hasGeneratedVideoPreview(current)) {
      sendResponse({ ok: true, previewUrl: current.previewUrl });
      return false;
    }

    queueVideoPreview(senderTabId, current);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message?.type === "MEDIA_RESET" && Number.isInteger(senderTabId)) {
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;

    // Un iframe navega de forma independiente del documento principal. Limpiar
    // toda la pestaña desde ese frame hacía desaparecer medios válidos de otros
    // frames. El frame principal conserva el reset completo de siempre.
    if (frameId > 0) {
      if (clearFrameMedia(senderTabId, frameId)) {
        postToPanels(senderTabId, {
          type: "MEDIA_SNAPSHOT",
          items: [...getTabStore(senderTabId).values()]
        });
      }
    } else {
      clearTabMedia(senderTabId);
      postToPanels(senderTabId, { type: "MEDIA_RESET" });
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "CLEAR_MEDIA") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : senderTabId;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "No hay una pestaña disponible para limpiar." });
      return false;
    }

    clearTabMedia(tabId);
    postToPanels(tabId, { type: "MEDIA_RESET" });
    sendToPage(tabId, { type: "MEDIA_DROP_CLEAR" });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "START_DOWNLOAD") {
    const tabId = Number.isInteger(senderTabId) ? senderTabId : message.tabId;
    const sanitized = sanitizeMediaItem(message.item);

    if (
      !Number.isInteger(tabId)
      || !sanitized
      || (!sanitized.downloadable && !sanitized.streaming)
    ) {
      sendResponse({ ok: false, error: "La solicitud de descarga no es válida." });
      return false;
    }

    let trustedItem = getTabStore(tabId).get(sanitized.id) || null;

    if (
      !trustedItem
      && Number.isInteger(senderTabId)
      && sameDocumentOrigin(sanitized.pageUrl, sender.url)
    ) {
      trustedItem = sanitized;
      upsertMedia(tabId, [sanitized], sender.frameId);
    }

    if (!trustedItem || trustedItem.url !== sanitized.url || trustedItem.type !== sanitized.type) {
      sendResponse({ ok: false, error: "El recurso no pertenece a los medios detectados en esta pestaña." });
      return false;
    }

    const operation = trustedItem.streaming
      ? startStreamDownload(trustedItem, tabId)
      : startDownload(trustedItem, tabId);

    operation
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
    return true;
  }

  return false;
});


function headerValue(headers, name) {
  const target = String(name || "").toLowerCase();
  if (!Array.isArray(headers) || !headers.length) return "";

  let values = responseHeaderValueCache.get(headers);
  if (!values) {
    values = new Map();
    for (const item of headers) {
      const key = String(item?.name || "").toLowerCase();
      if (key && !values.has(key)) values.set(key, String(item?.value || "").trim());
    }
    responseHeaderValueCache.set(headers, values);
  }

  return values.get(target) || "";
}

function filenameFromContentDisposition(value) {
  const header = String(value || "");
  if (!header) return null;

  const utf8 = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, "")); } catch {}
  }

  const plain = header.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return (plain?.[1] || plain?.[2] || "").trim() || null;
}

function originalFilenameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hinted = ["filename", "file", "name", "download", "attachment"]
      .map((key) => parsed.searchParams.get(key))
      .find((value) => value && /\.[a-z0-9]{2,8}$/i.test(value));
    if (hinted) return decodeURIComponent(hinted).split(/[\/]/).pop();

    const lastPart = decodeURIComponent(parsed.pathname).split("/").filter(Boolean).pop() || "";
    return /\.[a-z0-9]{2,8}$/i.test(lastPart) ? lastPart : null;
  } catch {
    return null;
  }
}

function mediaId(type, url) {
  const seed = `${type}|${url}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `md-${(hash >>> 0).toString(36)}`;
}

function normalizeNetworkVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Parámetros de rango/chunk muy comunes que harían aparecer el mismo video muchas veces.
    for (const key of ["range", "rn", "rbuf", "sq", "ump", "alr"]) {
      if (url.hostname.includes("googlevideo.com")) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.href;
  } catch {
    return rawUrl;
  }
}

function mediaKindHintFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hintedMime = ["mime", "type", "content_type"]
      .map((key) => String(url.searchParams.get(key) || "").toLowerCase())
      .find(Boolean) || "";

    if (hintedMime.startsWith("audio/")) return "audio";
    if (hintedMime.startsWith("video/")) return "video";
  } catch {}

  let decoded = String(rawUrl || "").toLowerCase();
  try { decoded = decodeURIComponent(decoded); } catch {}
  if (/(?:[?&](?:mime|type|content_type)=audio(?:%2f|\/))/i.test(decoded)) return "audio";
  if (/(?:[?&](?:mime|type|content_type)=video(?:%2f|\/))/i.test(decoded)) return "video";
  return null;
}

function parseContentRangeHeader(value) {
  const match = String(value || "").match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!match) return { start: 0, end: 0, total: 0, valid: false };

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? 0 : Number(match[3]);
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
    total: Number.isFinite(total) ? total : 0,
    valid: true
  };
}

function networkFormat(url, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("mpegurl") || type.includes("m3u8")) return "m3u8";
  if (type.includes("dash+xml")) return "mpd";
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  if (type.includes("mp4")) return "mp4";
  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (ext) return ext;
  } catch {}
  return "video";
}

function isVideoResponse(details) {
  const contentType = headerValue(details.responseHeaders, "content-type").toLowerCase();
  const contentDisposition = headerValue(details.responseHeaders, "content-disposition").toLowerCase();
  const url = String(details.url || "");
  const hintedKind = mediaKindHintFromUrl(url);
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch {}

  // YouTube/GoogleVideo usa /videoplayback tanto para audio como para video.
  // Nunca debemos convertir una pista de audio DASH en candidato del reproductor.
  if (/^audio\//i.test(contentType) || hintedKind === "audio") return false;

  if (/\.(?:m4s|ts|aac|cmfv|cmfa)(?:$|[?#])/i.test(decoded)) return false;
  if (/^video\//i.test(contentType) || hintedKind === "video") return true;
  if (/(?:mpegurl|application\/vnd\.apple\.mpegurl|application\/dash\+xml)/i.test(contentType)) return true;
  if (/filename=.*\.(?:mp4|webm|mov|m4v|ogv)(?:["'; ]|$)/i.test(contentDisposition)) return true;
  if (/\.(?:mp4|webm|mov|m4v|ogv|m3u8|mpd)(?:$|[?#])/i.test(decoded)) return true;

  // Fallback para endpoints opacos: solo cuando no existe una pista explícita de audio.
  if (/videoplayback/i.test(decoded) && hintedKind !== "audio") return true;
  return false;
}

function registerNetworkVideo(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0 || !isVideoResponse(details)) return;
  const rawUrl = String(details.url || "");
  if (!/^https?:/i.test(rawUrl)) return;

  const url = normalizeNetworkVideoUrl(rawUrl);
  const contentType = headerValue(details.responseHeaders, "content-type");
  const contentLength = Number(headerValue(details.responseHeaders, "content-length") || 0);
  const contentRange = parseContentRangeHeader(headerValue(details.responseHeaders, "content-range"));
  const networkResponseBytes = Number.isFinite(contentLength) && contentLength > 0
    ? contentLength
    : (contentRange.valid ? Math.max(0, contentRange.end - contentRange.start + 1) : 0);
  const networkTotalBytes = contentRange.total > 0 ? contentRange.total : networkResponseBytes;
  const networkPartial = Number(details.statusCode) === 206 || contentRange.valid;
  const format = networkFormat(url, contentType);
  const stream = ["m3u8", "mpd"].includes(format);
  const id = mediaId("video", url);
  const contentDisposition = headerValue(details.responseHeaders, "content-disposition");
  const originalFilename = filenameFromContentDisposition(contentDisposition) || originalFilenameFromUrl(url);

  upsertMedia(details.tabId, [{
    id,
    type: "video",
    url,
    previewUrl: null,
    width: 0,
    height: 0,
    duration: null,
    format,
    streamKind: stream ? format : null,
    streaming: stream,
    originalFilename,
    title: originalFilename || (stream ? "Video en streaming" : "Video detectado"),
    source: stream ? "network-stream" : "network",
    downloadable: !stream,
    networkContentType: contentType,
    networkResponseBytes,
    networkTotalBytes,
    networkPartial,
    pageUrl: details.documentUrl || details.initiator || ""
  }], details.frameId);

  if (stream) {
    sendToPage(details.tabId, {
      type: "MEDIA_DROP_STREAM_DETECTED",
      mediaId: id,
      url,
      format,
      pageUrl: details.documentUrl || details.initiator || ""
    });
  }
}

function networkImageFormat(url, contentType) {
  const type = String(contentType || "").toLowerCase();
  const mimeMap = [
    ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
    ["image/avif", "avif"], ["image/gif", "gif"], ["image/svg+xml", "svg"],
    ["image/bmp", "bmp"], ["image/tiff", "tiff"]
  ];
  for (const [mime, ext] of mimeMap) if (type.includes(mime)) return ext;
  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase();
    if (ext) return ext === "jpeg" ? "jpg" : ext;
  } catch {}
  return "image";
}

function isImageResponse(details) {
  const contentType = headerValue(details.responseHeaders, "content-type").toLowerCase();
  const contentDisposition = headerValue(details.responseHeaders, "content-disposition");
  const contentLength = Number(headerValue(details.responseHeaders, "content-length") || 0);
  const url = String(details.url || "");
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch {}

  if (/^(?:image\/(?:x-icon|vnd\.microsoft\.icon))/.test(contentType)) return false;
  if (/(?:favicon|apple-touch-icon|sprite|spacer|pixel|tracking)[._/?-]/i.test(decoded)) return false;
  if (contentLength > 0 && contentLength < 3000) return false;
  if (/^image\//i.test(contentType)) return true;
  if (/filename\s*\*?=.*\.(?:jpe?g|png|webp|avif|gif|svg|bmp|tiff?)/i.test(contentDisposition)) return true;
  return /\.(?:jpe?g|png|webp|avif|gif|svg|bmp|tiff?)(?:$|[?#])/i.test(decoded);
}

function registerNetworkImage(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0 || !isImageResponse(details)) return;
  const url = String(details.url || "");
  if (!/^https?:/i.test(url)) return;

  const contentType = headerValue(details.responseHeaders, "content-type");
  const contentDisposition = headerValue(details.responseHeaders, "content-disposition");
  const originalFilename = filenameFromContentDisposition(contentDisposition) || originalFilenameFromUrl(url);
  const format = networkImageFormat(url, contentType);

  upsertMedia(details.tabId, [{
    id: mediaId("image", url),
    type: "image",
    url,
    previewUrl: url,
    width: 0,
    height: 0,
    format,
    originalFilename,
    title: originalFilename || "Imagen detectada",
    source: "network",
    downloadable: true,
    pageUrl: details.documentUrl || details.initiator || ""
  }], details.frameId);
}

if (chrome.webRequest?.onHeadersReceived) {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      registerNetworkVideo(details);
      registerNetworkImage(details);
    },
    { urls: ["http://*/*", "https://*/*"], types: ["image", "media", "xmlhttprequest", "other"] },
    ["responseHeaders"]
  );
}

chrome.tabs.onRemoved.addListener((tabId) => {
  mediaByTab.delete(tabId);
  mediaFramesByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  clearTabMedia(tabId);
  postToPanels(tabId, { type: "MEDIA_RESET" });
});

function readableError(error) {
  if (!error) return "No se pudo iniciar la descarga.";
  return String(error.message || error).replace(/^Error:\s*/i, "");
}

function isAllowedDownloadUrl(rawUrl, mediaType) {
  return Boolean(safeDownloadUrl(rawUrl, mediaType));
}

function extensionFromItem(item) {
  const known = item.type === "video" ? SAFE_VIDEO_EXTENSIONS : SAFE_IMAGE_EXTENSIONS;

  const format = String(item.format || "").toLowerCase().replace(/^\./, "");
  if (known.has(format)) return format === "jpeg" ? "jpg" : format;

  try {
    const match = new URL(item.url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    const urlExt = match?.[1]?.toLowerCase();
    if (urlExt && known.has(urlExt)) {
      return urlExt === "jpeg" ? "jpg" : urlExt;
    }
  } catch {
    // El nombre alternativo se genera abajo.
  }

  return item.type === "video" ? "mp4" : "jpg";
}

function sanitizeSegment(value, fallback) {
  let sanitized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 90);

  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)) {
    sanitized = `${sanitized}-media`;
  }

  return sanitized || fallback;
}

function filenameForItem(item, forcedExtension = null) {
  const internalExtension = String(forcedExtension || "").toLowerCase();
  const extension = ["mp4", "webm", "mov", "m4v", "ogv", "ts"].includes(internalExtension)
    ? internalExtension
    : extensionFromItem(item);

  // El nombre es relativo a la carpeta Descargas del navegador.
  // Al no incluir subcarpetas, fotos y videos van directamente a Downloads.
  // Prioridad: 1) Content-Disposition; 2) nombre real de URL; 3) título; 4) generado.
  let original = String(item.originalFilename || "").trim();
  if (!original) original = originalFilenameFromUrl(item.url) || "";

  if (original) {
    original = original.split(/[\/]/).pop();
    const match = original.match(/^(.*?)(\.[a-z0-9]{2,8})$/i);
    const rawBase = match?.[1] || original;
    const rawExt = match?.[2]?.slice(1).toLowerCase() || extension;
    const safeBase = sanitizeSegment(rawBase, item.type === "video" ? "video" : "foto");
    const allowedExtensions = item.type === "video" ? SAFE_VIDEO_EXTENSIONS : SAFE_IMAGE_EXTENSIONS;
    const safeExt = forcedExtension
      ? extension
      : (allowedExtensions.has(rawExt) ? rawExt : extension);
    return `${safeBase}.${safeExt === "jpeg" ? "jpg" : safeExt}`;
  }

  const title = String(item.title || "").trim();
  const fallback = `${item.type === "video" ? "video" : "foto"}-${Date.now()}`;
  const safeBase = sanitizeSegment(title, fallback);
  return `${safeBase}.${extension}`;
}

function samePageOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function streamCandidateScore(streamItem, candidate) {
  if (!candidate || candidate.id === streamItem.id || candidate.type !== "video") return -Infinity;

  const candidateKindHint = mediaKindHintFromUrl(candidate.url);
  const contentType = String(candidate.networkContentType || "").toLowerCase();

  // Nunca vincular un <video>/blob real con la pista de audio DASH.
  if (candidateKindHint === "audio" || contentType.startsWith("audio/")) return -Infinity;

  const direct = candidate.downloadable && Boolean(safeHttpUrl(candidate.url));
  const hls = candidate.streaming
    && String(candidate.streamKind || candidate.format || "").toLowerCase() === "m3u8";

  if (!direct && !hls) return -Infinity;

  const responseBytes = Number(candidate.networkResponseBytes || 0);
  const totalBytes = Number(candidate.networkTotalBytes || 0);

  // Un recurso completo de decenas de KB no puede representar razonablemente
  // un video largo. Los chunks parciales sí pueden ser pequeños, siempre que
  // Content-Range revele un recurso total de tamaño real.
  if (
    direct
    && streamItem.duration >= STREAM_LONG_MEDIA_SECONDS
    && totalBytes > 0
    && totalBytes <= STREAM_TINY_RESOURCE_BYTES
  ) {
    return -Infinity;
  }

  let score = direct ? 10_000 : 8_000;

  if (samePageOrigin(streamItem.pageUrl, candidate.pageUrl)) score += 2_500;
  if (/network/i.test(String(candidate.source || ""))) score += 800;
  if (candidateKindHint === "video" || contentType.startsWith("video/")) score += 1_600;

  // En DASH/range, Content-Range nos dice el tamaño del recurso completo.
  // Premia la pista de video real sin favorecer por accidente un init segment.
  if (totalBytes > 0) {
    score += Math.min(
      STREAM_SIZE_SCORE_CAP,
      Math.log2(Math.max(1, totalBytes / 1024)) * 90
    );
  } else if (responseBytes > STREAM_TINY_RESOURCE_BYTES) {
    score += 350;
  }

  if (
    streamItem.width > 0
    && streamItem.height > 0
    && candidate.width > 0
    && candidate.height > 0
  ) {
    const streamPixels = streamItem.width * streamItem.height;
    const candidatePixels = candidate.width * candidate.height;
    const ratio = Math.min(streamPixels, candidatePixels) / Math.max(streamPixels, candidatePixels);
    score += ratio * 2_400;
  }

  if (
    streamItem.duration > 0
    && candidate.duration > 0
  ) {
    const ratio = Math.min(streamItem.duration, candidate.duration)
      / Math.max(streamItem.duration, candidate.duration);
    score += ratio * 1_200;
  }

  if (
    streamItem.previewUrl
    && candidate.previewUrl
    && streamItem.previewUrl === candidate.previewUrl
  ) {
    score += 1_000;
  }

  score += Math.min(500, Math.max(0, (candidate.detectedAt || 0) / 1e12));
  return score;
}

function resolveStreamCandidates(tabId, streamItem) {
  return [...getTabStore(tabId).values()]
    .filter((candidate) => candidate.type === "video" && candidate.id !== streamItem.id)
    .map((candidate) => ({
      candidate,
      score: streamCandidateScore(streamItem, candidate)
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, STREAM_MAX_CANDIDATE_ATTEMPTS)
    .map((entry) => entry.candidate);
}

function isGoogleVideoUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === "googlevideo.com" || hostname.endsWith(".googlevideo.com");
  } catch {
    return false;
  }
}

function googleVideoTotalBytes(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!isGoogleVideoUrl(url.href)) return 0;
    const value = Number(url.searchParams.get(GOOGLEVIDEO_TOTAL_BYTES_PARAM) || 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function googleVideoDownloadUrl(rawUrl, totalBytes) {
  try {
    const url = new URL(rawUrl);
    if (!isGoogleVideoUrl(url.href)) return null;
    const size = Math.floor(Number(totalBytes || 0));
    if (!(size > STREAM_MIN_VALID_DOWNLOAD_BYTES)) return null;

    // YouTube entrega videoplayback por trozos. Pedimos explícitamente el
    // rango completo usando el mismo mecanismo que usa su reproductor.
    url.searchParams.set(GOOGLEVIDEO_RANGE_PARAM, `0-${size - 1}`);
    return url.href;
  } catch {
    return null;
  }
}

function googleVideoExtension(rawUrl, fallback = "mp4") {
  try {
    const mime = String(new URL(rawUrl).searchParams.get("mime") || "").toLowerCase();
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4")) return "mp4";
  } catch {}
  return SAFE_VIDEO_EXTENSIONS.has(String(fallback || "").toLowerCase())
    ? String(fallback).toLowerCase()
    : "mp4";
}

function probeLooksLikeVideo(probe) {
  if (!probe?.ok) return false;
  const type = String(probe.contentType || "").toLowerCase();
  if (type.startsWith("audio/")) return false;
  if (type.startsWith("video/")) return true;
  return type.includes("octet-stream");
}

function broadcastSyntheticDownload(tabId, mediaId, state, percent = null, error = null) {
  const message = {
    type: "DOWNLOAD_PROGRESS",
    mediaId,
    state,
    percent: Number.isFinite(percent) ? percent : null
  };

  if (error) message.error = error;
  postToPanels(tabId, message);
  sendToPage(tabId, message);
}

async function requestHlsDownload(item, tabId) {
  await ensureOffscreenPreviewDocument();

  const response = await chrome.runtime.sendMessage({
    target: "media-drop-offscreen",
    type: "DOWNLOAD_HLS",
    tabId,
    mediaId: item.id,
    url: item.url,
    filename: filenameForItem(item, "mp4")
  });

  if (!response?.ok || !response.started) {
    throw new Error(response?.error || "No fue posible descargar el stream HLS.");
  }

  broadcastSyntheticDownload(tabId, item.id, "complete", 100);
  return {
    ok: true,
    stream: true,
    filename: response.filename,
    size: response.size || null
  };
}

async function probeRemoteStreamUrl(url) {
  try {
    await ensureOffscreenPreviewDocument();
    const response = await withPreviewTimeout(chrome.runtime.sendMessage({
      target: "media-drop-offscreen",
      type: "PROBE_REMOTE_MEDIA",
      url
    }), 14_000);

    if (!response?.ok) return null;
    return {
      status: Number(response.status || 0),
      contentType: cleanText(response.contentType, 96).toLowerCase(),
      responseBytes: Math.max(0, Number(response.responseBytes || 0)),
      totalBytes: Math.max(0, Number(response.totalBytes || 0)),
      partial: response.partial === true
    };
  } catch {
    return null;
  }
}

async function requestRangedMediaDownload(item, candidate, tabId, totalBytes) {
  await ensureOffscreenPreviewDocument();

  const extension = SAFE_VIDEO_EXTENSIONS.has(String(candidate.format || "").toLowerCase())
    ? String(candidate.format).toLowerCase()
    : "mp4";

  const response = await chrome.runtime.sendMessage({
    target: "media-drop-offscreen",
    type: "DOWNLOAD_RANGED_MEDIA",
    tabId,
    mediaId: item.id,
    url: candidate.url,
    filename: filenameForItem(
      {
        ...item,
        originalFilename: candidate.originalFilename || item.originalFilename
      },
      extension
    ),
    extension,
    expectedTotalBytes: Math.max(0, Number(totalBytes || 0))
  });

  if (!response?.ok || !response.started) {
    throw new Error(response?.error || "No fue posible reconstruir el video por rangos.");
  }

  broadcastSyntheticDownload(tabId, item.id, "complete", 100);
  return {
    ok: true,
    stream: true,
    filename: response.filename,
    size: response.size || null
  };
}

async function rememberCompletedMediaDownload(tracked) {
  if (typeof tracked?.mediaId !== "string") return;

  downloadedImageHistoryWriteQueue = downloadedImageHistoryWriteQueue.then(async () => {
    try {
      const stored = await chrome.storage.local.get({ [DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]: {} });
      const rawHistory = stored[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY];
      const history = rawHistory && typeof rawHistory === "object" && !Array.isArray(rawHistory)
        ? { ...rawHistory }
        : {};

      history[tracked.mediaId] = Date.now();

      const entries = Object.entries(history)
        .filter(([mediaId, timestamp]) => mediaId.startsWith("md-") && Number.isFinite(Number(timestamp)))
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, DOWNLOADED_IMAGE_HISTORY_MAX_ITEMS);

      await chrome.storage.local.set({
        [DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]: Object.fromEntries(entries)
      });
    } catch {
      // El historial visual es auxiliar: nunca debe convertir una descarga correcta en error.
    }
  });

  return downloadedImageHistoryWriteQueue;
}

function releaseStreamBlob(blobUrl) {
  if (!blobUrl) return;
  chrome.runtime.sendMessage({
    target: "media-drop-offscreen",
    type: "REVOKE_STREAM_BLOB",
    blobUrl
  }).catch(() => {});
}

async function startDownload(item, tabId, options = {}) {
  const url = options.url || item.url;
  const trackedMediaId = options.mediaId || item.id;
  const internalBlob = options.internalBlob === true;

  if (
    !item
    || typeof trackedMediaId !== "string"
    || (!internalBlob && !isAllowedDownloadUrl(url, item.type))
  ) {
    throw new Error("Este recurso todavía no se puede descargar directamente.");
  }

  const downloadId = await chrome.downloads.download({
    url,
    filename: filenameForItem(item, options.extension || null),
    conflictAction: "uniquify",
    saveAs: false
  });

  if (!Number.isInteger(downloadId)) {
    if (options.streamBlobUrl) releaseStreamBlob(options.streamBlobUrl);
    throw new Error("Edge no devolvió un identificador de descarga.");
  }

  activeDownloads.set(downloadId, {
    downloadId,
    mediaId: trackedMediaId,
    mediaType: item.type,
    tabId,
    percent: null,
    state: "in_progress",
    streamBlobUrl: options.streamBlobUrl || null
  });

  broadcastDownload(activeDownloads.get(downloadId));
  ensureProgressPolling();

  return { ok: true, downloadId };
}

function isYoutubePage(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === "youtube.com"
      || host.endsWith(".youtube.com")
      || host === "youtu.be"
      || host.endsWith(".youtu.be");
  } catch {
    return false;
  }
}

async function closeCaptureTabLater(tabId, delayMs) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  await wait(Math.max(0, Number(delayMs || 0)));
  try { await chrome.tabs.remove(tabId); } catch {}
}

async function sendPlayerCaptureBootstrap(captureTabId, job) {
  const deadline = Date.now() + PLAYER_CAPTURE_READY_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const ready = await ensureContentScript(captureTabId);
      if (ready) {
        const response = await chrome.tabs.sendMessage(captureTabId, {
          type: "MEDIA_DROP_START_PLAYER_CAPTURE",
          job
        });
        if (response?.ok && response?.started) return response;
        if (response?.error) lastError = new Error(response.error);
      }
    } catch (error) {
      lastError = error;
    }

    await wait(PLAYER_CAPTURE_READY_POLL_MS);
  }

  throw lastError || new Error("No fue posible preparar el reproductor de respaldo.");
}

async function startPlayerCaptureDownload(item, tabId) {
  const pageUrl = safeHttpUrl(item?.pageUrl);
  if (!pageUrl) {
    throw new Error("El reproductor no tiene una página válida para iniciar la captura.");
  }

  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("No hay una pestaña de origen válida para capturar el reproductor.");
  }

  const job = {
    sourceTabId: tabId,
    mediaId: item.id,
    title: cleanText(item.title || "Video", 160),
    expectedDuration: Number(item.duration || 0),
    expectedWidth: Number(item.width || 0),
    expectedHeight: Number(item.height || 0),
    pageUrl,
    captureMode: "source-tab"
  };

  // Capturamos el <video> que MediaDrop ya detectó en la pestaña original.
  // Abrir una copia de YouTube no aporta una fuente nueva y sí crea una pestaña
  // visible para el usuario. El content script puede usar captureStream() sobre
  // el reproductor existente sin navegar ni abrir ventanas auxiliares.
  broadcastSyntheticDownload(tabId, item.id, "in_progress", 0);
  await sendPlayerCaptureBootstrap(tabId, job);

  return {
    ok: true,
    stream: true,
    capture: true,
    captureMode: "source-tab",
    captureTabId: tabId
  };
}

async function startStreamDownload(item, tabId) {
  const kind = String(item.streamKind || item.format || "").toLowerCase();

  // YouTube usa MSE/DASH y URLs googlevideo firmadas/segmentadas. La detección
  // del reproductor es fiable, pero la URL observada no representa un archivo
  // único. Para YouTube capturamos el MediaStream del <video> real que ya está
  // abierto en la pestaña de origen; así evitamos abrir copias de YouTube.
  if (isYoutubePage(item.pageUrl) && item.streaming) {
    return startPlayerCaptureDownload(item, tabId);
  }

  // HLS manifest: MediaDrop downloads the best variant and assembles its
  // segments locally before handing the resulting file to Chrome/Edge.
  if (kind === "m3u8" && /^https?:/i.test(item.url)) {
    return requestHlsDownload(item, tabId);
  }

  // A blob: player is only a MediaSource façade. Resolve it to the actual
  // MP4/WebM/HLS request MediaDrop already observed in this tab.
  const candidates = resolveStreamCandidates(tabId, item);
  let lastCandidateError = null;

  for (const candidate of candidates) {
    const candidateKind = String(candidate.streamKind || candidate.format || "").toLowerCase();

    if (candidate.streaming && candidateKind === "m3u8") {
      const proxyItem = {
        ...item,
        url: candidate.url,
        format: "m3u8",
        streamKind: "m3u8",
        originalFilename: candidate.originalFilename || item.originalFilename
      };

      try {
        return await requestHlsDownload(proxyItem, tabId);
      } catch (error) {
        lastCandidateError = error;
        continue;
      }
    }

    if (!candidate.downloadable || !safeHttpUrl(candidate.url)) continue;

    try {
      const observedTotalBytes = Number(candidate.networkTotalBytes || 0);

      // GoogleVideo ya incluye en la URL firmada dos datos mucho más fiables
      // que volver a hacer fetch desde el contexto de la extensión: `mime`
      // identifica la pista y `clen` su tamaño total. Reutilizamos exactamente
      // esa URL y pedimos el rango completo mediante chrome.downloads, que usa
      // la pila de descargas del navegador y no está sujeto al fetch CORS del
      // documento offscreen.
      if (isGoogleVideoUrl(candidate.url)) {
        const hintedKind = mediaKindHintFromUrl(candidate.url);
        const observedType = String(candidate.networkContentType || "").toLowerCase();
        if (hintedKind === "audio" || observedType.startsWith("audio/")) continue;

        const encodedTotalBytes = googleVideoTotalBytes(candidate.url);
        const totalBytes = Math.max(observedTotalBytes, encodedTotalBytes);
        const fullRangeUrl = googleVideoDownloadUrl(candidate.url, totalBytes);

        const isConfirmedVideo = hintedKind === "video" || observedType.startsWith("video/");
        if (isConfirmedVideo && fullRangeUrl) {
          const extension = googleVideoExtension(candidate.url, candidate.format);
          return await startDownload(
            {
              ...item,
              url: fullRangeUrl,
              format: extension,
              originalFilename: candidate.originalFilename || item.originalFilename
            },
            tabId,
            {
              mediaId: item.id,
              url: fullRangeUrl,
              extension
            }
          );
        }

        // No volvemos a pasar un GoogleVideo por el fetch offscreen. Si esta
        // respuesta no trae suficiente evidencia/tamaño, probamos el siguiente
        // candidato observado del mismo reproductor.
        lastCandidateError = new Error(
          "La pista de YouTube detectada no expone todavía su tamaño completo; reproduce unos segundos y vuelve a intentar."
        );
        continue;
      }

      const probe = await probeRemoteStreamUrl(candidate.url);
      if (!probeLooksLikeVideo(probe)) {
        throw new Error("La respuesta asociada al reproductor no es un archivo de video válido.");
      }


      const observedResponseBytes = Number(candidate.networkResponseBytes || 0);
      const probedTotalBytes = Number(probe?.totalBytes || 0);
      const probedResponseBytes = Number(probe?.responseBytes || 0);
      const totalBytes = Math.max(observedTotalBytes, probedTotalBytes);

      if (
        item.duration >= STREAM_LONG_MEDIA_SECONDS
        && totalBytes > 0
        && totalBytes <= STREAM_MIN_VALID_DOWNLOAD_BYTES
      ) {
        throw new Error("La fuente asociada al stream es demasiado pequeña para ser el video completo.");
      }

      const observedPartial = candidate.networkPartial === true
        && observedTotalBytes > 0
        && observedResponseBytes > 0
        && observedResponseBytes < observedTotalBytes;
      const probedPartial = probe?.partial === true
        && probedTotalBytes > 0
        && probedResponseBytes > 0
        && probedResponseBytes < probedTotalBytes;

      // GoogleVideo/YouTube usa videoplayback por rangos. Nunca entregamos ese
      // URL directamente a chrome.downloads: reconstruimos la pista completa.
      const forceRangedDownload = false;

      if (
        totalBytes > STREAM_MIN_VALID_DOWNLOAD_BYTES
        && (forceRangedDownload || observedPartial || probedPartial)
      ) {
        return await requestRangedMediaDownload(item, candidate, tabId, totalBytes);
      }

      if (!(totalBytes > STREAM_MIN_VALID_DOWNLOAD_BYTES)) {
        throw new Error("No fue posible confirmar el tamaño real de la fuente de video.");
      }

      return await startDownload(
        {
          ...item,
          url: candidate.url,
          format: candidate.format,
          originalFilename: candidate.originalFilename || item.originalFilename
        },
        tabId,
        {
          mediaId: item.id,
          url: candidate.url
        }
      );
    } catch (error) {
      lastCandidateError = error;
      // El candidato de mayor puntuación puede ser un init segment o una
      // respuesta caducada. Probamos el siguiente recurso observado.
    }
  }

  // Para otros reproductores blob/MSE, si las fuentes directas fallan, usamos
  // el mismo respaldo del reproductor. Esto mantiene el comportamiento general
  // y evita crear parches por sitio.
  if ((kind === "blob" || kind === "stream" || item.source === "stream-player") && safeHttpUrl(item.pageUrl)) {
    try {
      return await startPlayerCaptureDownload(item, tabId);
    } catch (captureError) {
      if (!lastCandidateError) lastCandidateError = captureError;
    }
  }

  if (lastCandidateError && candidates.length) {
    throw lastCandidateError;
  }

  if (kind === "mpd") {
    throw new Error("Este stream DASH no expone todavía un archivo de video directo descargable.");
  }

  throw new Error(
    "MediaDrop detectó el reproductor, pero todavía no encontró el MP4/WebM o playlist HLS que lo alimenta. Reproduce unos segundos el video y vuelve a intentar."
  );
}

function broadcastDownload(download) {
  if (!download) return;
  const message = {
    type: "DOWNLOAD_PROGRESS",
    downloadId: download.downloadId,
    mediaId: download.mediaId,
    state: download.state,
    percent: download.percent,
    bytesReceived: download.bytesReceived ?? 0,
    totalBytes: download.totalBytes ?? -1,
    error: download.error || null
  };

  sendToPage(download.tabId, message);
  postToPanels(download.tabId, message);
}

function ensureProgressPolling() {
  if (progressTimer) return;
  progressTimer = setInterval(pollDownloadProgress, PROGRESS_POLL_MS);
  pollDownloadProgress();
}

function stopProgressPollingIfIdle() {
  if (activeDownloads.size || !progressTimer) return;
  clearInterval(progressTimer);
  progressTimer = null;
}

async function pollDownloadProgress() {
  if (progressPollInFlight) return;
  progressPollInFlight = true;
  const downloads = [...activeDownloads.values()];
  if (!downloads.length) {
    progressPollInFlight = false;
    stopProgressPollingIfIdle();
    return;
  }

  try {
    await Promise.all(downloads.map(async (tracked) => {
      try {
        const [item] = await chrome.downloads.search({ id: tracked.downloadId });
        if (!item || !activeDownloads.has(tracked.downloadId)) return;

        tracked.bytesReceived = Number(item.bytesReceived || 0);
        tracked.totalBytes = Number(item.totalBytes || -1);
        tracked.state = item.state || tracked.state;
        tracked.error = item.error || null;
        tracked.percent = tracked.totalBytes > 0
          ? Math.min(100, Math.max(0, Math.round((tracked.bytesReceived / tracked.totalBytes) * 100)))
          : null;

        broadcastDownload(tracked);

        if (tracked.state === "complete") {
          await rememberCompletedMediaDownload(tracked);
          activeDownloads.delete(tracked.downloadId);
        } else if (tracked.state === "interrupted") {
          activeDownloads.delete(tracked.downloadId);
        }
      } catch {
        // onChanged seguirá notificando la finalización aunque una consulta puntual falle.
      }
    }));
  } finally {
    progressPollInFlight = false;
  }

  stopProgressPollingIfIdle();
}

chrome.downloads.onChanged.addListener(async (delta) => {
  const tracked = activeDownloads.get(delta.id);
  if (!tracked) return;

  if (delta.state?.current === "complete") {
    tracked.state = "complete";
    tracked.percent = 100;
    broadcastDownload(tracked);
    rememberCompletedMediaDownload(tracked).catch(() => {});
    if (tracked.streamBlobUrl) releaseStreamBlob(tracked.streamBlobUrl);
    activeDownloads.delete(delta.id);
    stopProgressPollingIfIdle();
    return;
  }

  if (delta.state?.current === "interrupted" || delta.error?.current) {
    tracked.state = "interrupted";
    tracked.error = delta.error?.current || "La descarga fue interrumpida.";
    broadcastDownload(tracked);
    if (tracked.streamBlobUrl) releaseStreamBlob(tracked.streamBlobUrl);
    activeDownloads.delete(delta.id);
    stopProgressPollingIfIdle();
  }
});

chrome.downloads.onErased.addListener((downloadId) => {
  const tracked = activeDownloads.get(downloadId);
  if (tracked?.streamBlobUrl) releaseStreamBlob(tracked.streamBlobUrl);
  activeDownloads.delete(downloadId);
  stopProgressPollingIfIdle();
});

// Crear (o reutilizar) el documento offscreen existente para seguir la
// preferencia de Chrome incluso con el panel de MediaDrop cerrado.
function startChromeAppearanceObserver() {
  ensureOffscreenPreviewDocument().catch((error) => {
    console.warn("MediaDrop: no se pudo iniciar la detección de apariencia", error);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  applyActionIcon().catch(console.warn);
  startChromeAppearanceObserver();
});
chrome.runtime.onStartup.addListener(() => {
  applyActionIcon().catch(console.warn);
  startChromeAppearanceObserver();
});
installIconPreferenceListener();
applyActionIcon().catch((error) => console.warn("MediaDrop: icono inicial", error));
startChromeAppearanceObserver();
