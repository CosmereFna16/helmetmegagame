export default function Tooltip({ text, children, className = "" }) {
  return (
    <span className={`tag-hover ${className}`.trim()} tabIndex={0}>
      {children}
      <span className="tag-tooltip" role="tooltip">
        {text}
      </span>
    </span>
  );
}
