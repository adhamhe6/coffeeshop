/**
 * Tiny SVG illustrations used as product/hero imagery by the mock API (dev + tests only).
 * Real imagery comes from the backend (`/media/...`).
 */
type Kind = 'cup' | 'iced' | 'bag' | 'pastry' | 'mug' | 'landscape' | 'tea';

const PALETTES: Record<string, [string, string, string]> = {
  cream: ['#f3e6d0', '#e5cfae', '#b4602b'],
  sage: ['#cfd8c4', '#a9b79b', '#3f4d38'],
  clay: ['#e8c9ad', '#d4a47c', '#7a3b17'],
  night: ['#4a3328', '#2b1d16', '#e0a070'],
  sand: ['#efe4d0', '#dccaa8', '#6b4a2a'],
};

function shapes(kind: Kind, accent: string): string {
  switch (kind) {
    case 'cup':
      return `<ellipse cx="200" cy="330" rx="130" ry="26" fill="#000" opacity=".10"/>
        <circle cx="200" cy="210" r="132" fill="#fffbf3"/><circle cx="200" cy="210" r="104" fill="#f2e7d4"/>
        <circle cx="200" cy="210" r="86" fill="#5a3a28"/><circle cx="200" cy="210" r="76" fill="#8a5a3c"/>
        <path d="M200 244c-34-24-34-48-14-52 10-2 14 6 14 6s4-8 14-6c20 4 20 28-14 52z" fill="#f4e4cc" opacity=".92"/>
        <path d="M312 190c34 0 34 40 0 40" fill="none" stroke="#fffbf3" stroke-width="14" stroke-linecap="round"/>`;
    case 'tea':
      return `<ellipse cx="200" cy="330" rx="120" ry="22" fill="#000" opacity=".10"/>
        <circle cx="200" cy="205" r="120" fill="#fffbf3"/><circle cx="200" cy="205" r="94" fill="#f4ead8"/>
        <circle cx="200" cy="205" r="78" fill="${accent}" opacity=".85"/><circle cx="200" cy="205" r="64" fill="#fff" opacity=".18"/>
        <rect x="190" y="70" width="20" height="48" rx="4" fill="#fffbf3" transform="rotate(18 200 94)"/>`;
    case 'iced':
      return `<ellipse cx="200" cy="344" rx="84" ry="16" fill="#000" opacity=".10"/>
        <path d="M118 108h164l-18 232a16 16 0 0 1-16 14h-96a16 16 0 0 1-16-14z" fill="#fffbf3" opacity=".7"/>
        <path d="M128 168h144l-14 170h-116z" fill="#6b4630"/><path d="M130 198h140l-4 50h-132z" fill="#b98a62" opacity=".7"/>
        <rect x="148" y="190" width="42" height="42" rx="8" fill="#fff" opacity=".35"/><rect x="214" y="220" width="40" height="40" rx="8" fill="#fff" opacity=".3"/>
        <rect x="236" y="38" width="12" height="190" rx="6" fill="${accent}" transform="rotate(8 242 133)"/>`;
    case 'bag':
      return `<ellipse cx="200" cy="350" rx="112" ry="16" fill="#000" opacity=".10"/>
        <path d="M110 92h180l16 252a16 16 0 0 1-16 16H110a16 16 0 0 1-16-16z" fill="#2b1d16"/>
        <path d="M110 92h180l4 40H106z" fill="#3b2a21"/><rect x="128" y="168" width="144" height="128" rx="8" fill="#f7f0e3"/>
        <circle cx="200" cy="214" r="22" fill="${accent}"/><rect x="150" y="256" width="100" height="8" rx="4" fill="#2b1d16" opacity=".8"/><rect x="164" y="272" width="72" height="6" rx="3" fill="#2b1d16" opacity=".45"/>`;
    case 'pastry':
      return `<ellipse cx="200" cy="338" rx="130" ry="20" fill="#000" opacity=".10"/>
        <path d="M70 280c0-80 60-140 130-140s130 60 130 140c0 20-20 36-50 36H120c-30 0-50-16-50-36z" fill="#d89a56"/>
        <path d="M118 270c10-60 44-100 82-100s72 40 82 100" fill="none" stroke="#b9772f" stroke-width="10" stroke-linecap="round"/>
        <path d="M150 276c6-40 26-70 50-70s44 30 50 70" fill="none" stroke="#b9772f" stroke-width="8" stroke-linecap="round"/>`;
    case 'mug':
      return `<ellipse cx="190" cy="344" rx="104" ry="16" fill="#000" opacity=".10"/>
        <path d="M96 120h190v170a44 44 0 0 1-44 44H140a44 44 0 0 1-44-44z" fill="${accent}"/>
        <path d="M286 160c52 0 52 90 0 90" fill="none" stroke="${accent}" stroke-width="22" stroke-linecap="round"/>
        <rect x="96" y="120" width="190" height="24" fill="#fff" opacity=".18"/><circle cx="191" cy="224" r="30" fill="#fffbf3" opacity=".9"/>`;
    default:
      return `<path d="M0 360l90-120 70 70 90-150 150 200v40H0z" fill="${accent}" opacity=".35"/>
        <path d="M0 400l120-90 100 60 180-120v150H0z" fill="${accent}" opacity=".55"/>
        <circle cx="300" cy="90" r="46" fill="#fffbf3" opacity=".8"/>`;
  }
}

export function art(
  kind: Kind,
  palette: keyof typeof PALETTES = 'cream',
  size: [number, number] = [400, 400],
): string {
  const [a, b, accent] = PALETTES[palette] as [string, string, string];
  const [w, h] = size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 ${Math.round((400 * h) / w)}" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="400" height="${Math.round((400 * h) / w)}" fill="url(#g)"/>${shapes(kind, accent)}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
