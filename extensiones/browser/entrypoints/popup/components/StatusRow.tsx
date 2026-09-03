interface StatusRowProps {
  label: string;
  ok: boolean;
  value: string;
}

/** Fila de la checklist de captura: check + etiqueta + estado a la derecha. */
export function StatusRow({ label, ok, value }: StatusRowProps) {
  return (
    <div className="row">
      <span className="row-check" data-ok={ok}>
        ✓
      </span>
      <span className="row-label">{label}</span>
      <span className="row-value">{value}</span>
    </div>
  );
}
