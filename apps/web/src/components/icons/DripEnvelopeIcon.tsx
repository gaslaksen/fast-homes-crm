export default function DripEnvelopeIcon({
  className = 'w-3 h-3',
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M1.5 3.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v.217l-6.5 4.062L1.5 3.717V3.5Zm0 1.934V12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5.434L8.283 9.28a.5.5 0 0 1-.566 0L1.5 5.434Z" />
    </svg>
  );
}
