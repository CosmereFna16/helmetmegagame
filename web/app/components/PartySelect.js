// One end of a movement of things or ⬢: a person standing here or a Room
// stash here, as the "character:<id>" / "room:<id>" keys resolveParty()
// parses server-side.
//
// Players are a flat, alphabetical list, deliberately NOT nested under their
// faction — that grouping would leak allegiances to anyone who opened the
// dropdown. The list itself is already narrowed to who is at your Location
// and not concealed (web/lib/peopleHere.js).
//
// Lives here rather than inside the Transfer dialog because Heal and Craft
// ask the same question ("who pays for this?") over the same people.
//
// `rooms` — the Room stashes at the character's Location they can get into
// (docs/systemdocs/CARRY.md), as "room:<id>". `selfId` puts "(you)" after
// your own name so a payer or destination list reads right.
//
// `silo` — the character's own faction silo, when it is somewhere else in
// this zone. It gets a group of its own at the top rather than being mixed in
// with "Rooms here", because it is NOT here and listing it as though it were
// would be a lie. Only ever passed for a DESTINATION: you deposit into a silo
// from across the zone, and take things out only by standing in the room
// (FACTIONS.md, web/lib/transferReach.js).
import Select from "./Select";

export default function PartySelect({ label, value, onChange, characters, rooms, hint, selfId = null, silo = null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          {hint}
        </option>
        {silo ? (
          <optgroup label="Your silo ‡">
            <option value={`room:${silo.id}`}>
              ★ {silo.name} — {silo.locationName} ‡
            </option>
          </optgroup>
        ) : null}
        {rooms?.length ? (
          <optgroup label="Rooms here ‡">
            {rooms.map((r) => (
              <option key={r.id} value={`room:${r.id}`}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {characters?.length ? (
          <optgroup label="People here ‡">
            {characters.map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.name}
                {selfId && c.id === selfId ? " (you) ‡" : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </label>
  );
}
