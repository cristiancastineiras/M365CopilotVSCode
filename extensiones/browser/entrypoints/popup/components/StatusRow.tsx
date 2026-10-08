export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

interface StatusRowProps {
  label: string;
  tone: Tone;
  value: string;
}

/** Una fila de la lista de estado: etiqueta a la izquierda, punto de color y valor a la derecha. */
export function StatusRow({ label, tone, value }: StatusRowProps) {
  return (
    <div className="item">
      <dt>{label}</dt>
      <dd>
        <span className="dot" data-tone={tone} aria-hidden="true" />
        {value}
      </dd>
    </div>
  );
}
