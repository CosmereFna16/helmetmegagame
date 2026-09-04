// What a Squeeze cube leaves you able to say.
//
// {tag:stupid} is permanent and incurable, and the point of it is that the
// player keeps playing — they can still walk into a room, still be led about,
// still be talked at — they just cannot make words any more. So the proxy
// keeps carrying their messages; it simply carries this instead.
//
// Length is preserved and content is not. Somebody typing a long anguished
// paragraph produces a long anguished noise, and a one-word answer produces a
// grunt, so the shape of what they meant survives even though the meaning
// doesn't. That is the whole design: it should be legible as *communication
// failing*, not as a bot swallowing the message.
//
// Deliberately NOT db/lib/gribble.js. That is a cipher — reversible by anyone
// holding the right tag, which is exactly right for a letter an illiterate
// character could hand to a friend. There is nothing to decode here.
//
// Pure and dependency-free, like gribble.js beside it, so both faces can use
// it and neither can drift.

const SYLLABLES = [
  "ehhhh", "blauh", "ghhr", "yahhh", "ugh", "eh", "uh", "gah", "mmnh",
  "hurhh", "nnn", "buh", "aaah", "ghuh", "wuh", "nyeh", "hhh", "orh",
];

const STUPID_SLUG = "stupid";

// Roughly one noise per word, so the reply is as long as the thought was.
// Punctuation is redrawn rather than copied: keeping the original commas would
// leak the sentence structure, which is most of what someone was saying.
function babble(content, rng = Math.random) {
  const words = String(content ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const pick = () => SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
  const out = [];
  let sinceBreak = 0;

  for (let i = 0; i < words.length; i += 1) {
    const first = out.length === 0;
    const syllable = pick();
    out.push(first ? syllable.charAt(0).toUpperCase() + syllable.slice(1) : syllable);
    sinceBreak += 1;
    if (i === words.length - 1) break;
    // A break every 2-4 noises. Without them a long message is one unreadable
    // wall, which reads as a bug rather than as somebody struggling.
    if (sinceBreak >= 2 + Math.floor(rng() * 3)) {
      out.push(rng() < 0.5 ? "…" : ",");
      sinceBreak = 0;
    } else {
      out.push(",");
    }
  }

  const text = out
    .join(" ")
    .replace(/ ([,…])/g, "$1")
    .replace(/,$/, "");
  return `${text}${rng() < 0.5 ? "!" : "…"}`;
}

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`)
// and tolerates a bare Tag[], same as db/lib/examineVision.js#slugSet.
function speaksBabble(characterTags) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === STUPID_SLUG);
}

module.exports = { babble, speaksBabble, STUPID_SLUG, SYLLABLES };
