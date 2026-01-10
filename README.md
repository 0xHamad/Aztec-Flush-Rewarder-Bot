# Aztec-Flush-Rewarder-Bot
# 🤖 Aztec Flush Rewarder Bot

Professional bot for earning AZTEC tokens by maintaining the Aztec validator set. Automatically monitors epochs, flushes the entry queue, and claims rewards.

## 📊 Features

- ✅ **Smart Epoch Monitoring** - Tracks blockchain timestamps and epoch progress
- ✅ **Adaptive Speed** - Normal mode (15s) → Fast mode (0.2s) at 95% epoch completion
- ✅ **Gas Optimization** - Only operates within 0.1-0.3 USDT gas range
- ✅ **Auto Claim** - Automatically claims rewards when threshold is met
- ✅ **Single Wallet** - Simple, secure, one-wallet operation
- ✅ **Real-time Stats** - Live progress bars and performance metrics

## 💰 Earnings Potential

- **Current Rate**: 100 AZTEC per validator inserted
- **Max Daily (current)**: ~38 validators = 3,800 AZTEC
- **After governance vote**: ~150 validators = 15,000 AZTEC per day
- **Competition**: Only 2 active participants as of Jan 6, 2025

## 📋 Prerequisites

- Node.js v18 or higher
- Ethereum wallet with ETH for gas (0.01-0.05 ETH recommended)
- Ethereum RPC endpoint (Alchemy/Infura)
- Basic terminal knowledge

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Clone or create project
mkdir aztec-flush-bot
cd aztec-flush-bot

# Copy all files (bot.js, package.json, .env.example) to this directory

# Install packages
npm install
```

### 2. Configure Environment

```bash
# Create .env file
cp .env.example .env

# Edit with your details
nano .env
```

**Required Configuration:**

```env
# Get from Alchemy (free tier works)
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key

# Your wallet private key (starts with 0x)
PRIVATE_KEY=0xYourPrivateKeyHere
```

### 3. Run the Bot

```bash
# Start the bot
npm start

# Or directly
node bot.js
```

## 🔧 Configuration Options

The bot comes pre-configured with optimal settings:

| Setting | Default | Description |
|---------|---------|-------------|
| Normal Interval | 15 seconds | Check frequency during normal operation |
| Fast Interval | 0.2 seconds | Check frequency near epoch end |
| Fast Mode Trigger | 95% | When to switch to fast mode |
| Max Gas Price | 12 Gwei | Maximum gas price (~0.3 USDT) |
| Min Gas Price | 4 Gwei | Minimum acceptable gas (~0.1 USDT) |
| Auto Claim | 100 AZTEC | Minimum balance to trigger claim |

## 📊 Understanding the Output

```
🚀 Aztec Flush Rewarder Bot Starting...

📊 Bot Configuration:
   Wallet: 0xYourAddress...
   ETH Balance: 0.05 ETH
   Pending Rewards: 0 AZTEC
   Pool Rewards: 855,300 AZTEC
   Reward Rate: 100 AZTEC per insertion

⚙️  Settings:
   Normal Interval: 15s
   Fast Interval: 0.2s
   Fast Mode Trigger: 95% epoch
   Gas Range: 4-12 Gwei

✅ Bot initialized successfully!

🤖 Bot is now running...

[10:30:45] Epoch 12345
Progress: ████████████████░░░░ 80.5%
Time remaining: 7m 28s
Stats: ✅ 5 | ❌ 0 | 💰 500 AZTEC

🔥 FAST MODE ACTIVATED (200ms interval)

🎯 Attempting flush at optimal time...

🔄 Sending flush transaction...
   TX Hash: 0xabc123...
   ⏳ Waiting for confirmation...
   ✅ Flush successful!
   Gas used: 0.000234 ETH
   Block: 18765432

💰 Claiming 500 AZTEC...
   ✅ Claimed successfully!
   TX: 0xdef456...
```

## 🎯 How It Works

1. **Monitoring Phase** (Normal Mode)
   - Checks every 15 seconds
   - Tracks epoch progress and remaining time
   - Displays progress bars and stats

2. **Fast Mode Activation** (95% Epoch)
   - Switches to 0.2 second intervals
   - Prepares for optimal flush timing
   - Monitors gas prices continuously

3. **Flush Execution**
   - Validates gas price is acceptable
   - Submits flush transaction
   - Waits for confirmation
   - Updates statistics

4. **Auto Claim**
   - Checks pending rewards after each flush
   - Claims when balance ≥ 100 AZTEC
   - Minimizes transaction costs

## ⚠️ Important Notes

### Gas Management
- Bot will NOT send transactions if gas exceeds 12 Gwei
- Estimated cost per flush: 0.1-0.3 USDT
- Keep 0.01-0.05 ETH in wallet for sustained operation

### Rate Limiting
- Currently: 1 validator per epoch (~38 minutes)
- After governance proposal: 4 validators per epoch
- Bot automatically handles empty queues

### Private Key Security
- Never share your private key
- Don't commit .env to GitHub
- Use a dedicated wallet with limited funds
- Consider using a hardware wallet address as target

## 🔍 Troubleshooting

### "Error: RPC_URL not found"
```bash
# Make sure .env file exists
ls -la .env

# Check if properly formatted
cat .env
```

### "Insufficient funds for gas"
```bash
# Add more ETH to your wallet
# Minimum: 0.01 ETH
# Recommended: 0.05 ETH
```

### "Gas too high"
```bash
# Bot automatically waits for lower gas
# Check current gas: https://etherscan.io/gastracker
# Usually lower at night (UTC)
```

### "No validators to flush"
```bash
# This is normal!
# Means queue is empty or already flushed this epoch
# Bot will keep monitoring for next opportunity
```

## 📈 Monitoring Performance

The bot tracks:
- Total successful flushes
- Failed attempts
- Total AZTEC claimed
- Total gas spent
- Success rate

Press `Ctrl+C` to stop and see final statistics.

## 🔗 Useful Links

- [Aztec Forum Post](https://forum.aztec.network/t/introducing-the-flush-rewarder-incentivizing-validator-set-maintenance/8287)
- [Flush Rewarder Contract](https://etherscan.io/address/0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65)
- [Rollup Contract](https://etherscan.io/address/0x603bb2c05D474794ea97805e8De69bCcFb3bCA12)
- [Gas Tracker](https://etherscan.io/gastracker)

## 📝 Running in Background (Linux)

```bash
# Install PM2 (process manager)
npm install -g pm2

# Start bot with PM2
pm2 start bot.js --name aztec-flush

# View logs
pm2 logs aztec-flush

# Stop bot
pm2 stop aztec-flush

# Restart bot
pm2 restart aztec-flush

# View status
pm2 status
```

## 🛡️ Security Best Practices

1. ✅ Use a dedicated wallet for the bot
2. ✅ Keep limited ETH in the wallet (0.05-0.1 ETH max)
3. ✅ Add .env to .gitignore
4. ✅ Regularly claim and withdraw AZTEC to safe wallet
5. ✅ Monitor bot logs for suspicious activity
6. ✅ Use hardware wallet for long-term AZTEC storage
