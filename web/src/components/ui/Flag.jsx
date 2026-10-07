// Small inline SVG flags (emoji flags don't render on Windows or many Linux setups). Simplified, 3:2.
const star = (cx, cy, r, rot = 0) => {
  const pts = Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2 + rot, rad = i % 2 ? r * 0.382 : r; return `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`; });
  return pts.join(" ");
};
const bars = (colors, vertical = false) => colors.map((c, i) => vertical ? <rect key={i} x={(30 / colors.length) * i} y="0" width={30 / colors.length + 0.1} height="20" fill={c} /> : <rect key={i} x="0" y={(20 / colors.length) * i} width="30" height={20 / colors.length + 0.1} fill={c} />);

const FLAGS = {
  us: <><rect width="30" height="20" fill="#fff" />{[0, 2, 4, 6, 8, 10, 12].map((i) => <rect key={i} y={i * (20 / 13)} width="30" height={20 / 13} fill="#b22234" />)}<rect width="13" height={20 * 7 / 13} fill="#3c3b6e" />{[[2, 2], [5, 2], [8, 2], [11, 2], [3.5, 4.2], [6.5, 4.2], [9.5, 4.2], [2, 6.4], [5, 6.4], [8, 6.4], [11, 6.4]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".6" fill="#fff" />)}</>,
  es: <><rect width="30" height="20" fill="#aa151b" /><rect y="5" width="30" height="10" fill="#f1bf00" /></>,
  cn: <><rect width="30" height="20" fill="#de2910" /><polygon points={star(5, 5, 3)} fill="#ffde00" />{[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y], i) => <polygon key={i} points={star(x, y, 1)} fill="#ffde00" />)}</>,
  de: <>{bars(["#000", "#dd0000", "#ffce00"])}</>,
  fr: <>{bars(["#0055a4", "#fff", "#ef4135"], true)}</>,
  jp: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="6" fill="#bc002d" /></>,
  br: <><rect width="30" height="20" fill="#009c3b" /><polygon points="15,2 27,10 15,18 3,10" fill="#ffdf00" /><circle cx="15" cy="10" r="4.4" fill="#002776" /><path d="M10.8 9 Q15 7.6 19.2 11" stroke="#fff" strokeWidth=".8" fill="none" /></>,
  kr: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="5" fill="#cd2e3a" /><path d="M10 10a5 5 0 0 0 10 0a2.5 2.5 0 0 0-5 0a2.5 2.5 0 0 1-5 0z" fill="#0047a0" />{[[4, 3, -35], [26, 3, 35], [4, 17, 35], [26, 17, -35]].map(([x, y, r], i) => <g key={i} transform={`rotate(${r} ${x} ${y})`} fill="#000"><rect x={x - 3} y={y - 2} width="6" height=".9" /><rect x={x - 3} y={y - .5} width="6" height=".9" /><rect x={x - 3} y={y + 1} width="6" height=".9" /></g>)}</>,
  in: <>{bars(["#ff9933", "#fff", "#138808"])}<circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth=".6" /><circle cx="15" cy="10" r=".5" fill="#000080" /></>,
  it: <>{bars(["#009246", "#fff", "#ce2b37"], true)}</>,
  id: <>{bars(["#ce1126", "#fff"])}</>,
  tr: <><rect width="30" height="20" fill="#e30a17" /><circle cx="11.5" cy="10" r="5" fill="#fff" /><circle cx="13" cy="10" r="4" fill="#e30a17" /><polygon points={star(17.5, 10, 2.2, Math.PI / 2 * 0)} fill="#fff" /></>,
  sa: <><rect width="30" height="20" fill="#006c35" /><rect x="7" y="6" width="16" height="2.2" rx="1" fill="#fff" /><rect x="9" y="9.5" width="12" height=".9" fill="#fff" /><rect x="8" y="12.5" width="14" height="1.2" rx=".6" fill="#fff" /></>,
  ru: <>{bars(["#fff", "#0039a6", "#d52b1e"])}</>,
  ir: <>{bars(["#239f40", "#fff", "#da0000"])}<circle cx="15" cy="10" r="2.2" fill="none" stroke="#da0000" strokeWidth=".9" /><rect x="14.7" y="7.6" width=".6" height="4.8" fill="#da0000" /></>,
};

/** A flag by country code ("us", "ir"…). Decorative: the language name is always shown next to it. */
export function Flag({ code, width = 22, className }) {
  return (
    <svg className={`flag ${className ?? ""}`} width={width} height={(width * 2) / 3} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <defs><clipPath id={`flag-${code}`}><rect width="30" height="20" rx="2.5" /></clipPath></defs>
      <g clipPath={`url(#flag-${code})`}>{FLAGS[code]}</g>
      <rect width="30" height="20" rx="2.5" fill="none" stroke="#0003" strokeWidth="1" />
    </svg>
  );
}
