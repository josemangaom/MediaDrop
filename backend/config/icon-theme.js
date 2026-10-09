// Apariencia del icono de la barra de Chrome. Independiente de la UI de MediaDrop.
// Automático sigue (prefers-color-scheme) cuando Chromium lo expone. Chrome
// NO ofrece un API pública para leer el color de temas personalizados del marco.
export const ICON_MODE_KEY = "mediaDropToolbarIconMode";
export const DETECTED_SCHEME_KEY = "mediaDropLastDetectedScheme";
export const CHROME_SCHEME_MESSAGE = "MEDIA_DROP_CHROME_COLOR_SCHEME";
export const ICON_PATHS = Object.freeze({
  light: Object.freeze({
    16: "frontend/public/icons/icon16-light.png",
    24: "frontend/public/icons/icon24-light.png",
    32: "frontend/public/icons/icon32-light.png",
    48: "frontend/public/icons/icon48-light.png"
  }),
  dark: Object.freeze({
    16: "frontend/public/icons/icon16-dark.png",
    24: "frontend/public/icons/icon24-dark.png",
    32: "frontend/public/icons/icon32-dark.png",
    48: "frontend/public/icons/icon48-dark.png"
  })
});

const allowedModes = new Set(["auto", "light", "dark"]);
let iconUpdateQueue = Promise.resolve();

export function normalizeIconMode(mode) {
  return allowedModes.has(mode) ? mode : "auto";
}

export function resolveIconMode(setting, detected) {
  const selected = normalizeIconMode(setting);
  return selected === "auto" ? (detected === "dark" ? "dark" : "light") : selected;
}

// Serializar las actualizaciones evita que un evento rezagado sobreescriba
// la selección actual cuando el navegador/reactivación genera varios eventos.
export function applyActionIcon() {
  iconUpdateQueue = iconUpdateQueue.catch(() => {}).then(async () => {
    const settings = await chrome.storage.local.get([ICON_MODE_KEY, DETECTED_SCHEME_KEY]);
    const scheme = resolveIconMode(settings[ICON_MODE_KEY], settings[DETECTED_SCHEME_KEY]);
    await chrome.action.setIcon({path: ICON_PATHS[scheme]});
  });
  return iconUpdateQueue;
}

export async function reportDetectedScheme(dark) {
  const detected = dark ? "dark" : "light";
  const stored = await chrome.storage.local.get(DETECTED_SCHEME_KEY);
  // Re-evaluar incluso si coincide: Chrome puede haber reiniciado el worker.
  if (stored[DETECTED_SCHEME_KEY] !== detected) {
    await chrome.storage.local.set({[DETECTED_SCHEME_KEY]: detected});
  }
  await applyActionIcon();
}

export function installIconPreferenceListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[ICON_MODE_KEY] || changes[DETECTED_SCHEME_KEY]) {
      applyActionIcon().catch(console.warn);
    }
  });
}
