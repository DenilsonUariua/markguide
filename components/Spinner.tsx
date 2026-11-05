interface SpinnerProps {
  size?: number;
  className?: string;
}

/** iOS-style activity indicator: eight fading spokes. */
export function Spinner({ size = 20, className = "" }: SpinnerProps) {
  return (
    <span
      className={`spinner ${size >= 26 ? "is-lg" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: 8 }).map((_, index) => (
        <span className="spoke" key={index} style={{ transform: `rotate(${index * 45}deg)` }}>
          <i style={{ animationDelay: `${index * 0.125}s` }} />
        </span>
      ))}
    </span>
  );
}
