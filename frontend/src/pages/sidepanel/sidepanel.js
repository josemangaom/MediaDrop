// MediaDrop · UI unificada para PC y Mobile
/* =========================================================
   MEDIA DROP · LOGICA DEL FLYOUT
   Orden semantico de referencia:
   background · iconos · dock izquierdo · dock derecho · media box ·
   media description · media download icon · menu de settings · popup
   Nota: el orden de ejecucion JS se conserva para no alterar funcionalidad.
   ========================================================= */

// ============================================================
// CONSTANTES · PREVIEW DE VIDEO
// ============================================================

const VIDEO_HOVER_DELAY_MS = 140;
const VIDEO_PLAYER_HOVER_AUTOPLAY = true;
const VIDEO_PLAYER_PAUSE_ON_MOUSE_LEAVE = false;
const VIDEO_PLAYER_PROGRESS_MAX = 1000;
const VIDEO_PLAYER_DEFAULT_VOLUME = 1;
const VIDEO_PLAYER_DEFAULT_RATE = 1;
const VIDEO_PLAYER_FALLBACK_TEXT = "MediaDrop detectó el video, pero esta fuente no puede reproducirse directamente en el flyout.";
const INLINE_VIDEO_PROTOCOLS = new Set(["http:", "https:"]);
const NATIVE_HLS_MIME = "application/vnd.apple.mpegurl";

// ============================================================
// CONSTANTES · FILTRO DE VIDEO ÚTIL
// ============================================================

// Los recursos de red se conservan internamente para resolver descargas,
// pero el flyout solo muestra videos con evidencia visual/reproducible real.
const VIDEO_FILTER_PLAYER_SOURCES = new Set(["dom", "stream-player", "instagram"]);
const VIDEO_FILTER_NETWORK_SOURCES = new Set(["network", "network-stream"]);
const VIDEO_FILTER_INTRINSIC_RESOLUTION = /video-metadata|offscreen-video|decoded-frame/i;
const VIDEO_FILTER_PREVIEW_PROTOCOLS = /^(?:data:image\/|https?:)/i;

const mediaItems = new Map();
const downloadProgress = new Map();
const downloadedImageHistory = new Set();
const mediaPageKeyCache = new Map();

const content = document.querySelector("#media-content");
const mediaSectionTitle = document.querySelector("#media-section-title");
const status = document.querySelector("#live-status");
const statusText = document.querySelector("#status-text");
const statusDownloadAllButton = document.querySelector("#status-download-all");
const rescanButton = document.querySelector("#rescan-button");
const composerMenuButton = document.querySelector("#composer-menu-button");
const mediaDock = document.querySelector(".media-dock");
const quickImagesButton = document.querySelector("#quick-images");
const quickVideosButton = document.querySelector("#quick-videos");
const quickRescanButton = document.querySelector("#quick-rescan");
const themeButton = document.querySelector("#theme-button");
const appMenu = document.querySelector("#app-menu");
const menuDownloadAllButton = document.querySelector("#menu-download-all");
const menuClearButton = document.querySelector("#menu-clear");
const menuHoverToggle = document.querySelector("#menu-hover-toggle");
const bulkDialog = document.querySelector("#bulk-dialog");
const bulkDialogMessage = document.querySelector("#bulk-dialog-message");
const bulkCancelButton = document.querySelector("#bulk-cancel");
const bulkConfirmButton = document.querySelector("#bulk-confirm");
const toast = document.querySelector("#toast");
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const initialLoader = document.querySelector("#initial-loader");
const videoPlayerBackdrop = document.querySelector("#video-player-backdrop");
const videoPlayerStage = document.querySelector(".video-player-stage");
const videoPlayerElement = document.querySelector("#video-player-element");
const videoPlayerFallback = document.querySelector("#video-player-fallback");
const videoPlayerCloseButton = document.querySelector("#video-player-close");
const videoPlayerTitle = document.querySelector("#video-player-title");
const videoPlayerDetails = document.querySelector("#video-player-details");
const videoPlayerDownloadButton = document.querySelector("#video-player-download");
const videoPlayerControls = document.querySelector("#video-player-controls");
const videoPlayerPlayButton = document.querySelector("#video-player-play");
const videoPlayerCenterButton = document.querySelector("#video-player-center-toggle");
const videoPlayerProgress = document.querySelector("#video-player-progress");
const videoPlayerVolumeButton = document.querySelector("#video-player-volume");
const videoPlayerVolumeSlider = document.querySelector("#video-player-volume-slider");
const videoPlayerTime = document.querySelector("#video-player-time");
const videoPlayerPipButton = document.querySelector("#video-player-pip");
const videoPlayerFullscreenButton = document.querySelector("#video-player-fullscreen");
const videoPlayerMoreButton = document.querySelector("#video-player-more");
const videoPlayerSpeedLabel = document.querySelector("#video-player-speed-label");
const videoPlayerMoreMenu = document.querySelector("#video-player-more-menu");
const imagePlayerBackdrop = document.querySelector("#image-player-backdrop");
const imagePlayerElement = document.querySelector("#image-player-element");
const imagePlayerFallback = document.querySelector("#image-player-fallback");
const imagePlayerCloseButton = document.querySelector("#image-player-close");
const imagePlayerTitle = document.querySelector("#image-player-title");
const imagePlayerDetails = document.querySelector("#image-player-details");
const imagePlayerDownloadButton = document.querySelector("#image-player-download");

const cardNodes = new Map();
const QUICK_IMAGES_ICON_MARKUP = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"/></svg>`;
const QUICK_VIDEOS_ICON_MARKUP = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="m160-800 80 160h120l-80-160h80l80 160h120l-80-160h80l80 160h120l-80-160h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0 0v320-320Z"/></svg>`;
const QUICK_RESCAN_ICON_MARKUP = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>`;
const DOWNLOAD_ICON_TEMPLATE = document.createElement("template");
DOWNLOAD_ICON_TEMPLATE.innerHTML = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z"/></svg>`;
const RETRY_ICON_TEMPLATE = document.createElement("template");
RETRY_ICON_TEMPLATE.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.35 5.65"></path><path d="M20 5v6h-6"></path></svg>`;
const CHECK_ICON_TEMPLATE = document.createElement("template");
CHECK_ICON_TEMPLATE.innerHTML = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>`;

function applyQuickActionIcons() {
  const quickImagesIcon = quickImagesButton?.querySelector('.empty-action-icon');
  const quickVideosIcon = quickVideosButton?.querySelector('.empty-action-icon');
  const quickRescanIcon = quickRescanButton?.querySelector('.empty-action-icon');
  if (quickImagesIcon) quickImagesIcon.innerHTML = QUICK_IMAGES_ICON_MARKUP;
  if (quickVideosIcon) quickVideosIcon.innerHTML = QUICK_VIDEOS_ICON_MARKUP;
  if (quickRescanIcon) quickRescanIcon.innerHTML = QUICK_RESCAN_ICON_MARKUP;
}

applyQuickActionIcons();

let activeType = "image";
let currentTabId = null;
let panelPort = null;
let renderRequested = false;
let reconnectTimer = null;
let toastTimer = null;
let pageUnavailableReason = "";
let bulkDialogResolver = null;
let dialogReturnFocus = null;
let bulkDownloadRunning = false;
let renderedType = null;
let initialScanPending = true;
let hoverPreviewTimer = null;
let hoverPreviewVideo = null;
let hoverPreviewCard = null;
let openVideoPlayerMediaId = null;
let videoPlayerReturnFocus = null;
let openImagePlayerMediaId = null;
let imagePlayerReturnFocus = null;

const THEME_STORAGE_KEY = "mediaDropTheme";
const THEME_DARK = "dark";
const THEME_LIGHT = "light";
const DEFAULT_THEME = THEME_DARK;

// ============================================================
// CONSTANTES · HISTORIAL DE IMÁGENES DESCARGADAS
// ============================================================

const DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY = "downloadedImageHistoryV1";

function normalizeTheme(theme) {
  return theme === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
}

function applyTheme(theme) {
  const nextTheme = normalizeTheme(theme);
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  const nextLabel = nextTheme === THEME_DARK
    ? "Cambiar a modo claro"
    : "Cambiar a modo oscuro";

  if (themeButton) {
    themeButton.setAttribute("aria-label", nextLabel);
    themeButton.title = nextLabel;
    themeButton.setAttribute("aria-pressed", String(nextTheme === THEME_DARK));
  }
}

let themeTransitionRunning = false;
const reducedThemeMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;

function prefersReducedThemeMotion() {
  return reducedThemeMotionQuery?.matches === true;
}

function getThemeRevealGeometry() {
  const rect = themeButton?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const farthestX = Math.max(x, window.innerWidth - x);
  const farthestY = Math.max(y, window.innerHeight - y);

  return {
    x,
    y,
    radius: Math.hypot(farthestX, farthestY) + 2,
  };
}

async function toggleTheme() {
  if (themeTransitionRunning) return;

  const currentTheme = normalizeTheme(document.documentElement.dataset.theme);
  const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
  const canAnimateTheme = typeof document.startViewTransition === "function"
    && !prefersReducedThemeMotion();

  if (!canAnimateTheme) {
    applyTheme(nextTheme);
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
    return;
  }

  themeTransitionRunning = true;
  const { x, y, radius } = getThemeRevealGeometry();
  const root = document.documentElement;
  root.classList.add("theme-transition-running");
  root.style.setProperty("--theme-reveal-x", `${x}px`);
  root.style.setProperty("--theme-reveal-y", `${y}px`);

  try {
    const transition = document.startViewTransition(() => {
      applyTheme(nextTheme);
    });

    await transition.ready;

    const revealAnimation = root.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${radius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 680,
        easing: "cubic-bezier(.22, 1, .36, 1)",
        fill: "both",
        pseudoElement: "::view-transition-new(root)",
      },
    );

    await Promise.allSettled([
      transition.finished,
      revealAnimation.finished,
      chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme }),
    ]);
  } catch (error) {
    applyTheme(nextTheme);
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
  } finally {
    themeTransitionRunning = false;
    root.classList.remove("theme-transition-running");
    root.style.removeProperty("--theme-reveal-x");
    root.style.removeProperty("--theme-reveal-y");
  }
}



function updateHoverToggle(enabled) {
  const visible = enabled !== false;
  menuHoverToggle?.setAttribute("aria-checked", String(visible));
  if (menuHoverToggle) {
    menuHoverToggle.title = visible
      ? "El botón de descarga aparece al pasar el mouse sobre un medio"
      : "El botón de descarga flotante está oculto";
  }
}

async function toggleHoverDownloadButton() {
  const stored = await chrome.storage.local.get({ hoverDownloadButtonEnabled: true });
  const nextValue = stored.hoverDownloadButtonEnabled === false;
  await chrome.storage.local.set({ hoverDownloadButtonEnabled: nextValue });
  updateHoverToggle(nextValue);
}

const MEDIA_DOCK_INDICATOR_INDEX = Object.freeze({
  video: 0,
  image: 1,
  settings: 2
});

function setMediaDockIndicator(target) {
  if (!mediaDock) return;
  const index = MEDIA_DOCK_INDICATOR_INDEX[target];
  if (!Number.isInteger(index)) return;

  const previousIndex = Number.parseInt(mediaDock.dataset.indicatorIndex || "1", 10);
  const travelDistance = Math.abs(index - previousIndex);
  const duration = travelDistance > 1 ? 400 : 300;

  mediaDock.style.setProperty("--media-dock-indicator-duration", `${duration}ms`);
  mediaDock.style.setProperty("--media-dock-indicator-index", String(index));
  mediaDock.dataset.indicatorIndex = String(index);
  mediaDock.classList.toggle("is-settings-active", target === "settings");
}

function setActiveType(nextType) {
  if (!["image", "video"].includes(nextType)) return;
  stopHoverPreview();
  if (nextType !== "video") closeVideoPlayer();
  if (nextType !== "image") closeImagePlayer();
  activeType = nextType;
  setMediaDockIndicator(activeType);
  if (mediaSectionTitle) mediaSectionTitle.textContent = activeType === "image" ? "Fotos" : "Videos";
  for (const tabButton of tabButtons) {
    const selected = tabButton.dataset.tab === activeType;
    tabButton.classList.toggle("is-active", selected);
    tabButton.setAttribute("aria-selected", String(selected));
  }
  chrome.storage.local.set({ preferredMediaTab: activeType }).catch(() => {});
  scheduleRender();
}

function connectPanel() {
  if (panelPort) return;
  panelPort = chrome.runtime.connect({ name: "media-drop-panel" });

  panelPort.onMessage.addListener(handlePanelMessage);
  panelPort.onDisconnect.addListener(() => {
    panelPort = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connectPanel();
      subscribeToActiveTab();
    }, 500);
  });

  if (Number.isInteger(currentTabId)) {
    panelPort.postMessage({ type: "SUBSCRIBE_TAB", tabId: currentTabId });
  }
}

function finishInitialScan() {
  if (!initialScanPending) return;
  initialScanPending = false;
  initialLoader?.classList.add("is-hidden");
}

function handlePanelMessage(message) {
  if (message?.type === "MEDIA_SNAPSHOT") {
    mediaItems.clear();
    upsertItems(message.items);
    finishInitialScan();
    setAvailableStatus();
    return;
  }

  if (message?.type === "MEDIA_UPSERTS") {
    upsertItems(message.items);
    finishInitialScan();
    setAvailableStatus();
    return;
  }

  if (message?.type === "MEDIA_RESET") {
    stopHoverPreview();
    closeVideoPlayer();
    closeImagePlayer();
    mediaItems.clear();
    downloadProgress.clear();
    scheduleRender();
    setAvailableStatus();
    return;
  }

  if (message?.type === "PAGE_UNAVAILABLE") {
    finishInitialScan();
    setUnavailableStatus(message.reason);
    return;
  }

  if (message?.type === "DOWNLOAD_PROGRESS") {
    updateDownloadProgress(message);
  }
}

function upsertItems(items) {
  for (const item of items || []) {
    if (!item?.id) continue;
    mediaItems.set(item.id, { ...mediaItems.get(item.id), ...item });
  }
  scheduleRender();
  refreshOpenVideoPlayer();
  refreshOpenImagePlayer();
}

function scheduleRender() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame(() => {
    renderRequested = false;
    render();
  });
}

function hasUsableVideoPreview(item) {
  return item?.type === "video"
    && typeof item.previewUrl === "string"
    && VIDEO_FILTER_PREVIEW_PROTOCOLS.test(item.previewUrl);
}

function hasIntrinsicVideoEvidence(item) {
  return item?.type === "video"
    && Number(item.width) > 0
    && Number(item.height) > 0
    && VIDEO_FILTER_INTRINSIC_RESOLUTION.test(String(item.resolutionSource || ""));
}

function isPlayerBackedVideo(item) {
  if (item?.type !== "video" || !VIDEO_FILTER_PLAYER_SOURCES.has(String(item.source || ""))) return false;

  return hasUsableVideoPreview(item)
    || Number(item.width) > 0
    || Number(item.height) > 0
    || Number(item.duration) > 0
    || item.streaming === true;
}

function hasStrongNetworkVideoEvidence(item) {
  if (item?.type !== "video" || !VIDEO_FILTER_NETWORK_SOURCES.has(String(item.source || ""))) return false;

  const contentType = String(item.networkContentType || "").toLowerCase();
  const kind = String(item.streamKind || item.format || "").toLowerCase();

  // Estas señales ya provienen de una respuesta HTTP observada por webRequest
  // o de un manifest de streaming real. No hace falta ocultarlas mientras llega
  // una miniatura o la metadata decodificada. Segmentos m4s/ts siguen filtrados
  // desde el detector y no entran aquí.
  if (contentType.startsWith("video/")) return true;
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(kind)) return true;
  return item.streaming === true && ["m3u8", "mpd"].includes(kind);
}

function isUsefulVideo(item) {
  if (item?.type !== "video") return false;

  // Un frame/poster válido o metadata intrínseca decodificada son las señales
  // más fuertes de que la URL representa un video realmente utilizable.
  if (hasUsableVideoPreview(item) || hasIntrinsicVideoEvidence(item)) return true;

  // Un <video> real de la página también es confiable aunque use blob/MediaSource.
  if (isPlayerBackedVideo(item)) return true;

  // Una respuesta HTTP inequívocamente de video o un manifest HLS/DASH real
  // también puede mostrarse antes de que termine el trabajo de preview/metadata.
  if (hasStrongNetworkVideoEvidence(item)) return true;

  // JSON-LD puede describir videos sin un elemento <video> visible. Solo se
  // muestra cuando trae dimensiones reales; de lo contrario espera validación.
  if (String(item.source || "") === "json-ld") {
    return Number(item.width) > 0 && Number(item.height) > 0;
  }

  return false;
}

function mediaPageKey(item) {
  const rawPageUrl = String(item?.pageUrl || "");
  if (mediaPageKeyCache.has(rawPageUrl)) return mediaPageKeyCache.get(rawPageUrl);

  let key = rawPageUrl;
  try {
    key = new URL(rawPageUrl).origin;
  } catch {}

  if (mediaPageKeyCache.size >= 512) mediaPageKeyCache.clear();
  mediaPageKeyCache.set(rawPageUrl, key);
  return key;
}

function visibleMediaItems(type = null) {
  const candidates = [...mediaItems.values()]
    .filter((item) => !type || item.type === type);

  if (type && type !== "video") return candidates;

  const validated = candidates.filter((item) => item.type !== "video" || isUsefulVideo(item));
  const playerPages = new Set(
    validated
      .filter(isPlayerBackedVideo)
      .map(mediaPageKey)
      .filter(Boolean)
  );

  if (!playerPages.size) return validated;

  return validated.filter((item) => {
    if (item.type !== "video") return true;
    if (!VIDEO_FILTER_NETWORK_SOURCES.has(String(item.source || ""))) return true;

    // Si ya existe el reproductor real para esa página, los requests de red
    // quedan como soporte interno de descarga y no generan tarjetas duplicadas.
    return !playerPages.has(mediaPageKey(item));
  });
}

function counts(items = null) {
  let images = 0;
  let videos = 0;
  const source = Array.isArray(items) ? items : visibleMediaItems();
  for (const item of source) {
    if (item.type === "image") images += 1;
    if (item.type === "video") videos += 1;
  }
  return { images, videos };
}

function setAvailableStatus() {
  status.classList.remove("is-unavailable");
  pageUnavailableReason = "";
  updateStatusText();
}

function setUnavailableStatus(message) {
  status.classList.add("is-unavailable");
  pageUnavailableReason = message || "Página no disponible";
  statusText.textContent = pageUnavailableReason;
  scheduleRender();
}

function updateStatusText(visibleItems = null) {
  const nextText = pageUnavailableReason || (() => {
    const totals = counts(visibleItems);
    const amount = activeType === "image" ? totals.images : totals.videos;
    const label = activeType === "image"
      ? amount === 1 ? "imagen" : "imágenes"
      : amount === 1 ? "video" : "videos";
    return `Detectando en vivo · ${amount} ${label}`;
  })();

  if (statusText.textContent !== nextText) statusText.textContent = nextText;
}

function render() {
  const visibleItems = visibleMediaItems();
  updateStatusText(visibleItems);

  const items = visibleItems
    .filter((item) => item.type === activeType)
    .sort((a, b) => Number(b.detectedAt || 0) - Number(a.detectedAt || 0));

  const hasDownloadableItems = items.some((item) => item.downloadable || item.streaming);
  if (statusDownloadAllButton) statusDownloadAllButton.disabled = bulkDownloadRunning || !hasDownloadableItems;
  document.body.classList.toggle("has-items", items.length > 0);
  menuDownloadAllButton.disabled = bulkDownloadRunning || !hasDownloadableItems;

  if (initialScanPending) return;

  if (!items.length) {
    cardNodes.clear();
    renderedType = activeType;
    if (!content.firstElementChild?.classList.contains("empty-state")) {
      content.replaceChildren(createEmptyState());
    }
    return;
  }

  let list = content.firstElementChild;
  const expectedClass = activeType === "image" ? "photo-grid" : "video-list";
  if (renderedType !== activeType || !list?.classList.contains(expectedClass)) {
    cardNodes.clear();
    list = document.createElement("div");
    list.className = expectedClass;
    content.replaceChildren(list);
    renderedType = activeType;
  }

  const desiredIds = new Set(items.map((item) => item.id));
  for (const [id, card] of cardNodes) {
    if (desiredIds.has(id)) continue;
    card.remove();
    cardNodes.delete(id);
  }

  const orderedCards = [];
  for (const item of items) {
    let card = cardNodes.get(item.id);
    if (!card) {
      card = createMediaCard(item);
      cardNodes.set(item.id, card);
    } else {
      updateMediaCard(card, item);
    }
    orderedCards.push(card);
  }

  // Reutiliza los mismos nodos: no vuelve a crear imágenes ni reinicia miniaturas.
  for (let index = 0; index < orderedCards.length; index += 1) {
    const card = orderedCards[index];
    const current = list.children[index];
    if (current !== card) list.insertBefore(card, current || null);
  }
}

function createEmptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";

  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.innerHTML = activeType === "image"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="m5.5 18 4.7-4.8 3.1 3.1 2.1-2.1 3.1 3.8"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="m10 9 5 3-5 3Z"></path></svg>`;

  const title = document.createElement("h2");
  title.textContent = activeType === "image" ? "Aún no hay fotos" : "Aún no hay vídeos";

  const description = document.createElement("p");
  description.textContent = "Navega o desplázate por la página. Los medios nuevos aparecerán aquí automáticamente.";

  wrapper.append(icon, title, description);
  return wrapper;
}

function learnImageDimensionsFromPreview(mediaId, preview) {
  if (!(preview instanceof HTMLImageElement)) return;

  const item = mediaItems.get(mediaId);
  if (!item || item.type !== "image" || (item.width > 0 && item.height > 0)) return;

  const width = Number(preview.naturalWidth || 0);
  const height = Number(preview.naturalHeight || 0);
  if (width < 1 || height < 1) return;

  mediaItems.set(mediaId, {
    ...item,
    width: Math.round(width),
    height: Math.round(height),
    resolutionSource: "loaded-preview"
  });
  scheduleRender();
}

// ============================================================
// PREVIEW ANIMADO + MINI REPRODUCTOR
// ============================================================

function safeInlineVideoUrl(item, testVideo = null) {
  if (!item || item.type !== "video") return "";
  const rawUrl = String(item.url || "").trim();
  if (!rawUrl) return "";

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "";
  }

  if (!INLINE_VIDEO_PROTOCOLS.has(parsed.protocol)) return "";

  const kind = String(item.streamKind || item.format || "").toLowerCase();
  if (kind === "mpd" || kind === "blob" || kind === "stream") return "";

  if (kind === "m3u8") {
    const video = testVideo || document.createElement("video");
    return video.canPlayType(NATIVE_HLS_MIME) ? rawUrl : "";
  }

  if (item.streaming) return "";
  return rawUrl;
}

function stopHoverPreview() {
  clearTimeout(hoverPreviewTimer);
  hoverPreviewTimer = null;

  if (hoverPreviewVideo) {
    hoverPreviewVideo.pause();
    hoverPreviewVideo.removeAttribute("src");
    try { hoverPreviewVideo.load(); } catch {}
    hoverPreviewVideo.remove();
  }

  hoverPreviewCard?.classList.remove("is-hover-playing");
  hoverPreviewVideo = null;
  hoverPreviewCard = null;
}

function startHoverPreview(card, item) {
  if (!card || !item || item.type !== "video" || !videoPlayerBackdrop?.hidden) return;

  clearTimeout(hoverPreviewTimer);
  hoverPreviewTimer = setTimeout(() => {
    const frame = card.querySelector(".media-frame");
    if (!frame || !card.isConnected) return;

    stopHoverPreview();

    const preview = document.createElement("video");
    const previewUrl = safeInlineVideoUrl(item, preview);
    if (!previewUrl) return;

    preview.className = "hover-video-preview";
    preview.muted = true;
    preview.loop = true;
    preview.playsInline = true;
    preview.preload = "metadata";
    preview.src = previewUrl;

    preview.addEventListener("playing", () => {
      preview.classList.add("is-playing");
      card.classList.add("is-hover-playing");
    }, { once: true });

    preview.addEventListener("error", () => {
      if (hoverPreviewVideo === preview) stopHoverPreview();
    }, { once: true });

    frame.append(preview);
    hoverPreviewVideo = preview;
    hoverPreviewCard = card;

    preview.play().catch(() => {
      if (hoverPreviewVideo === preview) stopHoverPreview();
    });
  }, VIDEO_HOVER_DELAY_MS);
}

function videoPlayerDetailParts(item) {
  const parts = [];
  if (item.width && item.height) parts.push(`${item.width} × ${item.height}`);
  if (Number.isFinite(item.duration) && item.duration > 0) parts.push(formatDuration(item.duration));
  parts.push(item.streaming ? streamFormatLabel(item) : String(item.format || "video").toUpperCase());
  return parts;
}

function renderVideoPlayerDetails(item) {
  if (!videoPlayerDetails) return;
  videoPlayerDetails.replaceChildren();

  for (const [index, part] of videoPlayerDetailParts(item).entries()) {
    if (index > 0) {
      const divider = document.createElement("span");
      divider.className = "detail-divider";
      videoPlayerDetails.append(divider);
    }
    const node = document.createElement("span");
    node.textContent = part;
    videoPlayerDetails.append(node);
  }
}

function formatPlayerClock(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function setRangeProgress(input, ratio) {
  if (!input) return;
  const percent = Math.max(0, Math.min(1, Number(ratio) || 0)) * 100;
  input.style.setProperty("--range-progress", `${percent}%`);
}

function closeVideoPlayerMoreMenu() {
  if (videoPlayerMoreMenu) videoPlayerMoreMenu.hidden = true;
  videoPlayerMoreButton?.setAttribute("aria-expanded", "false");
}

function syncVideoPlayerControls() {
  if (!videoPlayerElement) return;

  const duration = Number.isFinite(videoPlayerElement.duration) && videoPlayerElement.duration > 0
    ? videoPlayerElement.duration
    : 0;
  const currentTime = Math.max(0, Number(videoPlayerElement.currentTime) || 0);
  const ratio = duration > 0 ? currentTime / duration : 0;

  if (videoPlayerProgress) {
    videoPlayerProgress.max = String(VIDEO_PLAYER_PROGRESS_MAX);
    videoPlayerProgress.value = String(Math.round(ratio * VIDEO_PLAYER_PROGRESS_MAX));
    videoPlayerProgress.disabled = duration <= 0;
    setRangeProgress(videoPlayerProgress, ratio);
  }

  if (videoPlayerTime) {
    videoPlayerTime.textContent = `${formatPlayerClock(currentTime)} / ${formatPlayerClock(duration)}`;
  }

  const isPlaying = !videoPlayerElement.paused && !videoPlayerElement.ended;
  videoPlayerStage?.classList.toggle("is-playing", isPlaying);
  videoPlayerPlayButton?.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
  if (videoPlayerPlayButton) videoPlayerPlayButton.title = isPlaying ? "Pausar" : "Reproducir";
  videoPlayerCenterButton?.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
  if (videoPlayerCenterButton) videoPlayerCenterButton.title = isPlaying ? "Pausar" : "Reproducir";

  const isMuted = videoPlayerElement.muted || videoPlayerElement.volume <= 0;
  videoPlayerStage?.classList.toggle("is-muted", isMuted);
  videoPlayerVolumeButton?.setAttribute("aria-label", isMuted ? "Activar sonido" : "Silenciar");
  if (videoPlayerVolumeButton) videoPlayerVolumeButton.title = isMuted ? "Activar sonido" : "Silenciar";

  if (videoPlayerVolumeSlider) {
    const volume = Math.max(0, Math.min(1, Number(videoPlayerElement.volume) || 0));
    videoPlayerVolumeSlider.value = String(volume);
    setRangeProgress(videoPlayerVolumeSlider, isMuted ? 0 : volume);
  }

  const currentRate = Number(videoPlayerElement.playbackRate || VIDEO_PLAYER_DEFAULT_RATE);
  if (videoPlayerSpeedLabel) {
    videoPlayerSpeedLabel.textContent = Number.isInteger(currentRate) ? `${currentRate}×` : `${currentRate.toFixed(1)}×`;
  }

  videoPlayerMoreMenu?.querySelectorAll('[data-video-action="speed"]').forEach((button) => {
    const speed = Number(button.dataset.videoSpeed || 0);
    button.classList.toggle("is-active", Math.abs(speed - currentRate) < 0.001);
  });
}

function resetVideoPlayerControls() {
  closeVideoPlayerMoreMenu();
  videoPlayerStage?.classList.remove("is-playing", "is-muted");
  if (videoPlayerProgress) {
    videoPlayerProgress.value = "0";
    videoPlayerProgress.disabled = true;
    setRangeProgress(videoPlayerProgress, 0);
  }
  if (videoPlayerVolumeSlider) {
    videoPlayerVolumeSlider.value = String(VIDEO_PLAYER_DEFAULT_VOLUME);
    setRangeProgress(videoPlayerVolumeSlider, VIDEO_PLAYER_DEFAULT_VOLUME);
  }
  if (videoPlayerTime) videoPlayerTime.textContent = "0:00 / 0:00";
  if (videoPlayerSpeedLabel) videoPlayerSpeedLabel.textContent = "1×";
  videoPlayerCenterButton?.setAttribute("aria-label", "Reproducir");
  if (videoPlayerCenterButton) videoPlayerCenterButton.title = "Reproducir";
}

async function toggleVideoPlayerPlayback() {
  if (!videoPlayerElement || videoPlayerElement.hidden) return;
  if (videoPlayerElement.paused || videoPlayerElement.ended) {
    await videoPlayerElement.play().catch(() => {});
  } else {
    videoPlayerElement.pause();
  }
  syncVideoPlayerControls();
}

function seekVideoPlayerFromControl() {
  if (!videoPlayerElement || !videoPlayerProgress) return;
  const duration = Number(videoPlayerElement.duration || 0);
  if (!(duration > 0)) return;
  const ratio = Number(videoPlayerProgress.value || 0) / VIDEO_PLAYER_PROGRESS_MAX;
  videoPlayerElement.currentTime = Math.max(0, Math.min(duration, duration * ratio));
  syncVideoPlayerControls();
}

function setVideoPlayerVolumeFromControl() {
  if (!videoPlayerElement || !videoPlayerVolumeSlider) return;
  const volume = Math.max(0, Math.min(1, Number(videoPlayerVolumeSlider.value || 0)));
  videoPlayerElement.volume = volume;
  videoPlayerElement.muted = volume <= 0;
  syncVideoPlayerControls();
}

function toggleVideoPlayerMute() {
  if (!videoPlayerElement) return;
  if (videoPlayerElement.muted || videoPlayerElement.volume <= 0) {
    if (videoPlayerElement.volume <= 0) videoPlayerElement.volume = VIDEO_PLAYER_DEFAULT_VOLUME;
    videoPlayerElement.muted = false;
  } else {
    videoPlayerElement.muted = true;
  }
  syncVideoPlayerControls();
}

async function toggleVideoPlayerFullscreen() {
  if (!videoPlayerStage || !videoPlayerElement) return;

  // Si por compatibilidad el navegador permitió Fullscreen API dentro del
  // popup, conservamos también la salida tradicional.
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch {}
    return;
  }

  const item = mediaItems.get(openVideoPlayerMediaId);
  if (!item || videoPlayerElement.hidden) return;

  const playableUrl = String(
    videoPlayerElement.currentSrc
    || videoPlayerElement.src
    || safeInlineVideoUrl(item, videoPlayerElement)
    || ""
  ).trim();
  if (!playableUrl) return;

  const token = `mediaDropFullscreen:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const payload = {
    item,
    tabId: currentTabId,
    playableUrl,
    poster: String(item.previewUrl || ""),
    currentTime: Number(videoPlayerElement.currentTime || 0),
    paused: Boolean(videoPlayerElement.paused),
    muted: Boolean(videoPlayerElement.muted),
    volume: Number(videoPlayerElement.volume),
    playbackRate: Number(videoPlayerElement.playbackRate || VIDEO_PLAYER_DEFAULT_RATE)
  };

  try {
    await chrome.storage.session.set({ [token]: payload });
    const fullscreenUrl = chrome.runtime.getURL(`frontend/src/pages/player/fullscreen-player.html#${encodeURIComponent(token)}`);
    await chrome.windows.create({
      url: fullscreenUrl,
      type: "popup",
      state: "fullscreen",
      focused: true
    });
  } catch {
    try { await chrome.storage.session.remove(token); } catch {}

    // Respaldo para navegadores Chromium que sí permitan Fullscreen API
    // directamente en la página de la extensión.
    try { await videoPlayerStage.requestFullscreen(); } catch {}
  }
}

async function toggleVideoPlayerPictureInPicture() {
  if (!videoPlayerElement || videoPlayerElement.hidden || !document.pictureInPictureEnabled) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await videoPlayerElement.requestPictureInPicture();
  } catch {}
}

function releaseVideoPlayerSource() {
  if (!videoPlayerElement) return;
  videoPlayerElement.pause();
  videoPlayerElement.removeAttribute("src");
  videoPlayerElement.removeAttribute("poster");
  videoPlayerElement.playbackRate = VIDEO_PLAYER_DEFAULT_RATE;
  videoPlayerElement.volume = VIDEO_PLAYER_DEFAULT_VOLUME;
  videoPlayerElement.muted = false;
  try { videoPlayerElement.load(); } catch {}
  resetVideoPlayerControls();
}

function showVideoPlayerFallback(message = VIDEO_PLAYER_FALLBACK_TEXT) {
  releaseVideoPlayerSource();
  if (videoPlayerElement) videoPlayerElement.hidden = true;
  if (videoPlayerControls) videoPlayerControls.hidden = true;
  if (videoPlayerCenterButton) videoPlayerCenterButton.hidden = true;
  if (videoPlayerFallback) {
    videoPlayerFallback.hidden = false;
    const description = videoPlayerFallback.querySelector(":scope > span:last-child");
    if (description) description.textContent = message;
  }
}

function refreshOpenVideoPlayer() {
  if (!openVideoPlayerMediaId || videoPlayerBackdrop?.hidden) return;
  const item = mediaItems.get(openVideoPlayerMediaId);
  if (!item) {
    closeVideoPlayer();
    return;
  }

  if (videoPlayerTitle) {
    videoPlayerTitle.textContent = item.title || "Video";
    videoPlayerTitle.title = videoPlayerTitle.textContent;
  }
  renderVideoPlayerDetails(item);

  if (videoPlayerDownloadButton) {
    videoPlayerDownloadButton.dataset.downloadFor = item.id;
    applyButtonState(videoPlayerDownloadButton, item, downloadProgress.get(item.id));
  }
}

function openVideoPlayer(item, returnFocus = null) {
  if (!item || item.type !== "video" || !videoPlayerBackdrop || !videoPlayerElement) return;

  stopHoverPreview();
  closeMenu();
  openVideoPlayerMediaId = item.id;
  videoPlayerReturnFocus = returnFocus;

  videoPlayerTitle.textContent = item.title || "Video";
  videoPlayerTitle.title = videoPlayerTitle.textContent;
  renderVideoPlayerDetails(item);

  videoPlayerDownloadButton.dataset.downloadFor = item.id;
  applyButtonState(videoPlayerDownloadButton, item, downloadProgress.get(item.id));

  const playableUrl = safeInlineVideoUrl(item, videoPlayerElement);
  const poster = String(item.previewUrl || "");

  // Hacemos visible el flyout antes de inicializar el elemento multimedia.
  // Algunos reproductores/Chromium difieren el layout o el primer frame si el
  // <video> se carga dentro de un ancestro display:none.
  videoPlayerBackdrop.hidden = false;
  document.body.classList.add("dialog-open");
  document.body.classList.add("video-dialog-open");

  if (playableUrl) {
    videoPlayerFallback.hidden = true;
    videoPlayerElement.hidden = false;
    if (videoPlayerControls) videoPlayerControls.hidden = false;
    if (videoPlayerCenterButton) videoPlayerCenterButton.hidden = true;
    videoPlayerElement.playbackRate = VIDEO_PLAYER_DEFAULT_RATE;
    videoPlayerElement.volume = VIDEO_PLAYER_DEFAULT_VOLUME;
    videoPlayerElement.muted = false;
    videoPlayerElement.src = playableUrl;
    if (poster && !poster.startsWith("blob:")) videoPlayerElement.poster = poster;
    else videoPlayerElement.removeAttribute("poster");

    requestAnimationFrame(() => {
      if (openVideoPlayerMediaId !== item.id || videoPlayerElement.hidden) return;
      try { videoPlayerElement.load(); } catch {}
      syncVideoPlayerControls();
    });
  } else {
    showVideoPlayerFallback();
  }

  requestAnimationFrame(() => videoPlayerElement?.focus?.());
}

function closeVideoPlayer() {
  if (!videoPlayerBackdrop || videoPlayerBackdrop.hidden) return;

  releaseVideoPlayerSource();
  videoPlayerBackdrop.hidden = true;
  document.body.classList.remove("dialog-open");
  document.body.classList.remove("video-dialog-open");
  openVideoPlayerMediaId = null;

  if (videoPlayerDownloadButton) videoPlayerDownloadButton.removeAttribute("data-download-for");

  const returnFocus = videoPlayerReturnFocus;
  videoPlayerReturnFocus = null;
  returnFocus?.focus?.();
}


function imagePlayerDetailParts(item) {
  const parts = [];
  if (item.width && item.height) parts.push(`${item.width} × ${item.height}`);
  parts.push(String(item.format || "image").toUpperCase());
  return parts;
}

function renderImagePlayerDetails(item) {
  if (!imagePlayerDetails) return;
  imagePlayerDetails.replaceChildren();

  for (const [index, part] of imagePlayerDetailParts(item).entries()) {
    if (index > 0) {
      const divider = document.createElement("span");
      divider.className = "detail-divider";
      imagePlayerDetails.append(divider);
    }
    const node = document.createElement("span");
    node.textContent = part;
    imagePlayerDetails.append(node);
  }
}

function showImagePlayerFallback(message = "MediaDrop detectó la imagen, pero esta fuente no puede mostrarse directamente en el flyout.") {
  if (imagePlayerElement) {
    imagePlayerElement.hidden = true;
    imagePlayerElement.removeAttribute("src");
    imagePlayerElement.removeAttribute("alt");
  }
  if (imagePlayerFallback) {
    imagePlayerFallback.hidden = false;
    const description = imagePlayerFallback.querySelector(":scope > span:last-child");
    if (description) description.textContent = message;
  }
}

function refreshOpenImagePlayer() {
  if (!openImagePlayerMediaId || imagePlayerBackdrop?.hidden) return;
  const item = mediaItems.get(openImagePlayerMediaId);
  if (!item) {
    closeImagePlayer();
    return;
  }

  if (imagePlayerTitle) {
    imagePlayerTitle.textContent = item.title || "Imagen";
    imagePlayerTitle.title = imagePlayerTitle.textContent;
  }
  renderImagePlayerDetails(item);

  if (imagePlayerDownloadButton) {
    imagePlayerDownloadButton.dataset.downloadFor = item.id;
    applyButtonState(imagePlayerDownloadButton, item, downloadProgress.get(item.id));
  }
}

function openImagePlayer(item, returnFocus = null) {
  if (!item || item.type !== "image" || !imagePlayerBackdrop || !imagePlayerElement) return;

  stopHoverPreview();
  closeMenu();
  closeVideoPlayer();
  openImagePlayerMediaId = item.id;
  imagePlayerReturnFocus = returnFocus;

  imagePlayerTitle.textContent = item.title || "Imagen";
  imagePlayerTitle.title = imagePlayerTitle.textContent;
  renderImagePlayerDetails(item);

  imagePlayerDownloadButton.dataset.downloadFor = item.id;
  applyButtonState(imagePlayerDownloadButton, item, downloadProgress.get(item.id));

  const imageUrl = String(item.previewUrl || item.url || "").trim();
  if (imageUrl) {
    imagePlayerFallback.hidden = true;
    imagePlayerElement.hidden = false;
    imagePlayerElement.src = imageUrl;
    imagePlayerElement.alt = item.title || "Imagen";
  } else {
    showImagePlayerFallback();
  }

  imagePlayerBackdrop.hidden = false;
  document.body.classList.add("dialog-open");
  document.body.classList.add("image-dialog-open");
  requestAnimationFrame(() => imagePlayerCloseButton?.focus());
}

function closeImagePlayer() {
  if (!imagePlayerBackdrop || imagePlayerBackdrop.hidden) return;

  imagePlayerBackdrop.hidden = true;
  if (imagePlayerElement) {
    imagePlayerElement.hidden = true;
    imagePlayerElement.removeAttribute("src");
    imagePlayerElement.removeAttribute("alt");
  }
  if (imagePlayerFallback) imagePlayerFallback.hidden = true;
  document.body.classList.remove("dialog-open");
  document.body.classList.remove("image-dialog-open");
  openImagePlayerMediaId = null;

  if (imagePlayerDownloadButton) imagePlayerDownloadButton.removeAttribute("data-download-for");

  const returnFocus = imagePlayerReturnFocus;
  imagePlayerReturnFocus = null;
  returnFocus?.focus?.();
}

function streamFormatLabel(item) {
  const format = String(item?.streamKind || item?.format || "").toLowerCase();
  if (format === "m3u8") return "HLS";
  if (format === "mpd") return "DASH";
  if (format === "blob") return "STREAM";
  if (format === "stream") return "STREAM";
  return String(item?.format || item?.type || "video").toUpperCase();
}

function createMediaCard(item) {
  const card = document.createElement("article");
  card.className = `media-card ${item.type === "image" ? "photo-card" : "video-card"}`;
  card.dataset.mediaId = item.id;

  const frame = document.createElement("div");
  frame.className = "media-frame";

  const fallback = document.createElement("div");
  fallback.className = "preview-fallback";
  fallback.innerHTML = item.type === "video"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="m10 9 5 3-5 3Z"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="m5.5 18 4.7-4.8 3.1 3.1 2.1-2.1 3.1 3.8"></path></svg>`;
  frame.append(fallback);

  if (item.type === "video") {
    const playHint = document.createElement("span");
    playHint.className = "video-preview-play";
    playHint.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5Z"></path></svg>`;
    frame.append(playHint);
  }

  if (item.previewUrl && !item.previewUrl.startsWith("blob:")) {
    const preview = document.createElement("img");
    preview.className = "media-preview";
    preview.loading = "lazy";
    preview.decoding = "async";
    preview.alt = "";
    preview.src = item.previewUrl;
    preview.dataset.previewUrl = item.previewUrl;
    frame.classList.add("has-preview");
    preview.addEventListener("load", () => {
      frame.classList.add("has-preview");
      learnImageDimensionsFromPreview(item.id, preview);
    });
    preview.addEventListener("error", () => {
      preview.classList.add("is-broken");
      frame.classList.remove("has-preview");
    });
    frame.append(preview);
  }

  const format = document.createElement("span");
  format.className = "format-chip";
  format.textContent = item.streaming
    ? streamFormatLabel(item)
    : String(item.format || item.type).toUpperCase();
  frame.append(format);

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "card-download";
  downloadButton.dataset.downloadFor = item.id;
  downloadButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const currentItem = mediaItems.get(item.id);
    if (currentItem) downloadItem(currentItem);
  });
  applyButtonState(downloadButton, item, downloadProgress.get(item.id));

  const meta = document.createElement("div");
  meta.className = "card-meta";

  const title = document.createElement("p");
  title.className = "media-title";
  title.textContent = item.title || (item.type === "image" ? "Foto" : "Video");
  title.title = title.textContent;

  const details = document.createElement("div");
  details.className = "media-details";

  const resolution = document.createElement("span");
  resolution.textContent = item.width && item.height ? `${item.width} × ${item.height}` : "Resolución desconocida";
  details.append(resolution);

  if (item.type === "video" && Number.isFinite(item.duration) && item.duration > 0) {
    const divider = document.createElement("span");
    divider.className = "detail-divider";
    const duration = document.createElement("span");
    duration.textContent = formatDuration(item.duration);
    details.append(divider, duration);
  }

  meta.append(title, details, downloadButton);
  card.append(frame, meta);
  card.__mediaDropRefs = {
    frame,
    preview: frame.querySelector(".media-preview"),
    format,
    downloadButton,
    title,
    details
  };

  if (item.type === "video") {
    frame.addEventListener("pointerenter", () => {
      const currentItem = mediaItems.get(item.id);
      if (currentItem) startHoverPreview(card, currentItem);
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const currentItem = mediaItems.get(item.id);
      if (currentItem) openVideoPlayer(currentItem, card);
    });
  } else {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const currentItem = mediaItems.get(item.id);
      if (currentItem) openImagePlayer(currentItem, card);
    });
  }

  return card;
}

function updateMediaCard(card, item) {
  const refs = card.__mediaDropRefs || {};
  const frame = refs.frame || card.querySelector(".media-frame");
  const currentPreview = refs.preview || frame?.querySelector(".media-preview");
  const nextPreviewUrl = item.previewUrl && !item.previewUrl.startsWith("blob:") ? item.previewUrl : "";

  if (nextPreviewUrl && currentPreview?.dataset.previewUrl !== nextPreviewUrl) {
    const replacement = document.createElement("img");
    replacement.className = "media-preview";
    replacement.loading = "lazy";
    replacement.decoding = "async";
    replacement.alt = "";
    replacement.src = nextPreviewUrl;
    replacement.dataset.previewUrl = nextPreviewUrl;
    frame?.classList.add("has-preview");
    replacement.addEventListener("load", () => {
      frame?.classList.add("has-preview");
      learnImageDimensionsFromPreview(item.id, replacement);
    });
    replacement.addEventListener("error", () => {
      replacement.classList.add("is-broken");
      frame?.classList.remove("has-preview");
    });
    currentPreview?.replaceWith(replacement) || frame?.append(replacement);
    refs.preview = replacement;
  } else if (!nextPreviewUrl && currentPreview) {
    currentPreview.remove();
    refs.preview = null;
    frame?.classList.remove("has-preview");
  } else if (nextPreviewUrl && currentPreview) {
    frame?.classList.add("has-preview");
  }

  const format = refs.format || frame?.querySelector(".format-chip");
  if (format) {
    const nextFormat = item.streaming
      ? streamFormatLabel(item)
      : String(item.format || item.type).toUpperCase();
    if (format.textContent !== nextFormat) format.textContent = nextFormat;
  }

  const unsupported = frame?.querySelector(".unsupported-chip");
  unsupported?.remove();

  const button = refs.downloadButton || card.querySelector(".card-download");
  if (button) applyButtonState(button, item, downloadProgress.get(item.id));

  const title = refs.title || card.querySelector(".media-title");
  if (title) {
    const nextTitle = item.title || (item.type === "image" ? "Foto" : "Video");
    if (title.textContent !== nextTitle) title.textContent = nextTitle;
    if (title.title !== nextTitle) title.title = nextTitle;
  }

  const details = refs.details || card.querySelector(".media-details");
  if (details) {
    const resolution = item.width && item.height ? `${item.width} × ${item.height}` : "Resolución desconocida";
    const duration = item.type === "video" && Number.isFinite(item.duration) && item.duration > 0
      ? formatDuration(item.duration)
      : "";
    const signature = `${resolution}|${duration}`;
    if (details.dataset.signature !== signature) {
      details.dataset.signature = signature;
      details.replaceChildren();
      const resolutionNode = document.createElement("span");
      resolutionNode.textContent = resolution;
      details.append(resolutionNode);
      if (duration) {
        const divider = document.createElement("span");
        divider.className = "detail-divider";
        const durationNode = document.createElement("span");
        durationNode.textContent = duration;
        details.append(divider, durationNode);
      }
    }
  }
}

function downloadIcon() {
  return DOWNLOAD_ICON_TEMPLATE.content.firstElementChild.cloneNode(true);
}

function retryIcon() {
  return RETRY_ICON_TEMPLATE.content.firstElementChild.cloneNode(true);
}

function checkIcon() {
  return CHECK_ICON_TEMPLATE.content.firstElementChild.cloneNode(true);
}

function syncDownloadMotion(motion, percent) {
  const isIndeterminate = !Number.isFinite(percent);
  const normalizedPercent = isIndeterminate ? 0 : Math.max(0, Math.min(100, percent));
  motion.classList.toggle("is-indeterminate", isIndeterminate);

  const nextAngle = `${normalizedPercent * 3.6}deg`;
  if (motion.style.getPropertyValue("--download-progress-angle") !== nextAngle) {
    motion.style.setProperty("--download-progress-angle", nextAngle);
  }
}

function createDownloadMotion(percent) {
  const motion = document.createElement("span");
  motion.className = "download-motion";
  syncDownloadMotion(motion, percent);
  motion.innerHTML = `
    <svg class="download-motion-arrow" viewBox="0 -960 960 960" aria-hidden="true">
      <path d="M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z"></path>
    </svg>`;

  return motion;
}

function normalizeDownloadedImageHistory(rawHistory) {
  if (!rawHistory || typeof rawHistory !== "object" || Array.isArray(rawHistory)) return [];
  return Object.keys(rawHistory).filter((mediaId) => typeof mediaId === "string" && mediaId.startsWith("md-"));
}

function replaceDownloadedImageHistory(rawHistory) {
  downloadedImageHistory.clear();
  for (const mediaId of normalizeDownloadedImageHistory(rawHistory)) {
    downloadedImageHistory.add(mediaId);
  }
}

function isDownloadedMedia(item) {
  return typeof item?.id === "string" && downloadedImageHistory.has(item.id);
}

function markDownloadedMediaInFlyout(mediaId) {
  if (typeof mediaId !== "string" || !mediaId.startsWith("md-")) return;
  downloadedImageHistory.add(mediaId);
}

function applyButtonState(button, item, progress) {
  const stateSignature = [
    item.downloadable === true,
    item.streaming === true,
    progress?.state || "idle",
    Number.isFinite(progress?.percent) ? progress.percent : "",
    isDownloadedMedia(item),
    item.type || "",
    item.title || "",
  ].join("|");

  if (button.dataset.stateSignature === stateSignature) return;

  if (progress?.state === "in_progress" && button.classList.contains("is-downloading")) {
    const motion = button.querySelector(".download-motion");
    if (motion) {
      syncDownloadMotion(motion, progress.percent);
      const nextTitle = Number.isFinite(progress.percent) ? `Descargando: ${progress.percent}%` : "Descargando";
      if (button.title !== nextTitle) button.title = nextTitle;
      if (button.getAttribute("aria-label") !== nextTitle) button.setAttribute("aria-label", nextTitle);
      button.dataset.stateSignature = stateSignature;
      return;
    }
  }

  button.dataset.stateSignature = stateSignature;
  button.replaceChildren();
  button.classList.remove("is-error", "is-complete", "is-unsupported", "is-downloading");

  if (!item.downloadable && !item.streaming) {
    button.disabled = true;
    button.classList.add("is-unsupported");
    button.title = "Este video no admite descarga.";
    button.setAttribute("aria-label", button.title);
    button.append(downloadIcon());
    return;
  }

  if (item.streaming && !progress) {
    button.disabled = false;
    button.title = "Descargar video en streaming";
    button.setAttribute("aria-label", button.title);
    button.append(downloadIcon());
    return;
  }

  if (progress?.state === "in_progress") {
    button.disabled = true;
    button.classList.add("is-downloading");
    button.title = Number.isFinite(progress.percent) ? `Descargando: ${progress.percent}%` : "Descargando";
    button.setAttribute("aria-label", button.title);
    button.append(createDownloadMotion(progress.percent));
    return;
  }

  if (progress?.state === "complete") {
    button.disabled = true;
    button.classList.add("is-complete");
    button.title = "Descarga completada";
    button.setAttribute("aria-label", button.title);
    button.append(checkIcon());
    return;
  }

  if (progress?.state === "interrupted") {
    button.disabled = false;
    button.classList.add("is-error");
    button.title = "La descarga falló. Pulsa para reintentar";
    button.setAttribute("aria-label", button.title);
    button.append(retryIcon());
    return;
  }

  if (isDownloadedMedia(item)) {
    button.disabled = true;
    button.classList.add("is-complete");
    button.title = item?.type === "video" ? "Video ya descargado" : "Imagen ya descargada";
    button.setAttribute("aria-label", button.title);
    button.append(checkIcon());
    return;
  }

  button.disabled = false;
  button.title = "Descargar";
  button.setAttribute("aria-label", `Descargar ${item.title || item.type}`);
  button.append(downloadIcon());
}

function updateDownloadButtons(mediaId, item, progress) {
  if (!mediaId || !item) return;
  const selector = `[data-download-for="${CSS.escape(mediaId)}"]`;
  for (const button of document.querySelectorAll(selector)) {
    applyButtonState(button, item, progress);
  }
}

function updateDownloadProgress(message) {
  downloadProgress.set(message.mediaId, message);
  const item = mediaItems.get(message.mediaId);

  if (message.state === "complete") {
    markDownloadedMediaInFlyout(message.mediaId);
  }

  if (item) updateDownloadButtons(message.mediaId, item, message);

  if (message.state === "complete") {
    setTimeout(() => {
      const current = downloadProgress.get(message.mediaId);
      if (current?.state !== "complete") return;
      downloadProgress.delete(message.mediaId);
      if (item) updateDownloadButtons(message.mediaId, item, null);
    }, 1_500);
  }

  if (message.state === "interrupted" && message.error) {
    showToast(`No se pudo descargar: ${message.error}`);
  }
}

async function downloadItem(item) {
  if (!item || (!item.downloadable && !item.streaming)) return false;
  if (isDownloadedMedia(item)) return false;
  downloadProgress.set(item.id, { state: "in_progress", percent: null });
  updateDownloadButtons(item.id, item, downloadProgress.get(item.id));

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_DOWNLOAD",
      item,
      tabId: currentTabId
    });

    if (!response?.ok) {
      updateDownloadProgress({
        mediaId: item.id,
        state: "interrupted",
        percent: null,
        error: response?.error || "Edge rechazó la descarga."
      });
      return false;
    }
    return true;
  } catch (error) {
    updateDownloadProgress({
      mediaId: item.id,
      state: "interrupted",
      percent: null,
      error: String(error?.message || error)
    });
    return false;
  }
}

function setMenuOpen(open) {
  appMenu.hidden = !open;
  document.body.classList.toggle("menu-open", open);
  composerMenuButton?.setAttribute("aria-expanded", String(open));
  setMediaDockIndicator(open ? "settings" : activeType);

  if (open) {
    const firstAvailableItem = appMenu.querySelector(".menu-item:not(:disabled)");
    requestAnimationFrame(() => firstAvailableItem?.focus());
  }
}

function closeMenu() {
  setMenuOpen(false);
}

function requestBulkConfirmation(count) {
  const currentFocus = document.activeElement;
  dialogReturnFocus = appMenu.contains(currentFocus) ? composerMenuButton : currentFocus;
  closeMenu();
  bulkDialogMessage.textContent = activeType === "image"
    ? `Se agruparán ${count} imágenes en un único archivo ZIP.`
    : `Se iniciarán ${count} descargas de videos. Edge podría pedir permiso para permitir varias descargas.`;
  bulkDialog.hidden = false;
  document.body.classList.add("dialog-open");
  requestAnimationFrame(() => bulkCancelButton.focus());

  return new Promise((resolve) => {
    bulkDialogResolver = resolve;
  });
}

function closeBulkDialog(confirmed = false) {
  if (bulkDialog.hidden) return;
  bulkDialog.hidden = true;
  document.body.classList.remove("dialog-open");

  const resolve = bulkDialogResolver;
  bulkDialogResolver = null;
  resolve?.(confirmed);

  const returnFocus = dialogReturnFocus;
  dialogReturnFocus = null;
  returnFocus?.focus?.();
}


const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_MAX_32 = 0xffffffff;
let zipCrcTable = null;

function zipCrc32Table() {
  if (zipCrcTable) return zipCrcTable;
  zipCrcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    zipCrcTable[n] = c >>> 0;
  }
  return zipCrcTable;
}

function zipCrc32(bytes) {
  const table = zipCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day = ((year - 1980) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { time, day };
}

function zipWriteU16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
}

function zipWriteU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function zipExtensionFromContentType(contentType) {
  const mime = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/svg+xml": "svg"
  };
  return map[mime] || "";
}

function cleanZipFilePart(value, fallback = "imagen") {
  let name = String(value || "").trim();
  try { name = name.normalize("NFKC"); } catch {}
  name = name
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name) name = fallback;
  return name.slice(0, 120).replace(/[. ]+$/g, "") || fallback;
}

function zipFilenameForImage(item, contentType, index, usedNames) {
  const knownExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "svg"]);
  const original = cleanZipFilePart(item?.originalFilename || "", "");
  const originalMatch = original.match(/^(.*)\.([a-z0-9]{2,8})$/i);

  let base = "";
  let extension = "";

  if (originalMatch && knownExtensions.has(originalMatch[2].toLowerCase())) {
    base = cleanZipFilePart(originalMatch[1], `imagen-${index + 1}`);
    extension = originalMatch[2].toLowerCase() === "jpeg" ? "jpg" : originalMatch[2].toLowerCase();
  } else {
    base = cleanZipFilePart(item?.title || `imagen-${index + 1}`, `imagen-${index + 1}`);
    const format = String(item?.format || "").toLowerCase().replace(/^\./, "");
    extension = knownExtensions.has(format)
      ? (format === "jpeg" ? "jpg" : format)
      : zipExtensionFromContentType(contentType);
  }

  if (!extension) extension = "jpg";
  let candidate = `${base}.${extension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix}).${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function fetchImageBytesForZip(item) {
  const response = await fetch(item.url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("La imagen llegó vacía.");
  if (blob.size > ZIP_MAX_32) throw new Error("La imagen supera el límite de ZIP clásico.");

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    contentType: blob.type || response.headers.get("content-type") || ""
  };
}

function buildStoredZip(entries) {
  if (!entries.length) throw new Error("No hay imágenes para empaquetar.");
  if (entries.length > 0xffff) throw new Error("Hay demasiados archivos para un ZIP clásico.");

  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = zipDosDateTime(new Date());

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.bytes;
    if (nameBytes.length > 0xffff) throw new Error("Un nombre de archivo es demasiado largo.");
    if (data.length > ZIP_MAX_32) throw new Error("Una imagen supera el límite de ZIP clásico.");

    const crc = zipCrc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);

    zipWriteU32(localView, 0, 0x04034b50);
    zipWriteU16(localView, 4, 20);
    zipWriteU16(localView, 6, ZIP_UTF8_FLAG);
    zipWriteU16(localView, 8, ZIP_STORE_METHOD);
    zipWriteU16(localView, 10, stamp.time);
    zipWriteU16(localView, 12, stamp.day);
    zipWriteU32(localView, 14, crc);
    zipWriteU32(localView, 18, data.length);
    zipWriteU32(localView, 22, data.length);
    zipWriteU16(localView, 26, nameBytes.length);
    zipWriteU16(localView, 28, 0);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    zipWriteU32(centralView, 0, 0x02014b50);
    zipWriteU16(centralView, 4, 20);
    zipWriteU16(centralView, 6, 20);
    zipWriteU16(centralView, 8, ZIP_UTF8_FLAG);
    zipWriteU16(centralView, 10, ZIP_STORE_METHOD);
    zipWriteU16(centralView, 12, stamp.time);
    zipWriteU16(centralView, 14, stamp.day);
    zipWriteU32(centralView, 16, crc);
    zipWriteU32(centralView, 20, data.length);
    zipWriteU32(centralView, 24, data.length);
    zipWriteU16(centralView, 28, nameBytes.length);
    zipWriteU16(centralView, 30, 0);
    zipWriteU16(centralView, 32, 0);
    zipWriteU16(centralView, 34, 0);
    zipWriteU16(centralView, 36, 0);
    zipWriteU32(centralView, 38, 0);
    zipWriteU32(centralView, 42, offset);
    central.set(nameBytes, 46);

    localParts.push(local, data);
    centralParts.push(central);
    offset += local.length + data.length;
    if (offset > ZIP_MAX_32) throw new Error("El ZIP supera el límite de 4 GB.");
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const part of centralParts) centralSize += part.length;
  if (centralStart + centralSize > ZIP_MAX_32) throw new Error("El ZIP supera el límite de 4 GB.");

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  zipWriteU32(endView, 0, 0x06054b50);
  zipWriteU16(endView, 4, 0);
  zipWriteU16(endView, 6, 0);
  zipWriteU16(endView, 8, entries.length);
  zipWriteU16(endView, 10, entries.length);
  zipWriteU32(endView, 12, centralSize);
  zipWriteU32(endView, 16, centralStart);
  zipWriteU16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function mediaDropZipName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `MediaDrop-fotos-${stamp}.zip`;
}

async function rememberImagesPackedInZip(items) {
  const timestamp = Date.now();
  for (const item of items) markDownloadedMediaInFlyout(item.id);

  try {
    const stored = await chrome.storage.local.get({ [DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]: {} });
    const raw = stored[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY];
    const history = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
    items.forEach((item, index) => {
      if (typeof item?.id === "string") history[item.id] = timestamp - index;
    });
    const trimmed = Object.entries(history)
      .filter(([mediaId, value]) => mediaId.startsWith("md-") && Number.isFinite(Number(value)))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 2000);
    await chrome.storage.local.set({
      [DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]: Object.fromEntries(trimmed)
    });
  } catch {
    // El historial visual no debe impedir la creación del ZIP.
  }
}

async function downloadImagesAsZip(items) {
  const usedNames = new Set();
  const entries = [];
  const packedItems = [];
  let failed = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      const resource = await fetchImageBytesForZip(item);
      entries.push({
        name: zipFilenameForImage(item, resource.contentType, index, usedNames),
        bytes: resource.bytes
      });
      packedItems.push(item);
    } catch {
      failed += 1;
    }
  }

  if (!entries.length) {
    throw new Error("No fue posible obtener ninguna de las imágenes para crear el ZIP.");
  }

  const zipBlob = buildStoredZip(entries);
  const blobUrl = URL.createObjectURL(zipBlob);

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: mediaDropZipName(),
      conflictAction: "uniquify",
      saveAs: false
    });

    if (!Number.isInteger(downloadId)) {
      throw new Error("Edge no inició la descarga del ZIP.");
    }

    await rememberImagesPackedInZip(packedItems);
    return { packed: packedItems.length, failed };
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

async function downloadAllVisible() {
  if (bulkDownloadRunning) return;
  const items = visibleMediaItems(activeType).filter(
    (item) => (item.downloadable || item.streaming) && !isDownloadedMedia(item)
  );
  if (!items.length) return;

  if (items.length > 20 && !await requestBulkConfirmation(items.length)) return;

  bulkDownloadRunning = true;
  render();

  if (activeType === "image") {
    try {
      showToast("Preparando ZIP de fotos…");
      const result = await downloadImagesAsZip(items);
      render();
      showToast(
        result.failed
          ? `ZIP iniciado: ${result.packed} fotos · ${result.failed} omitidas`
          : `${result.packed} ${result.packed === 1 ? "foto" : "fotos"} en un solo ZIP`
      );
    } catch (error) {
      showToast(`No se pudo crear el ZIP: ${String(error?.message || error)}`);
    } finally {
      bulkDownloadRunning = false;
      render();
    }
    return;
  }

  let started = 0;
  try {
    for (const item of items) {
      if (downloadProgress.get(item.id)?.state === "in_progress") continue;
      if (await downloadItem(item)) started += 1;
      await new Promise((resolve) => setTimeout(resolve, 110));
    }
  } finally {
    bulkDownloadRunning = false;
    render();
  }

  if (started) showToast(`${started} ${started === 1 ? "descarga iniciada" : "descargas iniciadas"}`);
}

async function rescanPage() {
  closeMenu();
  if (!Number.isInteger(currentTabId)) {
    showToast("No hay una pestaña disponible para analizar.");
    return;
  }

  status.classList.remove("is-unavailable");
  pageUnavailableReason = "";
  statusText.textContent = "Volviendo a analizar la página…";
  connectPanel();
  panelPort?.postMessage({ type: "SUBSCRIBE_TAB", tabId: currentTabId });
  showToast("Escaneo actualizado");
}

async function clearResults() {
  closeMenu();
  if (!Number.isInteger(currentTabId)) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CLEAR_MEDIA",
      tabId: currentTabId
    });

    if (!response?.ok) throw new Error(response?.error || "No fue posible limpiar los resultados.");
    mediaItems.clear();
    downloadProgress.clear();
    scheduleRender();
    showToast("Resultados eliminados");
  } catch (error) {
    showToast(String(error?.message || error));
  }
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2_600);
}

async function subscribeToActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) return;

    if (currentTabId !== tab.id) {
      stopHoverPreview();
      closeVideoPlayer();
      closeImagePlayer();
      currentTabId = tab.id;
      mediaItems.clear();
      downloadProgress.clear();
      scheduleRender();
    }

    connectPanel();
    panelPort?.postMessage({ type: "SUBSCRIBE_TAB", tabId: currentTabId });
  } catch {
    setUnavailableStatus("No fue posible leer esta pestaña.");
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    closeMenu();
    setActiveType(button.dataset.tab);
  });
}

statusDownloadAllButton?.addEventListener("click", downloadAllVisible);

function toggleMenu(event) {
  event?.stopPropagation?.();
  setMenuOpen(appMenu.hidden);
}

themeButton?.addEventListener("click", toggleTheme);
composerMenuButton?.addEventListener("click", toggleMenu);

menuDownloadAllButton.addEventListener("click", downloadAllVisible);
menuClearButton.addEventListener("click", clearResults);
menuHoverToggle?.addEventListener("click", toggleHoverDownloadButton);
rescanButton?.addEventListener("click", rescanPage);
quickRescanButton?.addEventListener("click", rescanPage);
quickImagesButton?.addEventListener("click", () => setActiveType("image"));
quickVideosButton?.addEventListener("click", () => setActiveType("video"));

function playOpenVideoPlayerOnHover() {
  if (!VIDEO_PLAYER_HOVER_AUTOPLAY || !openVideoPlayerMediaId || videoPlayerElement?.hidden) return;
  videoPlayerElement?.play?.().catch(() => {});
}

function pauseOpenVideoPlayerOnMouseLeave() {
  if (!VIDEO_PLAYER_PAUSE_ON_MOUSE_LEAVE || !openVideoPlayerMediaId || videoPlayerElement?.hidden) return;
  videoPlayerElement?.pause?.();
}

videoPlayerElement?.addEventListener("error", () => {
  if (!openVideoPlayerMediaId || videoPlayerElement.hidden) return;
  showVideoPlayerFallback("La fuente fue detectada, pero el navegador no pudo reproducirla directamente desde MediaDrop.");
});
videoPlayerElement?.addEventListener("loadedmetadata", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("durationchange", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("timeupdate", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("play", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("pause", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("ended", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("volumechange", syncVideoPlayerControls);
videoPlayerElement?.addEventListener("ratechange", syncVideoPlayerControls);
videoPlayerStage?.addEventListener("mouseenter", playOpenVideoPlayerOnHover);
videoPlayerStage?.addEventListener("mouseleave", pauseOpenVideoPlayerOnMouseLeave);
videoPlayerElement?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleVideoPlayerPlayback();
});
videoPlayerPlayButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleVideoPlayerPlayback();
});

videoPlayerCenterButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleVideoPlayerPlayback();
});
videoPlayerProgress?.addEventListener("input", (event) => {
  event.stopPropagation();
  seekVideoPlayerFromControl();
});
videoPlayerVolumeButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleVideoPlayerMute();
});
videoPlayerVolumeSlider?.addEventListener("input", (event) => {
  event.stopPropagation();
  setVideoPlayerVolumeFromControl();
});
videoPlayerPipButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleVideoPlayerPictureInPicture();
});
videoPlayerFullscreenButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleVideoPlayerFullscreen();
});
videoPlayerMoreButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!videoPlayerMoreMenu) return;
  const willOpen = videoPlayerMoreMenu.hidden;
  videoPlayerMoreMenu.hidden = !willOpen;
  videoPlayerMoreButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) syncVideoPlayerControls();
});
videoPlayerMoreMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("button[data-video-action]");
  if (!button || !videoPlayerElement) return;

  if (button.dataset.videoAction === "speed") {
    const speed = Number(button.dataset.videoSpeed || VIDEO_PLAYER_DEFAULT_RATE);
    videoPlayerElement.playbackRate = speed > 0 ? speed : VIDEO_PLAYER_DEFAULT_RATE;
    syncVideoPlayerControls();
    closeVideoPlayerMoreMenu();
    return;
  }

  if (button.dataset.videoAction === "download") {
    const item = mediaItems.get(openVideoPlayerMediaId);
    if (item) downloadItem(item);
    closeVideoPlayerMoreMenu();
  }
});
videoPlayerCloseButton?.addEventListener("click", closeVideoPlayer);
videoPlayerDownloadButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  const item = mediaItems.get(openVideoPlayerMediaId);
  if (item) downloadItem(item);
});
videoPlayerBackdrop?.addEventListener("pointerdown", (event) => {
  if (event.target === videoPlayerBackdrop) closeVideoPlayer();
});

document.addEventListener("pointerdown", (event) => {
  if (!videoPlayerMoreMenu || videoPlayerMoreMenu.hidden) return;
  if (event.target.closest("#video-player-more") || event.target.closest("#video-player-more-menu")) return;
  closeVideoPlayerMoreMenu();
});

imagePlayerElement?.addEventListener("error", () => {
  if (!openImagePlayerMediaId || imagePlayerElement.hidden) return;
  showImagePlayerFallback("La imagen fue detectada, pero el navegador no pudo mostrarla directamente desde MediaDrop.");
});
imagePlayerCloseButton?.addEventListener("click", closeImagePlayer);
imagePlayerDownloadButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  const item = mediaItems.get(openImagePlayerMediaId);
  if (item) downloadItem(item);
});
imagePlayerBackdrop?.addEventListener("pointerdown", (event) => {
  if (event.target === imagePlayerBackdrop) closeImagePlayer();
});

bulkCancelButton.addEventListener("click", () => closeBulkDialog(false));
bulkConfirmButton.addEventListener("click", () => closeBulkDialog(true));
bulkDialog.addEventListener("pointerdown", (event) => {
  if (event.target === bulkDialog) closeBulkDialog(false);
});

appMenu.addEventListener("pointerdown", (event) => {
  if (event.target === appMenu) closeMenu();
});

document.addEventListener("pointerdown", (event) => {
  if (appMenu.hidden) return;
  if (appMenu.contains(event.target) || composerMenuButton?.contains(event.target)) return;
  closeMenu();
});

appMenu.addEventListener("keydown", (event) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const availableItems = [...appMenu.querySelectorAll(".menu-item:not(:disabled)")];
  if (!availableItems.length) return;
  event.preventDefault();

  const currentIndex = availableItems.indexOf(document.activeElement);
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = availableItems.length - 1;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + availableItems.length) % availableItems.length;
  if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + availableItems.length) % availableItems.length;
  availableItems[nextIndex].focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (videoPlayerBackdrop && !videoPlayerBackdrop.hidden) {
    event.preventDefault();
    closeVideoPlayer();
    return;
  }
  if (imagePlayerBackdrop && !imagePlayerBackdrop.hidden) {
    event.preventDefault();
    closeImagePlayer();
    return;
  }
  if (!bulkDialog.hidden) {
    event.preventDefault();
    closeBulkDialog(false);
    return;
  }
  if (!appMenu.hidden) {
    event.preventDefault();
    closeMenu();
    composerMenuButton?.focus();
  }
});


chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if ("hoverDownloadButtonEnabled" in changes) {
    updateHoverToggle(changes.hoverDownloadButtonEnabled.newValue);
  }
  if (THEME_STORAGE_KEY in changes) {
    applyTheme(changes[THEME_STORAGE_KEY].newValue);
  }
  if (DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY in changes) {
    replaceDownloadedImageHistory(changes[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY].newValue);
    for (const item of mediaItems.values()) {
      updateDownloadButtons(item.id, item, downloadProgress.get(item.id));
    }
  }
});

chrome.tabs.onActivated.addListener(subscribeToActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== currentTabId || changeInfo.status !== "loading") return;
  stopHoverPreview();
  closeVideoPlayer();
  closeImagePlayer();
  mediaItems.clear();
  downloadProgress.clear();
  scheduleRender();
});

async function initialize() {
  const stored = await chrome.storage.local.get({
    preferredMediaTab: "image",
    hoverDownloadButtonEnabled: true,
    [THEME_STORAGE_KEY]: DEFAULT_THEME,
    [DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]: {}
  });

  if (["image", "video"].includes(stored.preferredMediaTab)) {
    activeType = stored.preferredMediaTab;
  }

  applyTheme(stored[THEME_STORAGE_KEY]);
  replaceDownloadedImageHistory(stored[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]);
  setActiveType(activeType);
  updateHoverToggle(stored.hoverDownloadButtonEnabled);

  connectPanel();
  await subscribeToActiveTab();
  render();
}

initialize();
