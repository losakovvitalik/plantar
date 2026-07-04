/** Логотипы технологий для селектора типа проекта */

export function ReactLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="-11.5 -10.25 23 20.5" className={className} aria-hidden="true">
      <circle r="2.05" fill="#58C4DC" />
      <g stroke="#58C4DC" strokeWidth="1" fill="none">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

export function TelegramLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#2AABEE" />
      <path
        d="M5.06 11.68l11.3-4.36c.53-.19.99.13.82.92l.001-.001-1.924 9.066c-.143.638-.524.793-1.058.492l-2.93-2.16-1.413 1.362c-.156.156-.288.288-.59.288l.208-2.983 5.43-4.906c.237-.208-.051-.325-.365-.118l-6.712 4.226-2.893-.903c-.628-.196-.642-.628.131-.928z"
        fill="#fff"
      />
    </svg>
  );
}

export function NodeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 1 21.5 6.5 V17.5 L12 23 2.5 17.5 V6.5 Z" fill="#5FA04E" />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fill="#fff"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        JS
      </text>
    </svg>
  );
}
