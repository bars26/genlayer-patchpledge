/** PatchPledge mark: an ink shield with a stitched green patch across it. */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="PatchPledge">
      <path d="M16 2.5 4.5 6.8v8.4c0 7.2 4.9 12.3 11.5 14.3 6.6-2 11.5-7.1 11.5-14.3V6.8L16 2.5Z" fill="#16181D" />
      <g transform="rotate(-24 16 16)">
        <rect x="8.4" y="12.3" width="15.2" height="7.4" rx="1.8" fill="#14A37F" />
        <path d="M11.6 14.4v3.2M14.6 14.4v3.2M17.6 14.4v3.2M20.6 14.4v3.2" stroke="#16181D" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
