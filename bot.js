// Aztec Flush Rewarder Bot - PROFESSIONAL FLASHBOTS EDITION
// ===========================================================
// Formula: next_epoch_start = genesis_time + (next_epoch × epoch_duration_secs)
// Uses Flashbots for guaranteed block inclusion
require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

// ==================== CONFIGURATION ====================
const CONFIG = {
    // Contract Addresses
    FLUSH_REWARDER: '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65',
    ROLLUP: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12',
    
    // Aztec Epoch Constants (from rollup contract)
    SLOT_DURATION: 72,           // seconds per slot
    SLOTS_PER_EPOCH: 32,         // slots per epoch
    EPOCH_DURATION: 72 * 32,     // 2304 seconds (38.4 minutes)
    
    // Flashbots Settings
    FLASHBOTS_RELAY_URLS: [
        'https://relay.flashbots.net',
        'https://builder0x69.io',
        'https://rpc.titanbuilder.xyz',
        'https://rsync-builder.xyz',
    ],
    
    // Timing
    SEND_BEFORE_EPOCH: 25,       // Send 25 seconds before new epoch
    BLOCK_TIME_AVG: 12,          // Average block time (12s)
    
    // Gas Settings (USD based)
    MIN_GAS_USD: 0.20,
    MAX_GAS_USD: 0.30,
    ETH_PRICE_USD: 3300,
    
    GAS_LIMIT_FLUSH: 200000,
    
    // Rewards
    MIN_CLAIM_AMOUNT: ethers.parseEther('100'),
    
    // Monitoring
    CHECK_INTERVAL: 1000,        // Check every 1 second
};

// ==================== ABIs ====================
const FLUSH_ABI = [
    'function flushEntryQueue() external returns (uint256)',
    'function claimRewards() external',
    'function rewardsOf(address) external view returns (uint256)',
    'function rewardsAvailable() external view returns (uint256)',
];

const ROLLUP_ABI = [
    'function getCurrentEpoch() external view returns (uint256)',
    'function getEpochForBlock(uint256) external view returns (uint256)',
    'function GENESIS_TIME() external view returns (uint256)',
    'function EPOCH_DURATION() external view returns (uint256)',
    'function SLOT_DURATION() external view returns (uint256)',
];

// ==================== PROFESSIONAL BOT ====================
class ProfessionalFlashbotsBot {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.flashbotsProvider = null;
        this.flushContract = null;
        this.rollupContract = null;
        
        this.genesisTime = null;
        this.currentEpoch = 0;
        this.lastFlushEpoch = -1;
        this.nextEpochTarget = null;
        
        this.isProcessing = false;
        this.bundleSubmitted = false;
        
        this.stats = {
            bundlesSubmitted: 0,
            bundlesIncluded: 0,
            flushSuccess: 0,
            flushFailed: 0,
            claimed: ethers.parseEther('0'),
            gasSpent: ethers.parseEther('0'),
            startTime: Date.now()
        };
    }

    // Initialize
    async initialize() {
        console.log('🏆 PROFESSIONAL FLASHBOTS FLUSH BOT');
        console.log('━'.repeat(60));
        console.log('⚡ Formula-Based Epoch Prediction');
        console.log('🚀 Flashbots Bundle Submission');
        console.log('🎯 Guaranteed Block Inclusion\n');
        
        if (!process.env.RPC_URL) throw new Error('❌ RPC_URL missing');
        if (!process.env.PRIVATE_KEY) throw new Error('❌ PRIVATE_KEY missing');
        
        // Setup provider
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        
        // Setup Flashbots
        console.log('🔌 Connecting to Flashbots...');
        this.flashbotsProvider = await FlashbotsBundleProvider.create(
            this.provider,
            this.wallet,
            CONFIG.FLASHBOTS_RELAY_URLS[0], // Primary relay
            'mainnet'
        );
        console.log('✅ Flashbots connected\n');
        
        // Setup contracts
        this.flushContract = new ethers.Contract(
            CONFIG.FLUSH_REWARDER,
            FLUSH_ABI,
            this.wallet
        );
        
        this.rollupContract = new ethers.Contract(
            CONFIG.ROLLUP,
            ROLLUP_ABI,
            this.provider
        );
        
        // Get genesis time from rollup contract
        console.log('📡 Reading genesis time from Rollup contract...');
        try {
            this.genesisTime = await this.rollupContract.GENESIS_TIME();
            console.log(`✅ Genesis Time: ${this.genesisTime.toString()}`);
            console.log(`   (${new Date(Number(this.genesisTime) * 1000).toISOString()})\n`);
        } catch (error) {
            console.log('⚠️  Could not read GENESIS_TIME() from contract');
            console.log('   Using alternative method...\n');
            // Fallback: calculate from current epoch
            await this.calculateGenesisTime();
        }
        
        // Display info
        await this.displayInfo();
        
        console.log('━'.repeat(60));
    }

    // Calculate genesis time if direct read fails
    async calculateGenesisTime() {
        const currentEpoch = await this.rollupContract.getCurrentEpoch();
        const block = await this.provider.getBlock('latest');
        const currentTime = block.timestamp;
        
        // genesis_time = current_time - (current_epoch × epoch_duration)
        this.genesisTime = BigInt(currentTime) - (currentEpoch * BigInt(CONFIG.EPOCH_DURATION));
        console.log(`✅ Genesis Time (calculated): ${this.genesisTime.toString()}\n`);
    }

    async displayInfo() {
        const balance = await this.provider.getBalance(this.wallet.address);
        const pending = await this.flushContract.rewardsOf(this.wallet.address);
        const available = await this.flushContract.rewardsAvailable();
        const currentEpoch = await this.rollupContract.getCurrentEpoch();
        
        console.log('📊 Configuration:');
        console.log(`   Wallet: ${this.wallet.address}`);
        console.log(`   ETH: ${ethers.formatEther(balance)}`);
        console.log(`   Pending: ${ethers.formatEther(pending)} AZTEC`);
        console.log(`   Pool: ${ethers.formatEther(available)} AZTEC`);
        console.log(`   Current Epoch: ${currentEpoch.toString()}`);
        
        console.log(`\n⚙️  Formula Settings:`);
        console.log(`   Genesis Time: ${this.genesisTime.toString()}`);
        console.log(`   Epoch Duration: ${CONFIG.EPOCH_DURATION}s (${CONFIG.EPOCH_DURATION/60} min)`);
        console.log(`   Slot Duration: ${CONFIG.SLOT_DURATION}s`);
        console.log(`   Slots per Epoch: ${CONFIG.SLOTS_PER_EPOCH}`);
        console.log(`   Send Before: ${CONFIG.SEND_BEFORE_EPOCH}s before epoch`);
        
        console.log(`\n🚀 Flashbots Config:`);
        console.log(`   Primary Relay: ${CONFIG.FLASHBOTS_RELAY_URLS[0]}`);
        console.log(`   Backup Relays: ${CONFIG.FLASHBOTS_RELAY_URLS.length - 1}`);
        console.log(`   Strategy: Bundle submission 25s before epoch`);
    }

    // Calculate next epoch start timestamp
    calculateNextEpochStart(currentEpoch) {
        const nextEpoch = BigInt(currentEpoch) + 1n;
        // Formula: next_epoch_start = genesis_time + (next_epoch × epoch_duration)
        const nextEpochStart = this.genesisTime + (nextEpoch * BigInt(CONFIG.EPOCH_DURATION));
        return {
            epoch: Number(nextEpoch),
            startTimestamp: Number(nextEpochStart),
            startDate: new Date(Number(nextEpochStart) * 1000)
        };
    }

    // Predict target block number from timestamp
    async predictBlockNumber(targetTimestamp) {
        const currentBlock = await this.provider.getBlock('latest');
        const currentTime = currentBlock.timestamp;
        const currentBlockNum = currentBlock.number;
        
        // Blocks until target = (target_time - current_time) / avg_block_time
        const timeDiff = targetTimestamp - currentTime;
        const blocksUntilTarget = Math.floor(timeDiff / CONFIG.BLOCK_TIME_AVG);
        const predictedBlock = currentBlockNum + blocksUntilTarget;
        
        return {
            current: currentBlockNum,
            predicted: predictedBlock,
            blocksAway: blocksUntilTarget,
            timeAway: timeDiff
        };
    }

    // Submit Flashbots bundle
    async submitFlashbotsBundle(targetBlockNumber) {
        try {
            console.log(`\n🚀 Preparing Flashbots bundle for block ${targetBlockNumber}...`);
            
            // Get gas price
            const feeData = await this.provider.getFeeData();
            const maxBaseFee = feeData.maxFeePerGas;
            const priorityFee = feeData.maxPriorityFeePerGas;
            
            // Create flush transaction
            const flushTx = await this.flushContract.flushEntryQueue.populateTransaction();
            
            const signedBundle = await this.flashbotsProvider.signBundle([
                {
                    signer: this.wallet,
                    transaction: {
                        to: CONFIG.FLUSH_REWARDER,
                        data: flushTx.data,
                        gasLimit: CONFIG.GAS_LIMIT_FLUSH,
                        maxFeePerGas: maxBaseFee,
                        maxPriorityFeePerGas: priorityFee,
                        chainId: 1,
                        type: 2
                    }
                }
            ]);
            
            console.log('   ✅ Bundle signed');
            console.log(`   Target block: ${targetBlockNumber}`);
            console.log(`   Gas: ${ethers.formatUnits(maxBaseFee, 'gwei')} Gwei`);
            
            // Submit to Flashbots
            const bundleSubmission = await this.flashbotsProvider.sendRawBundle(
                signedBundle,
                targetBlockNumber
            );
            
            this.stats.bundlesSubmitted++;
            
            console.log('   📤 Bundle submitted to Flashbots');
            console.log(`   Bundle Hash: ${bundleSubmission.bundleHash}`);
            
            // Wait for inclusion
            console.log('   ⏳ Waiting for bundle inclusion...');
            
            const waitResponse = await bundleSubmission.wait();
            
            if (waitResponse === 0) {
                console.log('   ✅ BUNDLE INCLUDED IN BLOCK!');
                this.stats.bundlesIncluded++;
                this.stats.flushSuccess++;
                return true;
            } else if (waitResponse === 1) {
                console.log('   ⚠️  Bundle not included (block passed)');
                return false;
            } else {
                console.log('   ⚠️  Bundle not included (unknown reason)');
                return false;
            }
            
        } catch (error) {
            console.error('   ❌ Flashbots bundle error:', error.message);
            this.stats.flushFailed++;
            return false;
        }
    }

    // Main monitoring loop
    async run() {
        console.log('\n🤖 BOT RUNNING...\n');
        console.log('Press Ctrl+C to stop\n');
        console.log('━'.repeat(60));
        
        while (true) {
            try {
                // Get current epoch from contract
                const currentEpoch = Number(await this.rollupContract.getCurrentEpoch());
                const block = await this.provider.getBlock('latest');
                const currentTime = block.timestamp;
                
                // Calculate next epoch details
                const nextEpoch = this.calculateNextEpochStart(currentEpoch);
                const timeUntilNext = nextEpoch.startTimestamp - currentTime;
                const minutesUntil = Math.floor(timeUntilNext / 60);
                const secondsUntil = timeUntilNext % 60;
                
                // Update tracking
                if (currentEpoch !== this.currentEpoch) {
                    this.currentEpoch = currentEpoch;
                    this.bundleSubmitted = false;
                    console.log(`\n🔔 Current Epoch: ${currentEpoch}`);
                }
                
                // Display status
                console.log(`\r[${new Date().toLocaleTimeString()}] Epoch ${currentEpoch} | Next in: ${minutesUntil}m ${secondsUntil}s | ✅ ${this.stats.flushSuccess} | 📦 ${this.stats.bundlesIncluded}/${this.stats.bundlesSubmitted}`, );
                
                // Check if we should submit bundle (25-30s before new epoch)
                const shouldSubmit = 
                    timeUntilNext <= CONFIG.SEND_BEFORE_EPOCH && 
                    timeUntilNext > 0 &&
                    !this.bundleSubmitted &&
                    !this.isProcessing &&
                    this.lastFlushEpoch !== nextEpoch.epoch;
                
                if (shouldSubmit) {
                    this.isProcessing = true;
                    this.bundleSubmitted = true;
                    
                    console.log(`\n\n🎯 TRIGGER: ${timeUntilNext}s until Epoch ${nextEpoch.epoch}`);
                    console.log(`   Next epoch starts: ${nextEpoch.startDate.toISOString()}`);
                    
                    // Predict target block
                    const blockPrediction = await this.predictBlockNumber(nextEpoch.startTimestamp);
                    console.log(`   Predicted block: ${blockPrediction.predicted} (in ${blockPrediction.blocksAway} blocks)`);
                    
                    // Submit Flashbots bundle
                    const success = await this.submitFlashbotsBundle(blockPrediction.predicted);
                    
                    if (success) {
                        this.lastFlushEpoch = nextEpoch.epoch;
                        console.log(`   🎉 SUCCESS! Flushed epoch ${nextEpoch.epoch}`);
                        
                        // Auto-claim if needed
                        await this.checkClaim();
                    }
                    
                    this.isProcessing = false;
                }
                
                // Sleep
                await this.sleep(CONFIG.CHECK_INTERVAL);
                
            } catch (error) {
                console.error('\n❌ Loop error:', error.message);
                await this.sleep(5000);
            }
        }
    }

    // Auto claim
    async checkClaim() {
        try {
            const pending = await this.flushContract.rewardsOf(this.wallet.address);
            if (pending >= CONFIG.MIN_CLAIM_AMOUNT) {
                console.log(`\n💰 Claiming ${ethers.formatEther(pending)} AZTEC...`);
                const tx = await this.flushContract.claimRewards({ gasLimit: 100000 });
                await tx.wait();
                this.stats.claimed += pending;
                console.log(`   ✅ Claimed! TX: ${tx.hash}`);
            }
        } catch (error) {
            console.error('❌ Claim error:', error.message);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== MAIN ====================
async function main() {
    const bot = new ProfessionalFlashbotsBot();
    await bot.initialize();
    await bot.run();
}

process.on('SIGINT', () => {
    console.log('\n\n⏹️  Stopping bot...');
    console.log(`\n📊 Final Stats:`);
    console.log(`   Bundles Submitted: ${bot?.stats?.bundlesSubmitted || 0}`);
    console.log(`   Bundles Included: ${bot?.stats?.bundlesIncluded || 0}`);
    console.log(`   Flush Success: ${bot?.stats?.flushSuccess || 0}`);
    console.log(`   Claimed: ${ethers.formatEther(bot?.stats?.claimed || 0)} AZTEC`);
    if (bot?.stats?.bundlesSubmitted > 0) {
        const successRate = ((bot.stats.bundlesIncluded / bot.stats.bundlesSubmitted) * 100).toFixed(1);
        console.log(`   Success Rate: ${successRate}%`);
    }
    console.log('\n👋 Goodbye!\n');
    process.exit(0);
});

if (require.main === module) {
    main().catch(error => {
        console.error('💥 Fatal:', error);
        process.exit(1);
    });
}

module.exports = ProfessionalFlashbotsBot;
