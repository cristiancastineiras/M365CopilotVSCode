/**
 * La API de extensiones con promesas en todos los navegadores.
 *
 * Chrome/Edge (MV3) devuelven promesas desde `chrome.*`. Firefox MV2 no: ahí
 * `chrome.*` sólo funciona con callbacks y, sin callback, devuelve
 * `undefined`. `await chrome.runtime.sendMessage(…)` daba undefined (el popup
 * fallaba con «can't access property "profile"») y `chrome.storage.local.get`
 * también, así que en Firefox nunca se leía el token guardado. Firefox ofrece
 * las mismas APIs con promesas en `browser.*`: misma regla que `wxt/browser`.
 *
 * Es una función y no una constante para que los tests puedan instalar su
 * `chrome` falso después de importar los módulos.
 */
export function ext(): typeof chrome {
  const g = globalThis as { browser?: typeof chrome; chrome?: typeof chrome };
  return (g.browser?.runtime?.id ? g.browser : g.chrome) as typeof chrome;
}
