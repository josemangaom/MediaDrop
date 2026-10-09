const shell = document.querySelector("#player-shell");
const video = document.querySelector("#player-video");
const centerToggle = document.querySelector("#center-toggle");
const playButton = document.querySelector("#play");
const progress = document.querySelector("#progress");
const volumeButton = document.querySelector("#volume");
const volumeSlider = document.querySelector("#volume-slider");
const time = document.querySelector("#time");
const title = document.querySelector("#title");
const pipButton = document.querySelector("#pip");
const fullscreenButton = document.querySelector("#fullscreen");
const moreButton = document.querySelector("#more");
const speedLabel = document.querySelector("#speed-label");
const moreMenu = document.querySelector("#more-menu");
const fallback = document.querySelector("#fallback");

let payload = null;
let mediaItem = null;
let sourceTabId = null;
let panelPort = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function formatClock(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function setRangeProgress(input, fraction) {
  input?.style.setProperty("--range-progress", `${clamp(fraction, 0, 1) * 100}%`);
}

function syncControls() {
  const isPlaying = !video.paused && !video.ended;
  const isMuted = video.muted || video.volume <= 0;
  shell.classList.toggle("is-playing", isPlaying);
  shell.classList.toggle("is-muted", isMuted);

  playButton.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
  playButton.title = isPlaying ? "Pausar" : "Reproducir";
  centerToggle.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
  centerToggle.title = isPlaying ? "Pausar" : "Reproducir";
  volumeButton.setAttribute("aria-label", isMuted ? "Activar sonido" : "Silenciar");
  volumeButton.title = isMuted ? "Activar sonido" : "Silenciar";

  const duration = Number.isFinite(video.duration) ? video.duration : Number(mediaItem?.duration || 0);
  const current = Number(video.currentTime || 0);
  progress.value = duration > 0 ? String(Math.round(clamp(current / duration, 0, 1) * 1000)) : "0";
  setRangeProgress(progress, duration > 0 ? current / duration : 0);
  volumeSlider.value = String(clamp(video.muted ? 0 : video.volume, 0, 1));
  setRangeProgress(volumeSlider, video.muted ? 0 : video.volume);
  time.textContent = `${formatClock(current)} / ${formatClock(duration)}`;
  if (speedLabel) {
    const rate = Number(video.playbackRate || 1);
    speedLabel.textContent = `${Number.isInteger(rate) ? rate : rate.toFixed(1).replace(/\.0$/, "")}×`;
  }

  pipButton.disabled = !document.pictureInPictureEnabled || video.hidden;
}

async function togglePlayback() {
  try {
    if (video.paused || video.ended) await video.play();
    else video.pause();
  } catch {}
  syncControls();
}

function seekFromControl() {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = (Number(progress.value || 0) / 1000) * video.duration;
  syncControls();
}

function setVolumeFromControl() {
  const value = clamp(volumeSlider.value, 0, 1);
  video.volume = value;
  video.muted = value <= 0;
  syncControls();
}

function toggleMute() {
  if (video.muted || video.volume <= 0) {
    if (video.volume <= 0) video.volume = .8;
    video.muted = false;
  } else {
    video.muted = true;
  }
  syncControls();
}

async function togglePictureInPicture() {
  if (!document.pictureInPictureEnabled || video.hidden) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch {}
}

async function exitFullscreenPlayer() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (Number.isInteger(currentWindow?.id)) {
      await chrome.windows.remove(currentWindow.id);
      return;
    }
  } catch {}
  window.close();
}

async function downloadVideo() {
  if (!mediaItem || !Number.isInteger(sourceTabId)) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_DOWNLOAD",
      item: mediaItem,
      tabId: sourceTabId
    });
    if (!response?.ok) throw new Error(response?.error || "No se pudo iniciar la descarga.");
    moreMenu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
  } catch (error) {
    moreMenu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
    fullscreenButton.title = String(error?.message || error || "No se pudo descargar");
  }
}

function connectDownloadProgress() {
  if (!Number.isInteger(sourceTabId)) return;
  try {
    panelPort = chrome.runtime.connect({ name: "media-drop-panel" });
    panelPort.postMessage({ type: "SUBSCRIBE_TAB", tabId: sourceTabId });
    panelPort.onMessage.addListener((message) => {
      if (message?.type !== "DOWNLOAD_PROGRESS" || message.mediaId !== mediaItem?.id) return;
      const state = String(message.state || "");
    });
  } catch {}
}

async function loadPayload() {
  const token = decodeURIComponent(String(location.hash || "").slice(1));
  if (!token) throw new Error("Sesión de reproductor no encontrada.");

  const stored = await chrome.storage.session.get(token);
  try { await chrome.storage.session.remove(token); } catch {}
  const data = stored?.[token];
  if (!data || typeof data !== "object") throw new Error("Sesión de reproductor caducada.");
  return data;
}

async function initialize() {
  try {
    payload = await loadPayload();
    mediaItem = payload.item || null;
    sourceTabId = Number.isInteger(payload.tabId) ? payload.tabId : null;

    const playableUrl = String(payload.playableUrl || "").trim();
    if (!mediaItem || mediaItem.type !== "video" || !playableUrl) throw new Error("Video no válido.");

    title.textContent = mediaItem.title || "Video";
    title.title = title.textContent;
    document.title = `${title.textContent} · MediaDrop`;

    const poster = String(payload.poster || "").trim();
    if (poster && !poster.startsWith("blob:")) video.poster = poster;

    video.volume = clamp(Number.isFinite(payload.volume) ? payload.volume : .8, 0, 1);
    video.muted = Boolean(payload.muted);
    video.playbackRate = clamp(Number(payload.playbackRate || 1), .25, 4) || 1;
    video.src = playableUrl;
    video.load();

    video.addEventListener("loadedmetadata", async () => {
      const requestedTime = Math.max(0, Number(payload.currentTime || 0));
      if (requestedTime > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(requestedTime, Math.max(0, video.duration - .05));
      }
      syncControls();
      if (!payload.paused) {
        try { await video.play(); } catch {}
      }
      syncControls();
    }, { once: true });

    video.addEventListener("error", () => {
      video.hidden = true;
      centerToggle.hidden = true;
      fallback.hidden = false;
    }, { once: true });

    connectDownloadProgress();
    syncControls();
  } catch {
    video.hidden = true;
    centerToggle.hidden = true;
    fallback.hidden = false;
  }
}

video.addEventListener("click", togglePlayback);
playButton.addEventListener("click", togglePlayback);
centerToggle.addEventListener("click", togglePlayback);
progress.addEventListener("input", seekFromControl);
volumeButton.addEventListener("click", toggleMute);
volumeSlider.addEventListener("input", setVolumeFromControl);
pipButton.addEventListener("click", togglePictureInPicture);
fullscreenButton.addEventListener("click", exitFullscreenPlayer);

moreButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = moreMenu.hidden;
  moreMenu.hidden = !open;
  moreButton.setAttribute("aria-expanded", String(open));
});

moreMenu.addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "speed") {
    const speed = clamp(Number(button.dataset.speed || 1), .25, 4) || 1;
    video.playbackRate = speed;
    moreMenu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
  } else if (action === "download") {
    downloadVideo();
  }
});

document.addEventListener("click", () => {
  moreMenu.hidden = true;
  moreButton.setAttribute("aria-expanded", "false");
});

document.addEventListener("keydown", (event) => {
  if (event.key === " " && event.target === document.body) {
    event.preventDefault();
    togglePlayback();
  }
});

for (const eventName of ["play", "pause", "ended", "timeupdate", "durationchange", "volumechange", "ratechange", "loadedmetadata"]) {
  video.addEventListener(eventName, syncControls);
}

window.addEventListener("pagehide", () => {
  try { panelPort?.disconnect(); } catch {}
});

initialize();
