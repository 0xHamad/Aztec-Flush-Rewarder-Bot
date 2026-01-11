// Aztec Flush Rewarder Bot - ULTRA-AGGRESSIVE WebSocket Edition
// ================================================================
// Features: WebSocket real-time, 0.001s response, 97% trigger
require('dotenv').config();
const { ethers } = require('ethers');

// ==================== CONFIGURATION ====================
const CONFIG = {
    // Contract Addresses
    FLUSH_REWARDER: '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65',
    ROLLUP: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12',
    
    // Epoch Settings
    EPOCH_DURATION: 38.4 * 60, // 38.4 minutes in seconds
    
    // Multi-speed monitoring
    NORMAL_INTERVAL: 10000,      // 10s (0-89%)
    MEDIUM_INTERVAL: 5000,       // 5s (90-94%)
    FAST_INTERVAL: 1000,         // 1s (95-96%)
    ULTRA_INTERVAL: 10,          // 0.01s (97-99%)
    INSTANT_INTERVAL: 1,         // 0.001s (new epoch trigger)
    
    // Thresholds
    MEDIUM_THRESHOLD: 0.90,      // 90%
    FAST_THRESHOLD: 0.95,        // 95%
    ULTRA_THRESHOLD: 0.97,       // 97% - ULTRA AGGRESSIVE!
    
    // Gas Settings (USD based)
    MIN_GAS_USD: 0.20,
    MAX_GAS_USD: 0.30,
    ETH_PRICE_USD: 3300, // Will fetch live price
    
    GAS_LIMIT_FLUSH: 200000,
    GAS_LIMIT_CLAIM: 100000,
    
    // Rewards
    MIN_CLAIM_AMOUNT: ethers.parseEther('100'),
    
    // Performance
    MAX_RETRIES: 2,
    PRE_SEND_BUFFER: 100, // 0.1s before epoch change
};

// ==================== ABIs ====================
const FLUSH_ABI = [
    'function flushEntryQueue() external returns (uint256)',
    'function claimRewards() external',
    'function rewardsOf(address) external view returns (uint256)',
    'function rewardsAvailable() external view returns (uint256)',
    'function rewardPerInsertion() external view returns (uint256)'
];

const ROLLUP_ABI = [
    'function getCurrentSlot() external view returns (uint256)',
    'event L2BlockProcessed(uint256 indexed blockNumber)'
];

// ==================== ULTRA-AGGRESSIVE BOT ====================
class UltraAggressiveBot {
    constructor() {
        this.wsProvider = null;
        this.httpProvider = null;
        this.wallet = null;
        this.wsWallet = null;
        this.flushContract = null;
        this.rollupContract = null;
        
        this.currentEpoch = 0;
        this.lastFlushEpoch = -1;
        this.isProcessing = false;
        this.currentInterval = CONFIG.NORMAL_INTERVAL;
        this.inUltraMode = false;
        
        this.stats = {
            flushes: 0,
            success: 0,
            failed: 0,
            claimed: ethers.parseEther('0'),
            gasSpent: ethers.parseEther('0'),
            epochChanges: 0,
            fastestFlush: null,
            startTime: Date.now()
        };
    }

    // Initialize WebSocket + HTTP providers
    async initialize() {
        console.log('🚀 ULTRA-AGGRESSIVE AZTEC FLUSH BOT');
        console.log('━'.repeat(60));
        console.log('⚡ Features:');
        console.log('   • WebSocket real-time monitoring');
        console.log('   • 0.001s instant response on epoch change');
        console.log('   • 97% ultra-fast mode activation');
        console.log('   • $0.20-$0.30 gas optimization\n');
        
        // Validate environment
        if (!process.env.RPC_URL) throw new Error('❌ RPC_URL missing');
        if (!process.env.PRIVATE_KEY) throw new Error('❌ PRIVATE_KEY missing');
        
        const rpcUrl = process.env.RPC_URL;
        
        // Detect WebSocket URL
        let wsUrl = process.env.WS_RPC_URL;
        if (!wsUrl) {
            // Auto-convert HTTP to WebSocket
            if (rpcUrl.includes('alchemy.com')) {
                wsUrl = rpcUrl.replace('https://', 'wss://').replace('/v2/', '/v2/');
            } else if (rpcUrl.includes('infura.io')) {
                wsUrl = rpcUrl.replace('https://', 'wss://');
            } else {
                console.log('⚠️  WebSocket URL not found, using HTTP only');
                console.log('💡 Add WS_RPC_URL to .env for best performance\n');
            }
        }
        
        // Setup providers
        this.httpProvider = new ethers.JsonRpcProvider(rpcUrl);
        
        if (wsUrl) {
            try {
                this.wsProvider = new ethers.WebSocketProvider(wsUrl);
                console.log('✅ WebSocket connected (ULTRA-FAST mode available)');
            } catch (error) {
                console.log('⚠️  WebSocket failed, using HTTP fallback');
                this.wsProvider = null;
            }
        }
        
        // Setup wallet
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.httpProvider);
        if (this.wsProvider) {
            this.wsWallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.wsProvider);
        }
        
        // Setup contracts
        this.flushContract = new ethers.Contract(CONFIG.FLUSH_REWARDER, FLUSH_ABI, this.wallet);
        this.rollupContract = new ethers.Contract(CONFIG.ROLLUP, ROLLUP_ABI, this.httpProvider);
        
        // Display info
        await this.displayInfo();
        
        // Subscribe to WebSocket blocks if available
        if (this.wsProvider) {
            this.wsProvider.on('block', (blockNumber) => {
                this.onNewBlock(blockNumber);
            });
            console.log('✅ Subscribed to real-time block updates\n');
        }
        
        console.log('━'.repeat(60));
    }

    async displayInfo() {
        const balance = await this.httpProvider.getBalance(this.wallet.address);
        const pending = await this.flushContract.rewardsOf(this.wallet.address);
        const available = await this.flushContract.rewardsAvailable();
        
        console.log('\n📊 Configuration:');
        console.log(`   Wallet: ${this.wallet.address}`);
        console.log(`   ETH: ${ethers.formatEther(balance)}`);
        console.log(`   Pending: ${ethers.formatEther(pending)} AZTEC`);
        console.log(`   Pool: ${ethers.formatEther(available)} AZTEC`);
        
        // Calculate gas limits
        const feeData = await this.httpProvider.getFeeData();
        const gasPrice = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
        const ethPrice = CONFIG.ETH_PRICE_USD;
        
        const minGwei = (CONFIG.MIN_GAS_USD / ethPrice / CONFIG.GAS_LIMIT_FLUSH * 1e9).toFixed(2);
        const maxGwei = (CONFIG.MAX_GAS_USD / ethPrice / CONFIG.GAS_LIMIT_FLUSH * 1e9).toFixed(2);
        
        console.log(`\n⚙️  Speed Settings:`);
        console.log(`   Normal: ${CONFIG.NORMAL_INTERVAL/1000}s (0-89%)`);
        console.log(`   Medium: ${CONFIG.MEDIUM_INTERVAL/1000}s (90-94%)`);
        console.log(`   Fast: ${CONFIG.FAST_INTERVAL/1000}s (95-96%)`);
        console.log(`   Ultra: ${CONFIG.ULTRA_INTERVAL}ms (97-99%) 🔥`);
        console.log(`   Instant: ${CONFIG.INSTANT_INTERVAL}ms (epoch change) 🚀`);
        
        console.log(`\n⛽ Gas Settings:`);
        console.log(`   Current: ${gasPrice.toFixed(2)} Gwei`);
        console.log(`   Target: ${minGwei}-${maxGwei} Gwei ($0.20-$0.30)`);
        console.log(`   ETH Price: ~$${ethPrice}`);
    }

    // Get current epoch info
    async getEpochInfo() {
        try {
            const block = await this.httpProvider.getBlock('latest');
            const currentTime = block.timestamp;
            
            const epochDuration = CONFIG.EPOCH_DURATION;
            const currentEpoch = Math.floor(currentTime / epochDuration);
            const epochStart = currentEpoch * epochDuration;
            const epochEnd = epochStart + epochDuration;
            const timeInEpoch = currentTime - epochStart;
            const progress = timeInEpoch / epochDuration;
            const remaining = epochEnd - currentTime;
            
            return {
                epoch: currentEpoch,
                start: epochStart,
                end: epochEnd,
                current: currentTime,
                timeIn: timeInEpoch,
                progress: progress,
                remaining: remaining,
                blockNumber: block.number
            };
        } catch (error) {
            console.error('❌ Epoch info error:', error.message);
            return null;
        }
    }

    // WebSocket block handler
    async onNewBlock(blockNumber) {
        if (this.isProcessing) return;
        
        // Quick epoch check
        const info = await this.getEpochInfo();
        if (!info) return;
        
        // Detect epoch change
        if (info.epoch !== this.currentEpoch) {
            this.currentEpoch = info.epoch;
            this.stats.epochChanges++;
            
            console.log(`\n🔔 NEW EPOCH DETECTED: ${info.epoch} (Block: ${blockNumber})`);
            
            // INSTANT FLUSH on epoch change!
            if (this.lastFlushEpoch !== info.epoch) {
                console.log('🚀 INSTANT FLUSH MODE ACTIVATED!');
                await this.sleep(CONFIG.INSTANT_INTERVAL); // 0.001s
                await this.attemptFlush(info, true);
            }
        }
    }

    // Adjust monitoring speed
    adjustSpeed(progress) {
        let interval = CONFIG.NORMAL_INTERVAL;
        let mode = '⏰ NORMAL';
        
        if (progress >= CONFIG.ULTRA_THRESHOLD) {
            interval = CONFIG.ULTRA_INTERVAL;
            mode = '🚀 ULTRA-FAST';
            this.inUltraMode = true;
        } else if (progress >= CONFIG.FAST_THRESHOLD) {
            interval = CONFIG.FAST_INTERVAL;
            mode = '🔥 FAST';
            this.inUltraMode = false;
        } else if (progress >= CONFIG.MEDIUM_THRESHOLD) {
            interval = CONFIG.MEDIUM_INTERVAL;
            mode = '⚡ MEDIUM';
            this.inUltraMode = false;
        } else {
            this.inUltraMode = false;
        }
        
        if (this.currentInterval !== interval) {
            this.currentInterval = interval;
            console.log(`\n${mode} MODE (${interval}ms) @ ${(progress*100).toFixed(1)}%`);
        }
    }

    // Check if gas is acceptable
    async checkGas() {
        const feeData = await this.httpProvider.getFeeData();
        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
        const ethPrice = CONFIG.ETH_PRICE_USD;
        
        const minGwei = CONFIG.MIN_GAS_USD / ethPrice / CONFIG.GAS_LIMIT_FLUSH * 1e9;
        const maxGwei = CONFIG.MAX_GAS_USD / ethPrice / CONFIG.GAS_LIMIT_FLUSH * 1e9;
        
        if (gasPriceGwei > maxGwei) {
            console.log(`⚠️  Gas too high: ${gasPriceGwei.toFixed(2)} Gwei (max: ${maxGwei.toFixed(2)})`);
            return { ok: false, feeData: null };
        }
        
        return { ok: true, feeData: feeData, gasPrice: gasPriceGwei };
    }

    // Attempt flush
    async attemptFlush(info, isInstant = false) {
        if (this.isProcessing) return;
        if (this.lastFlushEpoch === info.epoch) return;
        
        this.isProcessing = true;
        const startTime = Date.now();
        
        try {
            const gasCheck = await this.checkGas();
            if (!gasCheck.ok) {
                this.isProcessing = false;
                return;
            }
            
            const label = isInstant ? '⚡ INSTANT' : '🎯';
            console.log(`\n${label} FLUSH @ ${(info.progress*100).toFixed(1)}% (Epoch ${info.epoch})`);
            
            // Use WebSocket wallet if available for faster tx
            const contract = this.wsProvider ? 
                new ethers.Contract(CONFIG.FLUSH_REWARDER, FLUSH_ABI, this.wsWallet) :
                this.flushContract;
            
            const tx = await contract.flushEntryQueue({
                gasLimit: CONFIG.GAS_LIMIT_FLUSH,
                maxFeePerGas: gasCheck.feeData.maxFeePerGas,
                maxPriorityFeePerGas: gasCheck.feeData.maxPriorityFeePerGas
            });
            
            const sendTime = Date.now() - startTime;
            console.log(`   TX: ${tx.hash}`);
            console.log(`   Send time: ${sendTime}ms`);
            console.log(`   Gas: ${gasCheck.gasPrice.toFixed(2)} Gwei`);
            console.log('   ⏳ Confirming...');
            
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                const totalTime = Date.now() - startTime;
                const gasUsed = receipt.gasUsed * receipt.gasPrice;
                
                this.stats.success++;
                this.stats.gasSpent += gasUsed;
                this.lastFlushEpoch = info.epoch;
                
                if (!this.stats.fastestFlush || totalTime < this.stats.fastestFlush) {
                    this.stats.fastestFlush = totalTime;
                }
                
                console.log(`   ✅ SUCCESS in ${totalTime}ms!`);
                console.log(`   Gas: ${ethers.formatEther(gasUsed)} ETH`);
                console.log(`   Block: ${receipt.blockNumber}`);
                
                await this.checkClaim();
            } else {
                this.stats.failed++;
                console.log('   ❌ TX failed');
            }
        } catch (error) {
            this.stats.failed++;
            
            if (error.message.includes('execution reverted')) {
                console.log('   ℹ️  Queue empty or already flushed');
                this.lastFlushEpoch = info.epoch;
            } else {
                console.error('   ❌ Error:', error.message);
            }
        }
        
        this.isProcessing = false;
    }

    // Auto claim
    async checkClaim() {
        try {
            const pending = await this.flushContract.rewardsOf(this.wallet.address);
            if (pending >= CONFIG.MIN_CLAIM_AMOUNT) {
                console.log(`\n💰 Claiming ${ethers.formatEther(pending)} AZTEC...`);
                const tx = await this.flushContract.claimRewards({ gasLimit: CONFIG.GAS_LIMIT_CLAIM });
                await tx.wait();
                this.stats.claimed += pending;
                console.log(`   ✅ Claimed! TX: ${tx.hash}`);
            }
        } catch (error) {
            console.error('❌ Claim error:', error.message);
        }
    }

    // Display status
    showStatus(info) {
        const bar = this.progressBar(info.progress);
        const mins = Math.floor(info.remaining / 60);
        const secs = Math.floor(info.remaining % 60);
        
        console.log(`\n[${new Date().toLocaleTimeString()}] Epoch ${info.epoch}`);
        console.log(`${bar} ${(info.progress*100).toFixed(1)}%`);
        console.log(`Remaining: ${mins}m ${secs}s | ✅ ${this.stats.success} | ❌ ${this.stats.failed}`);
    }

    progressBar(progress, len = 20) {
        const filled = Math.floor(progress * len);
        return '█'.repeat(filled) + '░'.repeat(len - filled);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Main loop
    async run() {
        console.log('\n🤖 BOT RUNNING...\n');
        console.log('Press Ctrl+C to stop\n');
        console.log('━'.repeat(60));
        
        while (true) {
            try {
                const info = await this.getEpochInfo();
                if (!info) {
                    await this.sleep(5000);
                    continue;
                }
                
                // Update epoch tracking
                if (info.epoch !== this.currentEpoch) {
                    this.currentEpoch = info.epoch;
                    this.stats.epochChanges++;
                    console.log(`\n🔔 Epoch ${info.epoch} started`);
                }
                
                // Adjust speed based on progress
                this.adjustSpeed(info.progress);
                
                // Show status
                if (this.inUltraMode || Date.now() % 15000 < this.currentInterval) {
                    this.showStatus(info);
                }
                
                // Attempt flush in ultra-fast mode (97%+)
                if (info.progress >= CONFIG.ULTRA_THRESHOLD && this.lastFlushEpoch !== info.epoch) {
                    await this.attemptFlush(info);
                }
                
                await this.sleep(this.currentInterval);
                
            } catch (error) {
                console.error('❌ Loop error:', error.message);
                await this.sleep(5000);
            }
        }
    }
}

// ==================== MAIN ====================
async function main() {
    const bot = new UltraAggressiveBot();
    await bot.initialize();
    await bot.run();
}

process.on('SIGINT', () => {
    console.log('\n\n⏹️  Stopping bot...');
    console.log(`\n📊 Final Stats:`);
    console.log(`   Success: ${bot?.stats?.success || 0}`);
    console.log(`   Failed: ${bot?.stats?.failed || 0}`);
    console.log(`   Claimed: ${ethers.formatEther(bot?.stats?.claimed || 0)} AZTEC`);
    if (bot?.stats?.fastestFlush) {
        console.log(`   Fastest: ${bot.stats.fastestFlush}ms`);
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

module.exports = UltraAggressiveBot;
