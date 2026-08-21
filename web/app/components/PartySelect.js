// One end of a resource movement: a faction Silo or a living player, as the
// "faction:<id>" / "character:<id>" keys resolveParty() parses server-side.
//
// Factions and players are listed as two flat, alphabetical optgroups.
// Players are deliberately NOT nested under their faction — that grouping
// would leak allegiances to anyone who opened the dropdown.
//
// Lives here rather than inside TransferResourcesButton because the Heal
// dialog asks the same question ("who pays for this?") over a different set
// of people.
export default function PartySelect({ label, value, onChange, characters, factions, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          {hint}
        </option>
        {factions?.length ? (
          <optgroup label="Factions (Silo)">
            {factions.map((f) => (
              <option key={f.id} value={`faction:${f.id}`}>
                {f.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {characters?.length ? (
          <optgroup label="Players">
            {characters.map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
