export default function Loader({ className = '' }) {
  return (
    <aside
      className={`flex justify-center items-center after:content-['◎'] after:animate-ping${className ? ` ${className}` : ''}`}
    />
  );
}
