export function EmptyUploadIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect
        x="8"
        y="12"
        width="64"
        height="44"
        rx="8"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M28 36L36 28L44 36L52 28"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="30" cy="24" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M40 48H24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
