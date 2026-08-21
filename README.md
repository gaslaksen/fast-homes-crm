# Fast Homes CRM 🏠

A production-ready property wholesaling CRM with AI-assisted texting, lead scoring, and comps integration.

## 🎯 Features

- **Lead Management**: Complete CRM pipeline from acquisition to closing
- **Council Model Scoring**: CHAMP-based lead scoring (0-12 scale, 4 bands)
- **AI-Assisted Texting**: Claude-generated message drafts with human-in-the-loop approval
- **Auto-Extraction**: Claude extracts signals from conversations to update lead data
- **Comps Integration**: RentCast and ATTOM comps with a placeholder fallback
- **Twilio SMS**: Full inbound/outbound messaging with webhooks
- **Multi-Source Ingestion**: PropertyLeads.com, Google Ads, foreclosure, probate, tax sales, surplus funds, manual entry
- **Dashboard & Reporting**: Stats, hot leads, tasks, activity tracking
- **Complete Audit Trail**: Activity logging for all key events

## 🏗️ Architecture

### Monorepo Structure
```
fast-homes-crm/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # Next.js frontend
├── packages/
│   └── shared/       # Shared types & utilities
├── docker-compose.yml
└── README.md
```

### Tech Stack

**Backend:**
- NestJS (TypeScript)
- PostgreSQL + Prisma ORM
- Twilio (SMS provider) + Vapi (AI voice calling)
- Anthropic Claude (AI drafts, extraction, scoring)
- Mailgun (inbound + outbound email)
- BullMQ/Redis (drip sequences)

**Frontend:**
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Axios

## 🚀 Quick Start

> New contributor? See [CONTRIBUTING.md](CONTRIBUTING.md) for the full onboarding
> guide: access, environment setup, the branch/PR workflow, and the house rules.

### Prerequisites
- Node.js 18+
- pnpm 8+
- Docker & Docker Compose

### 1. Install Dependencies

```bash
# Install pnpm globally if needed
npm install -g pnpm

# Install all dependencies
pnpm install
```

### 2. Start Database

```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Wait for health checks
docker-compose ps
```

### 3. Configure Environment

```bash
# Copy example env file
cp apps/api/.env.example apps/api/.env

# Edit apps/api/.env with your credentials:
# - DATABASE_URL (default is fine for local)
# - TWILIO credentials (SMS provider; set SMS_TEST_MODE=true locally)
# - ANTHROPIC_API_KEY (powers all AI features)
# - RENTCAST_API_KEY / ATTOM_API_KEY (optional, for real comps)
```

### 4. Setup Database

```bash
# Generate Prisma client
cd apps/api
pnpm prisma generate

# Run migrations
pnpm prisma migrate dev

# Seed demo data
pnpm prisma db seed

cd ../..
```

### 5. Start Development Servers

```bash
# Terminal 1: Start API (port 3001)
cd apps/api
pnpm dev

# Terminal 2: Start Web (port 3000)
cd apps/web
pnpm dev
```

### 6. Access the App

- **Frontend**: http://localhost:3000
- **API**: http://localhost:3001
- **Demo Login**:
  - Email: demo@fasthomes.com
  - Password: password123

## 📋 Database Schema

### Core Models
- **Lead**: Property and seller info, scoring, status pipeline
- **Message**: SMS conversations with Twilio integration
- **Comp**: Property comparables for ARV calculation
- **Task**: Follow-up tasks with due dates
- **Note**: Internal notes on leads
- **Activity**: Audit trail of all changes
- **Contract**: Contract and closing details
- **User**: Agent accounts with role-based access

### Scoring Model (Council/CHAMP)
```
Challenge (0-3):  Property distress level
Authority (0-3):  Decision-making power
Money (0-3):      Price/ARV ratio
Priority (0-3):   Timeline urgency
---
Total (0-12):     Sum of all categories

Bands:
  0-3:   Dead/Cold
  4-6:   Workable
  7-9:   Hot
  10-12: Strike Zone
```

## 🔌 API Endpoints

### Leads
- `POST /leads` - Create lead
- `GET /leads` - List leads (with filters)
- `GET /leads/:id` - Get lead details
- `PATCH /leads/:id` - Update lead
- `POST /leads/:id/tasks` - Create task
- `POST /leads/:id/notes` - Add note
- `POST /leads/:id/contract` - Create/update contract

### Messages
- `GET /leads/:id/messages` - Get conversation
- `POST /leads/:id/messages/draft` - Generate AI drafts
- `POST /leads/:id/messages/send` - Send message via Twilio
- `POST /leads/:id/messages/rescore` - Force rescore

### Comps
- `POST /leads/:id/comps` - Fetch comps
- `GET /leads/:id/comps` - Get stored comps

### Webhooks
- `POST /webhooks/propertyleads` - PropertyLeads ingestion
- `POST /webhooks/google-ads` - Google Ads/landing page
- `POST /webhooks/twilio/inbound` - Twilio inbound SMS
- `POST /webhooks/twilio/status` - Twilio delivery status

### Dashboard
- `GET /dashboard/stats` - Overview statistics
- `GET /dashboard/activity` - Recent activity
- `GET /dashboard/tasks` - Upcoming tasks
- `GET /dashboard/hot-leads` - Top scored leads

### Auth
- `POST /auth/login` - Login
- `POST /auth/register` - Register
- `GET /auth/me` - Get current user

## 🤖 AI Features

### Message Drafting
When clicking "Draft Message", the system generates 3 variations:
- **Direct**: Straight to the point
- **Friendly**: Warm and conversational
- **Professional**: Polite and formal

User selects/edits before sending (human-in-the-loop).

### Signal Extraction
On each inbound message, AI extracts:
- Timeline (days)
- Asking price
- Property condition
- Distress signals
- Ownership status

These update the lead and trigger auto-rescoring.

### Opt-Out Handling
Keywords like "STOP", "UNSUBSCRIBE" automatically mark leads as DNC.

## 📊 Comps Integration

Comps and ARV come from a fallback chain: RentCast, then ChatARV, then
placeholder. RentCast is the primary source (`GET /avm/value` returns ARV plus
comparables in one call, cached 24h). ATTOM is available as an explicit comp
source and powers Deal Search. Set the keys you use in `.env`:

```bash
RENTCAST_API_KEY="your-api-key"
ATTOM_API_KEY="your-api-key"
CHATARV_API_KEY="your-api-key"   # optional
```

### Placeholder Mode
If no comp provider is configured, the system generates realistic placeholder
comps for demo/development.

## 🔧 Configuration

### Twilio Setup
1. Get account from twilio.com
2. Buy a phone number
3. Set webhook URL: `https://your-domain.com/webhooks/twilio/inbound`
4. Add credentials to `.env`:
```bash
TWILIO_ACCOUNT_SID="ACxxxxx"
TWILIO_AUTH_TOKEN="your-token"
TWILIO_PHONE_NUMBER="+15555551234"
```

### Anthropic Claude Setup
All AI features (message drafts, signal extraction, CAMP scoring, ARV, foreclosure
parsing) run on Claude. Without this key the app falls back to non-AI templates.
```bash
ANTHROPIC_API_KEY="sk-ant-xxxxx"
```

### PropertyLeads Setup
Configure webhook endpoint: `https://your-domain.com/webhooks/propertyleads`

## 🧪 Testing

```bash
# Run API tests
cd apps/api
pnpm test

# Test scoring engine
pnpm test scoring.service

# Test webhook handlers
pnpm test webhooks.controller
```

## 🚢 Deployment

### Environment Variables (Production)
```bash
# Database
DATABASE_URL="postgresql://user:pass@host:5432/db"

# Security
JWT_SECRET="generate-strong-secret"

# APIs
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_PHONE_NUMBER="..."
ANTHROPIC_API_KEY="..."
RENTCAST_API_KEY="..."
MAILGUN_API_KEY="..."

# Frontend URL (for CORS)
FRONTEND_URL="https://your-domain.com"
```

See `apps/api/.env.example` for the full, authoritative list of variables.

### Production Deploy
Deploys are automatic. Merging to `master` triggers a production deploy: Railway
builds and runs the API (plus Postgres and Redis), Vercel builds the web
frontend. Schema changes require a committed Prisma migration file, or Railway's
`prisma migrate deploy` silently no-ops and production drifts. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the branch and PR workflow.

### Docker Build
```bash
# Build API
cd apps/api
docker build -t fast-homes-api .

# Build Web
cd apps/web
docker build -t fast-homes-web .
```

### Database Migrations
```bash
cd apps/api
pnpm prisma migrate deploy
```

## 📱 Mobile Responsiveness
The frontend is fully responsive and works on mobile devices.

## 🔐 Security Notes

- Change `JWT_SECRET` in production
- Use environment variables for all secrets
- Enable rate limiting on webhooks
- Twilio webhook signatures are validated (`TWILIO_VALIDATE_WEBHOOKS=true`)
- Use HTTPS in production

## 📈 Roadmap / TODOs

### Immediate
- [ ] Add Twilio signature validation
- [ ] Implement rate limiting
- [ ] Add user roles/permissions enforcement
- [ ] Create admin panel for scoring rules

### Future
- [ ] Email integration (Gmail, Outlook)
- [ ] Calendar sync
- [ ] Document generation (contracts, LOIs)
- [ ] Advanced reporting/analytics
- [ ] Mobile app (React Native)
- [ ] Multi-team support
- [ ] Custom fields per source

## 🐛 Troubleshooting

### Database connection fails
```bash
# Check containers
docker-compose ps

# Restart
docker-compose down
docker-compose up -d
```

### Prisma client errors
```bash
cd apps/api
pnpm prisma generate
```

### Port conflicts
Change ports in:
- `apps/api/src/main.ts` (API)
- `apps/web/package.json` dev script (Web)
- `docker-compose.yml` (Database)

## 📄 License

MIT

## 🤝 Support

For issues or questions, please open a GitHub issue or contact the development team.

---

Built with ❤️ for property wholesalers
