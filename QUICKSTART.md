# Fast Homes CRM - Quick Start Guide

## ⚡ 5-Minute Setup

### Prerequisites
- Node.js 18+ installed
- Docker installed and running
- Terminal/command line access

### Step 1: Install pnpm (if needed)
```bash
npm install -g pnpm
```

### Step 2: Install Dependencies
```bash
cd fast-homes-crm
pnpm install
```

### Step 3: Start Database
```bash
docker-compose up -d
```

### Step 4: Setup API
```bash
cd apps/api
cp .env.example .env
pnpm prisma generate
pnpm prisma migrate dev --name init
pnpm prisma db seed
cd ../..
```

### Step 5: Start Development Servers

**Terminal 1 - API:**
```bash
cd apps/api
pnpm dev
```

**Terminal 2 - Frontend:**
```bash
cd apps/web
pnpm dev
```

### Step 6: Access the App

Open http://localhost:3000

**Demo Login:**
- Email: demo@fasthomes.com
- Password: password123

## 🎯 What You Get

**4 Demo Leads** with different scores:
- Strike Zone (12/12) - Urgent foreclosure
- Hot (9/12) - Motivated seller
- Workable (5/12) - Co-ownership
- Cold (3/12) - No urgency

**Sample Data Includes:**
- Messages and conversation history
- Property comps
- Tasks
- Activity logs

## 🔧 Optional: Configure AI Features

Edit `apps/api/.env`:

```bash
# For AI message drafting and signal extraction
OPENAI_API_KEY="sk-your-key-here"

# For real SMS (optional - works without it)
TWILIO_ACCOUNT_SID="ACxxxxx"
TWILIO_AUTH_TOKEN="your-token"
TWILIO_PHONE_NUMBER="+15555551234"

# For real property comps (optional - has placeholder mode)
CHATARV_API_KEY="your-key"
```

Restart API after adding keys.

## 📱 Key Features to Try

1. **Lead Scoring**: View the score breakdown on any lead detail page
2. **AI Drafts**: Click "Draft Message" to generate 3 AI-powered options
3. **Auto-Comps**: Click "Fetch Comps" to get property comparables
4. **Dashboard**: See stats, hot leads, and upcoming tasks
5. **Filters**: Use the leads list filters to find specific leads

## 🐛 Troubleshooting

**"Can't connect to database"**
```bash
docker-compose ps  # Check if containers are running
docker-compose restart
```

**"Port already in use"**
- API (3001): Stop other services on that port
- Web (3000): Stop other Next.js apps
- Postgres (5432): Stop local Postgres if running

**"Prisma errors"**
```bash
cd apps/api
pnpm prisma generate
pnpm prisma migrate reset  # ⚠️ Deletes all data
pnpm prisma db seed
```

## 📚 Next Steps

1. Read `README.md` for full documentation
2. Read `IMPLEMENTATION.md` for technical details
3. Explore the code structure
4. Configure your API keys for full functionality
5. Customize scoring rules in `apps/api/src/scoring/scoring.service.ts`

## 🎉 That's It!

You now have a fully functional property wholesaling CRM with:
- Lead management
- AI-powered texting
- Automatic scoring
- Property comps
- Complete audit trail

Happy wholesaling! 🏠
