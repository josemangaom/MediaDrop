# MediaDrop v1.0.16 · One UI Material Edge

Esta es una **extensión de Chrome Manifest V3** escrita con HTML/CSS/JS nativos.
La distribución sigue la estructura frontend/backend de la referencia, adaptada
sin inventar un servidor Node.js, React, Vite ni MongoDB que el proyecto no usa.

- **manifest.json**: debe estar en la raíz que se carga como extensión.
- **frontend/public/icons/**: SVG originales y PNG transparentes (16, 24, 32, 48 y 128 px).
- **frontend/src/assets/**: recursos SVG del menú e interfaz.
- **frontend/src/pages/sidepanel/**: ventana emergente de MediaDrop (HTML/CSS/JS).
- **frontend/src/pages/player/**: reproductor ampliado (HTML/CSS/JS).
- **frontend/src/services/content.js**: detector de medios inyectado en pestañas.
- **backend/controllers/background.js**: service worker MV3 y descargas.
- **backend/config/icon-theme.js**: iconos y detección de apariencia del navegador.
- **backend/config/browser-theme-observer.js**: observador de media query Offscreen.
- **backend/services/**: documento Offscreen y tareas de medios.
- **backend/utils/ts-to-mp4.js**: conversión de segmentos TS/MP4.
- **backend/tests/**: validaciones del paquete.

Las carpetas vacías se reservan para crecimiento futuro; no contienen APIs ficticias.

## Ícono

- El icono de la barra de Chrome sigue automáticamente la apariencia del navegador/sistema cuando Chromium la expone.
- Variante clara: #E3E3E3 (fondo transparente).
- Variante oscura: #474747 (fondo transparente).

**Limitación de Chrome:** sus extensiones MV3 no tienen una API pública
para consultar directamente el color de temas personalizados de la barra.
La detección automática puede seguir la preferencia del sistema.
El selector «Ícono de la barra de Chrome» se retiró de Ajustes.
El botón de luna/sol que cambia el tema de la interfaz sigue disponible.

## Instalación

1. Descomprime el ZIP.
2. Abre `chrome://extensions`, activa Modo desarrollador.
3. Elige «Cargar descomprimida» y selecciona la carpeta `MediaDrop` que contiene `manifest.json`.
4. Si tienes una versión previa sin publicar, recárgala o elimina la carpeta anterior para evitar confusiones.

Validación local automatizada: `node backend/tests/verify-package.mjs`.

## Ajuste One UI · Borde Material (2026-10-09)

- Se integró un borde de material óptico con luz en la arista superior,
  laterales sutiles y sombra interior, aplicado a los docks, menús, botones,
  tarjetas, diálogos y reproductores.
- El acabado se adapta a los temas claro y oscuro mediante variables
  `--material-*` en `frontend/src/pages/sidepanel/sidepanel.css`.
- Se conservaron medidas, radios, colorimetría base, difuminado, animaciones
  y toda la lógica de detección/descarga.
- Nota: el archivo adjunto no incluye un fichero Figma; el resultado usa la
  base One UI ya presente en el proyecto como referencia.

## Ajuste de interfaz · Menú simplificado (2026-10-09)

- Retirado el selector redundante «Ícono de la barra de Chrome», su texto explicativo y sus estilos/código de interfaz.
- Permanece el botón de tema oscuro/claro, la detección de icono automática del navegador y el resto de funcionalidades.
