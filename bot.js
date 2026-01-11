// Aztec Flush Bot - SIMPLE DIRECT TX VERSION
// ============================================
// No Flashbots, No Complex Math - Just Works!
require('dotenv').config();
const { ethers } = require('ethers');

// ==================== CONFIG ====================
const CONFIG = {
    FLUSH_REWARDER: '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65',
    ROLLUP: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12',
    
    EPOCH_DURATION: 2304, // 38.4 minutes
    
    CHECK_INTERVAL: 1000, // 1 second
    TRIGGER_BEFORE: 3, // Send 3 seconds before epoch ends
    
    MIN_CLAIM: ethers.parseEther('100'),
    GAS_LIMIT: 250000,
};

// ==================== ABIs ====================
const FLUSH_ABI = [
    'function flushEntryQueue() external returns (uint256)',
    'function claimRewards() external',
    'function rewardsOf(address) view returns (uint256)',
    'function rewardsAvailable() view returns (uint256)',
];

const ROLLUP_ABI = [
    'function getCurrentEpoch() view returns (uint256)',
    'function GENESIS_TIME() view returns (uint256)',
];

// ==================== SIMPLE BOT ====================
class SimpleFlushBot {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.flush = null;
        this.rollup = null;
        this.genesis = null;
        
        this.currentEpoch = 0;
        this.lastFlush = -1;
        this.processing = false;
        
        this.stats = {
            success: 0,
            failed: 0,
            claimed: ethers.parseEther('0'),
        };
    }

    async init() {
        console.log('🤖 SIMPLE AZTEC FLUSH BOT\n');
        console.log('━'.repeat(50));
        
        if (!process.env.RPC_URL) throw new Error('❌ RPC_URL missing');
        if (!process.env.PRIVATE_KEY) throw new Error('❌ PRIVATE_KEY missing');
        
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        
        this.flush = new ethers.Contract(CONFIG.FLUSH_REWARDER, FLUSH_ABI, this.wallet);
        this.rollup = new ethers.Contract(CONFIG.ROLLUP, ROLLUP_ABI, this.provider);
        
        // Get genesis from contract
        console.log('📡 Getting genesis time...');
        try {
            this.genesis = await this.rollup.GENESIS_TIME();
            console.log(`✅ Genesis: ${this.genesis.toString()}\n`);
        } catch (e) {
            console.log('⚠️  Cannot read GENESIS_TIME, using calculation\n');
            await this.calcGenesis();
        }
        
        await this.showInfo();
        console.log('━'.repeat(50));
    }

    async calcGenesis() {
        const epoch = await this.rollup.getCurrentEpoch();
        const block = await this.provider.getBlock('latest');
        
        // Rough calculation
        this.genesis = BigInt(block.timestamp) - (epoch * BigInt(CONFIG.EPOCH_DURATION));
        
        // Fine-tune
        for (let offset = -CONFIG.EPOCH_DURATION; offset <= 0; offset += 60) {
            const test = this.genesis + BigInt(offset);
            const calc = (BigInt(block.timestamp) - test) / BigInt(CONFIG.EPOCH_DURATION);
            if (calc === epoch) {
                this.genesis = test;
                break;
            }
        }
    }

    async showInfo() {
        const bal = await this.provider.getBalance(this.wallet.address);
        const pending = await this.flush.rewardsOf(this.wallet.address);
        const pool = await this.flush.rewardsAvailable();
        
        console.log('📊 Status:');
        console.log(`   Wallet: ${this.wallet.address}`);
        console.log(`   ETH: ${ethers.formatEther(bal)}`);
        console.log(`   Pending: ${ethers.formatEther(pending)} AZTEC`);
        console.log(`   Pool: ${ethers.formatEther(pool)} AZTEC\n`);
        
        if (bal < ethers.parseEther('0.001')) {
            console.log('⚠️  LOW ETH BALANCE! Add at least 0.01 ETH\n');
        }
    }

    getEpochInfo(timestamp) {
        const time = BigInt(timestamp);
        const epoch = (time - this.genesis) / BigInt(CONFIG.EPOCH_DURATION);
        const epochStart = this.genesis + (epoch * BigInt(CONFIG.EPOCH_DURATION));
        const epochEnd = epochStart + BigInt(CONFIG.EPOCH_DURATION);
        const into = time - epochStart;
        const remaining = epochEnd - time;
        const progress = Number(into) / CONFIG.EPOCH_DURATION;
        
        return {
            epoch: Number(epoch),
            remaining: Number(remaining),
            progress: progress,
        };
    }

    async tryFlush() {
        if (this.processing) return;
        this.processing = true;
        
        try {
            console.log(`\n🚀 FLUSHING...`);
            
            // Check balance
            const bal = await this.provider.getBalance(this.wallet.address);
            if (bal < ethers.parseEther('0.0005')) {
                console.log('❌ Insufficient ETH!');
                this.processing = false;
                return;
            }
            
            // Get gas
            const fee = await this.provider.getFeeData();
            
            console.log(`   Gas: ${ethers.formatUnits(fee.gasPrice, 'gwei')} Gwei`);
            
            // Send tx
            const tx = await this.flush.flushEntryQueue({
                gasLimit: CONFIG.GAS_LIMIT,
                maxFeePerGas: fee.maxFeePerGas,
                maxPriorityFeePerGas: fee.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei'),
            });
            
            console.log(`   TX: ${tx.hash}`);
            
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                this.stats.success++;
                console.log(`   ✅ SUCCESS! Block ${receipt.blockNumber}`);
                
                await this.autoClaim();
            } else {
                this.stats.failed++;
                console.log(`   ❌ Failed`);
            }
            
        } catch (err) {
            if (err.message.includes('execution reverted')) {
                console.log(`   ℹ️  Already flushed or queue empty`);
            } else if (err.message.includes('insufficient funds')) {
                console.log(`   ❌ Insufficient ETH! Add more funds`);
            } else {
                console.log(`   ❌ Error: ${err.message}`);
                this.stats.failed++;
            }
        }
        
        this.processing = false;
    }

    async autoClaim() {
        try {
            const pending = await this.flush.rewardsOf(this.wallet.address);
            if (pending >= CONFIG.MIN_CLAIM) {
                console.log(`\n💰 Claiming ${ethers.formatEther(pending)} AZTEC...`);
                const tx = await this.flush.claimRewards({ gasLimit: 100000 });
                await tx.wait();
                this.stats.claimed += pending;
                console.log(`   ✅ Claimed!`);
            }
        } catch (err) {
            console.log(`   ⚠️  Claim failed: ${err.message}`);
        }
    }

    progressBar(p) {
        const len = 20;
        const filled = Math.floor(p * len);
        return '█'.repeat(filled) + '░'.repeat(len - filled);
    }

    async run() {
        console.log('\n🤖 BOT RUNNING...\n');
        console.log('Press Ctrl+C to stop\n');
        console.log('━'.repeat(50));
        
        while (true) {
            try {
                const block = await this.provider.getBlock('latest');
                const info = this.getEpochInfo(block.timestamp);
                
                // Track epoch change
                if (info.epoch !== this.currentEpoch) {
                    const old = this.currentEpoch;
                    this.currentEpoch = info.epoch;
                    
                    if (old > 0) {
                        console.log(`\n🔔 NEW EPOCH: ${old} → ${info.epoch}\n`);
                    }
                    
                    this.lastFlush = -1; // Reset flush flag
                }
                
                const mins = Math.floor(info.remaining / 60);
                const secs = info.remaining % 60;
                const bar = this.progressBar(info.progress);
                
                process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Epoch ${info.epoch} [${bar}] ${(info.progress*100).toFixed(1)}% | ${mins}m ${secs}s | ✅${this.stats.success} ❌${this.stats.failed}   `);
                
                // Trigger flush at 3 seconds before epoch ends
                if (info.remaining <= CONFIG.TRIGGER_BEFORE && 
                    info.remaining > 0 && 
                    this.lastFlush !== info.epoch) {
                    
                    this.lastFlush = info.epoch;
                    await this.tryFlush();
                }
                
                await this.sleep(CONFIG.CHECK_INTERVAL);
                
            } catch (err) {
                console.error(`\n❌ Error: ${err.message}`);
                await this.sleep(5000);
            }
        }
    }

    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

// ==================== MAIN ====================
async function main() {
    const bot = new SimpleFlushBot();
    await bot.init();
    await bot.run();
}

process.on('SIGINT', () => {
    console.log('\n\n⏹️  Stopping...');
    console.log(`Final: ✅${bot?.stats?.success || 0} ❌${bot?.stats?.failed || 0}`);
    console.log(`Claimed: ${ethers.formatEther(bot?.stats?.claimed || 0)} AZTEC\n`);
    process.exit(0);
});

main().catch(err => {
    console.error('💥 Fatal:', err);
    process.exit(1);
});

module.exports = SimpleFlushBot;
