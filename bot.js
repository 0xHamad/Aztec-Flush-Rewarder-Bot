// Aztec Flush Rewarder Bot - Professional Edition
// ================================================
require('dotenv').config();
const { ethers } = require('ethers');

// ==================== CONFIGURATION ====================
const CONFIG = {
    // Contract Addresses (Ethereum Mainnet)
    FLUSH_REWARDER: '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65',
    ROLLUP: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12',
    
    // Epoch Configuration
    EPOCH_DURATION: 38.4 * 60, // 38.4 minutes in seconds
    FAST_MODE_THRESHOLD: 0.95, // Start fast mode at 95% epoch completion
    
    // Interval Settings (in milliseconds)
    NORMAL_CHECK_INTERVAL: 15 * 1000, // 15 seconds
    FAST_CHECK_INTERVAL: 200, // 0.2 seconds
    
    // Gas Settings
    MAX_GAS_PRICE_GWEI: 12, // ~0.3 USDT for flush tx
    MIN_GAS_PRICE_GWEI: 4,  // ~0.1 USDT for flush tx
    GAS_LIMIT_FLUSH: 200000,
    GAS_LIMIT_CLAIM: 100000,
    
    // Reward Settings
    MIN_CLAIM_AMOUNT: ethers.parseEther('100'), // Claim when >= 100 AZTEC
    
    // Retry Settings
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000
};

// ==================== CONTRACT ABIs ====================
const FLUSH_REWARDER_ABI = [
    'function flushEntryQueue() external returns (uint256)',
    'function claimRewards() external',
    'function rewardsOf(address account) external view returns (uint256)',
    'function rewardsAvailable() external view returns (uint256)',
    'function rewardPerInsertion() external view returns (uint256)',
    'function ROLLUP() external view returns (address)'
];

const ROLLUP_ABI = [
    'function getCurrentEpoch() external view returns (uint256)',
    'function getEpochForBlock(uint256 blockNumber) external view returns (uint256)',
    'function getTimestampForSlot(uint256 slot) external view returns (uint256)',
    'function getCurrentSlot() external view returns (uint256)',
    'function EPOCH_DURATION() external view returns (uint256)',
    'function AZTEC_EPOCH_DURATION() external view returns (uint256)',
    'function AZTEC_SLOT_DURATION() external view returns (uint256)'
];

// ==================== BOT CLASS ====================
class AztecFlushBot {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.flushContract = null;
        this.rollupContract = null;
        this.currentInterval = CONFIG.NORMAL_CHECK_INTERVAL;
        this.stats = {
            totalFlushes: 0,
            successfulFlushes: 0,
            failedFlushes: 0,
            totalClaimed: ethers.parseEther('0'),
            totalGasSpent: ethers.parseEther('0'),
            startTime: Date.now()
        };
    }

    // Initialize Bot
    async initialize() {
        console.log('🚀 Aztec Flush Rewarder Bot Starting...\n');
        
        // Validate environment variables
        if (!process.env.RPC_URL) throw new Error('❌ RPC_URL not found in .env');
        if (!process.env.PRIVATE_KEY) throw new Error('❌ PRIVATE_KEY not found in .env');
        
        // Setup provider and wallet
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        
        // Setup contracts
        this.flushContract = new ethers.Contract(
            CONFIG.FLUSH_REWARDER,
            FLUSH_REWARDER_ABI,
            this.wallet
        );
        
        this.rollupContract = new ethers.Contract(
            CONFIG.ROLLUP,
            ROLLUP_ABI,
            this.provider
        );
        
        // Display initial info
        await this.displayBotInfo();
        
        console.log('✅ Bot initialized successfully!\n');
        console.log('━'.repeat(60));
    }

    // Display Bot Information
    async displayBotInfo() {
        const balance = await this.provider.getBalance(this.wallet.address);
        const pendingRewards = await this.flushContract.rewardsOf(this.wallet.address);
        const availableRewards = await this.flushContract.rewardsAvailable();
        const rewardRate = await this.flushContract.rewardPerInsertion();
        
        console.log('📊 Bot Configuration:');
        console.log(`   Wallet: ${this.wallet.address}`);
        console.log(`   ETH Balance: ${ethers.formatEther(balance)} ETH`);
        console.log(`   Pending Rewards: ${ethers.formatEther(pendingRewards)} AZTEC`);
        console.log(`   Pool Rewards: ${ethers.formatEther(availableRewards)} AZTEC`);
        console.log(`   Reward Rate: ${ethers.formatEther(rewardRate)} AZTEC per insertion\n`);
        
        console.log('⚙️  Settings:');
        console.log(`   Normal Interval: ${CONFIG.NORMAL_CHECK_INTERVAL / 1000}s`);
        console.log(`   Fast Interval: ${CONFIG.FAST_CHECK_INTERVAL / 1000}s`);
        console.log(`   Fast Mode Trigger: ${CONFIG.FAST_MODE_THRESHOLD * 100}% epoch`);
        console.log(`   Gas Range: ${CONFIG.MIN_GAS_PRICE_GWEI}-${CONFIG.MAX_GAS_PRICE_GWEI} Gwei`);
    }

    // Get Current Epoch Info
    async getEpochInfo() {
        try {
            const currentSlot = await this.rollupContract.getCurrentSlot();
            const blockNumber = await this.provider.getBlockNumber();
            const block = await this.provider.getBlock(blockNumber);
            const currentTime = block.timestamp;
            
            // Calculate epoch (38.4 minutes = 2304 seconds)
            const epochDuration = CONFIG.EPOCH_DURATION;
            const currentEpoch = Math.floor(currentTime / epochDuration);
            const epochStartTime = currentEpoch * epochDuration;
            const epochEndTime = epochStartTime + epochDuration;
            const timeIntoEpoch = currentTime - epochStartTime;
            const epochProgress = timeIntoEpoch / epochDuration;
            const timeRemaining = epochEndTime - currentTime;
            
            return {
                currentEpoch,
                epochStartTime,
                epochEndTime,
                currentTime,
                timeIntoEpoch,
                epochProgress,
                timeRemaining,
                currentSlot: currentSlot.toString()
            };
        } catch (error) {
            console.error('❌ Error getting epoch info:', error.message);
            return null;
        }
    }

    // Check and adjust monitoring speed
    async adjustMonitoringSpeed(epochInfo) {
        const inFastMode = epochInfo.epochProgress >= CONFIG.FAST_MODE_THRESHOLD;
        const newInterval = inFastMode ? CONFIG.FAST_CHECK_INTERVAL : CONFIG.NORMAL_CHECK_INTERVAL;
        
        if (this.currentInterval !== newInterval) {
            this.currentInterval = newInterval;
            const mode = inFastMode ? '🔥 FAST MODE' : '⏰ NORMAL MODE';
            console.log(`\n${mode} ACTIVATED (${newInterval}ms interval)`);
        }
        
        return inFastMode;
    }

    // Check if gas price is acceptable
    async isGasPriceAcceptable() {
        const feeData = await this.provider.getFeeData();
        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
        
        if (gasPriceGwei > CONFIG.MAX_GAS_PRICE_GWEI) {
            console.log(`⚠️  Gas too high: ${gasPriceGwei.toFixed(2)} Gwei (max: ${CONFIG.MAX_GAS_PRICE_GWEI})`);
            return false;
        }
        
        return true;
    }

    // Execute flush transaction
    async executeFlush() {
        try {
            // Check gas price
            if (!await this.isGasPriceAcceptable()) {
                return { success: false, reason: 'gas_too_high' };
            }
            
            const feeData = await this.provider.getFeeData();
            
            console.log('\n🔄 Sending flush transaction...');
            
            const tx = await this.flushContract.flushEntryQueue({
                gasLimit: CONFIG.GAS_LIMIT_FLUSH,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
            });
            
            console.log(`   TX Hash: ${tx.hash}`);
            console.log('   ⏳ Waiting for confirmation...');
            
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                const gasUsed = receipt.gasUsed * receipt.gasPrice;
                this.stats.totalGasSpent += gasUsed;
                this.stats.successfulFlushes++;
                
                console.log(`   ✅ Flush successful!`);
                console.log(`   Gas used: ${ethers.formatEther(gasUsed)} ETH`);
                console.log(`   Block: ${receipt.blockNumber}`);
                
                // Check if we should claim
                await this.checkAndClaim();
                
                return { success: true, gasUsed };
            } else {
                this.stats.failedFlushes++;
                console.log('   ❌ Transaction failed');
                return { success: false, reason: 'tx_failed' };
            }
        } catch (error) {
            this.stats.failedFlushes++;
            
            if (error.message.includes('execution reverted')) {
                console.log('   ℹ️  No validators to flush (queue empty or already flushed this epoch)');
                return { success: false, reason: 'queue_empty' };
            }
            
            console.error('   ❌ Flush error:', error.message);
            return { success: false, reason: 'error', error: error.message };
        }
    }

    // Check pending rewards and claim if threshold met
    async checkAndClaim() {
        try {
            const pendingRewards = await this.flushContract.rewardsOf(this.wallet.address);
            
            if (pendingRewards >= CONFIG.MIN_CLAIM_AMOUNT) {
                console.log(`\n💰 Claiming ${ethers.formatEther(pendingRewards)} AZTEC...`);
                
                const tx = await this.flushContract.claimRewards({
                    gasLimit: CONFIG.GAS_LIMIT_CLAIM
                });
                
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                    this.stats.totalClaimed += pendingRewards;
                    console.log(`   ✅ Claimed successfully!`);
                    console.log(`   TX: ${tx.hash}`);
                } else {
                    console.log('   ❌ Claim failed');
                }
            }
        } catch (error) {
            console.error('❌ Claim error:', error.message);
        }
    }

    // Display status
    displayStatus(epochInfo) {
        const progressBar = this.getProgressBar(epochInfo.epochProgress);
        const timeRemainingStr = this.formatTime(epochInfo.timeRemaining);
        
        console.log(`\n[${new Date().toLocaleTimeString()}] Epoch ${epochInfo.currentEpoch}`);
        console.log(`Progress: ${progressBar} ${(epochInfo.epochProgress * 100).toFixed(1)}%`);
        console.log(`Time remaining: ${timeRemainingStr}`);
        console.log(`Stats: ✅ ${this.stats.successfulFlushes} | ❌ ${this.stats.failedFlushes} | 💰 ${ethers.formatEther(this.stats.totalClaimed)} AZTEC`);
    }

    // Progress bar helper
    getProgressBar(progress, length = 20) {
        const filled = Math.floor(progress * length);
        const empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    // Format time helper
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}m ${secs}s`;
    }

    // Main monitoring loop
    async run() {
        console.log('\n🤖 Bot is now running...\n');
        console.log('Press Ctrl+C to stop\n');
        console.log('━'.repeat(60));
        
        let lastFlushAttemptEpoch = -1;
        
        while (true) {
            try {
                const epochInfo = await this.getEpochInfo();
                
                if (!epochInfo) {
                    await this.sleep(5000);
                    continue;
                }
                
                // Adjust monitoring speed based on epoch progress
                const inFastMode = await this.adjustMonitoringSpeed(epochInfo);
                
                // Display status every 30 seconds in normal mode, or when in fast mode
                const shouldDisplayStatus = inFastMode || (Date.now() % 30000 < this.currentInterval);
                if (shouldDisplayStatus) {
                    this.displayStatus(epochInfo);
                }
                
                // Try to flush if we're in fast mode and haven't flushed this epoch yet
                if (inFastMode && lastFlushAttemptEpoch !== epochInfo.currentEpoch) {
                    console.log('\n🎯 Attempting flush at optimal time...');
                    const result = await this.executeFlush();
                    
                    if (result.success || result.reason === 'queue_empty') {
                        lastFlushAttemptEpoch = epochInfo.currentEpoch;
                    }
                }
                
                // Sleep until next check
                await this.sleep(this.currentInterval);
                
            } catch (error) {
                console.error('❌ Main loop error:', error.message);
                await this.sleep(5000);
            }
        }
    }

    // Sleep helper
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== MAIN EXECUTION ====================
async function main() {
    const bot = new AztecFlushBot();
    
    try {
        await bot.initialize();
        await bot.run();
    } catch (error) {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n⏹️  Shutting down bot...');
    console.log('Final stats:');
    console.log(`  Total flushes: ${bot?.stats?.successfulFlushes || 0}`);
    console.log(`  Total claimed: ${ethers.formatEther(bot?.stats?.totalClaimed || 0)} AZTEC`);
    console.log('\n👋 Goodbye!\n');
    process.exit(0);
});

// Start the bot
if (require.main === module) {
    main();
}

module.exports = AztecFlushBot;
