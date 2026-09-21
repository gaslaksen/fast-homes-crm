/**
 * The consent wording shown on the digdeeperllc.com call-back form, by version.
 *
 * A carrier or a regulator asking "what did this person agree to" has to be
 * answered with the exact words that were on the page, so the API records the
 * wording it holds for the version the form reports rather than trusting text
 * sent by a browser. Change the wording in
 * apps/digdeeper-site/public/index.html and here together, add a new version
 * key, and bump CONSENT_VERSION in apps/digdeeper-site/public/form.js. Never
 * edit an old version in place: rows already point at it.
 */
export const DIGDEEPER_CONSENT_VERSION = '2026-09-21';

export interface ConsentWording {
  marketing: string;
  service: string;
}

export const DIGDEEPER_CONSENT_TEXT: Record<string, ConsentWording> = {
  '2026-09-21': {
    marketing:
      'I consent to receive marketing text messages from D.I.G. Deeper LLC at the phone number provided. Frequency may vary. Message & data rates may apply. Text HELP to (904) 595-9620 for assistance. You can reply STOP to unsubscribe at any time.',
    service:
      'I consent to receive non-marketing text messages from D.I.G. Deeper LLC about my inquiry, appointment confirmations and updates on my file. Frequency may vary. Message & data rates may apply. Text HELP to (904) 595-9620 for assistance. You can reply STOP to unsubscribe at any time.',
  },
};

/** Submissions allowed from one network address inside the window. */
export const INQUIRY_RATE_LIMIT = 5;
export const INQUIRY_RATE_WINDOW_MS = 10 * 60 * 1000;
