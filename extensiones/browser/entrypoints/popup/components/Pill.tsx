export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

interface PillProps {
  tone: Tone;
  label: string;
}

/** Etiqueta compacta con punto de estado (p. ej. la conexión con VS Code). */
export function Pill({ tone, label }: PillProps) {
  return (
    <span className="pill" data-tone={tone === 'neutral' ? undefined : tone}>
      <span className="pill-dot" />
      {label}
    </span>
  );
}
