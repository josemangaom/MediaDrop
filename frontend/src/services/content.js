(() => {
  // Guard por build. Al recargar/actualizar una extensión, una pestaña abierta
  // puede conservar el marcador legado aunque el runtime anterior ya no
  // responda. Usar un identificador de build permite que el fallback de
  // background.js reinserte el detector actual sin exigir refrescar la página.
  const CONTENT_BUILD_ID = "1.0.10";
  if (globalThis.__mediaDropContentBuild === CONTENT_BUILD_ID) return;
  globalThis.__mediaDropContentBuild = CONTENT_BUILD_ID;
  globalThis.__mediaDropBetaLoaded = true; // compatibilidad con builds anteriores

  const MIN_SIDE = 72;
  const MIN_AREA = 9_000;
  const SVG_MIN_SIDE = 16;
  const SVG_MIN_AREA = 256;
  const MAX_ITEMS = 500;
  const DOT_COUNT = 12;

  // Plataforma, controles flotantes e historial persistente de imágenes.
  // Mobile usa botón fijo; PC conserva el comportamiento por hover.
  const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;
  const MOBILE_FIXED_IMAGE_BUTTON_SIZE_PX = 17;
  const MOBILE_FIXED_IMAGE_BUTTON_SIDE_OFFSET_PX = 7;
  const MOBILE_FIXED_IMAGE_BUTTON_VIEWPORT_MARGIN_PX = 4;
  const DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY = "downloadedImageHistoryV1";
  const IMAGE_DOWNLOAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11"></path>
      <path d="m7.5 10 4.5 4.5 4.5-4.5"></path>
      <path d="M5 20h14"></path>
    </svg>
  `;
  const IMAGE_DOWNLOADED_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.2 4.2L19 7"></path>
    </svg>
  `;

  // Frost global de los controles flotantes inyectados en las páginas.
  const FROST_BLUR_PX = 20;
  const FROST_SATURATION_PERCENT = 125;

  // Hojas compartidas entre Shadow Roots. En móvil puede haber decenas de
  // controles; parsear el mismo CSS para cada imagen desperdicia memoria/CPU.
  const HOVER_CONTROL_CSS = `
      :host { color-scheme: dark; }
      button {
        box-sizing: border-box;
        width: 17px;
        height: 17px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 50%;
        color: #fff;
        background: rgba(33, 33, 33, .72);
        -webkit-backdrop-filter: blur(${FROST_BLUR_PX}px) saturate(${FROST_SATURATION_PERCENT}%);
        backdrop-filter: blur(${FROST_BLUR_PX}px) saturate(${FROST_SATURATION_PERCENT}%);
        box-shadow:
          0 5px 12px rgba(0,0,0,.30),
          inset 0 1px 0 rgba(255,255,255,.04);
        cursor: pointer;
        transition: transform .12s ease, background .12s ease, opacity .12s ease;
      }
      button:hover { background: #2b2b2b; }
      button:active { transform: scale(.95); }
      button[data-downloaded="true"] { cursor: default; }
      button[data-downloaded="true"]:active { transform: none; background: #2b2b2b; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      button:disabled { opacity: .58; cursor: not-allowed; transform: none; }
      svg { width: 8px; height: 8px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `;
  const MOBILE_FIXED_CONTROL_CSS = `
      :host { color-scheme: dark; }
      button {
        box-sizing: border-box;
        width: ${MOBILE_FIXED_IMAGE_BUTTON_SIZE_PX}px;
        height: ${MOBILE_FIXED_IMAGE_BUTTON_SIZE_PX}px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 50%;
        color: #fff;
        background: rgba(33, 33, 33, .72);
        -webkit-backdrop-filter: blur(${FROST_BLUR_PX}px) saturate(${FROST_SATURATION_PERCENT}%);
        backdrop-filter: blur(${FROST_BLUR_PX}px) saturate(${FROST_SATURATION_PERCENT}%);
        box-shadow:
          0 5px 12px rgba(0,0,0,.30),
          inset 0 1px 0 rgba(255,255,255,.04);
        cursor: pointer;
        transition: transform .12s ease, background .12s ease, opacity .12s ease;
        touch-action: manipulation;
      }
      button:active { transform: scale(.95); background: #2b2b2b; }
      button[data-downloaded="true"] { cursor: default; }
      button[data-downloaded="true"]:active { transform: none; background: rgba(33, 33, 33, .72); }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      button:disabled { opacity: .58; cursor: not-allowed; transform: none; }
      svg { width: 8px; height: 8px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `;
  const PROGRESS_BADGE_CSS = `
      :host { color-scheme: dark; }
      button {
        box-sizing: border-box;
        position: relative;
        width: 17px;
        height: 17px;
        padding: 0;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 50%;
        background: rgba(33, 33, 33, .72);
        -webkit-backdrop-filter: blur(${FROST_BLUR_PX}px) saturate(${FROST_SATURATION_PERCENT}%);
        backdrop-filter: blur(${FROST_BLUR_PX}px) saturate(${FROST_SATURATION_PERCENT}%);
        box-shadow:
          0 5px 12px rgba(0,0,0,.30),
          inset 0 1px 0 rgba(255,255,255,.04);
        pointer-events: none;
        transition: opacity .2s ease, transform .2s ease;
      }
      button.retry { pointer-events: auto; cursor: pointer; }
      .ring { position: absolute; inset: 2px; }
      .dot {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 1.2px;
        height: 1.2px;
        margin: -0.6px;
        border-radius: 50%;
        background: rgba(255,255,255,.28);
        transition: background .12s ease;
      }
      .dot.filled { background: #10a37f; }
      .dot.failed { background: #e02e2a; }
      .ring.indeterminate { animation: spin .9s linear infinite; }
      .center {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #fff;
        font: 700 7px/1 ui-sans-serif, system-ui, sans-serif;
        opacity: 0;
        transform: scale(.7);
        transition: opacity .18s ease, transform .18s ease;
      }
      button.complete .center, button.failed .center { opacity: 1; transform: scale(1); }
      button.complete .ring, button.failed .ring { opacity: .88; }
      button.leaving { opacity: 0; transform: scale(.82); }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .ring.indeterminate { animation-duration: 1.8s; }
        button, .dot, .center { transition: none; }
      }
  `;
  const sharedShadowStyleSheets = new Map();

  function applySharedShadowStyle(shadowRoot, key, cssText) {
    if (
      "adoptedStyleSheets" in shadowRoot
      && typeof CSSStyleSheet === "function"
      && typeof CSSStyleSheet.prototype.replaceSync === "function"
    ) {
      let sheet = sharedShadowStyleSheets.get(key);
      if (sheet === undefined) {
        try {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(cssText);
          sharedShadowStyleSheets.set(key, sheet);
        } catch {
          sheet = null;
          sharedShadowStyleSheets.set(key, null);
        }
      }
      if (sheet) {
        try {
          shadowRoot.adoptedStyleSheets = [sheet];
          return;
        } catch {
          // Fallback to a regular <style> below without changing the rendered CSS.
        }
      }
    }

    const style = document.createElement("style");
    style.textContent = cssText;
    shadowRoot.append(style);
  }

  // Captura de respaldo para reproductores MSE/blob. Mantener estas constantes
  // arriba facilita ajustar calidad, timeouts y formato sin tocar la lógica.
  const PLAYER_CAPTURE_VIDEO_WAIT_MS = 90_000;
  const PLAYER_CAPTURE_VIDEO_POLL_MS = 250;
  const PLAYER_CAPTURE_PROGRESS_MS = 500;
  const PLAYER_CAPTURE_STALL_TIMEOUT_MS = 45_000;
  const PLAYER_CAPTURE_RECORDER_TIMESLICE_MS = 1_000;
  const PLAYER_CAPTURE_MIN_BLOB_BYTES = 128 * 1024;
  const PLAYER_CAPTURE_BLOB_REVOKE_DELAY_MS = 60_000;
  const PLAYER_CAPTURE_DURATION_TOLERANCE_SECONDS = 6;
  const PLAYER_CAPTURE_MIN_DURATION_RATIO = 0.82;
  const PLAYER_CAPTURE_480P_BITRATE = 2_500_000;
  const PLAYER_CAPTURE_720P_BITRATE = 5_000_000;
  const PLAYER_CAPTURE_1080P_BITRATE = 8_000_000;
  const PLAYER_CAPTURE_HIGH_BITRATE = 12_000_000;
  const PLAYER_CAPTURE_AUDIO_BITRATE = 192_000;
  const PLAYER_CAPTURE_MIME_TYPES = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  const mediaItems = new Map();
  const elementRefs = new Map();
  const pendingUpserts = new Map();
  const activeBadges = new Map();
  const mobileFixedImageControls = new Map();
  const downloadedImageHistory = new Set();
  const sessionDownloadedImageIds = new Set();
  const sessionDownloadedImageElements = new WeakSet();
  const pendingNodes = new Set();
  const previewJobs = new WeakMap();
  const imageMetadataListeners = new WeakSet();
  const videoMetadataListeners = new WeakSet();
  const instagramVisualIds = new WeakMap();
  const instagramNetworkVisualAssignments = new Map();
  const instagramUsedVisualIds = new Set();
  const processedPerformanceEntries = new WeakSet();
  const observedShadowRoots = new WeakSet();
  const MEDIA_MUTATION_OBSERVER_OPTIONS = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "src", "srcset", "poster", "style", "type", "href", "xlink:href", "data",
      "data-src", "data-original", "data-lazy-src", "data-video-src", "data-video-url",
      "data-url", "data-stream", "data-playback-url", "data-content-url", "data-mp4", "data-webm"
    ]
  };

  let nextInstagramVisualId = 1;
  let flushTimer = null;
  let scanTimer = null;
  let lastPageUrl = location.href;
  let hoverTarget = null;
  let hoverItem = null;
  let repositionRequested = false;
  let hoverDownloadButtonEnabled = false;
  let playerCaptureRunning = false;
  let performanceResourceCursor = 0;
  let performanceObserverActive = false;
  let navigationWatchTimer = null;
  let mutationObserver = null;
  let shadowRescanRequested = false;

  function isMobilePlatform() {
    const userAgentDataMobile = navigator.userAgentData?.mobile;
    if (typeof userAgentDataMobile === "boolean") return userAgentDataMobile;
    return MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent || "");
  }

  const IS_MOBILE_PLATFORM = isMobilePlatform();

  function hashString(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed === "about:blank") return null;
    if (trimmed.startsWith("data:") && trimmed.length > 2_000_000) return null;

    try {
      const url = new URL(trimmed, document.baseURI);
      if (!["http:", "https:", "data:", "blob:"].includes(url.protocol)) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  function formatFromUrl(url, fallback = "") {
    if (!url) return fallback;

    if (url.startsWith("data:")) {
      const mime = url.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || "";
      const subtype = mime.split("/")[1] || "";
      if (subtype === "svg+xml") return "svg";
      return subtype.replace("jpeg", "jpg") || fallback;
    }

    if (url.startsWith("blob:")) return "stream";

    try {
      const parsed = new URL(url);
      const extension = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
      if (extension) return extension === "jpeg" ? "jpg" : extension;

      const hinted = parsed.searchParams.get("format") || parsed.searchParams.get("fm");
      if (hinted && /^[a-z0-9]{2,5}$/i.test(hinted)) return hinted.toLowerCase();
    } catch {
      return fallback;
    }

    return fallback;
  }

  function cleanTitle(value, fallback) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return text || fallback;
  }

  function originalFilenameFromUrl(rawUrl) {
    if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) return null;
    try {
      const parsed = new URL(rawUrl, document.baseURI);
      const hinted = ["filename", "file", "name", "download", "attachment"]
        .map((key) => parsed.searchParams.get(key))
        .find((value) => value && /\.[a-z0-9]{2,6}$/i.test(value));
      if (hinted) return decodeURIComponent(hinted).split(/[\/]/).pop();

      const lastPart = decodeURIComponent(parsed.pathname).split("/").filter(Boolean).pop() || "";
      return lastPart && /\.[a-z0-9]{2,6}$/i.test(lastPart) ? lastPart : null;
    } catch {
      return null;
    }
  }

  function imageLikeUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    if (url.startsWith("data:image/")) return url;
    try {
      const parsed = new URL(url);
      const decoded = decodeURIComponent(parsed.href);
      if (/\.(?:jpe?g|png|webp|avif|gif|svg|bmp|ico|tiff?)(?:$|[?#])/i.test(decoded)) return url;
      if (/(?:[?&](?:format|fm|ext|type)=)(?:jpe?g|png|webp|avif|gif|svg)(?:&|$)/i.test(decoded)) return url;
    } catch {}
    return null;
  }

  function isSvgUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return false;
    if (/^data:image\/svg\+xml(?:[;,])/i.test(url)) return true;
    try {
      const decoded = decodeURIComponent(url);
      if (/\.svg(?:$|[?#])/i.test(decoded)) return true;
      if (/(?:[?&](?:format|fm|ext|type)=)svg(?:&|$)/i.test(decoded)) return true;
    } catch {}
    return false;
  }

  function isVisibleSize(element, allowSmall = false, knownRect = null) {
    if (!(element instanceof Element)) return false;
    const rect = knownRect || element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (allowSmall) return rect.width >= 40 && rect.height >= 40;
    return Math.min(rect.width, rect.height) >= MIN_SIDE || rect.width * rect.height >= MIN_AREA;
  }

  function isVisibleSvgSize(element, knownRect = null) {
    if (!(element instanceof Element)) return false;
    const rect = knownRect || element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return Math.min(rect.width, rect.height) >= SVG_MIN_SIDE || rect.width * rect.height >= SVG_MIN_AREA;
  }

  function parseSrcset(srcset, baselineWidth) {
    if (!srcset) return [];

    return srcset
      .split(/\s*,\s*/)
      .map((part) => {
        const match = part.trim().match(/^(\S+)(?:\s+([0-9.]+)(w|x))?$/);
        if (!match) return null;

        const url = normalizeUrl(match[1]);
        if (!url) return null;

        const value = Number(match[2] || 1);
        const score = match[3] === "w"
          ? value
          : match[3] === "x"
            ? value * Math.max(1, baselineWidth)
            : baselineWidth;

        return { url, score };
      })
      .filter(Boolean);
  }

  function imageCandidates(image, knownRect = null) {
    const rect = knownRect || image.getBoundingClientRect();
    const baselineWidth = image.naturalWidth || rect.width || 1;
    const candidates = [];

    const add = (rawUrl, score = baselineWidth) => {
      const url = normalizeUrl(rawUrl);
      if (url) candidates.push({ url, score });
    };

    add(image.currentSrc, image.naturalWidth || baselineWidth);
    add(image.src, image.naturalWidth || baselineWidth);

    // Lazy-loaders y frameworks usan muchos nombres distintos para conservar la URL original.
    const directAttrs = [
      "data-src", "data-original", "data-original-src", "data-lazy-src", "data-lazy",
      "data-image", "data-image-url", "data-url", "data-full", "data-full-src",
      "data-hi-res-src", "data-large", "data-large-src", "data-zoom-image",
      "data-flickity-lazyload", "data-splide-lazy", "data-cfsrc"
    ];
    for (const attr of directAttrs) add(image.getAttribute(attr), baselineWidth * 1.6);

    const srcsetAttrs = [
      "srcset", "data-srcset", "data-lazy-srcset", "data-original-srcset",
      "data-flickity-lazyload-srcset"
    ];
    for (const attr of srcsetAttrs) {
      candidates.push(...parseSrcset(image.getAttribute(attr), rect.width || baselineWidth));
    }

    const picture = image.closest("picture");
    if (picture) {
      for (const source of picture.querySelectorAll("source")) {
        for (const attr of ["srcset", "data-srcset", "data-lazy-srcset"]) {
          candidates.push(...parseSrcset(source.getAttribute(attr), rect.width || baselineWidth));
        }
        add(source.getAttribute("src"), baselineWidth * 1.4);
      }
    }

    // Muchas galerías enlazan la miniatura directamente con el archivo a resolución completa.
    const anchor = image.closest("a[href]");
    if (anchor) {
      const href = imageLikeUrl(anchor.getAttribute("href"));
      if (href) candidates.push({ url: href, score: Math.max(100_000, baselineWidth * 2) });
    }

    const seen = new Set();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    });
  }

  function registerMedia(item, element) {
    if (!item?.url || !item?.type) return null;

    const id = item.id || `md-${hashString(`${item.type}|${item.url}`)}`;
    const previous = mediaItems.get(id);
    const merged = {
      ...previous,
      ...item,
      id,
      detectedAt: previous?.detectedAt || item.detectedAt || Date.now()
    };

    mediaItems.set(id, merged);
    if (element) {
      elementRefs.set(id, typeof WeakRef === "function" ? new WeakRef(element) : element);
      syncMobileFixedImageButton(merged, element);
    }

    while (mediaItems.size > MAX_ITEMS) {
      const oldestId = mediaItems.keys().next().value;
      mediaItems.delete(oldestId);
      elementRefs.delete(oldestId);
      removeMobileFixedImageButtonsForMedia(oldestId);
    }

    pendingUpserts.set(id, merged);
    scheduleUpsertFlush();
    return merged;
  }

  function getElementForMedia(mediaId) {
    const reference = elementRefs.get(mediaId);
    if (!reference) return null;
    return typeof reference.deref === "function" ? reference.deref() : reference;
  }

  function detectImage(image, allowSmall = false) {
    if (!(image instanceof HTMLImageElement)) return null;

    if (!imageMetadataListeners.has(image)) {
      imageMetadataListeners.add(image);
      image.addEventListener("load", () => {
        detectImage(image, true);
      }, { passive: true });
    }

    const rect = image.getBoundingClientRect();
    const candidates = imageCandidates(image, rect);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);

    const url = candidates[0].url;
    const svgSource = isSvgUrl(url);
    if (svgSource ? !isVisibleSvgSize(image, rect) : !isVisibleSize(image, allowSmall, rect)) return null;
    if (image.naturalWidth > 0 && image.naturalHeight > 0
      && image.naturalWidth <= 16 && image.naturalHeight <= 16) return null;
    const width = Math.round(image.naturalWidth || rect.width || 0);
    const height = Math.round(image.naturalHeight || rect.height || 0);

    return registerMedia({
      type: "image",
      url,
      previewUrl: normalizeUrl(image.currentSrc || image.src) || url,
      width,
      height,
      format: formatFromUrl(url, "image"),
      originalFilename: originalFilenameFromUrl(url),
      title: cleanTitle(image.alt || image.getAttribute("aria-label"), "Foto"),
      source: location.hostname.includes("instagram.com") ? "instagram" : "dom",
      downloadable: !url.startsWith("blob:"),
      pageUrl: location.href
    }, image);
  }

  function videoCandidates(video) {
    const candidates = [];
    const add = (rawUrl, priority, hintedType = "") => {
      const url = normalizeUrl(rawUrl);
      if (!url) return;
      const hint = String(hintedType || "").toLowerCase();
      const format = formatFromUrl(url, "");
      const mediaHint = /video\//i.test(hint) || /(?:mp4|webm|mov|m4v|ogv|m3u8|mpd)/i.test(hint);
      candidates.push({ url, priority: priority + (mediaHint ? 5 : 0), hintedType: hint, format });
    };

    add(video.currentSrc, video.currentSrc?.startsWith("blob:") ? 1 : 40, video.getAttribute("type"));
    add(video.src, video.src?.startsWith("blob:") ? 1 : 35, video.getAttribute("type"));

    const videoAttrs = [
      "data-src", "data-video-src", "data-video-url", "data-url", "data-stream",
      "data-playback-url", "data-content-url", "data-mp4", "data-webm"
    ];
    for (const attr of videoAttrs) add(video.getAttribute(attr), 30, video.getAttribute("type"));

    for (const source of video.querySelectorAll("source")) {
      const type = source.getAttribute("type") || "";
      add(source.getAttribute("src"), 32, type);
      add(source.getAttribute("data-src"), 30, type);
      add(source.getAttribute("data-video-src"), 30, type);
    }

    const parentLink = video.closest("a[href]");
    if (parentLink) add(parentLink.getAttribute("href"), 18);

    const seen = new Set();
    return candidates
      .sort((a, b) => b.priority - a.priority)
      .filter((candidate) => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      });
  }

  function visualIdForInstagramVideo(video) {
    if (!instagramVisualIds.has(video)) {
      instagramVisualIds.set(video, nextInstagramVisualId++);
    }
    return instagramVisualIds.get(video);
  }

  function overlapArea(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function nearbyImageForVideo(video, knownVideoRect = null) {
    if (!(video instanceof HTMLVideoElement)) return null;

    const poster = normalizeUrl(video.poster);
    if (poster) {
      return {
        previewUrl: poster,
        previewSource: "video-poster",
        width: Math.round(video.videoWidth || 0),
        height: Math.round(video.videoHeight || 0)
      };
    }

    const videoRect = knownVideoRect || video.getBoundingClientRect();
    const roots = [
      video.parentElement,
      video.parentElement?.parentElement,
      video.closest("article")
    ].filter(Boolean);

    let best = null;
    let bestScore = -1;
    const seen = new Set();

    for (const root of roots) {
      for (const image of root.querySelectorAll?.("img") || []) {
        if (!(image instanceof HTMLImageElement) || seen.has(image)) continue;
        seen.add(image);

        const previewUrl = normalizeUrl(image.currentSrc || image.src);
        if (!previewUrl || previewUrl.startsWith("data:")) continue;

        const rect = image.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) continue;

        const overlap = overlapArea(videoRect, rect);
        const centerDistance = Math.hypot(
          (videoRect.left + videoRect.width / 2) - (rect.left + rect.width / 2),
          (videoRect.top + videoRect.height / 2) - (rect.top + rect.height / 2)
        );

        const score = overlap * 5
          + Math.min(rect.width * rect.height, 1_000_000)
          - centerDistance * 25;

        if (score > bestScore) {
          bestScore = score;
          best = {
            previewUrl,
            previewSource: "nearby-video-image",
            width: Math.round(video.videoWidth || 0),
            height: Math.round(video.videoHeight || 0)
          };
        }
      }
    }

    return best;
  }

  function instagramVideoVisualHints() {
    if (!location.hostname.includes("instagram.com")) return [];

    return [...document.querySelectorAll("video")]
      .map((video) => {
        const hint = nearbyImageForVideo(video) || {};
        const rect = video.getBoundingClientRect();
        const intrinsicWidth = Math.round(video.videoWidth || 0);
        const intrinsicHeight = Math.round(video.videoHeight || 0);
        const width = intrinsicWidth || Math.round(rect.width || 0);
        const height = intrinsicHeight || Math.round(rect.height || 0);
        const previewUrl = hint.previewUrl || null;

        if (!previewUrl && (!width || !height)) return null;

        return {
          id: visualIdForInstagramVideo(video),
          previewUrl,
          previewSource: hint.previewSource || "instagram-video-visual",
          width,
          height,
          resolutionSource: intrinsicWidth > 0 && intrinsicHeight > 0
            ? "video-metadata-dom"
            : "instagram-layout",
          visible: rect.bottom > 0
            && rect.right > 0
            && rect.top < window.innerHeight
            && rect.left < window.innerWidth
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.visible) - Number(a.visible));
  }

  function instagramVisualHintForNetworkUrl(url) {
    if (!location.hostname.includes("instagram.com")) return null;

    const existing = instagramNetworkVisualAssignments.get(url);
    if (existing) return existing;

    const hints = instagramVideoVisualHints();
    if (!hints.length) return null;

    let selected = hints.find((hint) => !instagramUsedVisualIds.has(hint.id));
    if (!selected) selected = hints[0];
    if (!selected) return null;

    instagramUsedVisualIds.add(selected.id);
    instagramNetworkVisualAssignments.set(url, selected);
    return selected;
  }

  function refreshInstagramNetworkItemsForVideo(video) {
    if (!location.hostname.includes("instagram.com")) return;
    if (!(video instanceof HTMLVideoElement)) return;

    const visualId = visualIdForInstagramVideo(video);
    const width = Math.round(video.videoWidth || 0);
    const height = Math.round(video.videoHeight || 0);
    if (width < 1 || height < 1) return;

    const visualHint = nearbyImageForVideo(video);

    for (const [url, assignment] of instagramNetworkVisualAssignments) {
      if (assignment?.id !== visualId) continue;

      const mediaId = `md-${hashString(`video|${url}`)}`;
      const current = mediaItems.get(mediaId);
      if (!current || current.type !== "video") continue;

      registerMedia({
        ...current,
        width,
        height,
        resolutionSource: "video-metadata-dom",
        previewUrl: current.previewUrl || visualHint?.previewUrl || null,
        previewSource: current.previewSource || visualHint?.previewSource || null
      }, video);
    }
  }

  function bestVisibleVideoForStream() {
    const videos = [...document.querySelectorAll("video")];
    if (!videos.length) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const video of videos) {
      if (!(video instanceof HTMLVideoElement)) continue;

      const rect = video.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const visibleArea = visibleWidth * visibleHeight;
      const ready = video.readyState >= HTMLMediaElement.HAVE_METADATA;
      const playing = !video.paused && !video.ended;
      const intrinsic = (video.videoWidth || 0) * (video.videoHeight || 0);

      const score =
        (playing ? 5_000_000 : 0)
        + (ready ? 1_000_000 : 0)
        + visibleArea * 4
        + Math.min(intrinsic, 4_000_000);

      if (score > bestScore) {
        bestScore = score;
        best = video;
      }
    }

    return best;
  }

  function hydrateDetectedStream(message) {
    const url = normalizeUrl(message?.url);
    const mediaId = String(message?.mediaId || "");
    if (!url || !mediaId) return false;

    const video = bestVisibleVideoForStream();
    if (!video) return false;

    const rect = video.getBoundingClientRect();
    const intrinsicWidth = Math.round(video.videoWidth || 0);
    const intrinsicHeight = Math.round(video.videoHeight || 0);
    const poster = normalizeUrl(video.poster);
    const visualHint = nearbyImageForVideo(video);
    const generatedPreview = generatedVideoPreview(video);
    const previewUrl = generatedPreview || poster || visualHint?.previewUrl || null;
    const format = String(message.format || formatFromUrl(url, "stream")).toLowerCase();
    const streamKind = url.startsWith("blob:") ? "blob" : format;

    const registered = registerMedia({
      id: mediaId,
      type: "video",
      url,
      previewUrl,
      previewSource: generatedPreview
        ? "generated-frame"
        : poster
          ? "video-poster"
          : (visualHint?.previewSource || "stream-player"),
      width: intrinsicWidth || Math.round(rect.width || 0),
      height: intrinsicHeight || Math.round(rect.height || 0),
      resolutionSource: intrinsicWidth > 0 && intrinsicHeight > 0
        ? "video-metadata-dom"
        : "video-layout",
      duration: Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration)
        : null,
      format,
      streamKind,
      streaming: true,
      title: cleanTitle(
        video.getAttribute("aria-label") || document.title,
        "Video en streaming"
      ),
      source: "stream-player",
      downloadable: false,
      pageUrl: location.href
    }, video);

    if (registered?.id) {
      scheduleVideoPreview(video, registered.id);
    }

    return Boolean(registered);
  }

  function playerCaptureDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function playerCaptureDurationMatches(video, expectedDuration) {
    const expected = Number(expectedDuration || 0);
    const actual = Number(video?.duration || 0);
    if (!(expected > 0) || !(actual > 0) || !Number.isFinite(actual)) return true;

    const difference = Math.abs(expected - actual);
    if (difference <= PLAYER_CAPTURE_DURATION_TOLERANCE_SECONDS) return true;

    const ratio = Math.min(expected, actual) / Math.max(expected, actual);
    return ratio >= PLAYER_CAPTURE_MIN_DURATION_RATIO;
  }

  async function waitForPlayerCaptureVideo(expectedDuration) {
    const deadline = Date.now() + PLAYER_CAPTURE_VIDEO_WAIT_MS;

    while (Date.now() < deadline) {
      const video = bestVisibleVideoForStream();
      if (
        video instanceof HTMLVideoElement
        && video.readyState >= HTMLMediaElement.HAVE_METADATA
        && Number(video.videoWidth || 0) > 0
        && Number(video.videoHeight || 0) > 0
        && playerCaptureDurationMatches(video, expectedDuration)
      ) {
        return video;
      }
      await playerCaptureDelay(PLAYER_CAPTURE_VIDEO_POLL_MS);
    }

    throw new Error("No apareció un reproductor compatible para capturar.");
  }

  function createPlayerCaptureRecorder(stream, video) {
    if (typeof MediaRecorder !== "function") {
      throw new Error("MediaRecorder no está disponible en este navegador.");
    }

    const baseOptions = {
      videoBitsPerSecond: playerCaptureVideoBitrate(video)
    };
    if (stream.getAudioTracks().length) {
      baseOptions.audioBitsPerSecond = PLAYER_CAPTURE_AUDIO_BITRATE;
    }

    for (const mimeType of PLAYER_CAPTURE_MIME_TYPES) {
      try {
        if (!MediaRecorder.isTypeSupported(mimeType)) continue;
        return new MediaRecorder(stream, { ...baseOptions, mimeType });
      } catch {
        // Chromium puede anunciar un contenedor aunque el encoder concreto no
        // esté disponible en la máquina. Probamos el siguiente formato.
      }
    }

    try {
      return new MediaRecorder(stream, baseOptions);
    } catch {
      throw new Error("MediaRecorder no ofrece un formato de video compatible en este navegador.");
    }
  }

  function playerCaptureExtension(mime) {
    return String(mime || "").toLowerCase().includes("mp4") ? "mp4" : "webm";
  }

  function playerCaptureVideoBitrate(video) {
    const width = Number(video?.videoWidth || 0);
    const height = Number(video?.videoHeight || 0);
    const pixels = width * height;

    if (pixels <= 854 * 480) return PLAYER_CAPTURE_480P_BITRATE;
    if (pixels <= 1280 * 720) return PLAYER_CAPTURE_720P_BITRATE;
    if (pixels <= 1920 * 1080) return PLAYER_CAPTURE_1080P_BITRATE;
    return PLAYER_CAPTURE_HIGH_BITRATE;
  }

  function sanitizePlayerCaptureFilename(value, extension) {
    const base = String(value || document.title || "video")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 150) || "video";
    return `${base}.${extension}`;
  }

  function snapshotPlayerCaptureState(video) {
    return {
      currentTime: Number(video?.currentTime || 0),
      paused: Boolean(video?.paused),
      muted: Boolean(video?.muted),
      volume: Number.isFinite(Number(video?.volume)) ? Number(video.volume) : 1,
      playbackRate: Number.isFinite(Number(video?.playbackRate)) ? Number(video.playbackRate) : 1,
      defaultPlaybackRate: Number.isFinite(Number(video?.defaultPlaybackRate)) ? Number(video.defaultPlaybackRate) : 1,
      loop: Boolean(video?.loop)
    };
  }

  async function restorePlayerCaptureState(video, state) {
    if (!(video instanceof HTMLVideoElement) || !state) return;

    try { video.pause(); } catch {}
    try { video.loop = state.loop; } catch {}
    try { video.playbackRate = state.playbackRate; } catch {}
    try { video.defaultPlaybackRate = state.defaultPlaybackRate; } catch {}
    try { video.volume = state.volume; } catch {}
    try { video.muted = state.muted; } catch {}

    if (Number.isFinite(state.currentTime) && state.currentTime >= 0) {
      try {
        const duration = Number(video.duration || 0);
        const target = duration > 0
          ? Math.min(state.currentTime, Math.max(0, duration - 0.05))
          : state.currentTime;
        video.currentTime = target;
      } catch {}
    }

    if (!state.paused) {
      try { await video.play(); } catch {}
    }
  }

  async function seekPlayerCaptureToStart(video) {
    try { video.pause(); } catch {}
    try { video.loop = false; } catch {}
    try { video.playbackRate = 1; } catch {}
    try { video.defaultPlaybackRate = 1; } catch {}

    // El elemento se silencia durante la captura y después se restaura. La
    // captura de HTMLMediaElement conserva la pista de audio antes del mute.
    try { video.muted = true; } catch {}

    if (Number(video.currentTime || 0) > 0.05) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("seeked", finish);
          resolve();
        };
        video.addEventListener("seeked", finish, { once: true });
        try { video.currentTime = 0; } catch { finish(); }
        setTimeout(finish, 3_000);
      });
    }
  }

  function captureStreamFromVideo(video) {
    const capture = video.captureStream || video.webkitCaptureStream;
    if (typeof capture !== "function") {
      throw new Error("Este navegador no expone captureStream() para el reproductor.");
    }

    const stream = capture.call(video);
    if (!(stream instanceof MediaStream) || !stream.getVideoTracks().length) {
      throw new Error("El reproductor no expuso una pista de video capturable.");
    }
    return stream;
  }

  function addAudioFallbackFromElement(video, stream) {
    if (stream.getAudioTracks().length) {
      return { stream, audioContext: null };
    }

    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextClass !== "function") return { stream, audioContext: null };

    try {
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);

      const audioTracks = destination.stream.getAudioTracks();
      if (!audioTracks.length) {
        audioContext.close().catch(() => {});
        return { stream, audioContext: null };
      }

      const combined = new MediaStream([
        ...stream.getVideoTracks(),
        ...audioTracks
      ]);
      return { stream: combined, audioContext };
    } catch {
      return { stream, audioContext: null };
    }
  }

  function reportPlayerCapture(type, job, extra = {}) {
    chrome.runtime.sendMessage({
      type,
      sourceTabId: Number(job.sourceTabId),
      mediaId: String(job.mediaId || ""),
      ...extra
    }).catch(() => {});
  }

  async function runPlayerCapture(job) {
    let recorder = null;
    let sourceStream = null;
    let audioContext = null;
    let progressTimer = null;
    let objectUrl = null;
    let video = null;
    let originalVideoState = null;

    try {
      video = await waitForPlayerCaptureVideo(job.expectedDuration);
      originalVideoState = snapshotPlayerCaptureState(video);
      await seekPlayerCaptureToStart(video);

      sourceStream = captureStreamFromVideo(video);
      const enriched = addAudioFallbackFromElement(video, sourceStream);
      sourceStream = enriched.stream;
      audioContext = enriched.audioContext;

      const chunks = [];
      recorder = createPlayerCaptureRecorder(sourceStream, video);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size > 0) chunks.push(event.data);
      });

      let resolveStopped;
      let rejectStopped;
      const stopped = new Promise((resolve, reject) => {
        resolveStopped = resolve;
        rejectStopped = reject;
      });

      recorder.addEventListener("stop", () => resolveStopped(), { once: true });
      recorder.addEventListener("error", (event) => {
        rejectStopped(event?.error || new Error("MediaRecorder interrumpió la captura."));
      }, { once: true });

      const duration = Number(video.duration || job.expectedDuration || 0);
      let lastTime = Number(video.currentTime || 0);
      let lastAdvanceAt = Date.now();

      const stopRecorder = () => {
        if (recorder?.state && recorder.state !== "inactive") {
          try { recorder.stop(); } catch {}
        }
      };

      video.addEventListener("ended", stopRecorder, { once: true });
      video.addEventListener("error", () => {
        rejectStopped(new Error("El reproductor falló durante la captura."));
        stopRecorder();
      }, { once: true });

      recorder.start(PLAYER_CAPTURE_RECORDER_TIMESLICE_MS);

      try {
        await video.play();
      } catch {
        throw new Error("El navegador bloqueó la reproducción automática de la pestaña de captura.");
      }

      progressTimer = setInterval(() => {
        const current = Number(video.currentTime || 0);
        if (current > lastTime + 0.05) {
          lastTime = current;
          lastAdvanceAt = Date.now();
        }

        if (Date.now() - lastAdvanceAt > PLAYER_CAPTURE_STALL_TIMEOUT_MS) {
          rejectStopped(new Error("El reproductor dejó de avanzar durante la captura."));
          stopRecorder();
          return;
        }

        const percent = duration > 0
          ? Math.max(0, Math.min(99, Math.floor((current / duration) * 100)))
          : null;
        reportPlayerCapture("MEDIA_DROP_PLAYER_CAPTURE_PROGRESS", job, { percent });

        if (duration > 0 && current >= duration - 0.2) stopRecorder();
      }, PLAYER_CAPTURE_PROGRESS_MS);

      await stopped;
      clearInterval(progressTimer);
      progressTimer = null;

      const blobType = String(recorder.mimeType || "video/webm").split(";")[0] || "video/webm";
      const blob = new Blob(chunks, { type: blobType });
      if (blob.size < PLAYER_CAPTURE_MIN_BLOB_BYTES) {
        throw new Error("La captura terminó, pero el archivo resultante es demasiado pequeño.");
      }

      const extension = playerCaptureExtension(recorder.mimeType);
      const filename = sanitizePlayerCaptureFilename(job.title, extension);
      objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      (document.body || document.documentElement).append(anchor);
      anchor.click();
      anchor.remove();

      reportPlayerCapture("MEDIA_DROP_PLAYER_CAPTURE_COMPLETE", job, {
        size: blob.size,
        filename,
        mimeType: blob.type,
        hasAudio: sourceStream.getAudioTracks().length > 0
      });

      setTimeout(() => {
        try { URL.revokeObjectURL(objectUrl); } catch {}
      }, PLAYER_CAPTURE_BLOB_REVOKE_DELAY_MS);
    } catch (error) {
      if (progressTimer) clearInterval(progressTimer);
      if (recorder?.state && recorder.state !== "inactive") {
        try { recorder.stop(); } catch {}
      }
      reportPlayerCapture("MEDIA_DROP_PLAYER_CAPTURE_FAILED", job, {
        error: String(error?.message || error || "No fue posible capturar el reproductor.")
      });
    } finally {
      try {
        for (const track of sourceStream?.getTracks?.() || []) track.stop();
      } catch {}
      if (audioContext) {
        try { await audioContext.close(); } catch {}
      }
      if (video && originalVideoState) {
        await restorePlayerCaptureState(video, originalVideoState);
      }
    }
  }

  function generatedVideoPreview(video) {
    if (!(video instanceof HTMLVideoElement)) return null;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;

    const sourceWidth = Number(video.videoWidth || 0);
    const sourceHeight = Number(video.videoHeight || 0);
    if (sourceWidth < 2 || sourceHeight < 2) return null;

    // The popup never needs a full-resolution frame. Keeping previews compact
    // prevents snapshots/messages from becoming unnecessarily large.
    const maxWidth = 320;
    const maxHeight = 180;
    const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
    const width = Math.max(2, Math.round(sourceWidth * scale));
    const height = Math.max(2, Math.round(sourceHeight * scale));

    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true
      });
      if (!context) return null;

      context.drawImage(video, 0, 0, width, height);

      // WebP is supported by Chromium and keeps generated previews small.
      // If the frame is cross-origin without CORS, toDataURL throws a
      // SecurityError and we simply keep the normal fallback.
      return canvas.toDataURL("image/webp", 0.72);
    } catch {
      return null;
    }
  }

  function publishGeneratedVideoPreview(mediaId, previewUrl) {
    if (!mediaId || !previewUrl) return;

    const current = mediaItems.get(mediaId);
    if (!current || current.previewUrl === previewUrl) return;

    const updated = {
      ...current,
      previewUrl,
      previewSource: "generated-frame"
    };

    mediaItems.set(mediaId, updated);
    pendingUpserts.set(mediaId, updated);
    scheduleUpsertFlush();
  }

  async function requestBackgroundVideoPreview(mediaId) {
    const item = mediaItems.get(mediaId);
    if (!item || item.type !== "video" || !item.downloadable) return;

    try {
      await chrome.runtime.sendMessage({
        type: "REQUEST_VIDEO_PREVIEW",
        mediaId
      });
    } catch {
      // Best-effort: the normal poster/fallback remains available.
    }
  }

  function scheduleVideoPreview(video, mediaId) {
    if (!(video instanceof HTMLVideoElement) || !mediaId) return;
    if (previewJobs.has(video)) return;

    const job = {
      mediaId,
      attempts: 0,
      timer: null,
      done: false,
      fallbackRequested: false,
      videoFrameCallbackId: null,
      startedAt: performance.now()
    };
    previewJobs.set(video, job);

    const requestFallback = () => {
      if (job.fallbackRequested || job.done) return;
      job.fallbackRequested = true;
      requestBackgroundVideoPreview(job.mediaId);
    };

    const cleanup = () => {
      clearTimeout(job.timer);
      for (const eventName of ["loadedmetadata", "loadeddata", "canplay", "playing", "timeupdate", "seeked"]) {
        video.removeEventListener(eventName, tryCapture);
      }

      if (
        job.videoFrameCallbackId !== null
        && typeof video.cancelVideoFrameCallback === "function"
      ) {
        try { video.cancelVideoFrameCallback(job.videoFrameCallbackId); } catch {}
      }
    };

    const finish = (previewUrl) => {
      if (job.done) return;
      job.done = true;
      cleanup();

      if (previewUrl) {
        publishGeneratedVideoPreview(job.mediaId, previewUrl);
      } else {
        requestFallback();
      }
    };

    const scheduleNextAttempt = () => {
      if (job.done) return;

      const elapsed = performance.now() - job.startedAt;
      if (job.attempts >= 18 || elapsed > 12_000) {
        finish(null);
        return;
      }

      clearTimeout(job.timer);
      job.timer = setTimeout(tryCapture, 500);
    };

    function tryCapture() {
      if (job.done) return;

      if (!video.isConnected) {
        finish(null);
        return;
      }

      job.attempts += 1;

      const previewUrl = generatedVideoPreview(video);
      if (previewUrl) {
        finish(previewUrl);
        return;
      }

      // Cross-origin video frames often cannot be exported from a page canvas.
      // Ask the extension's hidden Offscreen worker early, while still keeping
      // the page-frame capture alive in case the video becomes drawable later.
      if (job.attempts >= 3) requestFallback();

      scheduleNextAttempt();
    }

    for (const eventName of ["loadedmetadata", "loadeddata", "canplay", "playing", "timeupdate", "seeked"]) {
      video.addEventListener(eventName, tryCapture, { passive: true });
    }

    if (typeof video.requestVideoFrameCallback === "function") {
      const onFrame = () => {
        if (job.done) return;

        const previewUrl = generatedVideoPreview(video);
        if (previewUrl) {
          finish(previewUrl);
          return;
        }

        requestFallback();
        try {
          job.videoFrameCallbackId = video.requestVideoFrameCallback(onFrame);
        } catch {}
      };

      try {
        job.videoFrameCallbackId = video.requestVideoFrameCallback(onFrame);
      } catch {}
    }

    queueMicrotask(tryCapture);
  }

  function detectVideo(video, allowSmall = false) {
    if (!(video instanceof HTMLVideoElement)) return null;
    const rect = video.getBoundingClientRect();
    if (!isVisibleSize(video, allowSmall, rect)) return null;

    if (!videoMetadataListeners.has(video)) {
      videoMetadataListeners.add(video);
      for (const eventName of ["loadedmetadata", "loadeddata", "durationchange"]) {
        video.addEventListener(eventName, () => detectVideo(video, true), { passive: true });
      }
    }

    refreshInstagramNetworkItemsForVideo(video);

    const candidates = videoCandidates(video);
    if (!candidates.length) return null;

    const url = candidates[0].url;
    const format = formatFromUrl(url, "video");
    const isStream = url.startsWith("blob:") || ["m3u8", "mpd", "stream"].includes(format);
    const intrinsicWidth = Math.round(video.videoWidth || 0);
    const intrinsicHeight = Math.round(video.videoHeight || 0);
    const visualHint = location.hostname.includes("instagram.com")
      ? nearbyImageForVideo(video, rect)
      : null;
    const poster = normalizeUrl(video.poster);
    const previewUrl = poster || visualHint?.previewUrl || null;

    const registered = registerMedia({
      type: "video",
      url,
      previewUrl,
      previewSource: poster ? "video-poster" : (visualHint?.previewSource || null),
      width: intrinsicWidth || Math.round(rect.width || 0),
      height: intrinsicHeight || Math.round(rect.height || 0),
      resolutionSource: intrinsicWidth > 0 && intrinsicHeight > 0
        ? "video-metadata-dom"
        : "video-layout",
      duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
      format,
      originalFilename: originalFilenameFromUrl(url),
      title: cleanTitle(video.getAttribute("aria-label") || document.title, "Video"),
      source: location.hostname.includes("instagram.com") ? "instagram" : "dom",
      streaming: isStream,
      streamKind: isStream
        ? (url.startsWith("blob:") ? "blob" : format)
        : null,
      downloadable: !isStream,
      pageUrl: location.href
    }, video);

    // Generate a thumbnail from the video's own decoded frame. If the site
    // has a poster it is used only as an immediate fallback until the real
    // generated frame is available. The original media is never modified.
    if (registered?.id) {
      scheduleVideoPreview(video, registered.id);
    }

    return registered;
  }

  function backgroundUrl(element) {
    if (!(element instanceof Element)) return null;
    const value = getComputedStyle(element).backgroundImage;
    if (!value || value === "none") return null;
    const match = value.match(/url\((?:"|')?(.*?)(?:"|')?\)/i);
    return normalizeUrl(match?.[1]);
  }

  function detectBackground(element, allowSmall = false, knownRect = null) {
    if (!(element instanceof Element)) return null;
    const url = backgroundUrl(element);
    if (!url) return null;
    const rect = knownRect || element.getBoundingClientRect();
    if (isSvgUrl(url) ? !isVisibleSvgSize(element, rect) : !isVisibleSize(element, allowSmall, rect)) return null;

    return registerMedia({
      type: "image",
      url,
      previewUrl: url,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      format: formatFromUrl(url, "image"),
      originalFilename: originalFilenameFromUrl(url),
      title: cleanTitle(element.getAttribute("aria-label") || element.getAttribute("title"), "Foto"),
      source: "css",
      downloadable: !url.startsWith("blob:"),
      pageUrl: location.href
    }, element);
  }

  function detectSvgImage(element, allowSmall = false) {
    if (!(element instanceof SVGImageElement)) return null;
    const url = normalizeUrl(element.getAttribute("href") || element.getAttribute("xlink:href"));
    if (!url) return null;
    const rect = element.getBoundingClientRect();
    if (!isVisibleSvgSize(element, rect)) return null;
    return registerMedia({
      type: "image",
      url,
      previewUrl: url,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      format: formatFromUrl(url, "image"),
      originalFilename: originalFilenameFromUrl(url),
      title: cleanTitle(element.getAttribute("aria-label") || element.getAttribute("title"), "Foto"),
      source: "svg-image",
      downloadable: !url.startsWith("blob:"),
      pageUrl: location.href
    }, element);
  }

  function detectEmbeddedSvg(element, allowSmall = false) {
    const isObject = element instanceof HTMLObjectElement;
    const isEmbed = element instanceof HTMLEmbedElement;
    if (!isObject && !isEmbed) return null;

    const rawUrl = isObject ? element.getAttribute("data") : element.getAttribute("src");
    const url = normalizeUrl(rawUrl);
    const hintedType = String(element.getAttribute("type") || "").toLowerCase();
    if (!url || (!isSvgUrl(url) && hintedType !== "image/svg+xml")) return null;
    const rect = element.getBoundingClientRect();
    if (!isVisibleSvgSize(element, rect)) return null;

    return registerMedia({
      type: "image",
      url,
      previewUrl: url,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      format: "svg",
      originalFilename: originalFilenameFromUrl(url),
      title: cleanTitle(element.getAttribute("aria-label") || element.getAttribute("title"), "SVG"),
      source: isObject ? "svg-object" : "svg-embed",
      downloadable: !url.startsWith("blob:"),
      pageUrl: location.href
    }, element);
  }

  function detectSvgDocument(root = document) {
    if (root !== document) return null;
    const svg = document.documentElement;
    if (!(svg instanceof SVGSVGElement) || !isSvgUrl(location.href)) return null;

    const viewBox = svg.viewBox?.baseVal;
    const rect = svg.getBoundingClientRect();
    const width = Math.round(viewBox?.width || svg.width?.baseVal?.value || rect.width || 0);
    const height = Math.round(viewBox?.height || svg.height?.baseVal?.value || rect.height || 0);

    return registerMedia({
      type: "image",
      url: location.href,
      previewUrl: location.href,
      width,
      height,
      format: "svg",
      originalFilename: originalFilenameFromUrl(location.href),
      title: cleanTitle(document.title, originalFilenameFromUrl(location.href) || "SVG"),
      source: "svg-document",
      downloadable: true,
      pageUrl: location.href
    }, svg);
  }

  function detectPseudoBackground(element, pseudo, knownRect = null) {
    if (!(element instanceof Element)) return null;
    let value = "";
    try { value = getComputedStyle(element, pseudo).backgroundImage; } catch { return null; }
    if (!value || value === "none") return null;
    const match = value.match(/url\((?:"|')?(.*?)(?:"|')?\)/i);
    const url = normalizeUrl(match?.[1]);
    if (!url) return null;
    const rect = knownRect || element.getBoundingClientRect();
    if (isSvgUrl(url) ? !isVisibleSvgSize(element, rect) : !isVisibleSize(element, false, rect)) return null;
    return registerMedia({
      type: "image", url, previewUrl: url,
      width: Math.round(rect.width), height: Math.round(rect.height),
      format: formatFromUrl(url, "image"), originalFilename: originalFilenameFromUrl(url),
      title: cleanTitle(element.getAttribute("aria-label") || element.getAttribute("title"), "Foto"),
      source: `css-${pseudo.replace(":", "")}`, downloadable: !url.startsWith("blob:"), pageUrl: location.href
    }, element);
  }

  function detectImageMetadata(root = document) {
    if (!root?.querySelectorAll) return;
    const selectors = [
      'meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]',
      'link[rel="image_src"]', 'link[rel="preload"][as="image"]'
    ];
    for (const node of root.querySelectorAll(selectors.join(","))) {
      const raw = node.getAttribute("content") || node.getAttribute("href");
      const url = normalizeUrl(raw);
      if (!url) continue;
      registerMedia({
        type: "image", url, previewUrl: url, width: 0, height: 0,
        format: formatFromUrl(url, "image"), originalFilename: originalFilenameFromUrl(url),
        title: cleanTitle(document.title, "Foto"), source: "metadata",
        downloadable: !url.startsWith("blob:"), pageUrl: location.href
      });
    }
  }

  function inspectElement(element, allowSmall = false) {
    if (element instanceof HTMLImageElement) return detectImage(element, allowSmall);
    if (element instanceof HTMLVideoElement) return detectVideo(element, allowSmall);
    if (typeof SVGImageElement !== "undefined" && element instanceof SVGImageElement) return detectSvgImage(element, allowSmall);
    if (element instanceof HTMLObjectElement || element instanceof HTMLEmbedElement) return detectEmbeddedSvg(element, allowSmall);
    if (element instanceof HTMLSourceElement) {
      const parent = element.closest("video");
      return parent ? detectVideo(parent, allowSmall) : null;
    }
    return null;
  }

  function detectVideoMetadata(root = document) {
    if (!root?.querySelectorAll) return;

    const metaSelectors = [
      'meta[property="og:video"]', 'meta[property="og:video:url"]', 'meta[property="og:video:secure_url"]',
      'meta[name="twitter:player:stream"]', 'meta[itemprop="contentUrl"]'
    ];

    for (const meta of root.querySelectorAll(metaSelectors.join(","))) {
      const url = normalizeUrl(meta.getAttribute("content"));
      if (!url) continue;
      const format = formatFromUrl(url, "video");
      const isStream = url.startsWith("blob:") || ["m3u8", "mpd", "stream"].includes(format);
      registerMedia({
        type: "video",
        url,
        previewUrl: null,
        width: 0,
        height: 0,
        duration: null,
        format,
        title: cleanTitle(document.title, "Video"),
        source: "metadata",
        streaming: isStream,
        streamKind: isStream ? (url.startsWith("blob:") ? "blob" : format) : null,
        downloadable: !isStream,
        pageUrl: location.href
      });
    }

    for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
      const raw = script.textContent?.trim();
      if (!raw || raw.length > 2_000_000) continue;
      try {
        const data = JSON.parse(raw);
        const stack = Array.isArray(data) ? [...data] : [data];
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== "object") continue;
          if (Array.isArray(node)) { stack.push(...node); continue; }
          const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] || "");
          if (/VideoObject/i.test(type)) {
            const rawUrls = [node.contentUrl, node.embedUrl].flat().filter(Boolean);
            for (const rawUrl of rawUrls) {
              const url = normalizeUrl(rawUrl);
              if (!url) continue;
              const format = formatFromUrl(url, "video");
              const isStream = ["m3u8", "mpd", "stream"].includes(format) || url.startsWith("blob:");
              registerMedia({
                type: "video", url, previewUrl: normalizeUrl(node.thumbnailUrl),
                width: Number(node.width || 0) || 0, height: Number(node.height || 0) || 0,
                duration: null, format, title: cleanTitle(node.name || document.title, "Video"),
                source: "json-ld",
                streaming: isStream,
                streamKind: isStream ? (url.startsWith("blob:") ? "blob" : format) : null,
                downloadable: !isStream,
                pageUrl: location.href
              });
            }
          }
          for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
        }
      } catch {
        // JSON-LD inválido o generado dinámicamente: se ignora.
      }
    }
  }

  function isMediaDropUiElement(node) {
    return node instanceof Element && Boolean(node.closest?.("[data-media-drop-ui]"));
  }

  function scanRoot(root) {
    if (!root?.querySelectorAll) return;
    if (isMediaDropUiElement(root)) return;

    detectSvgDocument(root);
    if (root instanceof Element) inspectElement(root);

    for (const element of root.querySelectorAll("img, video, video source, svg image, object[data], embed[src]")) {
      inspectElement(element);
    }

    // Fondos CSS inline y elementos con clases/atributos que suelen usar imágenes dinámicas.
    const backgroundCandidates = root.querySelectorAll('[style*="background"], [class*="image"], [class*="photo"], [class*="thumb"], [data-bg], [data-background], [data-background-image]');
    let backgroundCount = 0;
    for (const element of backgroundCandidates) {
      if (backgroundCount++ > 250) break;
      const hasDataBackground = element.matches('[data-bg], [data-background], [data-background-image]');
      const knownRect = hasDataBackground ? element.getBoundingClientRect() : null;
      detectBackground(element, false, knownRect);
      if (hasDataBackground) {
        const raw = element.getAttribute("data-bg") || element.getAttribute("data-background") || element.getAttribute("data-background-image");
        const url = normalizeUrl(raw);
        if (url) {
          const rect = knownRect;
          if (!(isSvgUrl(url) ? isVisibleSvgSize(element, rect) : isVisibleSize(element, false, rect))) continue;
          registerMedia({
            type: "image", url, previewUrl: url, width: Math.round(rect.width), height: Math.round(rect.height),
            format: formatFromUrl(url, "image"), originalFilename: originalFilenameFromUrl(url),
            title: cleanTitle(element.getAttribute("aria-label") || element.getAttribute("title"), "Foto"),
            source: "data-background", downloadable: !url.startsWith("blob:"), pageUrl: location.href
          }, element);
        }
      }
    }

    // Pseudo-elementos: se limita el muestreo para evitar castigar páginas gigantes.
    let pseudoCount = 0;
    for (const element of root.querySelectorAll('[class*="image"], [class*="photo"], [class*="thumb"], figure, picture')) {
      if (pseudoCount++ > 120) break;
      detectPseudoBackground(element, "::before");
      detectPseudoBackground(element, "::after");
    }

    detectImageMetadata(root);
    detectVideoMetadata(root);

    // Algunos reproductores modernos encapsulan el <video> dentro de shadow DOM abierto.
    // Cada root se escanea una vez y luego queda bajo el mismo MutationObserver;
    // así los cambios dinámicos siguen detectándose sin reescanearlo completo.
    for (const host of root.querySelectorAll("*")) {
      const shadowRoot = host.shadowRoot;
      if (!shadowRoot) continue;

      const firstVisit = !observedShadowRoots.has(shadowRoot);
      if (firstVisit) {
        observedShadowRoots.add(shadowRoot);
        if (mutationObserver) {
          try { mutationObserver.observe(shadowRoot, MEDIA_MUTATION_OBSERVER_OPTIONS); } catch {}
        }
      }

      if (firstVisit || shadowRescanRequested) scanRoot(shadowRoot);
    }

    if (root === document) shadowRescanRequested = false;
  }

  function inspectPerformanceEntry(entry) {
    if (!entry || typeof entry !== "object") return;
    if (processedPerformanceEntries.has(entry)) return;
    processedPerformanceEntries.add(entry);

    const url = normalizeUrl(entry.name);
    if (!url || url.startsWith("blob:")) return;

    if (/\.(?:m4s|ts|aac|cmfv|cmfa)(?:$|[?#])/i.test(url)) return;

    const format = formatFromUrl(url, "");
    const decoded = (() => { try { return decodeURIComponent(url); } catch { return url; } })();
    const queryHintsVideo = /(?:[?&](?:mime|type|format|content_type)=video(?:%2F|\/)|videoplayback|video_url=)/i.test(decoded);
    const stream = ["m3u8", "mpd"].includes(format);
    const looksLikeVideo = stream
      || ["mp4", "webm", "mov", "m4v", "ogv"].includes(format)
      || queryHintsVideo
      || ["video", "media"].includes(entry.initiatorType);

    if (!looksLikeVideo) return;

    const instagramHint = location.hostname.includes("instagram.com")
      ? instagramVisualHintForNetworkUrl(url)
      : null;

    registerMedia({
      type: "video",
      url,
      previewUrl: instagramHint?.previewUrl || null,
      previewSource: instagramHint?.previewSource || null,
      width: instagramHint?.width || 0,
      height: instagramHint?.height || 0,
      resolutionSource: instagramHint?.resolutionSource || null,
      duration: null,
      format: format || "video",
      title: cleanTitle(document.title, "Video"),
      source: location.hostname.includes("instagram.com") ? "instagram" : "network",
      streaming: stream,
      streamKind: stream ? format : null,
      downloadable: !stream,
      pageUrl: location.href
    });
  }

  function scanPerformanceResources() {
    try {
      const entries = performance.getEntriesByType("resource");

      // Resource Timing normalmente crece de forma acumulativa. Procesar solo
      // la cola nueva evita volver a recorrer cientos de entradas ya vistas en
      // cada mutación del DOM. Si la página limpia el buffer, reiniciamos.
      if (entries.length < performanceResourceCursor) performanceResourceCursor = 0;

      for (let index = performanceResourceCursor; index < entries.length; index += 1) {
        inspectPerformanceEntry(entries[index]);
      }

      performanceResourceCursor = entries.length;
    } catch {
      // Resource Timing puede estar restringido por algunas páginas.
    }
  }

  function scheduleUpsertFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const items = [...pendingUpserts.values()];
      pendingUpserts.clear();
      if (!items.length) return;
      chrome.runtime.sendMessage({ type: "MEDIA_UPSERTS", items }).catch(() => {});
    }, 120);
  }

  function scheduleNodeScan(node) {
    if (node) {
      // Si ya tenemos un ancestro pendiente, escanear también al hijo sería
      // trabajo duplicado. Si llega el ancestro después, sustituye a sus hijos.
      let covered = false;
      for (const pendingNode of pendingNodes) {
        if (pendingNode === node || pendingNode.contains?.(node)) {
          covered = true;
          break;
        }
        if (node.contains?.(pendingNode)) pendingNodes.delete(pendingNode);
      }
      if (!covered) pendingNodes.add(node);
    }

    if (scanTimer) return;

    scanTimer = setTimeout(() => {
      scanTimer = null;
      const nodes = [...pendingNodes];
      pendingNodes.clear();

      if (nodes.length > 80) {
        scanRoot(document);
      } else {
        for (const pendingNode of nodes) scanRoot(pendingNode);
      }
      if (!performanceObserverActive) scanPerformanceResources();
    }, 120);
  }

  function resetForNavigation() {
    shadowRescanRequested = true;
    mediaItems.clear();
    elementRefs.clear();
    pendingUpserts.clear();
    instagramNetworkVisualAssignments.clear();
    instagramUsedVisualIds.clear();
    hideHoverButton();
    clearMobileFixedImageButtons();
    for (const mediaId of [...activeBadges.keys()]) removeBadge(mediaId);
    chrome.runtime.sendMessage({ type: "MEDIA_RESET" }).catch(() => {});
    setTimeout(() => {
      scanRoot(document);
      scanPerformanceResources();
    }, 200);
  }

  function createHoverButton() {
    const host = document.createElement("div");
    host.dataset.mediaDropUi = "hover";
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      width: "17px",
      height: "17px",
      display: "none",
      zIndex: "2147483647",
      pointerEvents: "auto"
    });

    const shadow = host.attachShadow({ mode: "closed" });
    applySharedShadowStyle(shadow, "hover-control", HOVER_CONTROL_CSS);

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Descargar este medio");
    button.title = "Descargar";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11"></path>
        <path d="m7.5 10 4.5 4.5 4.5-4.5"></path>
        <path d="M5 20h14"></path>
      </svg>
    `;

    shadow.append(button);
    document.documentElement.append(host);

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if ((!hoverItem?.downloadable && !hoverItem?.streaming) || !hoverTarget) return;
      if (isImageDownloaded(hoverItem, hoverTarget)) return;
      const item = hoverItem;
      const target = hoverTarget;
      hideHoverButton();
      createProgressBadge(item.id, target);
      await requestDownload(item);
    });

    return { host, button, visualStateKey: "" };
  }

  const hoverControl = createHoverButton();

  // ============================================================
  // MOBILE · BOTÓN FIJO SOBRE IMÁGENES
  // ============================================================

  function createMobileFixedImageButton(item, target) {
    const host = document.createElement("div");
    host.dataset.mediaDropUi = "mobile-fixed-image-download";
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      width: `${MOBILE_FIXED_IMAGE_BUTTON_SIZE_PX}px`,
      height: `${MOBILE_FIXED_IMAGE_BUTTON_SIZE_PX}px`,
      display: "none",
      zIndex: "2147483647",
      pointerEvents: "auto"
    });

    const shadow = host.attachShadow({ mode: "closed" });
    applySharedShadowStyle(shadow, "mobile-fixed-control", MOBILE_FIXED_CONTROL_CSS);

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Descargar esta imagen");
    button.title = "Descargar imagen";
    button.innerHTML = IMAGE_DOWNLOAD_ICON_SVG;

    shadow.append(button);
    document.documentElement.append(host);

    const control = { host, button, target, mediaId: item.id, downloaded: false, visualStateKey: "" };
    mobileFixedImageControls.set(target, control);

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const currentItem = mediaItems.get(control.mediaId);
      if (control.downloaded) return;
      if (!currentItem || (!currentItem.downloadable && !currentItem.streaming) || !control.target?.isConnected) return;

      hideMobileFixedImageButtonsForMedia(control.mediaId);
      createProgressBadge(control.mediaId, control.target);
      await requestDownload(currentItem);
    });

    return control;
  }

  function isMediaDownloaded(item, target = null) {
    if (!item) return false;
    if (downloadedImageHistory.has(item.id) || sessionDownloadedImageIds.has(item.id)) return true;
    return item.type === "image" && target instanceof Element && sessionDownloadedImageElements.has(target);
  }

  function markImageDownloaded(mediaId) {
    const normalizedId = String(mediaId || "");
    if (!normalizedId) return;

    sessionDownloadedImageIds.add(normalizedId);

    for (const control of mobileFixedImageControls.values()) {
      if (control.mediaId !== normalizedId) continue;
      if (control.target instanceof Element) sessionDownloadedImageElements.add(control.target);
      const item = mediaItems.get(control.mediaId);
      if (item) syncMobileFixedImageButtonState(control, item);
    }

    if (!IS_MOBILE_PLATFORM && hoverItem?.id === normalizedId && hoverTarget instanceof Element) {
      sessionDownloadedImageElements.add(hoverTarget);
      showHoverButton(hoverTarget, hoverItem);
    }
  }

  function normalizeDownloadedImageHistory(rawHistory) {
    if (!rawHistory || typeof rawHistory !== "object" || Array.isArray(rawHistory)) return [];
    return Object.keys(rawHistory).filter((mediaId) => typeof mediaId === "string" && mediaId.startsWith("md-"));
  }

  function syncMobileFixedImageButtonState(control, item) {
    if (!control?.button || !item) return;

    const downloaded = isMediaDownloaded(item, control.target);
    const canDownload = item.downloadable || item.streaming;
    const visualStateKey = `${downloaded ? 1 : 0}:${canDownload ? 1 : 0}`;
    control.downloaded = downloaded;

    // Evita reconstruir el SVG y recalcular estilos cuando nada visible cambió.
    if (control.visualStateKey === visualStateKey) return;
    control.visualStateKey = visualStateKey;
    control.button.dataset.downloaded = downloaded ? "true" : "false";

    if (downloaded) {
      control.button.disabled = false;
      control.button.innerHTML = IMAGE_DOWNLOADED_ICON_SVG;
      control.button.title = "Imagen ya descargada";
      control.button.setAttribute("aria-label", control.button.title);
      return;
    }

    control.button.disabled = !canDownload;
    control.button.innerHTML = IMAGE_DOWNLOAD_ICON_SVG;
    control.button.title = canDownload ? "Descargar imagen" : "Esta imagen no admite descarga";
    control.button.setAttribute("aria-label", canDownload ? "Descargar esta imagen" : "Esta imagen no admite descarga");
  }

  function refreshMobileDownloadedImageStates() {
    if (!IS_MOBILE_PLATFORM) return;
    for (const control of mobileFixedImageControls.values()) {
      const item = mediaItems.get(control.mediaId);
      if (item) syncMobileFixedImageButtonState(control, item);
    }
  }

  function positionMobileFixedImageControl(control) {
    const target = control?.target;
    const host = control?.host;
    if (!host || !target?.isConnected) {
      if (host) host.style.display = "none";
      return false;
    }

    const rect = target.getBoundingClientRect();
    const size = MOBILE_FIXED_IMAGE_BUTTON_SIZE_PX;
    const margin = MOBILE_FIXED_IMAGE_BUTTON_VIEWPORT_MARGIN_PX;
    const sideOffset = MOBILE_FIXED_IMAGE_BUTTON_SIDE_OFFSET_PX;
    const left = Math.min(window.innerWidth - size - margin, Math.max(margin, rect.right - size - sideOffset));
    const top = Math.min(window.innerHeight - size - margin, Math.max(margin, rect.bottom - size - sideOffset));
    const visible = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

    const nextLeft = `${Math.round(left)}px`;
    const nextTop = `${Math.round(top)}px`;
    const nextDisplay = visible ? "block" : "none";
    if (host.style.left !== nextLeft) host.style.left = nextLeft;
    if (host.style.top !== nextTop) host.style.top = nextTop;
    if (host.style.display !== nextDisplay) host.style.display = nextDisplay;
    return visible;
  }

  function syncMobileFixedImageButton(item, target) {
    if (!IS_MOBILE_PLATFORM || !hoverDownloadButtonEnabled || item?.type !== "image" || !(target instanceof Element)) {
      removeMobileFixedImageButton(target);
      return;
    }

    let control = mobileFixedImageControls.get(target);
    if (!control) control = createMobileFixedImageButton(item, target);

    control.mediaId = item.id;
    control.target = target;
    syncMobileFixedImageButtonState(control, item);

    if (activeBadges.has(item.id)) {
      control.host.style.display = "none";
      return;
    }

    positionMobileFixedImageControl(control);
  }

  function removeMobileFixedImageButton(target) {
    const control = mobileFixedImageControls.get(target);
    if (!control) return;
    control.host.remove();
    mobileFixedImageControls.delete(target);
  }

  function removeMobileFixedImageButtonsForMedia(mediaId) {
    for (const [target, control] of mobileFixedImageControls) {
      if (control.mediaId === mediaId) removeMobileFixedImageButton(target);
    }
  }

  function clearMobileFixedImageButtons() {
    for (const target of mobileFixedImageControls.keys()) removeMobileFixedImageButton(target);
  }

  function hideMobileFixedImageButtonsForMedia(mediaId) {
    for (const control of mobileFixedImageControls.values()) {
      if (control.mediaId === mediaId) control.host.style.display = "none";
    }
  }

  function restoreMobileFixedImageButtonsForMedia(mediaId) {
    if (!IS_MOBILE_PLATFORM || !hoverDownloadButtonEnabled || activeBadges.has(mediaId)) return;
    for (const control of mobileFixedImageControls.values()) {
      if (control.mediaId !== mediaId) continue;
      const item = mediaItems.get(control.mediaId);
      if (item) syncMobileFixedImageButtonState(control, item);
      positionMobileFixedImageControl(control);
    }
  }

  function refreshMobileFixedImageButtons() {
    if (!IS_MOBILE_PLATFORM || !hoverDownloadButtonEnabled) {
      clearMobileFixedImageButtons();
      return;
    }

    for (const [mediaId, item] of mediaItems) {
      if (item.type !== "image") continue;
      const target = getElementForMedia(mediaId);
      if (target) syncMobileFixedImageButton(item, target);
    }

    // Recorremos de nuevo el DOM para cubrir imágenes duplicadas que comparten URL/ID.
    scanRoot(document);
  }

  function findMediaTarget(event) {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLImageElement || node instanceof HTMLVideoElement) return node;
      if (node instanceof Element && node.dataset?.mediaDropUi) return null;
    }

    let element = event.target instanceof Element ? event.target : null;
    for (let depth = 0; element && depth < 4; depth += 1, element = element.parentElement) {
      if (backgroundUrl(element) && isVisibleSize(element, true)) return element;
    }
    return null;
  }

  function itemForTarget(target) {
    if (target instanceof HTMLImageElement) return detectImage(target, true);
    if (target instanceof HTMLVideoElement) return detectVideo(target, true);
    return detectBackground(target, true);
  }

  function positionFloatingHost(host, target) {
    if (!host || !target?.isConnected) {
      if (host) host.style.display = "none";
      return false;
    }

    const rect = target.getBoundingClientRect();
    const size = Number.parseFloat(host.style.width) || 18;
    const bottomOffset = target instanceof HTMLVideoElement && target.controls ? 44 : 7;
    const sideOffset = 7;
    const left = Math.min(window.innerWidth - size - 4, Math.max(4, rect.right - size - sideOffset));
    const top = Math.min(window.innerHeight - size - 4, Math.max(4, rect.bottom - size - bottomOffset));
    const visible = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

    const nextLeft = `${Math.round(left)}px`;
    const nextTop = `${Math.round(top)}px`;
    const nextDisplay = visible ? "block" : "none";
    if (host.style.left !== nextLeft) host.style.left = nextLeft;
    if (host.style.top !== nextTop) host.style.top = nextTop;
    if (host.style.display !== nextDisplay) host.style.display = nextDisplay;
    return visible;
  }

  function showHoverButton(target, item) {
    if (IS_MOBILE_PLATFORM || !hoverDownloadButtonEnabled || !item || activeBadges.has(item.id)) {
      hideHoverButton();
      return;
    }
    hoverTarget = target;
    hoverItem = item;
    const downloaded = isMediaDownloaded(item, target);
    const canDownload = item.downloadable || item.streaming;
    const visualStateKey = [
      downloaded ? 1 : 0,
      canDownload ? 1 : 0,
      item.type || "",
      item.streaming ? 1 : 0,
      item.downloadable ? 1 : 0
    ].join(":");

    if (hoverControl.visualStateKey !== visualStateKey) {
      hoverControl.visualStateKey = visualStateKey;
      hoverControl.button.dataset.downloaded = downloaded ? "true" : "false";
      hoverControl.button.disabled = downloaded ? false : !canDownload;

      if (downloaded) {
        hoverControl.button.innerHTML = IMAGE_DOWNLOADED_ICON_SVG;
        hoverControl.button.title = item?.type === "video" ? "Video ya descargado" : "Imagen ya descargada";
        hoverControl.button.setAttribute("aria-label", hoverControl.button.title);
      } else {
        hoverControl.button.innerHTML = IMAGE_DOWNLOAD_ICON_SVG;
        hoverControl.button.title = item.streaming
          ? "Descargar video en streaming"
          : item.downloadable
            ? "Descargar"
            : "Este medio no admite descarga";
        hoverControl.button.setAttribute(
          "aria-label",
          canDownload ? "Descargar este medio" : "Medio no descargable"
        );
      }
    }
    positionFloatingHost(hoverControl.host, hoverTarget);
  }

  function hideHoverButton() {
    hoverControl.host.style.display = "none";
    hoverTarget = null;
    hoverItem = null;
  }

  function createProgressBadge(mediaId, target) {
    if (!target?.isConnected) return null;
    if (activeBadges.has(mediaId)) return activeBadges.get(mediaId);

    hideMobileFixedImageButtonsForMedia(mediaId);

    const host = document.createElement("div");
    host.dataset.mediaDropUi = "progress";
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      width: "17px",
      height: "17px",
      zIndex: "2147483647",
      pointerEvents: "none"
    });

    const shadow = host.attachShadow({ mode: "closed" });
    applySharedShadowStyle(shadow, "progress-badge", PROGRESS_BADGE_CSS);

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Descarga en progreso");
    const ring = document.createElement("span");
    ring.className = "ring indeterminate";
    const dots = [];

    for (let index = 0; index < DOT_COUNT; index += 1) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.transform = `rotate(${index * (360 / DOT_COUNT)}deg) translateY(-4.4px)`;
      ring.append(dot);
      dots.push(dot);
    }

    const center = document.createElement("span");
    center.className = "center";
    button.append(ring, center);
    shadow.append(button);
    document.documentElement.append(host);

    const badge = { mediaId, target, host, button, ring, dots, center, state: "in_progress" };
    activeBadges.set(mediaId, badge);
    positionFloatingHost(host, target);
    updateBadge(badge, { state: "in_progress", percent: null });

    button.addEventListener("click", async (event) => {
      if (badge.state !== "interrupted") return;
      event.preventDefault();
      event.stopPropagation();
      const item = mediaItems.get(mediaId);
      if (!item) return;
      updateBadge(badge, { state: "in_progress", percent: null });
      await requestDownload(item);
    });

    return badge;
  }

  function updateBadge(badge, progress) {
    if (!badge) return;
    const state = progress.state || "in_progress";
    const percent = Number.isFinite(progress.percent) ? progress.percent : null;
    badge.state = state;
    badge.button.classList.remove("complete", "failed", "retry", "leaving");
    badge.ring.classList.toggle("indeterminate", state === "in_progress" && percent === null);
    badge.center.textContent = "";

    for (const dot of badge.dots) dot.className = "dot";

    if (state === "complete") {
      for (const dot of badge.dots) dot.classList.add("filled");
      badge.button.classList.add("complete");
      badge.button.setAttribute("aria-label", "Descarga completada");
      badge.center.textContent = "✓";

      setTimeout(() => badge.button.classList.add("leaving"), 900);
      setTimeout(() => removeBadge(badge.mediaId), 1_250);
      return;
    }

    if (state === "interrupted") {
      for (const dot of badge.dots) dot.classList.add("failed");
      badge.button.classList.add("failed", "retry");
      badge.button.setAttribute("aria-label", "La descarga falló. Pulsa para reintentar");
      badge.button.title = "Reintentar descarga";
      badge.host.style.pointerEvents = "auto";
      badge.center.textContent = "↻";
      return;
    }

    badge.host.style.pointerEvents = "none";
    badge.button.setAttribute("aria-label", percent === null ? "Descarga en progreso" : `Descarga al ${percent}%`);

    if (percent === null) {
      badge.dots.slice(0, 3).forEach((dot) => dot.classList.add("filled"));
    } else {
      const filledDots = Math.min(DOT_COUNT, Math.ceil((percent / 100) * DOT_COUNT));
      badge.dots.slice(0, filledDots).forEach((dot) => dot.classList.add("filled"));
    }
  }

  function removeBadge(mediaId) {
    const badge = activeBadges.get(mediaId);
    if (!badge) return;
    badge.host.remove();
    activeBadges.delete(mediaId);
    restoreMobileFixedImageButtonsForMedia(mediaId);
  }

  async function requestDownload(item) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "START_DOWNLOAD", item });
      if (!response?.ok) {
        updateBadge(activeBadges.get(item.id), {
          state: "interrupted",
          error: response?.error || "No se pudo iniciar la descarga."
        });
      }
    } catch (error) {
      updateBadge(activeBadges.get(item.id), {
        state: "interrupted",
        error: String(error?.message || error)
      });
    }
  }

  function requestReposition() {
    if (repositionRequested) return;
    repositionRequested = true;
    requestAnimationFrame(() => {
      repositionRequested = false;
      if (hoverTarget) positionFloatingHost(hoverControl.host, hoverTarget);
      for (const [target, control] of mobileFixedImageControls) {
        if (!target?.isConnected) {
          removeMobileFixedImageButton(target);
          continue;
        }
        if (activeBadges.has(control.mediaId)) control.host.style.display = "none";
        else positionMobileFixedImageControl(control);
      }
      for (const badge of activeBadges.values()) {
        positionFloatingHost(badge.host, badge.target);
      }
    });
  }

  function clearDetectedMedia() {
    shadowRescanRequested = true;
    clearTimeout(flushTimer);
    clearTimeout(scanTimer);
    flushTimer = null;
    scanTimer = null;
    mediaItems.clear();
    elementRefs.clear();
    pendingUpserts.clear();
    pendingNodes.clear();
    hideHoverButton();
    clearMobileFixedImageButtons();
    for (const mediaId of [...activeBadges.keys()]) removeBadge(mediaId);
  }

  document.addEventListener("pointerover", (event) => {
    if (IS_MOBILE_PLATFORM || !hoverDownloadButtonEnabled) return;
    const target = findMediaTarget(event);
    if (!target || target === hoverTarget) return;
    const item = itemForTarget(target);
    if (item) showHoverButton(target, item);
  }, true);

  document.addEventListener("pointerout", () => {
    if (IS_MOBILE_PLATFORM) return;
    setTimeout(() => {
      if (!hoverTarget) return;
      const targetHovered = hoverTarget.matches?.(":hover");
      const controlHovered = hoverControl.host.matches?.(":hover");
      if (!targetHovered && !controlHovered) hideHoverButton();
    }, 70);
  }, true);


  chrome.storage.local.get({
    hoverDownloadButtonEnabled: true,
    [DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]: {}
  })
    .then((stored) => {
      hoverDownloadButtonEnabled = stored.hoverDownloadButtonEnabled !== false;
      downloadedImageHistory.clear();
      for (const mediaId of normalizeDownloadedImageHistory(stored[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY])) {
        downloadedImageHistory.add(mediaId);
      }

      if (IS_MOBILE_PLATFORM) {
        hideHoverButton();
        refreshMobileFixedImageButtons();
      } else if (!hoverDownloadButtonEnabled) {
        hideHoverButton();
      }
    })
    .catch(() => {
      hoverDownloadButtonEnabled = true;
      if (IS_MOBILE_PLATFORM) refreshMobileFixedImageButtons();
    });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY]) {
      downloadedImageHistory.clear();
      for (const mediaId of normalizeDownloadedImageHistory(changes[DOWNLOADED_IMAGE_HISTORY_STORAGE_KEY].newValue)) {
        downloadedImageHistory.add(mediaId);
      }

      if (IS_MOBILE_PLATFORM) {
        refreshMobileDownloadedImageStates();
      } else if (hoverTarget && hoverItem) {
        showHoverButton(hoverTarget, hoverItem);
      }
    }

    if (!changes.hoverDownloadButtonEnabled) return;
    hoverDownloadButtonEnabled = changes.hoverDownloadButtonEnabled.newValue !== false;

    if (IS_MOBILE_PLATFORM) {
      hideHoverButton();
      refreshMobileFixedImageButtons();
      return;
    }

    if (!hoverDownloadButtonEnabled) hideHoverButton();
  });

  window.addEventListener("scroll", requestReposition, { capture: true, passive: true });
  window.addEventListener("resize", requestReposition, { passive: true });

  document.addEventListener("loadedmetadata", (event) => {
    if (event.target instanceof HTMLVideoElement) detectVideo(event.target, true);
  }, true);

  document.addEventListener("play", (event) => {
    if (event.target instanceof HTMLVideoElement) {
      detectVideo(event.target, true);
      scanPerformanceResources();
    }
  }, true);

  mutationObserver = new MutationObserver((mutations) => {
    let mobileTreeChanged = false;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && !isMediaDropUiElement(node)) scheduleNodeScan(node);
        }
        if (IS_MOBILE_PLATFORM && mutation.removedNodes.length) mobileTreeChanged = true;
      } else if (mutation.type === "attributes") {
        if (!isMediaDropUiElement(mutation.target)) scheduleNodeScan(mutation.target);
        if (IS_MOBILE_PLATFORM) mobileTreeChanged = true;
      }

      if (IS_MOBILE_PLATFORM && mutation.addedNodes?.length) mobileTreeChanged = true;
    }

    if (IS_MOBILE_PLATFORM && mobileTreeChanged && mobileFixedImageControls.size) {
      // Una sola pasada por lote de mutaciones. Antes se recorrían todos los
      // controles por cada nodo eliminado y se pedía reposicionar por mutación.
      for (const [target] of mobileFixedImageControls) {
        if (!target?.isConnected) removeMobileFixedImageButton(target);
      }
      requestReposition();
    }
  });

  mutationObserver.observe(document.documentElement, MEDIA_MUTATION_OBSERVER_OPTIONS);

  try {
    const performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) inspectPerformanceEntry(entry);
    });
    performanceObserver.observe({ type: "resource", buffered: true });
    performanceObserverActive = true;
  } catch {
    // El escaneo del DOM sigue funcionando si PerformanceObserver no está disponible.
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if ((sender?.id && sender.id !== chrome.runtime.id) || !message || typeof message !== "object") return false;

    if (message?.type === "MEDIA_DROP_PING") {
      sendResponse({ ok: true, pageUrl: location.href });
      return false;
    }

    if (message?.type === "MEDIA_DROP_CLEAR") {
      clearDetectedMedia();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "MEDIA_DROP_VIDEO_PREVIEW") {
      const mediaId = String(message.mediaId || "");
      const previewUrl = String(message.previewUrl || "");
      const current = mediaItems.get(mediaId);

      if (
        current
        && current.type === "video"
        && previewUrl.startsWith("data:image/")
      ) {
        const updated = {
          ...current,
          previewUrl,
          previewSource: String(message.previewSource || "offscreen-video-frame"),
          width: Number(message.width) > 0 ? Math.round(Number(message.width)) : current.width,
          height: Number(message.height) > 0 ? Math.round(Number(message.height)) : current.height,
          resolutionSource: Number(message.width) > 0 && Number(message.height) > 0
            ? "offscreen-video-decoded-frame"
            : current.resolutionSource,
          duration: Number(message.duration) > 0 ? Number(message.duration) : current.duration
        };
        mediaItems.set(mediaId, updated);
        pendingUpserts.set(mediaId, updated);
        scheduleUpsertFlush();
      }

      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "MEDIA_DROP_START_PLAYER_CAPTURE") {
      const job = message.job && typeof message.job === "object" ? message.job : null;
      if (!job?.mediaId || !Number.isInteger(Number(job.sourceTabId))) {
        sendResponse({ ok: false, error: "La tarea de captura no es válida." });
        return false;
      }

      if (playerCaptureRunning) {
        sendResponse({ ok: false, error: "Esta pestaña ya está realizando una captura." });
        return false;
      }

      playerCaptureRunning = true;
      runPlayerCapture(job).finally(() => {
        playerCaptureRunning = false;
      });

      sendResponse({ ok: true, started: true });
      return false;
    }

    if (message?.type === "MEDIA_DROP_STREAM_DETECTED") {
      const hydrated = hydrateDetectedStream(message);

      if (!hydrated) {
        // Dynamic players often create the <video> a moment after the manifest request.
        setTimeout(() => hydrateDetectedStream(message), 250);
        setTimeout(() => hydrateDetectedStream(message), 900);
      }

      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "MEDIA_DROP_VIDEO_METADATA") {
      const mediaId = String(message.mediaId || "");
      const current = mediaItems.get(mediaId);
      const width = Number(message.width);
      const height = Number(message.height);
      const duration = Number(message.duration);

      if (
        current
        && current.type === "video"
        && Number.isFinite(width)
        && Number.isFinite(height)
        && width > 0
        && height > 0
      ) {
        const updated = {
          ...current,
          width: Math.round(width),
          height: Math.round(height),
          duration: Number.isFinite(duration) && duration > 0
            ? duration
            : current.duration,
          resolutionSource: String(message.resolutionSource || "offscreen-video-metadata")
        };

        mediaItems.set(mediaId, updated);
        pendingUpserts.set(mediaId, updated);
        scheduleUpsertFlush();
      }

      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "MEDIA_DROP_IMAGE_DIMENSIONS") {
      const mediaId = String(message.mediaId || "");
      const current = mediaItems.get(mediaId);
      const width = Number(message.width);
      const height = Number(message.height);

      if (
        current
        && current.type === "image"
        && Number.isFinite(width)
        && Number.isFinite(height)
        && width > 0
        && height > 0
      ) {
        const updated = {
          ...current,
          width: Math.round(width),
          height: Math.round(height)
        };
        mediaItems.set(mediaId, updated);
        pendingUpserts.set(mediaId, updated);
        scheduleUpsertFlush();
      }

      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "MEDIA_DROP_GET_SNAPSHOT") {
      scanRoot(document);
      scanPerformanceResources();
      sendResponse({
        items: [...mediaItems.values()],
        page: { url: location.href, title: document.title }
      });
      return false;
    }

    if (message?.type === "DOWNLOAD_PROGRESS") {
      if (message.state === "complete") {
        const completedMediaId = String(message.mediaId || "");
        const completedItem = mediaItems.get(completedMediaId);
        if (completedItem) {
          downloadedImageHistory.add(completedMediaId);
        }

        // La confirmación local manda de inmediato. Esto evita que el control
        // vuelva temporalmente a ⬇ mientras storage.local termina de persistir
        // el historial o mientras la imagen cambia de URL/currentSrc al cargar.
        markImageDownloaded(completedMediaId);

        if (IS_MOBILE_PLATFORM) {
          refreshMobileDownloadedImageStates();
        } else if (hoverTarget && hoverItem?.id === completedMediaId) {
          showHoverButton(hoverTarget, hoverItem);
        }
      }

      let badge = activeBadges.get(message.mediaId);
      if (!badge && message.state === "in_progress") {
        const element = getElementForMedia(message.mediaId);
        if (element) badge = createProgressBadge(message.mediaId, element);
      }
      if (badge) updateBadge(badge, message);
      return false;
    }

    return false;
  });

  function scheduleNavigationWatch() {
    clearTimeout(navigationWatchTimer);
    navigationWatchTimer = setTimeout(() => {
      if (location.href !== lastPageUrl) {
        lastPageUrl = location.href;
        resetForNavigation();
      }
      scheduleNavigationWatch();
    }, document.hidden ? 3_000 : 800);
  }

  document.addEventListener("visibilitychange", () => {
    scheduleNavigationWatch();
    if (!document.hidden) {
      scanRoot(document);
      scanPerformanceResources();
    }
  });

  scheduleNavigationWatch();
  scanRoot(document);
  scanPerformanceResources();
})();
