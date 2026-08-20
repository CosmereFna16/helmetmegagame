export default function InfoIcon({ text }) {
  return (
    <span className="tag-hover info-icon" tabIndex={0}>
      <span className="info-icon-glyph" aria-label="More info">
        ?
      </span>
      <span className="tag-tooltip" role="tooltip">
        {text}
      </span>
    </span>
  );
}
