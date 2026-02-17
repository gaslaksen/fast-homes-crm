#!/bin/bash

# Fast Homes CRM - Setup Script
# This script automates the initial setup process

set -e

echo "🏠 Fast Homes CRM - Setup"
echo "=========================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "⚠️  pnpm is not installed. Installing..."
    npm install -g pnpm
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install
echo "✅ Dependencies installed"
echo ""

# Start database
echo "🐘 Starting PostgreSQL and Redis..."
docker-compose up -d
echo "⏳ Waiting for database to be ready..."
sleep 5
echo "✅ Database started"
echo ""

# Setup API environment
echo "⚙️  Setting up API environment..."
if [ ! -f apps/api/.env ]; then
    cp apps/api/.env.example apps/api/.env
    echo "✅ Created apps/api/.env from example"
    echo "⚠️  Please edit apps/api/.env and add your API keys"
else
    echo "⚠️  apps/api/.env already exists, skipping"
fi
echo ""

# Generate Prisma client and run migrations
echo "🗄️  Setting up database schema..."
cd apps/api
pnpm prisma generate
pnpm prisma migrate dev --name init
echo "✅ Database schema created"
echo ""

# Seed database
echo "🌱 Seeding demo data..."
pnpm prisma db seed
echo "✅ Demo data loaded"
echo ""

cd ../..

echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "==========="
echo ""
echo "1. Edit apps/api/.env with your API keys:"
echo "   - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (optional)"
echo "   - OPENAI_API_KEY (optional for AI features)"
echo "   - CHATARV_API_KEY (optional for real comps)"
echo ""
echo "2. Start the development servers:"
echo "   Terminal 1: cd apps/api && pnpm dev"
echo "   Terminal 2: cd apps/web && pnpm dev"
echo ""
echo "3. Open http://localhost:3000 and login with:"
echo "   Email: demo@fasthomes.com"
echo "   Password: password123"
echo ""
echo "For more information, see README.md"
