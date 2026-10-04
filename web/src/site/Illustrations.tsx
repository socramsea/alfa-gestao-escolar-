/** Ilustrações usadas enquanto a escola não envia fotos reais. */

export function SchoolIllustration() {
  return (
    <svg viewBox="0 0 400 300" role="img" aria-label="Ilustração da escola">
      <rect x="0" y="230" width="400" height="70" fill="var(--s-leaf)" opacity="0.25" />
      <rect x="70" y="110" width="260" height="130" rx="6" fill="var(--s-surface)" stroke="var(--s-ink)" strokeWidth="4" />
      <polygon points="60,115 200,45 340,115" fill="var(--s-brand)" stroke="var(--s-ink)" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="200" cy="92" r="16" fill="var(--s-sun)" stroke="var(--s-ink)" strokeWidth="4" />
      <rect x="175" y="170" width="50" height="70" rx="4" fill="var(--s-sun)" stroke="var(--s-ink)" strokeWidth="4" />
      {[95, 255].map((x) => (
        <g key={x}>
          <rect x={x} y="140" width="50" height="40" rx="4" fill="var(--s-tint)" stroke="var(--s-ink)" strokeWidth="4" />
          <line x1={x + 25} y1="140" x2={x + 25} y2="180" stroke="var(--s-ink)" strokeWidth="3" />
        </g>
      ))}
      <circle cx="40" cy="205" r="26" fill="var(--s-leaf)" opacity="0.8" />
      <rect x="37" y="215" width="6" height="25" fill="var(--s-ink)" />
      <circle cx="362" cy="200" r="30" fill="var(--s-leaf)" opacity="0.8" />
      <rect x="359" y="212" width="6" height="28" fill="var(--s-ink)" />
      <circle cx="330" cy="40" r="18" fill="var(--s-sun)" />
    </svg>
  );
}

const stroke = { stroke: 'var(--s-ink)', strokeWidth: 4, strokeLinejoin: 'round' as const };

export function GarmentIllustration({ name }: { name: string }) {
  const lower = name.toLowerCase();

  if (/t[êe]nis|sapato/.test(lower)) {
    return (
      <svg viewBox="0 0 120 120" role="img" aria-label={name}>
        <path d="M14 76 L20 50 L46 52 L58 66 L98 72 Q108 74 108 86 L108 92 L14 92 Z" fill="var(--s-surface)" {...stroke} />
        <rect x="12" y="90" width="98" height="10" rx="4" fill="var(--s-ink)" />
        <line x1="40" y1="58" x2="52" y2="58" {...stroke} strokeWidth={3} />
        <line x1="44" y1="66" x2="58" y2="66" {...stroke} strokeWidth={3} />
      </svg>
    );
  }

  if (/cal[çc]a/.test(lower)) {
    return (
      <svg viewBox="0 0 120 120" role="img" aria-label={name}>
        <path d="M34 14 H86 L92 108 H66 L60 48 L54 108 H28 Z" fill="var(--s-brand)" {...stroke} />
        <line x1="34" y1="24" x2="86" y2="24" {...stroke} strokeWidth={3} />
        <line x1="31" y1="60" x2="29" y2="104" stroke="var(--s-surface)" strokeWidth="4" />
        <line x1="89" y1="60" x2="91" y2="104" stroke="var(--s-surface)" strokeWidth="4" />
      </svg>
    );
  }

  if (/bermuda|short|saia/.test(lower)) {
    return (
      <svg viewBox="0 0 120 120" role="img" aria-label={name}>
        <path d="M30 26 H90 L98 86 H68 L60 52 L52 86 H22 Z" fill="var(--s-brand)" {...stroke} />
        <line x1="30" y1="36" x2="90" y2="36" {...stroke} strokeWidth={3} />
      </svg>
    );
  }

  const jacket = /jaqueta|moletom|casaco|blusa/.test(lower);
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={name}>
      <path
        d={jacket ? 'M42 14 L60 22 L78 14 L106 34 L96 54 L88 48 L88 106 H32 V48 L24 54 L14 34 Z' : 'M42 18 L60 26 L78 18 L104 34 L94 52 L84 46 L84 102 H36 V46 L26 52 L16 34 Z'}
        fill={jacket ? 'var(--s-brand)' : 'var(--s-surface)'}
        {...stroke}
      />
      {jacket ? (
        <line x1="60" y1="22" x2="60" y2="106" {...stroke} strokeWidth={3} />
      ) : (
        <>
          <path d="M50 21 Q60 32 70 21" fill="none" {...stroke} strokeWidth={3} />
          <circle cx="72" cy="50" r="7" fill="var(--s-sun)" {...stroke} strokeWidth={2.5} />
        </>
      )}
    </svg>
  );
}
