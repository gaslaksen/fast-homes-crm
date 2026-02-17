import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo user
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'demo@fasthomes.com' },
    update: {},
    create: {
      email: 'demo@fasthomes.com',
      password: hashedPassword,
      firstName: 'Demo',
      lastName: 'Agent',
      role: 'ADMIN',
    },
  });

  console.log('✅ Created demo user:', user.email);

  // Create sample leads
  const leads = [
    {
      source: 'PROPERTY_LEADS',
      status: 'NEW',
      propertyAddress: '123 Oak Street',
      propertyCity: 'Charlotte',
      propertyState: 'NC',
      propertyZip: '28202',
      propertyType: 'Single Family',
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1800,
      sellerFirstName: 'John',
      sellerLastName: 'Smith',
      sellerPhone: '+17045551234',
      sellerEmail: 'john.smith@email.com',
      timeline: 30,
      askingPrice: 180000,
      conditionLevel: 'fair',
      distressSignals: (['needs_repairs', 'motivated']),
      ownershipStatus: 'sole_owner',
      arv: 250000,
      arvConfidence: 85,
      challengeScore: 2,
      authorityScore: 3,
      moneyScore: 2,
      priorityScore: 2,
      totalScore: 9,
      scoreBand: 'HOT',
      abcdFit: 'B',
      scoringRationale: 'Motivated seller with sole ownership, fair asking price at 72% ARV, 30-day timeline',
      tags: (['hot_lead', 'needs_comps']),
      assignedToUserId: user.id,
    },
    {
      source: 'GOOGLE_ADS',
      status: 'ATTEMPTING_CONTACT',
      propertyAddress: '456 Maple Avenue',
      propertyCity: 'Charlotte',
      propertyState: 'NC',
      propertyZip: '28203',
      propertyType: 'Single Family',
      bedrooms: 4,
      bathrooms: 2.5,
      sqft: 2200,
      sellerFirstName: 'Sarah',
      sellerLastName: 'Johnson',
      sellerPhone: '+17045555678',
      sellerEmail: 'sarah.j@email.com',
      timeline: 7,
      askingPrice: 280000,
      conditionLevel: 'distressed',
      distressSignals: (['vacant', 'code_violations', 'foreclosure']),
      ownershipStatus: 'sole_owner',
      arv: 350000,
      arvConfidence: 90,
      challengeScore: 3,
      authorityScore: 3,
      moneyScore: 3,
      priorityScore: 3,
      totalScore: 12,
      scoreBand: 'STRIKE_ZONE',
      abcdFit: 'A',
      scoringRationale: 'Urgent timeline (<14 days), distressed property with major issues, asking price at 80% ARV, sole owner with decision authority',
      tags: (['strike_zone', 'urgent', 'foreclosure']),
      assignedToUserId: user.id,
    },
    {
      source: 'MANUAL',
      status: 'QUALIFIED',
      propertyAddress: '789 Pine Drive',
      propertyCity: 'Charlotte',
      propertyState: 'NC',
      propertyZip: '28204',
      propertyType: 'Townhouse',
      bedrooms: 3,
      bathrooms: 2.5,
      sqft: 1600,
      sellerFirstName: 'Michael',
      sellerLastName: 'Williams',
      sellerPhone: '+17045559012',
      timeline: 60,
      askingPrice: 200000,
      conditionLevel: 'good',
      ownershipStatus: 'co_owner',
      arv: 230000,
      arvConfidence: 80,
      challengeScore: 1,
      authorityScore: 1,
      moneyScore: 2,
      priorityScore: 1,
      totalScore: 5,
      scoreBand: 'WORKABLE',
      abcdFit: 'C',
      scoringRationale: 'Longer timeline (60 days), co-ownership requires multiple approvals, decent price at 87% ARV, property in good condition',
      tags: (['workable', 'co_owner']),
      assignedToUserId: user.id,
    },
    {
      source: 'PROPERTY_LEADS',
      status: 'NEW',
      propertyAddress: '321 Elm Boulevard',
      propertyCity: 'Charlotte',
      propertyState: 'NC',
      propertyZip: '28205',
      propertyType: 'Single Family',
      bedrooms: 2,
      bathrooms: 1,
      sqft: 1200,
      sellerFirstName: 'Emily',
      sellerLastName: 'Davis',
      sellerPhone: '+17045553456',
      timeline: 180,
      askingPrice: 150000,
      conditionLevel: 'excellent',
      ownershipStatus: 'sole_owner',
      arv: 155000,
      arvConfidence: 75,
      challengeScore: 0,
      authorityScore: 3,
      moneyScore: 0,
      priorityScore: 0,
      totalScore: 3,
      scoreBand: 'DEAD_COLD',
      abcdFit: 'D',
      scoringRationale: 'No urgency (180-day timeline), asking price at 97% ARV (too high), excellent condition means no distress, though sole owner',
      tags: (['low_priority']),
    },
  ];

  for (const leadData of leads) {
    const lead = await prisma.lead.create({
      data: leadData,
    });
    console.log(`✅ Created lead: ${lead.propertyAddress}`);

    // Add sample activity
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: 'LEAD_CREATED',
        description: `Lead created from ${lead.source}`,
        metadata: ({ source: lead.source }),
      },
    });

    // Add sample messages for some leads
    if (lead.totalScore >= 7) {
      await prisma.message.create({
        data: {
          leadId: lead.id,
          direction: 'OUTBOUND',
          status: 'SENT',
          body: `Hi ${lead.sellerFirstName}, this is Fast Homes for Cash. I saw you're interested in selling your property at ${lead.propertyAddress}. I'd love to discuss a quick, hassle-free cash offer. Are you available for a brief chat?`,
          from: '+17045550000',
          to: lead.sellerPhone,
          sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      await prisma.message.create({
        data: {
          leadId: lead.id,
          direction: 'INBOUND',
          status: 'RECEIVED',
          body: 'Yes, I need to sell quickly. What kind of offer can you make?',
          from: lead.sellerPhone,
          to: '+17045550000',
          sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        },
      });

      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'MESSAGE_SENT',
          description: `Message sent to ${lead.sellerPhone}`,
        },
      });

      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'MESSAGE_RECEIVED',
          description: `Message received from ${lead.sellerPhone}`,
        },
      });
    }

    // Add sample task for hot leads
    if (lead.scoreBand === 'STRIKE_ZONE' || lead.scoreBand === 'HOT') {
      await prisma.task.create({
        data: {
          leadId: lead.id,
          userId: user.id,
          title: 'Schedule property inspection',
          description: `Call ${lead.sellerFirstName} to schedule a walkthrough of ${lead.propertyAddress}`,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    // Add sample comps for leads with ARV
    if (lead.arv) {
      const compData = [
        {
          address: '111 Nearby St',
          distance: 0.3,
          soldPrice: lead.arv * 0.95,
          soldDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          daysOnMarket: 25,
          bedrooms: lead.bedrooms,
          bathrooms: lead.bathrooms,
          sqft: lead.sqft,
        },
        {
          address: '222 Adjacent Ave',
          distance: 0.5,
          soldPrice: lead.arv * 1.02,
          soldDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
          daysOnMarket: 18,
          bedrooms: lead.bedrooms,
          bathrooms: lead.bathrooms,
          sqft: lead.sqft,
        },
        {
          address: '333 Close Blvd',
          distance: 0.7,
          soldPrice: lead.arv * 0.98,
          soldDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          daysOnMarket: 32,
          bedrooms: lead.bedrooms,
          bathrooms: lead.bathrooms,
          sqft: lead.sqft,
        },
      ];

      for (const comp of compData) {
        await prisma.comp.create({
          data: {
            leadId: lead.id,
            ...comp,
          },
        });
      }

      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'COMPS_FETCHED',
          description: `Comps fetched: 3 comparables found, ARV: $${lead.arv.toLocaleString()}`,
          metadata: ({ count: 3, arv: lead.arv }),
        },
      });
    }
  }

  console.log('✅ Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
