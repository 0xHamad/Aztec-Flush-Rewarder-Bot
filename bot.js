// Aztec Flush Bot - PERFECT WORKING VERSION
// ===========================================
// Real-time blockchain tracking, proper epoch sync
require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
    FLUSH_CONTRACT: '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65',
    ROLLUP_CONTRACT: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12',
    
    SLOT_DURATION: 72,        // seconds per slot
    SLOTS_PER_EPOCH: 32,      // slots per epoch  
    EPOCH_DURATION: 2304,     // 72 * 32 = 2304 seconds (38.4 minutes)
    
    CHECK_INTERVAL: 3000,     // Check every 3 seconds
    FLUSH_AT_PROGRESS: 0.98,  // Flush at 98% of epoch
    
    MIN_ETH_BALANCE: ethers.parseEther('0.001'),
    MIN_CLAIM_AMOUNT: ethers.parseEther('100'),
    GAS_LIMIT: 250000,
};

const FLUSH_ABI = [
    'function flushEntryQueue() external',
    'function claimRewards() external', 
    'function rewardsOf(address) external view returns (uint256)',
    'function rewardsAvailable() external view returns (uint256)',
];

const ROLLUP_ABI = [
    'function getCurrentEpoch() external view returns (uint256)',
    'function getEpochAtTime(uint256) external view returns (uint256)',
];

class AztecFlushBot {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.flushContract = null;
        this.rollupContract = null;
        
        // Tracking
        this.genesisTime = null;
        this.currentTrackedEpoch = null;
        this.lastFlushedEpoch = -1;
        this.isProcessing = false;
        
        // Stats
        this.stats = {
            flushSuccess: 0,
            flushFailed: 0,
            totalClaimed: ethers.parseEther('0'),
            totalGasSpent: ethers.parseEther('0'),
        };
    }

    // Initialize bot
    async initialize() {
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║  🤖 AZTEC FLUSH BOT - PERFECT VERSION  ║');
        console.log('╚════════════════════════════════════════╝\n');
        
        // Validate environment
        if (!process.env.RPC_URL) throw new Error('❌ RPC_URL missing in .env');
        if (!process.env.PRIVATE_KEY) throw new Error('❌ PRIVATE_KEY missing in .env');
        
        console.log('📡 Connecting to Ethereum...');
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        
        console.log('📝 Loading contracts...');
        this.flushContract = new ethers.Contract(
            CONFIG.FLUSH_CONTRACT,
            FLUSH_ABI,
            this.wallet
        );
        
        this.rollupContract = new ethers.Contract(
            CONFIG.ROLLUP_CONTRACT,
            ROLLUP_ABI,
            this.provider
        );
        
        console.log('⏰ Calculating genesis time from blockchain...\n');
        await this.findGenesisTime();
        
        await this.displayStatus();
        
        console.log('\n' + '═'.repeat(70));
    }

    // Find accurate genesis time by syncing with contract
    async findGenesisTime() {
        // Get current blockchain state
        const block = await this.provider.getBlock('latest');
        const currentTime = block.timestamp;
        const contractEpoch = await this.rollupContract.getCurrentEpoch();
        
        console.log(`   Blockchain time: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);
        console.log(`   Contract epoch: ${contractEpoch.toString()}`);
        
        // Calculate approximate genesis
        const epochNum = Number(contractEpoch);
        const epochDuration = CONFIG.EPOCH_DURATION;
        
        // Start with rough estimate
        let bestGenesis = currentTime - (epochNum * epochDuration);
        let bestError = Infinity;
        
        // Fine-tune by testing different genesis times
        // We want: (currentTime - genesis) / epochDuration = contractEpoch
        for (let offset = -epochDuration; offset <= epochDuration; offset += 12) {
            const testGenesis = currentTime - (epochNum * epochDuration) + offset;
            const calculatedEpoch = Math.floor((currentTime - testGenesis) / epochDuration);
            const error = Math.abs(calculatedEpoch - epochNum);
            
            if (error < bestError) {
                bestError = error;
                bestGenesis = testGenesis;
            }
            
            if (error === 0) {
                // Found exact match
                this.genesisTime = testGenesis;
                
                // Calculate current epoch details
                const epochStart = testGenesis + (epochNum * epochDuration);
                const timeIntoEpoch = currentTime - epochStart;
                const progress = (timeIntoEpoch / epochDuration) * 100;
                
                console.log(`   ✅ Genesis time found: ${testGenesis}`);
                console.log(`   Current epoch ${epochNum} started at: ${epochStart}`);
                console.log(`   Time into epoch: ${Math.floor(timeIntoEpoch / 60)}m ${timeIntoEpoch % 60}s`);
                console.log(`   Current progress: ${progress.toFixed(1)}%`);
                
                this.currentTrackedEpoch = epochNum;
                return;
            }
        }
        
        // If no exact match, use best approximation
        this.genesisTime = bestGenesis;
        console.log(`   ⚠️  Using approximate genesis: ${bestGenesis}`);
        this.currentTrackedEpoch = epochNum;
    }

    // Get current epoch info from blockchain time
    getEpochInfo(blockTimestamp) {
        const currentTime = blockTimestamp;
        const epochDuration = CONFIG.EPOCH_DURATION;
        
        // Calculate epoch number
        const epochNumber = Math.floor((currentTime - this.genesisTime) / epochDuration);
        
        // Calculate epoch boundaries
        const epochStart = this.genesisTime + (epochNumber * epochDuration);
        const epochEnd = epochStart + epochDuration;
        
        // Calculate progress
        const timeIntoEpoch = currentTime - epochStart;
        const timeRemaining = epochEnd - currentTime;
        const progress = timeIntoEpoch / epochDuration;
        
        return {
            epoch: epochNumber,
            startTime: epochStart,
            endTime: epochEnd,
            currentTime: currentTime,
            timeIntoEpoch: timeIntoEpoch,
            timeRemaining: timeRemaining,
            progress: progress,
        };
    }

    // Display bot status
    async displayStatus() {
        const balance = await this.provider.getBalance(this.wallet.address);
        const pendingRewards = await this.flushContract.rewardsOf(this.wallet.address);
        const poolRewards = await this.flushContract.rewardsAvailable();
        
        console.log('📊 Bot Status:');
        console.log(`   Wallet: ${this.wallet.address}`);
        console.log(`   ETH Balance: ${ethers.formatEther(balance)} ETH`);
        
        if (balance < CONFIG.MIN_ETH_BALANCE) {
            console.log(`   ⚠️  WARNING: Low balance! Need at least 0.001 ETH`);
            console.log(`   ⚠️  Current: ${ethers.formatEther(balance)} ETH`);
            console.log(`   ⚠️  Bot will NOT flush without sufficient ETH!`);
        } else {
            console.log(`   ✅ Balance sufficient for operations`);
        }
        
        console.log(`   Pending Rewards: ${ethers.formatEther(pendingRewards)} AZTEC`);
        console.log(`   Pool Available: ${ethers.formatEther(poolRewards)} AZTEC`);
        
        console.log('\n⚙️  Bot Settings:');
        console.log(`   Genesis Time: ${this.genesisTime}`);
        console.log(`   Epoch Duration: ${CONFIG.EPOCH_DURATION}s (${CONFIG.EPOCH_DURATION / 60} minutes)`);
        console.log(`   Flush Trigger: ${CONFIG.FLUSH_AT_PROGRESS * 100}% epoch progress`);
        console.log(`   Check Interval: ${CONFIG.CHECK_INTERVAL / 1000}s`);
    }

    // Try to flush the entry queue
    async attemptFlush(epochInfo) {
        if (this.isProcessing) return false;
        if (this.lastFlushedEpoch === epochInfo.epoch) return false;
        
        this.isProcessing = true;
        
        try {
            console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`🚀 FLUSHING EPOCH ${epochInfo.epoch}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            
            // Check balance
            const balance = await this.provider.getBalance(this.wallet.address);
            if (balance < CONFIG.MIN_ETH_BALANCE) {
                console.log(`❌ Insufficient ETH!`);
                console.log(`   Current: ${ethers.formatEther(balance)} ETH`);
                console.log(`   Minimum: 0.001 ETH`);
                console.log(`   Add ETH to: ${this.wallet.address}\n`);
                this.isProcessing = false;
                return false;
            }
            
            // Get gas settings
            const feeData = await this.provider.getFeeData();
            const gasPrice = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
            
            console.log(`📊 Transaction Details:`);
            console.log(`   Gas Price: ${gasPrice.toFixed(2)} Gwei`);
            console.log(`   Estimated Cost: ${ethers.formatEther(BigInt(CONFIG.GAS_LIMIT) * feeData.gasPrice)} ETH`);
            
            // Send transaction
            console.log(`\n📤 Sending flush transaction...`);
            const tx = await this.flushContract.flushEntryQueue({
                gasLimit: CONFIG.GAS_LIMIT,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei'),
            });
            
            console.log(`   TX Hash: ${tx.hash}`);
            console.log(`   ⏳ Waiting for confirmation...`);
            
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                const gasUsed = receipt.gasUsed * receipt.gasPrice;
                this.stats.totalGasSpent += gasUsed;
                this.stats.flushSuccess++;
                this.lastFlushedEpoch = epochInfo.epoch;
                
                console.log(`\n✅ FLUSH SUCCESSFUL!`);
                console.log(`   Block: ${receipt.blockNumber}`);
                console.log(`   Gas Used: ${ethers.formatEther(gasUsed)} ETH`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
                
                // Try to claim rewards
                await this.tryClaimRewards();
                
                this.isProcessing = false;
                return true;
            } else {
                this.stats.flushFailed++;
                console.log(`\n❌ Transaction failed`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
                this.isProcessing = false;
                return false;
            }
            
        } catch (error) {
            this.stats.flushFailed++;
            
            if (error.message.includes('execution reverted')) {
                console.log(`\nℹ️  Queue already flushed for epoch ${epochInfo.epoch}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
                this.lastFlushedEpoch = epochInfo.epoch;
            } else if (error.message.includes('insufficient funds')) {
                console.log(`\n❌ INSUFFICIENT FUNDS FOR GAS!`);
                console.log(`   Add more ETH to wallet: ${this.wallet.address}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            } else {
                console.log(`\n❌ Error: ${error.message}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            }
            
            this.isProcessing = false;
            return false;
        }
    }

    // Try to claim accumulated rewards
    async tryClaimRewards() {
        try {
            const pending = await this.flushContract.rewardsOf(this.wallet.address);
            
            if (pending >= CONFIG.MIN_CLAIM_AMOUNT) {
                console.log(`💰 Claiming ${ethers.formatEther(pending)} AZTEC...`);
                
                const tx = await this.flushContract.claimRewards({ gasLimit: 100000 });
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                    this.stats.totalClaimed += pending;
                    console.log(`   ✅ Claimed! TX: ${tx.hash}\n`);
                } else {
                    console.log(`   ❌ Claim failed\n`);
                }
            }
        } catch (error) {
            console.log(`   ⚠️  Claim error: ${error.message}\n`);
        }
    }

    // Progress bar visualization
    makeProgressBar(progress, length = 30) {
        const filled = Math.floor(progress * length);
        const empty = length - filled;
        return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
    }

    // Main monitoring loop
    async run() {
        console.log('\n🤖 BOT IS NOW MONITORING BLOCKCHAIN...\n');
        console.log('Press Ctrl+C to stop\n');
        console.log('═'.repeat(70) + '\n');
        
        while (true) {
            try {
                // Get latest block
                const block = await this.provider.getBlock('latest');
                const epochInfo = this.getEpochInfo(block.timestamp);
                
                // Detect epoch change
                if (epochInfo.epoch !== this.currentTrackedEpoch) {
                    const oldEpoch = this.currentTrackedEpoch;
                    this.currentTrackedEpoch = epochInfo.epoch;
                    
                    console.log(`\n🔔 EPOCH CHANGED: ${oldEpoch} → ${epochInfo.epoch}`);
                    console.log(`   Time: ${new Date(block.timestamp * 1000).toISOString()}\n`);
                }
                
                // Calculate time display
                const mins = Math.floor(epochInfo.timeRemaining / 60);
                const secs = Math.floor(epochInfo.timeRemaining % 60);
                const progressPercent = (epochInfo.progress * 100).toFixed(1);
                const progressBar = this.makeProgressBar(epochInfo.progress);
                
                // Display status
                const timestamp = new Date().toLocaleTimeString();
                process.stdout.write(`\r[${timestamp}] Epoch ${epochInfo.epoch} [${progressBar}] ${progressPercent}% | ${mins}m ${secs}s | ✅${this.stats.flushSuccess} ❌${this.stats.flushFailed}   `);
                
                // Check if we should flush
                if (epochInfo.progress >= CONFIG.FLUSH_AT_PROGRESS && 
                    this.lastFlushedEpoch !== epochInfo.epoch &&
                    !this.isProcessing) {
                    
                    await this.attemptFlush(epochInfo);
                }
                
                // Sleep before next check
                await new Promise(resolve => setTimeout(resolve, CONFIG.CHECK_INTERVAL));
                
            } catch (error) {
                console.error(`\n\n❌ Error in main loop: ${error.message}`);
                console.log('Retrying in 5 seconds...\n');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

// ==================== MAIN ====================
async function main() {
    const bot = new AztecFlushBot();
    
    try {
        await bot.initialize();
        await bot.run();
    } catch (error) {
        console.error('\n💥 Fatal Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⏹️  Bot shutting down...\n');
    console.log('📊 Final Statistics:');
    console.log(`   Successful Flushes: ${bot?.stats?.flushSuccess || 0}`);
    console.log(`   Failed Attempts: ${bot?.stats?.flushFailed || 0}`);
    console.log(`   Total Claimed: ${ethers.formatEther(bot?.stats?.totalClaimed || 0n)} AZTEC`);
    console.log(`   Total Gas Spent: ${ethers.formatEther(bot?.stats?.totalGasSpent || 0n)} ETH\n`);
    console.log('👋 Goodbye!\n');
    process.exit(0);
});

// Start bot
if (require.main === module) {
    main();
}

module.exports = AztecFlushBot;
