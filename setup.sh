#!/bin/bash

# Aztec Flush Rewarder Bot - Interactive Setup Script
# ====================================================

clear

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║    🚀  ULTRA-AGGRESSIVE AZTEC FLUSH BOT SETUP  🚀         ║"
echo "║                         BY HAMAD                           ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Welcome! This script will help you configure the bot."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env already exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists!"
    echo ""
    read -p "Do you want to reconfigure? (y/n): " reconfigure
    if [ "$reconfigure" != "y" ] && [ "$reconfigure" != "Y" ]; then
        echo ""
        echo "✅ Keeping existing configuration."
        echo ""
        echo "Run 'npm start' to start the bot."
        exit 0
    fi
    echo ""
fi

# Get HTTP RPC URL
echo "📡 Step 1/3: HTTP RPC Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Get FREE API key from Alchemy:"
echo "  1. Visit: https://dashboard.alchemy.com/"
echo "  2. Create account (free)"
echo "  3. Create New App → Ethereum → Mainnet"
echo "  4. Copy API Key"
echo ""
echo "Format: https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
echo ""

while true; do
    read -p "Enter your HTTP RPC URL: " RPC_URL
    
    if [[ $RPC_URL =~ ^https?:// ]]; then
        echo "✅ HTTP RPC URL accepted"
        
        # Extract API key for auto-generating WebSocket URL
        if [[ $RPC_URL =~ alchemy\.com/v2/([a-zA-Z0-9_-]+) ]]; then
            ALCHEMY_KEY="${BASH_REMATCH[1]}"
        elif [[ $RPC_URL =~ infura\.io.*v3/([a-zA-Z0-9]+) ]]; then
            INFURA_KEY="${BASH_REMATCH[1]}"
        fi
        
        break
    else
        echo "❌ Invalid format! URL must start with https://"
        echo ""
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get WebSocket RPC URL
echo "🔌 Step 2/3: WebSocket RPC (ULTRA-FAST MODE)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚡ WebSocket enables REAL-TIME epoch detection!"
echo "   Without it: 10-15 second delay"
echo "   With it: 0.001 second response time"
echo ""

# Auto-suggest WebSocket URL if we detected the provider
if [ ! -z "$ALCHEMY_KEY" ]; then
    SUGGESTED_WS="wss://eth-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY"
    echo "📌 Detected Alchemy! Suggested WebSocket URL:"
    echo "   $SUGGESTED_WS"
    echo ""
    read -p "Use this WebSocket URL? (Y/n): " use_suggested
    
    if [ "$use_suggested" == "n" ] || [ "$use_suggested" == "N" ]; then
        read -p "Enter custom WebSocket URL (or press Enter to skip): " WS_RPC_URL
    else
        WS_RPC_URL=$SUGGESTED_WS
        echo "✅ Using suggested WebSocket URL"
    fi
elif [ ! -z "$INFURA_KEY" ]; then
    SUGGESTED_WS="wss://mainnet.infura.io/ws/v3/$INFURA_KEY"
    echo "📌 Detected Infura! Suggested WebSocket URL:"
    echo "   $SUGGESTED_WS"
    echo ""
    read -p "Use this WebSocket URL? (Y/n): " use_suggested
    
    if [ "$use_suggested" == "n" ] || [ "$use_suggested" == "N" ]; then
        read -p "Enter custom WebSocket URL (or press Enter to skip): " WS_RPC_URL
    else
        WS_RPC_URL=$SUGGESTED_WS
        echo "✅ Using suggested WebSocket URL"
    fi
else
    echo "💡 Convert your HTTP URL to WebSocket:"
    echo ""
    echo "Alchemy format:"
    echo "  https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
    echo "  becomes:"
    echo "  wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
    echo ""
    echo "Infura format:"
    echo "  https://mainnet.infura.io/v3/YOUR_KEY"
    echo "  becomes:"
    echo "  wss://mainnet.infura.io/ws/v3/YOUR_KEY"
    echo ""
    read -p "Enter WebSocket URL (or press Enter to skip): " WS_RPC_URL
fi

# Validate WebSocket URL
if [[ -z "$WS_RPC_URL" ]]; then
    echo "⚠️  WebSocket skipped - bot will use HTTP polling"
    echo "💡 Performance will be slower without WebSocket"
    WS_RPC_URL=""
elif [[ $WS_RPC_URL =~ ^wss?:// ]]; then
    echo "✅ WebSocket URL accepted - ULTRA-FAST MODE ENABLED! 🚀"
else
    echo "⚠️  Invalid WebSocket format (must start with wss://)"
    echo "⚠️  Skipping WebSocket, using HTTP only"
    WS_RPC_URL=""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get Private Key
echo "🔑 Step 3/3: Wallet Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "  • Use a DEDICATED wallet for this bot"
echo "  • Keep only 0.05-0.1 ETH in this wallet"
echo "  • NEVER share your private key with anyone"
echo "  • This key will be stored locally in .env file"
echo ""
echo "Your private key should:"
echo "  • Start with 0x"
echo "  • Be 66 characters long (including 0x)"
echo ""

while true; do
    read -sp "Enter your wallet private key: " PRIVATE_KEY
    echo ""
    
    # Validate private key format
    if [[ $PRIVATE_KEY =~ ^0x[a-fA-F0-9]{64}$ ]]; then
        echo "✅ Private key format valid"
        break
    else
        echo "❌ Invalid format! Must be 66 characters starting with 0x"
        echo ""
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create .env file
cat > .env << EOF
# Aztec Ultra-Aggressive Flush Bot Configuration
# Auto-generated on $(date)

# Ethereum HTTP RPC URL
RPC_URL=$RPC_URL

# WebSocket RPC URL (for real-time monitoring)
WS_RPC_URL=$WS_RPC_URL

# Wallet Private Key
PRIVATE_KEY=$PRIVATE_KEY
EOF

echo "📝 Configuration saved to .env file"
echo ""

# Set proper permissions
chmod 600 .env
echo "🔒 File permissions set (only you can read)"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Setup Complete!"
echo ""

# Show configuration summary
echo "📊 Your Configuration:"
echo "   HTTP RPC: ✅ Configured"
if [ -z "$WS_RPC_URL" ]; then
    echo "   WebSocket: ⚠️  Not configured (slower performance)"
else
    echo "   WebSocket: ✅ Configured (ULTRA-FAST mode enabled!)"
fi
echo "   Wallet: ✅ Configured"
echo ""

echo "Next steps:"
echo "  1. Test configuration:  npm test"
echo "  2. Start the bot:       npm start"
echo ""
echo "💡 Tips:"
echo "  • Monitor bot logs regularly"
echo "  • Keep at least 0.01 ETH in wallet for gas"
echo "  • Press Ctrl+C to stop the bot anytime"
if [ -z "$WS_RPC_URL" ]; then
    echo "  • Consider adding WebSocket URL for 100x faster performance!"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Ask if user wants to test now
read -p "Would you like to test the configuration now? (y/n): " test_now

if [ "$test_now" == "y" ] || [ "$test_now" == "Y" ]; then
    echo ""
    echo "🔍 Running configuration test..."
    echo ""
    npm test
fi

echo ""
echo "Happy flushing! 🎉"
echo ""
