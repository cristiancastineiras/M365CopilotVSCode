import { BRIDGE_MESSAGE_MARKER, signOutRequestId } from '@m365copilot/core';
import { registerHandlers, sendMessage } from '@/utils/messaging';
import { logger } from '@/utils/logger';

/**
 * Puente entre el interceptor (mundo MAIN) y el background.
 *
 * Este content script corre en el mundo ISOLATED, donde SÍ tenemos acceso a
 * `chrome.runtime`. Escucha los `window.postMessage` que emite el interceptor
 * (interceptor.content.ts) y reenvía el perfil al background, que es quien lo
 * guarda y lo envía al servidor local de VS Code.
 *
 * El puente es de doble sentido: el background también pide por aquí que el
 * interceptor vuelva a mirar la caché de MSAL cuando toca renovar el token, que
 * es la forma menos invasiva de conseguir uno nuevo (sin recargar nada).
 */
export default defineContentScript({
  matches: [
    'https://m365.cloud.microsoft/*',
    'https://*.cloud.microsoft/*',
    'https://www.office.com/*',
    'https://outlook.office.com/*',
    'https://teams.microsoft.com/*',
  ],
  runAt: 'document_start',
  main() {
    logger.info('M365 Copilot bridge (ISOLATED) loaded on:', window.location.href);

    /** Manda una petición al interceptor (mundo MAIN). */
    function askInterceptor(kind: 'RESCAN_REQUEST' | 'REQUEST_PROFILE'): void {
      try {
        window.postMessage({ [BRIDGE_MESSAGE_MARKER]: true, kind }, location.origin);
      } catch (err) {
        logger.error(`Error pidiendo ${kind} al interceptor:`, err);
      }
    }

    window.addEventListener('message', (event: MessageEvent) => {
      // Sólo aceptamos mensajes de esta misma ventana/origen.
      if (event.source !== window) return;
      if (event.origin !== location.origin) return;

      const data = event.data;
      if (!data || data[BRIDGE_MESSAGE_MARKER] !== true) return;

      if (data.kind === 'PROFILE_UPDATED' && data.payload) {
        sendMessage('PROFILE_UPDATED', data.payload).catch((err) => {
          logger.error('Error reenviando perfil al background:', err);
        });
      }
    });

    // El background pide re-escanear cuando el token está a punto de caducar.
    registerHandlers({
      RESCAN_TOKEN: () => {
        logger.info('Re-escaneo pedido por el background');
        askInterceptor('RESCAN_REQUEST');
        return { status: 'ok' as const };
      },
    });

    // Los dos content scripts arrancan en `document_start` y el orden entre
    // mundos no está garantizado: pedir el perfil al cargar evita depender de
    // que el interceptor publique justo cuando este listener ya existe.
    askInterceptor('REQUEST_PROFILE');

    // Cuando VS Code pide cerrar la sesión abre esta web con el marcador en la
    // URL (`?m365copilot-signout=<id>`). Llegar por aquí es lo que hace que el
    // cierre sea inmediato: el camino de respaldo es el latido del background,
    // que tarda hasta un minuto en mirar el servidor local.
    //
    // Esto NO autoriza nada por sí solo: el background comprueba que ese id sea
    // el que VS Code tiene pendiente antes de borrar nada, porque una URL la
    // puede enlazar cualquiera.
    const signOutId = signOutRequestId(location.href);
    if (signOutId) {
      logger.info('VS Code pide cerrar la sesión de Microsoft desde esta pestaña');
      sendMessage('HARD_RESET', { requestId: signOutId }).catch((err) => {
        // Lo normal es acabar aquí: el cierre de sesión navega esta misma
        // pestaña, así que el puerto muere antes de que llegue la respuesta.
        logger.debug('Sin respuesta al cierre de sesión (la pestaña ya navegó):', err);
      });
    }
  },
});
