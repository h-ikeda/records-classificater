export default function Loader({ className = '' }) {
  return (
    <aside
      role="status"
      aria-live="polite"
      className={`flex justify-center items-center after:content-['◎'] after:animate-ping${className ? ` ${className}` : ''}`}
    >
      <span className="sr-only">Loading</span>
    </aside>
  );
}
