import assert from 'node:assert/strict';
let data={};const changed=[];let listener;
globalThis.chrome={
  storage:{local:{
    async get(keys){if(typeof keys==='string')return {[keys]:data[keys]};return Object.fromEntries(keys.map(k=>[k,data[k]]));},
    async set(entries){const old={...data};Object.assign(data,entries);listener?.(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,{oldValue:old[k],newValue:v}])),"local");}
  },onChanged:{addListener(cb){listener=cb;}}},
  action:{async setIcon({path}){changed.push(path[16]);}}
};
const {ICON_MODE_KEY, installIconPreferenceListener, applyActionIcon,reportDetectedScheme}=await import('../config/icon-theme.js');
installIconPreferenceListener();
await applyActionIcon();
assert(changed.at(-1).endsWith('icon16-light.png'));
await reportDetectedScheme(true);
await applyActionIcon();
assert(changed.at(-1).endsWith('icon16-dark.png'));
await chrome.storage.local.set({[ICON_MODE_KEY]:'light'});
await applyActionIcon();
assert(changed.at(-1).endsWith('icon16-light.png'));
await reportDetectedScheme(true);
await applyActionIcon();
assert(changed.at(-1).endsWith('icon16-light.png'),'Un cambio detectado no debe sobrescribir un modo manual.');
await chrome.storage.local.set({[ICON_MODE_KEY]:'dark'});
await applyActionIcon();
assert(changed.at(-1).endsWith('icon16-dark.png'));
await chrome.storage.local.set({[ICON_MODE_KEY]:'auto'});
await reportDetectedScheme(false);
await applyActionIcon();
assert(changed.at(-1).endsWith('icon16-light.png'));
console.log('✓ Modo auto/claro/oscuro, iconos, detección y respaldo manual verificados.');
