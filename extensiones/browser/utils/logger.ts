/** Logger con prefijo y niveles; silenciable en producción. */

const PREFIX = '[ms365copilot]';
// `import.meta.env` lo inyecta Vite; fuera del bundler (los tests corren en Node
// puro) no existe, y leerlo a pelo tiraba al importar cualquier módulo que use
// el logger.
const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

export const logger = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
  debug: (...args: unknown[]) => {
    if (isDev) console.debug(PREFIX, ...args);
  },
};
