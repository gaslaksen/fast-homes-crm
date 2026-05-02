/**
 * Format a phone number from +1XXXXXXXXXX to (XXX) XXX-XXXX for display.
 * Returns the original string if it doesn't match the expected pattern.
 */
export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7);
    return `(${area}) ${prefix}-${line}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

type LeadLike = {
  sellerFirstName?: string | null;
  sellerLastName?: string | null;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
};

export function getLeadDisplayName(lead: LeadLike): string {
  const first = (lead.sellerFirstName || '').trim();
  const last = (lead.sellerLastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ');
  return name || (lead.propertyAddress || '').trim() || 'Unnamed lead';
}

export function getLeadAddressLine(lead: LeadLike): string {
  const street = (lead.propertyAddress || '').trim();
  const city = (lead.propertyCity || '').trim();
  const state = (lead.propertyState || '').trim();
  const zip = (lead.propertyZip || '').trim();
  const cityStateZip = [city, state].filter(Boolean).join(', ');
  const tail = [cityStateZip, zip].filter(Boolean).join(' ');
  return [street, tail].filter(Boolean).join(' · ');
}
