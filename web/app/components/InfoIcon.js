import Tooltip from "./Tooltip";

export default function InfoIcon({ text }) {
  return (
    <Tooltip text={text} className="info-icon">
      <span className="info-icon-glyph" aria-label="More info">
        ?
      </span>
    </Tooltip>
  );
}
