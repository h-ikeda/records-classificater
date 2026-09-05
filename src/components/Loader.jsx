// 待っていることが一目で分かるよう、回り続ける輪で表す。大きさは 1em なので
// 呼び出し側の text-* がそのまま効き、色も currentColor に従う。
export default function Loader({ className = '', label = '読み込み中' }) {
  return (
    <aside
      role="status"
      aria-live="polite"
      className={`flex justify-center items-center${className ? ` ${className}` : ''}`}
    >
      <svg
        className="w-[1em] h-[1em] animate-spin motion-reduce:[animation-duration:3s]"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </aside>
  );
}
