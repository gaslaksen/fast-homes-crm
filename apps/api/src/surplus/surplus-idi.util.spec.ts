import {
  buildIdiBatchCsv,
  idiFirstName,
  idiRelationshipLabel,
  matchIdiRow,
  mergeEmails,
  mergePhones,
  namesSeveralPeople,
  parseCsv,
  parseIdiResults,
  readIdiTable,
  streetKey,
  IdiMatchCandidate,
} from './surplus-idi.util';
import { IDI_RESULTS_CSV } from './surplus-idi.fixtures';

const NOW = new Date('2026-10-22T12:00:00Z');

describe('IDI batch upload', () => {
  it('writes the template header and a middle initial, CRLF, no BOM', () => {
    const csv = buildIdiBatchCsv([
      { first: idiFirstName('MARY THERESE'), last: 'Spieckerman', street: '2296 Starlite Ln', city: 'Port Charlotte', state: 'FL', zip: '33952' },
    ]);
    expect(csv).toBe(
      'First Name(Including Middle Initial),Last Name,Address,City,State,Zip\r\nMARY T,Spieckerman,2296 Starlite Ln,Port Charlotte,FL,33952\r\n',
    );
  });

  it('quotes a cell that carries a comma', () => {
    const csv = buildIdiBatchCsv([{ first: 'A', last: 'B', street: '1 Main St, Apt 2', city: 'X', state: 'FL', zip: '32909' }]);
    expect(csv).toContain('"1 Main St, Apt 2"');
  });

  it('leaves a single given name alone', () => {
    expect(idiFirstName('Ruth')).toBe('Ruth');
    expect(idiFirstName('Glenn A')).toBe('Glenn A');
  });
});

describe('IDI results file', () => {
  const rows = parseIdiResults(parseCsv(IDI_RESULTS_CSV));

  it('reads every row', () => {
    expect(rows).toHaveLength(3);
  });

  it('reads a living match with dated phones and emails', () => {
    const r = rows[0];
    expect(r.input).toEqual({ first: 'Jane Q', last: 'Sample', street: '100 Example Rd SE', city: 'Palm Bay', state: 'FL', zip: '32909' });
    expect(r.deceased).toBe('N');
    expect(r.matched).toBe(true);
    expect(r.phones[0]).toEqual({ num: '2625550101', type: 'Mobile', firstSeen: '2007-09-16', lastSeen: '2026-09-11' });
    expect(r.phones).toHaveLength(3);
    expect(r.emails[0]).toEqual({ email: 'jsample@example.net', firstSeen: '2007-06-20', lastSeen: '2025-11-19' });
  });

  it('reads relatives with their own contacts and keeps a leading zero ZIP', () => {
    const [spouse, child] = rows[0].relatives;
    expect(spouse).toMatchObject({ name: 'JOHN P SAMPLE JR', age: 66, phones: ['2625550201', '2625550202'], emails: ['john@example.net'], relationship: 'SPOUSE' });
    expect(child).toMatchObject({ name: 'ANN SAMPLE', zip: '02108', relationship: 'CHILD' });
  });

  it('treats an all U row as nobody found', () => {
    expect(rows[1].matched).toBe(false);
    expect(rows[1].phones).toEqual([]);
    expect(rows[1].relatives).toEqual([]);
  });

  it('reads a death flag', () => {
    expect(rows[2].deceased).toBe('Y');
    expect(rows[2].relatives[0].relationship).toBe('SPOUSE - WIDOWED');
  });

  it('refuses the batch file that was sent instead of the one that came back', () => {
    const sent = parseCsv('First Name(Including Middle Initial),Last Name,Address,City,State,Zip\r\nA,B,1 Main St,X,FL,32909\r\n');
    expect(() => parseIdiResults(sent)).toThrow(/not an IDI results file/);
  });

  it('reads the same file as a buffer', () => {
    expect(readIdiTable(Buffer.from(IDI_RESULTS_CSV), 'x_out.csv')).toHaveLength(4);
  });

  it('labels relationships for the card', () => {
    expect(idiRelationshipLabel('SPOUSE - WIDOWED')).toBe('Spouse (widowed)');
    expect(idiRelationshipLabel('IN-LAW')).toBe('In-law');
    expect(idiRelationshipLabel('OTHER RELATIVE')).toBe('Other relative');
    expect(idiRelationshipLabel(null)).toBe('Relative');
  });
});

describe('matching a returned row to a claimant', () => {
  const rows = parseIdiResults(parseCsv(IDI_RESULTS_CSV));
  const cand = (over: Partial<IdiMatchCandidate>): IdiMatchCandidate => ({
    leadId: 'l1',
    detailId: 'd1',
    claimant: 'JANE Q SAMPLE',
    county: 'Brevard',
    caseNumber: '250481',
    streets: ['100 EXAMPLE ROAD SE'],
    ...over,
  });

  it('compares house number and street name only', () => {
    expect(streetKey('1313 TORGERSON RD SE')).toBe(streetKey('1313 Torgerson Road SE'));
    expect(streetKey('7597 E Pen Ct')).toBe('7597 PEN');
    expect(streetKey('PO Box 12')).toBeNull();
  });

  it('picks the claimant whose name and address both fit', () => {
    const m = matchIdiRow(rows[0], [cand({}), cand({ leadId: 'l2', detailId: 'd2', streets: ['9 Other St'] })]);
    expect(m.confidence).toBe('name_and_address');
    expect(m.pick?.leadId).toBe('l1');
  });

  it('accepts a lone name match at another address, flagged as name only', () => {
    const m = matchIdiRow(rows[0], [cand({ streets: ['9 Other St'] })]);
    expect(m.confidence).toBe('name_only');
    expect(m.pick?.leadId).toBe('l1');
  });

  it('will not choose between two name matches with no address to separate them', () => {
    const m = matchIdiRow(rows[0], [cand({ streets: [] }), cand({ leadId: 'l2', detailId: 'd2', streets: [] })]);
    expect(m.confidence).toBe('ambiguous');
    expect(m.pick).toBeNull();
    expect(m.options).toHaveLength(2);
  });

  it('separates spouses at one address by the spelled out first name', () => {
    // Her middle initial M meets his surname Mills, so the name test alone
    // passes her row against both of them.
    const wife = { ...rows[2], input: { ...rows[2].input, first: 'Emma M', last: 'Mills' } };
    const m = matchIdiRow(wife, [
      cand({ leadId: 'paul', claimant: 'PAUL G MILLS', streets: ['7500 E Sample Ct'] }),
      cand({ leadId: 'emma', claimant: 'EMMA M MILLS', streets: ['7500 E Sample Ct'] }),
    ]);
    expect(m.confidence).toBe('name_and_address');
    expect(m.pick?.leadId).toBe('emma');
  });

  it('never hands a wife the husband row', () => {
    const m = matchIdiRow(rows[2], [cand({ claimant: 'EMMA M EXAMPLE', streets: ['7500 E Sample Ct'] })]);
    expect(m.confidence).toBe('none');
  });

  it('spots a claimant that names two people', () => {
    expect(namesSeveralPeople('GLENN A & MARIA C LAWSON')).toBe(true);
    expect(namesSeveralPeople('GLENN A LAWSON')).toBe(false);
  });
});

describe('merging contacts, newest first', () => {
  it('ranks fresh IDI numbers, then what we held, then stale IDI numbers', () => {
    const { phones, dropped, added } = mergePhones(
      [
        { num: '9045550001', type: 'Mobile', dnc: 'federal' },
        { num: '9045550002', type: 'Landline', dnc: null },
      ],
      [
        { num: '2625550101', type: 'Mobile', firstSeen: null, lastSeen: '2026-09-11' },
        { num: '2625550102', type: 'Mobile', firstSeen: null, lastSeen: '2019-10-08' },
        { num: '2625550103', type: 'Listed Landline', firstSeen: null, lastSeen: '2026-09-02' },
      ],
      NOW,
    );
    expect(phones.map((p) => p.num)).toEqual(['2625550101', '2625550103', '9045550001', '9045550002']);
    expect(phones[2].dnc).toBe('federal');
    expect(dropped.map((p) => p.num)).toEqual(['2625550102']);
    expect(added).toBe(2);
  });

  it('keeps a DNC flag on a number IDI returns again', () => {
    const { phones, added } = mergePhones(
      [{ num: '2625550101', type: null, dnc: 'state' }],
      [{ num: '2625550101', type: 'Mobile', firstSeen: null, lastSeen: '2026-09-11' }],
      NOW,
    );
    expect(phones).toEqual([{ num: '2625550101', type: 'Mobile', dnc: 'state', lastSeen: '2026-09-11', fromIdi: true }]);
    expect(added).toBe(0);
  });

  it('merges emails the same way', () => {
    const r = mergeEmails(
      ['kept@example.com'],
      [
        { email: 'old@example.com', firstSeen: null, lastSeen: '2007-09-24' },
        { email: 'new@example.com', firstSeen: null, lastSeen: '2025-11-19' },
      ],
      NOW,
    );
    expect(r.emails).toEqual(['new@example.com', 'kept@example.com']);
    expect(r.added).toBe(1);
  });
});
