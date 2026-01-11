#!/bin/bash

# Aztec Flush Rewarder Bot - Interactive Setup Script
# ====================================================

clear

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║    🚀  ULTRA-AGGRESSIVE AZTEC FLUSH BOT SETUP  🚀         ║"
echo "║                       BY HAMAD                             ║"
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

# Get RPC URL
echo "📡 Step 1/2: Ethereum RPC Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You need an Ethereum RPC endpoint from:"
echo "  • Alchemy (Recommended): https://www.alchemy.com/"
echo "  • Infura: https://www.infura.io/"
echo "  • QuickNode: https://www.quicknode.com/"
echo ""
echo "Format: https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
echo ""

while true; do
    read -p "Enter your RPC URL: " RPC_URL
    
    # Validate RPC URL format
    if [[ $RPC_URL =~ ^https?:// ]]; then
        echo "✅ RPC URL accepted"
        break
    else
        echo "❌ Invalid format! URL must start with http:// or https://"
        echo ""
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get Private Key
echo "🔑 Step 2/2: Wallet Configuration"
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
# Aztec Flush Rewarder Bot Configuration
# Auto-generated on $(date)

# Ethereum RPC URL
RPC_URL=$RPC_URL

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
echo "Next steps:"
echo "  1. Test configuration:  npm test"
echo "  2. Start the bot:       npm start"
echo ""
echo "💡 Tips:"
echo "  • Monitor bot logs regularly"
echo "  • Keep at least 0.001 ETH in wallet for gas"
echo "  • Press Ctrl+C to stop the bot anytime"
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
