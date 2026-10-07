import { connectionArtSvg, type ConnectionState } from '@m365copilot/core';
import { t } from '@/utils/i18n';

/**
 * Same artwork as the userscript's panel (see `connectionArtSvg` in
 * @m365copilot/core). The markup is a constant string, so React never
 * replaces it when only `state` changes: the `data-state` attribute flips and
 * the SVG's own CSS animates the change (VS Code "lights up" on connect).
 */
const MARKUP = connectionArtSvg({ idPrefix: 'popup-art', title: t('art.title') });

export function ConnectionArt({ state }: { state: ConnectionState }) {
  return <div className="hero-art" data-state={state} dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
