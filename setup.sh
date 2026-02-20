#!/bin/bash

# Container Image Compare - Quick Start Script

echo "🚀 Container Image Compare - Setup Script"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Check Node.js installation
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js found: $NODE_VERSION${NC}"
else
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18.x or higher.${NC}"
    echo -e "${YELLOW}  Download from: https://nodejs.org/${NC}"
    exit 1
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓ npm found: v$NPM_VERSION${NC}"
else
    echo -e "${RED}✗ npm not found.${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
echo -e "${GRAY}This may take a few minutes...${NC}"
echo ""

# Install dependencies
if npm run install-all; then
    echo ""
    echo -e "${GREEN}✓ Dependencies installed successfully!${NC}"
    echo ""
else
    echo -e "${RED}✗ Failed to install dependencies${NC}"
    exit 1
fi

# Check for .env file
echo -e "${YELLOW}⚙️  Checking configuration...${NC}"
ENV_PATH="backend/.env"
if [ ! -f "$ENV_PATH" ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating default configuration...${NC}"
    
    # Generate random 32-character key
    RANDOM_KEY=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
    
    cat > "$ENV_PATH" << EOF
# Server Configuration
PORT=5000
NODE_ENV=development

# Cache Configuration
CACHE_DIR=./cache
MAX_CACHE_SIZE_GB=10

# Data Storage
DATA_DIR=./data
MAX_HISTORY_ITEMS=50

# Security - AUTO-GENERATED
CREDENTIALS_ENCRYPTION_KEY=$RANDOM_KEY
EOF
    
    echo -e "${GREEN}✓ Created .env file with auto-generated encryption key${NC}"
else
    echo -e "${GREEN}✓ Configuration file exists${NC}"
fi

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""

echo -e "${CYAN}🎯 Next steps:${NC}"
echo -e "  1. Start development server: ${YELLOW}npm run dev${NC}"
echo -e "  2. Open browser: ${YELLOW}http://localhost:3000${NC}"
echo -e "  3. Try comparing: ${YELLOW}nginx:1.25.0 vs nginx:1.26.0${NC}"
echo ""

echo -e "${GRAY}📚 For more information, see README.md${NC}"
echo ""

read -p "Would you like to start the development server now? (Y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    echo ""
    echo -e "${CYAN}🚀 Starting development server...${NC}"
    echo ""
    npm run dev
fi
