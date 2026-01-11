#!/bin/bash

clear

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║  🚀  ADVANCED AZTEC FLUSH BOT SETUP - FLASHBOTS EDITION   ║"
echo "║                    BY 0xHAMAD                             ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "This bot uses:"
echo "  ⚡ Real-time epoch tracking from Rollup contract"
echo "  ⚡ Precise timing formula: genesis + (epoch × 2304)"
echo "  ⚡ Flashbots for MEV protection"
echo "  ⚡ WebSocket for 0.001s response time"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists!"
    echo ""
    read -p "Reconfigure? (y/n): " reconfigure
    if [ "$reconfigure" != "y" ] && [ "$reconfigure" != "Y" ]; then
        echo ""
        echo "✅ Keeping existing configuration."
        echo "▶️  Run 'npm start' to start the bot."
        exit 0
    fi
    echo ""
fi

# Step 1: HTTP RPC
echo "📡 Step 1/5: HTTP RPC Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Get FREE RPC from:"
echo "  • Alchemy: https://dashboard.alchemy.com/"
echo "  • Infura: https://infura.io/"
echo ""
echo "Format: https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
echo ""

while true; do
    read -p "Enter HTTP RPC URL: " RPC_URL
    
    if [[ $RPC_URL =~ ^https?:// ]]; then
        echo "✅ HTTP RPC accepted"
        
        # Extract key for WebSocket suggestion
        if [[ $RPC_URL =~ alchemy\.com/v2/([a-zA-Z0-9_-]+) ]]; then
            ALCHEMY_KEY="${BASH_REMATCH[1]}"
        elif [[ $RPC_URL =~ infura\.io.*v3/([a-zA-Z0-9]+) ]]; then
            INFURA_KEY="${BASH_REMATCH[1]}"
        fi
        
        break
    else
        echo "❌ Invalid! Must start with https://"
        echo ""
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 2: WebSocket RPC
echo "🔌 Step 2/5: WebSocket RPC (CRITICAL FOR SPEED!)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚡ WebSocket enables 0.001s epoch detection!"
echo "   Without it: 10-30 second delay ❌"
echo "   With it: Instant response ✅"
echo ""

if [ ! -z "$ALCHEMY_KEY" ]; then
    SUGGESTED_WS="wss://eth-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY"
    echo "📌 Auto-detected Alchemy WebSocket:"
    echo "   $SUGGESTED_WS"
    echo ""
    read -p "Use this? (Y/n): " use_suggested
    
    if [ "$use_suggested" == "n" ] || [ "$use_suggested" == "N" ]; then
        read -p "Enter custom WebSocket URL: " WS_RPC_URL
    else
        WS_RPC_URL=$SUGGESTED_WS
        echo "✅ Using auto-detected WebSocket"
    fi
elif [ ! -z "$INFURA_KEY" ]; then
    SUGGESTED_WS="wss://mainnet.infura.io/ws/v3/$INFURA_KEY"
    echo "📌 Auto-detected Infura WebSocket:"
    echo "   $SUGGESTED_WS"
    echo ""
    read -p "Use this? (Y/n): " use_suggested
    
    if [ "$use_suggested" == "n" ] || [ "$use_suggested" == "N" ]; then
        read -p "Enter custom WebSocket URL: " WS_RPC_URL
    else
        WS_RPC_URL=$SUGGESTED_WS
        echo "✅ Using auto-detected WebSocket"
    fi
else
    echo "Convert your HTTP to WebSocket:"
    echo "  https://... → wss://..."
    echo ""
    read -p "Enter WebSocket URL (or skip): " WS_RPC_URL
fi

if [[ -z "$WS_RPC_URL" ]]; then
    echo "⚠️  WebSocket skipped - slower performance!"
    WS_RPC_URL=""
elif [[ $WS_RPC_URL =~ ^wss?:// ]]; then
    echo "✅ WebSocket enabled - ULTRA-FAST mode! 🚀"
else
    echo "⚠️  Invalid format, skipping WebSocket"
    WS_RPC_URL=""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 3: Private Key
echo "🔑 Step 3/5: Wallet Private Key"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  SECURITY:"
echo "  • Use DEDICATED wallet (not your main wallet!)"
echo "  • Keep only 0.05-0.1 ETH"
echo "  • Never share this key"
echo ""

while true; do
    read -sp "Enter private key (0x...): " PRIVATE_KEY
    echo ""
    
    if [[ $PRIVATE_KEY =~ ^0x[a-fA-F0-9]{64}$ ]]; then
        echo "✅ Valid format"
        break
    else
        echo "❌ Invalid! Must be 66 chars starting with 0x"
        echo ""
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 4: Flashbots
echo "⚡ Step 4/5: Flashbots Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Flashbots benefits:"
echo "  ✅ Precise block targeting"
echo "  ✅ MEV protection"
echo "  ✅ Higher success rate"
echo ""
read -p "Enable Flashbots? (Y/n): " enable_fb

if [ "$enable_fb" == "n" ] || [ "$enable_fb" == "N" ]; then
    ENABLE_FLASHBOTS="false"
    echo "⚠️  Flashbots disabled (using direct transactions)"
else
    ENABLE_FLASHBOTS="true"
    echo "✅ Flashbots enabled!"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 5: Gas Budget
echo "💰 Step 5/5: Gas Budget"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Maximum you're willing to pay per flush (in USD)"
echo ""
read -p "Max gas budget (default: 0.30): " MAX_GAS_USD

if [ -z "$MAX_GAS_USD" ]; then
    MAX_GAS_USD="0.30"
fi

echo "✅ Max gas: \$MAX_GAS_USD per transaction"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create .env
cat > .env << EOF
# ==========================================
# AZTEC FLUSH BOT - ADVANCED CONFIGURATION
# Auto-generated: $(date)
# ==========================================

# RPC Configuration
RPC_URL=$RPC_URL
WS_RPC_URL=$WS_RPC_URL

# Wallet
PRIVATE_KEY=$PRIVATE_KEY

# Flashbots
ENABLE_FLASHBOTS=$ENABLE_FLASHBOTS
FLASHBOTS_RELAY_URL=https://relay.flashbots.net

# Gas Budget
MAX_GAS_USD=$MAX_GAS_USD
MIN_GAS_USD=0.05
ETH_PRICE_USD=3300

# Timing
SEND_TX_BEFORE_EPOCH=25
AGGRESSIVE_MODE=true

# Contract Addresses
FLUSH_REWARDER_ADDRESS=0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65
ROLLUP_ADDRESS=0x603bb2c05D474794ea97805e8De69bCcFb3bCA12

# Network Constants
GENESIS_TIMESTAMP=1704067200
EPOCH_DURATION_SECONDS=2304
SLOT_DURATION_SECONDS=72
EOF

chmod 600 .env
echo "📝 Configuration saved to .env"
echo "🔒 File permissions set (secure)"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ SETUP COMPLETE!"
echo ""
echo "📊 Your Configuration:"
echo "   HTTP RPC: ✅"
if [ -z "$WS_RPC_URL" ]; then
    echo "   WebSocket: ❌ (slower)"
else
    echo "   WebSocket: ✅ (ULTRA-FAST!)"
fi
echo "   Flashbots: ${ENABLE_FLASHBOTS}"
echo "   Max Gas: \$MAX_GAS_USD"
echo ""
echo "Next steps:"
echo "  1. Install Flashbots: npm install @flashbots/ethers-provider-bundle --legacy-peer-deps"
echo "  2. Test config: npm test"
echo "  3. Start bot: npm start"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

read -p "Install Flashbots package now? (y/n): " install_now

if [ "$install_now" == "y" ] || [ "$install_now" == "Y" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    npm install @flashbots/ethers-provider-bundle
    echo ""
fi

read -p "Test configuration now? (y/n): " test_now

if [ "$test_now" == "y" ] || [ "$test_now" == "Y" ]; then
    echo ""
    echo "🔍 Running tests..."
    echo ""
    npm test
fi

echo ""
echo "Happy flushing! 🎉"
echo ""
