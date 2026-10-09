// Observa solo la preferencia de esquema que Chromium publica a sus páginas.
// No interpreta equivocadamente el selector interno de MediaDrop como tema de Chrome.
(() => {
  const query = matchMedia("(prefers-color-scheme: dark)");
  let previous = null;

  async function announce() {
    const dark = Boolean(query.matches);
    if (previous === dark) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "MEDIA_DROP_CHROME_COLOR_SCHEME", dark
      });
      if (response?.ok) previous = dark;
    } catch {
      // Un service worker reiniciado podrá recibir el siguiente informe.
    }
  }

  query.addEventListener?.("change", announce);
  announce();
  // Respaldo para versiones de Chromium donde Offscreen no dispara "change".
  setInterval(announce, 5000);
})();
