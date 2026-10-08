/**
 * Ilustración «M365 → VS Code» del popup de la extensión de navegador y del
 * panel del userscript: el logo de M365 Copilot a la izquierda, el de VS Code
 * a la derecha y, entre ambos, una señal de tres anillos concéntricos (el
 * «wifi loader» de Uiverse.io por mobinkakei, licencia MIT, rehecho dentro
 * del SVG) que cuenta en qué punto está la conexión.
 *
 * - waiting:   los dos logos apagados (en gris) y los anillos girando en gris:
 *              está buscando el token; M365 «respira».
 * - captured:  M365 se enciende y los anillos giran con el degradado de la
 *              marca: tiene el token y está buscando a VS Code, que sigue apagado.
 * - connected: los anillos se paran y forman una señal de wifi que apunta a
 *              VS Code, con una onda que viaja hacia él; VS Code se enciende.
 * - warning:   token caducado o hace falta iniciar sesión: señal débil en
 *              ámbar y aviso sobre M365.
 *
 * Los logos son los del proyecto (extensiones/vscode/logo/m365-vscode.svg y
 * vscode.svg), incrustados aquí como <symbol>. Ojo: el icono de VS Code es una
 * marca de Microsoft y sus pautas de uso restringen usarlo en extensiones o
 * en versiones modificadas; su uso aquí es decisión del proyecto.
 *
 * El SVG es estático y lleva su propio <style>: el estado se cambia SÓLO con el
 * atributo `data-state` de un ancestro, así el DOM no se recrea y los cambios
 * de estado se ven como transiciones (VS Code «se enciende» con un fundido).
 * El gris es un filtro de desaturación sobre el propio logo. Sin `vscode`,
 * `window` ni React: es una cadena que cualquiera puede insertar.
 */

export type ConnectionState = 'waiting' | 'captured' | 'connected' | 'warning';

export interface ConnectionStateInput {
  readonly hasToken: boolean;
  readonly expired: boolean;
  readonly vscodeConnected: boolean;
  /** El auto-renovador se rindió: hace falta que el usuario inicie sesión. */
  readonly needsUser?: boolean;
}

export function connectionState(input: ConnectionStateInput): ConnectionState {
  if (input.needsUser || (input.hasToken && input.expired)) return 'warning';
  if (!input.hasToken) return 'waiting';
  return input.vscodeConnected ? 'connected' : 'captured';
}

export interface ConnectionArtOptions {
  /** Prefijo de los ids de gradientes/filtros/símbolos, por si hay dos en el mismo documento. */
  readonly idPrefix?: string;
  readonly leftLabel?: string;
  readonly rightLabel?: string;
  /** Texto accesible del conjunto. */
  readonly title?: string;
}

/** Logo de M365 Copilot del proyecto (logo/m365-vscode.svg): sus gradientes (fuera del
 * <symbol>, por compatibilidad) y el símbolo, con los ids prefijados. */
function m365Symbol(id: (name: string) => string): string {
  return `<radialGradient id="${id('m0')}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(59.4363 31.0868) rotate(-130.285) scale(27.6431 26.1575)"><stop offset="0.0955758" stop-color="#00AEFF"/><stop offset="0.773185" stop-color="#2253CE"/><stop offset="1" stop-color="#0736C4"/></radialGradient>
<radialGradient id="${id('m1')}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(15.3608 50.9716) rotate(50.2556) scale(25.0142 24.5538)"><stop stop-color="#FFB657"/><stop offset="0.633728" stop-color="#FF5F3D"/><stop offset="0.923392" stop-color="#C02B3C"/></radialGradient>
<linearGradient id="${id('m2')}" x1="17.6789" y1="10.6669" x2="21.2461" y2="52.961" gradientUnits="userSpaceOnUse"><stop offset="0.156162" stop-color="#0D91E1"/><stop offset="0.487484" stop-color="#52B471"/><stop offset="0.652394" stop-color="#98BD42"/><stop offset="0.937361" stop-color="#FFC800"/></linearGradient>
<linearGradient id="${id('m3')}" x1="20.9521" y1="5.07764" x2="22.8995" y2="51.2097" gradientUnits="userSpaceOnUse"><stop stop-color="#3DCBFF"/><stop offset="0.246674" stop-color="#0588F7" stop-opacity="0"/></linearGradient>
<radialGradient id="${id('m4')}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(64.843 17.441) rotate(109.722) scale(61.4524 75.0539)"><stop offset="0.0661714" stop-color="#8C48FF"/><stop offset="0.5" stop-color="#F2598A"/><stop offset="0.895833" stop-color="#FFB152"/></radialGradient>
<linearGradient id="${id('m5')}" x1="66.9168" y1="19.1407" x2="66.8913" y2="31.7025" gradientUnits="userSpaceOnUse"><stop offset="0.0581535" stop-color="#F8ADFA"/><stop offset="0.708063" stop-color="#A86EDD" stop-opacity="0"/></linearGradient>
<symbol id="${id('m365')}" viewBox="0.5 0.578 72 72">
<path d="M53.1574 10.3146C52.1706 7.19669 49.2773 5.07764 46.007 5.07764L43.5352 5.07764C39.9228 5.07764 36.8237 7.65268 36.1621 11.2039L32.4891 30.9179L33.5912 27.2788C34.5491 24.1158 37.4644 21.9526 40.7692 21.9526H52.2499L58.8326 24.2562L62.3337 21.9644C59.0634 21.9644 56.1701 19.8336 55.1833 16.7157L53.1574 10.3146Z" fill="url(#${id('m0')})"/>
<path d="M20.615 62.8082C21.5914 65.9426 24.4927 68.0777 27.7757 68.0777H32.6415C36.7421 68.0777 40.0824 64.7845 40.1408 60.6844L40.3984 42.5737L39.4114 45.86C38.459 49.0313 35.5396 51.2027 32.2284 51.2027H20.75L14.8141 48.4965L11.4807 51.2027C14.7636 51.2027 17.665 53.3378 18.6414 56.4722L20.615 62.8082Z" fill="url(#${id('m1')})"/>
<path d="M45.5 5.07764H19.25C11.75 5.07764 7.25001 14.7496 4.25002 24.4216C0.695797 35.8804 -3.95498 51.2056 9.50001 51.2056H20.931C24.2656 51.2056 27.1975 49.0121 28.135 45.812C30.1073 39.0797 33.5545 27.3661 36.2631 18.446C37.6417 13.906 38.79 10.007 40.5523 7.57888C41.5404 6.21761 43.1871 5.07764 45.5 5.07764Z" fill="url(#${id('m2')})"/>
<path d="M45.5 5.07764H19.25C11.75 5.07764 7.25001 14.7496 4.25002 24.4216C0.695797 35.8804 -3.95498 51.2056 9.50001 51.2056H20.931C24.2656 51.2056 27.1975 49.0121 28.135 45.812C30.1073 39.0797 33.5545 27.3661 36.2631 18.446C37.6417 13.906 38.79 10.007 40.5523 7.57888C41.5404 6.21761 43.1871 5.07764 45.5 5.07764Z" fill="url(#${id('m3')})"/>
<path d="M27.4946 68.0776H53.7446C61.2446 68.0776 65.7446 58.4071 68.7446 48.7365C72.2988 37.2794 76.9496 21.9565 63.4946 21.9565H52.0633C48.7288 21.9565 45.797 24.1499 44.8594 27.3499C42.8871 34.0812 39.44 45.7927 36.7314 54.7113C35.3529 59.2506 34.2046 63.149 32.4422 65.5768C31.4542 66.9378 29.8075 68.0776 27.4946 68.0776Z" fill="url(#${id('m4')})"/>
<path d="M27.4946 68.0776H53.7446C61.2446 68.0776 65.7446 58.4071 68.7446 48.7365C72.2988 37.2794 76.9496 21.9565 63.4946 21.9565H52.0633C48.7288 21.9565 45.797 24.1499 44.8594 27.3499C42.8871 34.0812 39.44 45.7927 36.7314 54.7113C35.3529 59.2506 34.2046 63.149 32.4422 65.5768C31.4542 66.9378 29.8075 68.0776 27.4946 68.0776Z" fill="url(#${id('m5')})"/>
<rect x="24.125" y="51.2031" width="48.375" height="21.375" rx="3.63727" fill="black"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M27.0683 55.2876V68.3192H29.479V58.9306L32.1221 64.1367H33.7293L36.3143 58.9266V68.3192H38.8025V55.2876H36.0239L33.0046 61.3343L30.0019 55.2876H27.0683ZM45.0813 68.4839C43.6484 68.4839 42.5317 68.1418 41.7314 67.4576C40.9375 66.7734 40.5405 65.7439 40.5405 64.3691H42.9222C42.9222 65.021 43.1094 65.5309 43.4838 65.8988C43.8646 66.2668 44.3939 66.4507 45.0716 66.4507C45.6783 66.4507 46.143 66.2958 46.4657 65.986C46.7949 65.6762 46.9595 65.1856 46.9595 64.5144C46.9595 63.8689 46.7594 63.401 46.3592 63.1105C45.9655 62.8136 45.4524 62.6652 44.8198 62.6652H44.0356V60.7095H44.8876C45.4556 60.7095 45.9074 60.5546 46.2431 60.2447C46.5787 59.9349 46.7465 59.5251 46.7465 59.0152C46.7465 58.4988 46.5948 58.118 46.2915 57.8727C45.9946 57.6274 45.5847 57.5048 45.0619 57.5048C44.4874 57.5048 44.0421 57.6662 43.7258 57.9889C43.4095 58.3052 43.2514 58.7408 43.2514 59.2959H40.8794C40.8794 58.4246 41.0601 57.7081 41.4216 57.1466C41.7895 56.5851 42.2897 56.1655 42.9222 55.888C43.5548 55.604 44.2648 55.462 45.0522 55.462C45.7816 55.462 46.4561 55.5814 47.0757 55.8202C47.6953 56.059 48.1923 56.4237 48.5667 56.9142C48.9475 57.4048 49.1379 58.0341 49.1379 58.8022C49.1379 59.5832 48.9507 60.2028 48.5763 60.661C48.2084 61.1193 47.7114 61.442 47.0854 61.6292C47.776 61.7712 48.3472 62.0939 48.799 62.5974C49.2573 63.0944 49.4864 63.7947 49.4864 64.6983C49.4864 65.9247 49.0895 66.8638 48.2956 67.5157C47.5081 68.1611 46.4367 68.4839 45.0813 68.4839ZM52.875 67.8448C53.5914 68.2773 54.4047 68.4935 55.3148 68.4935C56.2313 68.4935 57.0058 68.3128 57.6384 67.9513C58.2774 67.5899 58.7614 67.0929 59.0906 66.4603C59.4198 65.8213 59.5844 65.0887 59.5844 64.2626C59.5844 63.4041 59.423 62.6845 59.1003 62.1036C58.7776 61.5162 58.3387 61.0741 57.7836 60.7772C57.235 60.4738 56.6153 60.3221 55.9247 60.3221C55.3438 60.3221 54.8339 60.4157 54.395 60.6029C53.9625 60.7901 53.5785 61.0386 53.2429 61.3484C53.2007 61.388 53.1589 61.4283 53.1174 61.4691C53.1613 60.2186 53.3483 59.2715 53.6785 58.6278C54.0658 57.8791 54.6144 57.5047 55.3244 57.5047C55.7633 57.5047 56.1183 57.6274 56.3894 57.8727C56.667 58.1115 56.8541 58.4761 56.951 58.9667H59.3327C59.1648 57.8436 58.7389 56.9819 58.0547 56.3817C57.3705 55.7749 56.4604 55.4716 55.3244 55.4716C54.4015 55.4716 53.5817 55.7072 52.8653 56.1784C52.1488 56.6431 51.5873 57.3627 51.1807 58.3374C50.774 59.3055 50.5707 60.548 50.5707 62.0648C50.5707 63.5881 50.7773 64.8241 51.1904 65.7729C51.6034 66.7153 52.165 67.4059 52.875 67.8448ZM53.1251 63.3296C53.2967 63.1623 53.4877 63.0086 53.6979 62.8684C54.2207 62.5134 54.8113 62.3359 55.4697 62.3359C55.9667 62.3359 56.3539 62.5102 56.6315 62.8587C56.909 63.2008 57.0478 63.6784 57.0478 64.2916C57.0478 64.9177 56.9026 65.4373 56.6121 65.8504C56.3281 66.2635 55.8957 66.47 55.3148 66.47C54.9404 66.47 54.5822 66.3506 54.2401 66.1118C53.9045 65.8665 53.6301 65.4696 53.4171 64.9209C53.2601 64.4988 53.1627 63.9683 53.1251 63.3296ZM62.9053 68.0676C63.583 68.3516 64.3382 68.4935 65.1708 68.4935C65.997 68.4935 66.7393 68.329 67.3976 67.9998C68.0624 67.6706 68.5885 67.1801 68.9757 66.5282C69.363 65.8698 69.5566 65.0469 69.5566 64.0593C69.5566 63.0718 69.3727 62.2747 69.0048 61.6679C68.6433 61.0612 68.1689 60.6191 67.5816 60.3416C66.9942 60.0576 66.3649 59.9156 65.6936 59.9156C65.1773 59.9156 64.7287 59.9995 64.3479 60.1673C63.9735 60.3286 63.6895 60.5191 63.4959 60.7385L63.7283 57.7565H68.5788V55.6362H61.7241L61.1723 62.6555H63.3894C63.5701 62.4296 63.7993 62.2424 64.0768 62.0939C64.3543 61.9455 64.6932 61.8713 65.0934 61.8713C65.6614 61.8713 66.1229 62.0455 66.4779 62.3941C66.8393 62.7362 67.02 63.2912 67.02 64.0593C67.02 64.892 66.849 65.5019 66.5069 65.8892C66.1713 66.2764 65.7259 66.4701 65.1708 66.4701C64.5835 66.4701 64.1026 66.3055 63.7283 65.9763C63.3539 65.6407 63.1667 65.1824 63.1667 64.6015H60.6979C60.6979 65.4729 60.8947 66.199 61.2885 66.7799C61.6886 67.3543 62.2276 67.7836 62.9053 68.0676Z" fill="white"/>
</symbol>`;
}

/** Logo de VS Code del proyecto (logo/vscode.svg). */
function vscodeSymbol(id: (name: string) => string): string {
  return `<symbol id="${id('vscode')}" viewBox="1.5 1.5 29 29">
<path d="M29.01,5.03,23.244,2.254a1.742,1.742,0,0,0-1.989.338L2.38,19.8A1.166,1.166,0,0,0,2.3,21.447c.025.027.05.053.077.077l1.541,1.4a1.165,1.165,0,0,0,1.489.066L28.142,5.75A1.158,1.158,0,0,1,30,6.672V6.605A1.748,1.748,0,0,0,29.01,5.03Z" fill="#0065a9"/>
<path d="M29.01,26.97l-5.766,2.777a1.745,1.745,0,0,1-1.989-.338L2.38,12.2A1.166,1.166,0,0,1,2.3,10.553c.025-.027.05-.053.077-.077l1.541-1.4A1.165,1.165,0,0,1,5.41,9.01L28.142,26.25A1.158,1.158,0,0,0,30,25.328V25.4A1.749,1.749,0,0,1,29.01,26.97Z" fill="#007acc"/>
<path d="M23.244,29.747a1.745,1.745,0,0,1-1.989-.338A1.025,1.025,0,0,0,23,28.684V3.316a1.024,1.024,0,0,0-1.749-.724,1.744,1.744,0,0,1,1.989-.339l5.765,2.772A1.748,1.748,0,0,1,30,6.6V25.4a1.748,1.748,0,0,1-.991,1.576Z" fill="#1f9cf0"/>
</symbol>`;
}

/**
 * Los tres anillos del loader con las medidas del original (r = 40, 27 y 14
 * sobre un centro común). Sus `stroke-dasharray` (un cuarto de cada
 * circunferencia) y los `stroke-dashoffset` de la animación están calculados
 * para esos radios, así que el conjunto se encoge con un `scale` en vez de
 * tocar los números. `half` centra el arco en las 3 en punto: la señal de
 * «conectado» apunta a VS Code.
 */
const RINGS = [
  { name: 'outer', r: 40, dash: '62.75 188.25', keys: [25, 0, 301, 276], front: 0.15, back: 0.3, half: 31.375 },
  { name: 'middle', r: 27, dash: '42.5 127.5', keys: [17, 0, 204, 187], front: 0.1, back: 0.25, half: 21.25 },
  { name: 'inner', r: 14, dash: '22 66', keys: [9, 0, 106, 97], front: 0.05, back: 0.2, half: 11 },
] as const;

/** Azul de marca de Fluent (botones, señal) y los colores de estado de Windows 11. */
const BRAND = '#0f6cbd';
const SUCCESS = '#107c10';
const WARNING = '#bc4b09';

function ringStyles(): string {
  return RINGS.map(({ name, dash, keys: [k0, k1, k2, k3], front, back, half }) =>
    [
      `.m365-art .${name} { stroke-dasharray: ${dash}; }`,
      `.m365-art .back.${name} { animation: m365-art-${name} 1.8s ease infinite ${back}s; }`,
      `.m365-art .front.${name} { animation: m365-art-${name} 1.8s ease infinite ${front}s; }`,
      `[data-state="connected"] .m365-art .front.${name}, [data-state="warning"] .m365-art .front.${name} { stroke-dashoffset: ${half}; }`,
      `@keyframes m365-art-${name} { 0% { stroke-dashoffset: ${k0}; } 25% { stroke-dashoffset: ${k1}; } 65% { stroke-dashoffset: ${k2}; } 80%, 100% { stroke-dashoffset: ${k3}; } }`,
    ].join('\n  '),
  ).join('\n  ');
}

/** Marcado del SVG; el estado lo decide `data-state` en un elemento que lo contenga. */
export function connectionArtSvg(options: ConnectionArtOptions = {}): string {
  const id = (name: string) => `${options.idPrefix ?? 'm365art'}-${name}`;
  const left = escapeXml(options.leftLabel ?? 'M365 Copilot');
  const right = escapeXml(options.rightLabel ?? 'VS Code');
  const title = escapeXml(options.title ?? `${options.leftLabel ?? 'M365 Copilot'} → ${options.rightLabel ?? 'VS Code'}`);
  const use = (symbol: string, extra = '') =>
    `<use href="#${id(symbol)}" xlink:href="#${id(symbol)}" width="64" height="64"${extra}/>`;
  const rings = RINGS.map(
    ({ name, r }) => `<circle class="ring back ${name}" r="${r}"/><circle class="ring front ${name}" r="${r}"/>`,
  ).join('');

  return `<svg class="m365-art" viewBox="0 0 260 104" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<title>${title}</title>
<defs>
  ${m365Symbol(id)}
  ${vscodeSymbol(id)}
  <filter id="${id('grey')}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>
  <filter id="${id('blur')}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
<style>
  .m365-art { display: block; width: 100%; height: auto; overflow: visible; }
  .m365-art .layer, .m365-art .badge, .m365-art .halo, .m365-art .core { transition: opacity .5s ease; }
  .m365-art .on, .m365-art .badge, .m365-art .halo, .m365-art .core { opacity: 0; }
  .m365-art .off { opacity: .4; }
  .m365-art .label { fill: currentColor; font: 600 11px 'Segoe UI Variable Text', 'Segoe UI', -apple-system, system-ui, sans-serif; text-anchor: middle; }
  .m365-art .signal { transition: transform .5s ease; }
  .m365-art .ring { fill: none; stroke-width: 6px; stroke-linecap: round; transform-box: fill-box; transform-origin: center;
    transform: rotate(-100deg); transition: transform .5s ease, opacity .4s ease, stroke .4s ease; }
  .m365-art .back { stroke: currentColor; stroke-opacity: .18; }
  .m365-art .front { stroke: ${BRAND}; }
  .m365-art .core { fill: ${BRAND}; transition: opacity .5s ease, fill .4s ease; }
  ${ringStyles()}
  [data-state="waiting"] .m365-art .m365 .off { animation: m365-art-breathe 2.4s ease-in-out infinite; }
  [data-state="waiting"] .m365-art .front { stroke: #8a8886; }
  [data-state="captured"] .m365-art .m365 .on,
  [data-state="connected"] .m365-art .m365 .on,
  [data-state="warning"] .m365-art .m365 .on { opacity: 1; }
  [data-state="captured"] .m365-art .m365 .off,
  [data-state="connected"] .m365-art .m365 .off,
  [data-state="warning"] .m365-art .m365 .off,
  [data-state="connected"] .m365-art .vscode .off { opacity: 0; }
  [data-state="connected"] .m365-art .vscode .on,
  [data-state="connected"] .m365-art .badge.ok,
  [data-state="warning"] .m365-art .badge.warn,
  [data-state="connected"] .m365-art .core,
  [data-state="warning"] .m365-art .core { opacity: 1; }
  [data-state="connected"] .m365-art .halo { opacity: .35; }
  [data-state="connected"] .m365-art .signal,
  [data-state="warning"] .m365-art .signal { transform: translateX(-16px); }
  [data-state="connected"] .m365-art .ring,
  [data-state="warning"] .m365-art .ring { animation: none; transform: rotate(0deg); }
  [data-state="connected"] .m365-art .back,
  [data-state="warning"] .m365-art .back { opacity: 0; }
  [data-state="connected"] .m365-art .front { animation: m365-art-wave 1.8s ease-in-out infinite; }
  [data-state="connected"] .m365-art .front.middle { animation-delay: .2s; }
  [data-state="connected"] .m365-art .front.outer { animation-delay: .4s; }
  [data-state="warning"] .m365-art .front { stroke: ${WARNING}; }
  [data-state="warning"] .m365-art .front.middle { opacity: .4; }
  [data-state="warning"] .m365-art .front.outer { opacity: .16; }
  [data-state="warning"] .m365-art .core { fill: ${WARNING}; }
  @keyframes m365-art-breathe { 0%, 100% { opacity: .28; } 50% { opacity: .55; } }
  @keyframes m365-art-wave { 0%, 100% { opacity: .25; } 35% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .m365-art, .m365-art * { animation: none !important; transition: none !important; }
  }
</style>
<g class="node m365" transform="translate(14 14)">
  <g class="layer off" filter="url(#${id('grey')})">${use('m365')}</g>
  <g class="layer on">${use('m365')}</g>
  <g class="badge warn" transform="translate(62 2)"><circle r="10" fill="${WARNING}"/><path d="M0 -5V1.5M0 5.2V5.4" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>
</g>
<g transform="translate(130 46)"><g class="signal"><g transform="scale(.8)">${rings}<circle class="core" r="5"/></g></g></g>
<g class="node vscode" transform="translate(182 14)">
  <g class="halo" filter="url(#${id('blur')})">${use('vscode')}</g>
  <g class="layer off" filter="url(#${id('grey')})">${use('vscode')}</g>
  <g class="layer on">${use('vscode')}</g>
  <g class="badge ok" transform="translate(62 2)"><circle r="10" fill="${SUCCESS}"/><path d="M-4.5 0.5L-1.2 3.8L4.8 -3" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></g>
</g>
<text class="label" x="46" y="98">${left}</text>
<text class="label" x="214" y="98">${right}</text>
</svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
