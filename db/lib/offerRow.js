// The two buttons on a consent DM (docs/systemdocs/LESSONS.md): Accept and
// Decline, keyed by the Offer's id the way the Bird's Reply button is keyed
// by its letter (db/lib/bird.js). Shared by both Offer kinds — the bot
// handler reads the kind off the row, not off the button.
//
// Constants live here, in db/, so the web action that sends the DM and the
// bot handler that answers the click can't drift on the prefix.
const OFFER_ACCEPT_PREFIX = "offer:accept:";
const OFFER_DECLINE_PREFIX = "offer:decline:";

function offerButtonRow(offerId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: `${OFFER_ACCEPT_PREFIX}${offerId}`, label: "Accept" },
        { type: 2, style: 2, custom_id: `${OFFER_DECLINE_PREFIX}${offerId}`, label: "Decline" },
      ],
    },
  ];
}

module.exports = { OFFER_ACCEPT_PREFIX, OFFER_DECLINE_PREFIX, offerButtonRow };
