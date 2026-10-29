import { LeadsService } from './leads.service';

function service(prisma: any) {
  const svc = Object.create(LeadsService.prototype) as any;
  svc.prisma = prisma;
  return svc as LeadsService;
}

const prismaWith = (note: any) => ({
  note: {
    findFirst: jest.fn().mockResolvedValue(note),
    update: jest.fn(async ({ data }) => ({ ...note, ...data })),
    delete: jest.fn().mockResolvedValue(note),
  },
});

const author = { userId: 'u1', organizationId: 'org1', role: 'AGENT' };

describe('editing and deleting notes', () => {
  it('lets the author edit their note, scoped to the lead and the organization', async () => {
    const prisma = prismaWith({ id: 'n1', leadId: 'L1', userId: 'u1' });
    await service(prisma).editNote('L1', 'note_n1', '  Called back, left a voicemail  ', author);
    expect(prisma.note.findFirst.mock.calls[0][0].where).toEqual({ id: 'n1', leadId: 'L1', lead: { organizationId: 'org1' } });
    expect(prisma.note.update.mock.calls[0][0]).toEqual({ where: { id: 'n1' }, data: { content: 'Called back, left a voicemail' } });
  });

  it('refuses someone else on the team, but lets an admin', async () => {
    const prisma = prismaWith({ id: 'n1', leadId: 'L1', userId: 'u1' });
    await expect(service(prisma).deleteNote('L1', 'n1', { ...author, userId: 'u2' })).rejects.toThrow('Only the person');
    expect(prisma.note.delete).not.toHaveBeenCalled();
    await service(prisma).deleteNote('L1', 'n1', { userId: 'u2', organizationId: 'org1', role: 'ADMIN' });
    expect(prisma.note.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
  });

  it('refuses an empty edit, a missing note and a token with no organization', async () => {
    const prisma = prismaWith({ id: 'n1', leadId: 'L1', userId: 'u1' });
    await expect(service(prisma).editNote('L1', 'n1', '   ', author)).rejects.toThrow('cannot be empty');
    await expect(service(prisma).editNote('L1', 'n1', 'x', { userId: 'u1' })).rejects.toThrow('Sign in');
    prisma.note.findFirst.mockResolvedValue(null);
    await expect(service(prisma).deleteNote('L1', 'n9', author)).rejects.toThrow('not found');
  });
});
