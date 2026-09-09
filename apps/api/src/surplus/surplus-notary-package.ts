/**
 * The notary signing package, as the team drafted it in September 2026: a
 * cover with the notary's instructions, the General Limited Power of
 * Attorney, and the Irrevocable Direction to Pay Surplus Funds, followed by
 * the county's own claim form attached unaltered. The Client Recovery
 * Services Agreement is signed at retention and is not in the package.
 *
 * The cover and the direction differ by county because the clerk's form
 * does: Duval's Statement of Claim is notarized; Lee's Affidavit of Claim
 * needs two witnesses as well, and asks for the STRAP number. The general
 * text is what a county without its own package gets.
 *
 * Every body here is the team's working draft, reproduced from their
 * package with the claim's details as merge fields. The draft's own caveat
 * is kept in the cover: none of it has been reviewed by Florida counsel.
 */

const DRAFT_CAVEAT =
  'This package contains the documents signed at the notary appointment only. The Client Recovery Services Agreement is signed separately at retention, before this package is presented, and is not included here. This package is drafted from templates developed in prior planning and is provided as a working draft only. It has not been reviewed by a Florida licensed attorney. Given the power of attorney, fund direction, and unauthorized practice of law considerations that apply to third party assistance with tax deed surplus claims in Florida, this package should be reviewed by Florida counsel before it is used with any client or submitted to the Clerk of Court.';

const NOTARY_BLOCK = `State of _______________________, County of _______________________
Sworn to or affirmed and signed before me on this _____ day of ______________, 20____, by ___________________________________.
[ ] Personally known to me   [ ] Produced identification in the form of ___________________________
Notary Public: ___________________________________   Seal:
My commission expires: ___________________________________`;

const AT_THE_APPOINTMENT = `AT THE APPOINTMENT
Take a photocopy or photograph of the signer's photo ID for the file. Return every signed original to {{companyName}} the same day. Payment: as agreed in advance, on return of the signed documents. Call {{callbackNumber}} with any question before or during the appointment.

Notary name: ____________________   Signature: ____________________   Date: __________`;

function cover(opts: {
  countyLine: string;
  matterLine: string;
  countyForm: string;
  countyFormNote: string;
  reminder: string;
  idLine: string;
  estateLine: string;
  witnessLine?: string;
  holdLine: string;
}): string {
  return `{{companyName}}
NOTARY SIGNING PACKAGE
${opts.countyLine}

Signer: {{claimant}}
Signing address: {{claimantAddress}}
Matter: ${opts.matterLine}
Notary: {{notaryName}}
Prepared: {{today}}

${DRAFT_CAVEAT}

DOCUMENTS INCLUDED, IN ORDER OF EXECUTION
1. General Limited Power of Attorney. Signed at the notary appointment.
2. Irrevocable Direction to Pay Surplus Funds. Signed at the notary appointment. Case specific, discloses the fund source.
3. ${opts.countyForm}, reproduced exactly as provided, unaltered. Signed at the notary appointment. ${opts.countyFormNote}

Reminder: confirm the Client Recovery Services Agreement was already signed at retention before proceeding with this package. Sign the documents in the order listed above.${opts.reminder}

INSTRUCTIONS FOR THE NOTARY: BEFORE SCHEDULING THE APPOINTMENT
Confirm the claimant has the following ready before an in-person appointment is scheduled. Several of these cannot be produced on the spot, so confirming them in advance avoids a wasted trip.

Government-issued photo ID. ${opts.idLine} This is required by the Clerk's office to complete the claim and must be confirmed before the appointment is booked.

Estate or deceased former owner, if applicable. If the person entitled to the funds is deceased, the claimant will need ${opts.estateLine} These documents take time to obtain and cannot be created at the appointment. Confirm they already exist and are in hand.
${opts.witnessLine ? `\n${opts.witnessLine}\n` : ''}
Authority to sign for an entity, trust, or estate, if applicable. If the claimant is signing on behalf of a business entity, trust, or estate rather than as an individual, confirm they can show their authority to sign in that capacity.

${opts.holdLine}

${AT_THE_APPOINTMENT}`;
}

/** The cover and instructions, per county and in general. */
export const NOTARY_COVER = {
  general: cover({
    countyLine: '{{county}} County, Florida, Tax Deed Sale Surplus Claim',
    matterLine: '{{propertyAddress}}, {{county}} County, case {{caseNumber}}',
    countyForm: "The {{county}} County Clerk's own claim form",
    countyFormNote: "The county's own form, notarized where it calls for it. Check the county page for witness requirements before booking.",
    reminder: '',
    idLine: "A valid driver's license or state-issued photo ID.",
    estateLine:
      'a certified death certificate and probate documentation for the estate (an order of summary administration, letters of administration, or other writing of the court) establishing their authority to claim on the estate\'s behalf.',
    holdLine:
      'If any of the above is missing at the time of scheduling, particularly estate or probate documentation, hold off on booking the in-person visit until it is confirmed the claimant has it in hand.',
  }),
  Duval: cover({
    countyLine: 'Duval County, Florida, Tax Deed Sale Surplus Claim',
    matterLine: '{{propertyAddress}}, Duval County, clerk tax deed file {{caseNumber}}',
    countyForm: 'Duval County Statement of Claim to Surplus Funds from Tax Deed Sale (F.S. 197.582(3))',
    countyFormNote: "The county's own form, notarized.",
    reminder: '',
    idLine: "A valid driver's license or state-issued photo ID.",
    estateLine:
      'a certified death certificate and either an Order of Summary Administration, Letters of Administration, or other probate or heirship documentation establishing their authority to claim on the estate\'s behalf.',
    holdLine:
      'If any of the above is missing at the time of scheduling, particularly estate or probate documentation, hold off on booking the in-person visit until it is confirmed the claimant has it in hand.',
  }),
  Lee: cover({
    countyLine: 'Lee County, Florida, Tax Deed Sale Surplus Claim',
    matterLine: '{{propertyAddress}}, Lee County, tax deed number {{caseNumber}}',
    countyForm: 'Lee County Affidavit of Claim for Tax Deed Sale Surplus Funds',
    countyFormNote: "The county's own form, notarized, two witnesses required.",
    reminder:
      " Note that Lee County's Affidavit requires two witnesses in addition to the notary. Confirm both are available before the appointment.",
    idLine: "A valid driver's license or state-issued photo ID showing address and date of birth.",
    estateLine:
      'a certified death certificate and probate documentation for the estate: an order of family administration, order of summary administration, or other writing of the court. A photo ID is required for each claimant.',
    witnessLine:
      "Two witnesses. Lee County's affidavit requires two witness signatures in addition to the notary. Confirm the claimant can have two witnesses present at the appointment. This is a Lee County specific requirement not present on every county's form.",
    holdLine:
      'If any of the above is missing at the time of scheduling, particularly estate or probate documentation or the two required witnesses, hold off on booking the in-person visit until it is confirmed the claimant has everything in hand.',
  }),
};

/** Document 1. The same in every county. */
export const LIMITED_POA = `GENERAL LIMITED POWER OF ATTORNEY

KNOW ALL PERSONS BY THESE PRESENTS, that the undersigned, {{claimant}} ("Principal"), hereby appoints {{companyName}}, a Florida limited liability company with a business address of {{companyAddress}} ("Attorney in Fact"), as Principal's true and lawful attorney in fact, with the limited authority described below, and not otherwise.

1. LIMITED SCOPE OF AUTHORITY
This Power of Attorney authorizes Attorney in Fact solely to research and investigate potential funds that may be owed to Principal from one or more sources, and to communicate with government agencies, record custodians, and other third parties for the purpose of identifying such funds. This Power of Attorney does not authorize Attorney in Fact to sign any claim, agreement, or legal document on Principal's behalf, to accept or direct payment of any funds, or to act in any capacity beyond research and investigation as described here. Any claim identified through this research will require a separate, claim specific authorization signed by Principal before Attorney in Fact takes any further action.

2. TERM
This Power of Attorney is effective as of the date signed below and remains in effect for twelve (12) months, unless earlier revoked in writing by Principal.

3. REVOCATION
Principal may revoke this Power of Attorney at any time by written notice to Attorney in Fact.

4. NO COMPENSATION AUTHORITY
This Power of Attorney does not itself create any obligation for Principal to pay Attorney in Fact. Compensation, if any, is governed exclusively by the separate Client Recovery Services Agreement between the parties.

Principal Signature: _______________________________________   Date: ______________
Principal Printed Name: {{claimant}}

${NOTARY_BLOCK}`;

function direction(opts: { clerk: string; table: string; sourceNote: string; countyForm: string }): string {
  return `IRREVOCABLE DIRECTION TO PAY SURPLUS FUNDS
Case specific document, signed at the notary appointment

This Irrevocable Direction to Pay Surplus Funds ("Direction") is made by {{claimant}} ("Claimant"), in connection with surplus funds arising from a Tax Deed Sale held by the ${opts.clerk}, State of Florida, as described below.

1. PROPERTY AND CLAIM INFORMATION
${opts.table}

${opts.sourceNote}

2. DISCLOSURE OF FUND SOURCE
Claimant acknowledges and is hereby informed that the funds referenced in this Direction are surplus funds held by the ${opts.clerk} resulting from a Tax Deed Sale of the property described above, pursuant to Florida Statute Section 197.582. Claimant further acknowledges being informed that Claimant has the right to file a claim for these funds directly with the ${opts.clerk}, without the assistance of {{companyName}} or any other third party, and free of any fee or percentage of surplus.

3. CLAIMANT REMAINS CLAIMANT OF RECORD
Claimant will personally sign and submit the ${opts.countyForm} required by the ${opts.clerk}. {{companyName}} does not become the claimant of record and does not sign that form on Claimant's behalf.

4. DIRECTION TO PAY
Claimant irrevocably directs that, upon approval and disbursement of the surplus funds described above:

(a) If the ${opts.clerk} permits split disbursement to a third party designated by Claimant, the Clerk shall disburse Company's fee, as calculated under the Client Recovery Services Agreement between Claimant and Company, directly to {{companyName}}, with the balance disbursed to Claimant.

(b) If the Clerk of Court does not permit split disbursement, the full surplus amount shall be disbursed to Claimant, and Claimant agrees to pay Company's fee to {{companyName}} promptly after receipt of the funds, in accordance with the Client Recovery Services Agreement.

5. IRREVOCABILITY
This Direction is irrevocable while the underlying claim remains pending, and may be modified only by written agreement signed by both Claimant and Company.

Claimant Signature: _______________________________________   Date: ______________
Claimant Printed Name: {{claimant}}

${NOTARY_BLOCK}`;
}

/** Document 2. The clerk, the form and the case identifiers differ by county. */
export const DIRECTION_TO_PAY = {
  general: direction({
    clerk: '{{county}} County Clerk of Court',
    table: `Property Address: {{propertyAddress}}
Case or Tax Deed Number: {{caseNumber}}
Parcel Number: {{parcelId}}
Date of Sale: {{saleDate}}
Estimated Surplus Amount: Approximately {{surplusAmount}}`,
    sourceNote:
      "Case details above are drawn from the {{county}} County Clerk's tax deed file. Confirm current figures with the Clerk's office before filing; the surplus amount is stated as approximate.",
    countyForm: 'claim form',
  }),
  Duval: direction({
    clerk: 'Duval County Clerk of Court',
    table: `Property Address: {{propertyAddress}}
Clerk Tax Deed File #: {{caseNumber}}
Tax Collector Application #: ______________________
Date of Sale: {{saleDate}}
Estimated Surplus Amount: Approximately {{surplusAmount}}`,
    sourceNote:
      "Case details above are drawn from the Duval County Clerk's tax deed file. Confirm current figures with the Clerk's office before filing; the surplus amount is stated as approximate.",
    countyForm: 'Statement of Claim to Surplus Funds from Tax Deed Sale',
  }),
  Lee: direction({
    clerk: 'Lee County Clerk of Court',
    table: `Property Legal Description: ______________________________________________
STRAP #: {{parcelId}}
Tax Deed Number: {{caseNumber}}
Certificate Number / Year: ______________________
Date of Sale: {{saleDate}}
Estimated Surplus Amount: Approximately {{surplusAmount}}`,
    sourceNote:
      "Case details above are drawn from the Lee County Clerk's Notice of Tax Deed Surplus. Confirm current figures with the Clerk's office before filing; the surplus amount is stated as approximate. Fill the legal description and the certificate number from the notice.",
    countyForm: 'Affidavit of Claim for Tax Deed Sale Surplus Funds',
  }),
};

export const NOTARY_PACKAGE_NAME = 'Notary signing package, September 2026 draft';
