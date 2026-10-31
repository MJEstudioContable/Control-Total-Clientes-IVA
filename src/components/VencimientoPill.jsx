export default function VencimientoPill({
  day,
  digit,
  active = false,
  onClick,
  className = '',
  activeClassName = 'is-active',
}) {
  const numericDay = /^\d+$/.test(String(day));
  const dayLabel = numericDay ? `Día ${day}` : String(day);

  // Los valores no numéricos (por ejemplo "Sin vencimiento") conservan su
  // texto: no tienen una terminación de RUC asociada.
  if (!numericDay || digit === undefined || digit === null) {
    return (
      <button
        type="button"
        className={`${className} ${active ? activeClassName : ''}`.trim()}
        onClick={onClick}
      >
        {dayLabel}
      </button>
    );
  }

  const accessibleLabel = `Vencimiento ${dayLabel}, terminación ${digit}`;
  return (
    <button
      type="button"
      className={`${className} filter-pill-vencimiento ${active ? activeClassName : ''}`.trim()}
      onClick={onClick}
      title={`${dayLabel} • Terminación ${digit}`}
      aria-label={accessibleLabel}
      aria-pressed={active}
    >
      <span className="pill-day-label" aria-hidden="true">{dayLabel}</span>
      <span className="pill-digit-label" aria-hidden="true">{digit}</span>
    </button>
  );
}
