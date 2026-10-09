import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {join, resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const get=(p)=>readFileSync(join(root,p),'utf8');
const manifest=JSON.parse(get('manifest.json'));
assert.equal(manifest.manifest_version,3);
const paths=[manifest.background.service_worker, manifest.action.default_popup,
 ...Object.values(manifest.action.default_icon),
 ...manifest.content_scripts.flatMap(x=>x.js),...Object.values(manifest.icons)];
for (const path of paths) assert(existsSync(join(root,path)),`Manifest apunta a ruta inexistente: ${path}`);
for (const page of ['frontend/src/pages/sidepanel/sidepanel.html',
 'frontend/src/pages/player/fullscreen-player.html','backend/services/offscreen.html']) {
 const html=get(page);
 for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
   if (/^(?:#|data:|https?:|blob:|chrome:)/.test(match[1])) continue;
   assert(existsSync(resolve(root,dirname(page),match[1])),`Ruta HTML rota: ${page} → ${match[1]}`);
 }
}
for (const file of ['frontend/src/pages/sidepanel/sidepanel.css','frontend/src/pages/player/fullscreen-player.css']) {
  const css=get(file);
  for (const match of css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) {
    if (/^(?:data:|https?:|blob:|#)/.test(match[1])) continue;
    assert(existsSync(resolve(root,dirname(file),match[1])),`Ruta CSS rota: ${file} → ${match[1]}`);
  }
}
const background=get(manifest.background.service_worker);
assert(background.includes('frontend/src/services/content.js'));
assert(background.includes('backend/services/offscreen.html'));
assert(background.includes('frontend/src/pages/sidepanel/sidepanel.html')===false);
assert(get('frontend/src/pages/sidepanel/sidepanel.js').includes('frontend/src/pages/player/fullscreen-player.html'));
for(const mode of ['light','dark'])for(const s of [16,24,32,48,128]) {
 const target=`frontend/public/icons/icon${s}-${mode}.png`;
 assert(existsSync(join(root,target)),`Falta ${target}`);
}
console.log('✓ Manifest V3, archivos, iconos, referencias HTML, URLs del reproductor y servicios verificados.');
