import { SurplusDocumentsService } from './surplus-documents.service';
import { StorageService } from '../storage/storage.service';
import { SurplusDocumentKind } from '@fast-homes/shared';

/**
 * The checklist is pure, so it is pinned here: what a claim needs depends on
 * the claim, and "complete" has to mean every required document is in hand
 * and not merely that rows exist.
 */
describe('SurplusDocumentsService.checklist', () => {
  const svc = new SurplusDocumentsService({} as any, {} as any);

  it('needs the base set for a living individual', () => {
    const c = svc.checklist([], { deceased: false, isEntity: false });
    expect(c.required).toEqual([
      SurplusDocumentKind.FEE_AGREEMENT,
      SurplusDocumentKind.LIMITED_POA,
      SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS,
      SurplusDocumentKind.LETTER_OF_DIRECTION,
      SurplusDocumentKind.COUNTY_CLAIM_FORM,
      SurplusDocumentKind.PHOTO_ID,
    ]);
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual(c.required);
    expect(c.documents).toHaveLength(Object.values(SurplusDocumentKind).length);
  });

  it('adds the estate papers for a deceased claimant and entity papers for a company', () => {
    const estate = svc.checklist([], { deceased: true, isEntity: false });
    expect(estate.required).toContain(SurplusDocumentKind.DEATH_CERTIFICATE);
    expect(estate.required).toContain(SurplusDocumentKind.LETTERS_OF_ADMINISTRATION);
    const entity = svc.checklist([], { deceased: false, isEntity: true });
    expect(entity.required).toContain(SurplusDocumentKind.ENTITY_DOCUMENTS);
    expect(entity.required).not.toContain(SurplusDocumentKind.DEATH_CERTIFICATE);
  });

  it('counts received, signed, notarized and filed as in hand, not drafted or sent', () => {
    const rows = [
      { kind: 'fee_agreement', status: 'signed' },
      { kind: 'limited_poa', status: 'notarized' },
      { kind: 'assignment_of_rights', status: 'sent' },
      { kind: 'letter_of_direction', status: 'drafted' },
      { kind: 'county_claim_form', status: 'filed' },
      { kind: 'photo_id', status: 'received', fileKey: 'k', fileName: 'id.jpg' },
    ];
    const c = svc.checklist(rows, { deceased: false, isEntity: false });
    expect(c.missing).toEqual([SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS, SurplusDocumentKind.LETTER_OF_DIRECTION]);
    expect(c.complete).toBe(false);
    const id = c.documents.find((d) => d.kind === SurplusDocumentKind.PHOTO_ID)!;
    expect(id.hasFile).toBe(true);
    expect(id.fileName).toBe('id.jpg');
    const poa = c.documents.find((d) => d.kind === SurplusDocumentKind.LIMITED_POA)!;
    expect(poa.collected).toBe(true);
    expect(poa.hasFile).toBe(false);
  });

  it('is complete once every required kind is in hand, whatever the optional ones say', () => {
    const rows = [
      'fee_agreement',
      'limited_poa',
      'assignment_of_rights',
      'letter_of_direction',
      'county_claim_form',
      'photo_id',
    ].map((kind) => ({ kind, status: 'received' }));
    const c = svc.checklist(rows, { deceased: false, isEntity: false });
    expect(c.complete).toBe(true);
    expect(c.missing).toEqual([]);
    expect(c.documents.find((d) => d.kind === SurplusDocumentKind.W9)!.required).toBe(false);
  });
});

describe('StorageService', () => {
  const unconfigured = new StorageService({ get: () => '' } as any);

  it('is off without credentials and refuses writes with a plain message', async () => {
    expect(unconfigured.configured()).toBe(false);
    await expect(unconfigured.put('k', Buffer.from('x'))).rejects.toThrow(/not set up/);
    await expect(unconfigured.ping()).resolves.toEqual({ ok: false, message: 'Not configured' });
  });

  it('builds keys that sort by case and keep a safe file name at the end', () => {
    const key = unconfigured.keyFor(['surplus', 'org 1', null, 'photo_id'], 'Drivers License (front).PDF');
    expect(key).toMatch(/^surplus\/org_1\/photo_id\/[0-9a-f]{12}-Drivers_License_front_.PDF$/);
  });
});
