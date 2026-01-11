// Aztec Flush Bot - FINAL WORKING VERSION
// ========================================
require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
    FLUSH: '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65',
    ROLLUP: '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12',
    EPOCH_DURATION: 2304, // 38.4 minutes
    CHECK_INTERVAL: 2000, // 2 seconds
    FLUSH_BEFORE_END: 5, // Flush 5 seconds before epoch ends
    MIN_ETH: ethers.parseEther('0.001'),
    MIN_CLAIM: ethers.parseEther('100'),
    GAS_LIMIT: 250000,
};

const FLUSH_ABI = [
    'function flushEntryQueue() external',
    'function claimRewards() external',
    'function rewardsOf(address) view returns (uint256)',
    'function rewardsAvailable() view returns (uint256)',
];

const ROLLUP_ABI = [
    'function getCurrentEpoch() view returns (uint256)',
    'function GENESIS_TIME() view returns (uint256)',
];

class AztecFlushBot {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.flush = null;
        this.rollup = null;
        this.genesis = null;
        this.lastFlushEpoch = -1;
        this.processing = false;
        this.stats = { success: 0, failed: 0, claimed: 0n };
    }

    async init() {
        console.log('\n🤖 AZTEC FLUSH BOT - FINAL VERSION\n');
        console.log('═'.repeat(60));
        
        if (!process.env.RPC_URL || !process.env.PRIVATE_KEY) {
            throw new Error('❌ Missing RPC_URL or PRIVATE_KEY in .env');
        }
        
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.flush = new ethers.Contract(CONFIG.FLUSH, FLUSH_ABI, this.wallet);
        this.rollup = new ethers.Contract(CONFIG.ROLLUP, ROLLUP_ABI, this.provider);
        
        // Try to get genesis from contract
        console.log('📡 Connecting to Rollup contract...');
        try {
            this.genesis = await this.rollup.GENESIS_TIME();
            console.log(`✅ Genesis from contract: ${this.genesis}\n`);
        } catch (e) {
            console.log('⚠️  Cannot read GENESIS_TIME() from contract');
            console.log('   Calculating genesis time...\n');
            await this.calculateGenesis();
        }
        
        await this.showStatus();
        console.log('═'.repeat(60));
    }

    async calculateGenesis() {
        // Get current epoch from contract
        const currentEpochFromContract = await this.rollup.getCurrentEpoch();
        const block = await this.provider.getBlock('latest');
        const now = BigInt(block.timestamp);
        
        console.log(`   Current time: ${now}`);
        console.log(`   Current epoch (contract): ${currentEpochFromContract}`);
        
        // Calculate approximate genesis
        const epochDuration = BigInt(CONFIG.EPOCH_DURATION);
        let genesis = now - (currentEpochFromContract * epochDuration);
        
        // Fine-tune by checking which genesis gives us the correct epoch
        let found = false;
        for (let offset = -epochDuration; offset <= epochDuration; offset += 60n) {
            const testGenesis = genesis + offset;
            const calculatedEpoch = (now - testGenesis) / epochDuration;
            
            if (calculatedEpoch === currentEpochFromContract) {
                this.genesis = testGenesis;
                found = true;
                
                // Verify
                const epochStart = testGenesis + (currentEpochFromContract * epochDuration);
                const timeIntoEpoch = now - epochStart;
                const remaining = epochDuration - timeIntoEpoch;
                
                console.log(`   ✅ Genesis calculated: ${this.genesis}`);
                console.log(`   Current epoch starts at: ${epochStart}`);
                console.log(`   Time into epoch: ${timeIntoEpoch}s`);
                console.log(`   Time remaining: ${remaining}s\n`);
                break;
            }
        }
        
        if (!found) {
            this.genesis = genesis;
            console.log(`   ⚠️  Using approximate genesis: ${this.genesis}\n`);
        }
    }

    async showStatus() {
        const balance = await this.provider.getBalance(this.wallet.address);
        const pending = await this.flush.rewardsOf(this.wallet.address);
        const pool = await this.flush.rewardsAvailable();
        const contractEpoch = await this.rollup.getCurrentEpoch();
        
        console.log('📊 Bot Status:');
        console.log(`   Wallet: ${this.wallet.address}`);
        console.log(`   ETH Balance: ${ethers.formatEther(balance)} ETH`);
        console.log(`   Pending Rewards: ${ethers.formatEther(pending)} AZTEC`);
        console.log(`   Pool Available: ${ethers.formatEther(pool)} AZTEC`);
        console.log(`   Current Epoch: ${contractEpoch}\n`);
        
        if (balance < CONFIG.MIN_ETH) {
            console.log('⚠️  ═════════════════════════════════════════');
            console.log('⚠️  CRITICAL: INSUFFICIENT ETH BALANCE!');
            console.log('⚠️  Current: ' + ethers.formatEther(balance) + ' ETH');
            console.log('⚠️  Minimum: 0.001 ETH');
            console.log('⚠️  Recommended: 0.01 ETH');
            console.log('⚠️  ═════════════════════════════════════════');
            console.log('⚠️  Bot will NOT work without sufficient ETH!');
            console.log('⚠️  Send ETH to: ' + this.wallet.address);
            console.log('⚠️  ═════════════════════════════════════════\n');
        }
        
        console.log('⚙️  Settings:');
        console.log(`   Genesis Time: ${this.genesis}`);
        console.log(`   Epoch Duration: ${CONFIG.EPOCH_DURATION}s (${CONFIG.EPOCH_DURATION/60} min)`);
        console.log(`   Flush Trigger: ${CONFIG.FLUSH_BEFORE_END}s before epoch ends`);
        console.log(`   Check Interval: ${CONFIG.CHECK_INTERVAL/1000}s\n`);
    }

    getEpochInfo(timestamp) {
        const time = BigInt(timestamp);
        const duration = BigInt(CONFIG.EPOCH_DURATION);
        
        // Calculate current epoch
        const epoch = (time - this.genesis) / duration;
        const epochStart = this.genesis + (epoch * duration);
        const epochEnd = epochStart + duration;
        const timeIntoEpoch = time - epochStart;
        const remaining = epochEnd - time;
        const progress = Number(timeIntoEpoch) / CONFIG.EPOCH_DURATION;
        
        return {
            epoch: Number(epoch),
            start: Number(epochStart),
            end: Number(epochEnd),
            timeInto: Number(timeIntoEpoch),
            remaining: Number(remaining),
            progress: progress,
        };
    }

    async tryFlush(epochInfo) {
        if (this.processing) return false;
        if (this.lastFlushEpoch === epochInfo.epoch) return false;
        
        this.processing = true;
        
        try {
            console.log(`\n\n🚀 FLUSHING EPOCH ${epochInfo.epoch}...`);
            
            // Check balance
            const balance = await this.provider.getBalance(this.wallet.address);
            if (balance < CONFIG.MIN_ETH) {
                console.log('   ❌ Insufficient ETH balance!');
                console.log(`   Have: ${ethers.formatEther(balance)} ETH`);
                console.log(`   Need: 0.001 ETH minimum`);
                console.log(`   Add ETH to: ${this.wallet.address}\n`);
                this.processing = false;
                return false;
            }
            
            // Get gas settings
            const feeData = await this.provider.getFeeData();
            const gasPriceGwei = ethers.formatUnits(feeData.gasPrice, 'gwei');
            
            console.log(`   Gas Price: ${Number(gasPriceGwei).toFixed(2)} Gwei`);
            console.log(`   Estimated Cost: ~${ethers.formatEther(BigInt(CONFIG.GAS_LIMIT) * feeData.gasPrice)} ETH`);
            
            // Send transaction
            console.log(`   📤 Sending transaction...`);
            const tx = await this.flush.flushEntryQueue({
                gasLimit: CONFIG.GAS_LIMIT,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei'),
            });
            
            console.log(`   TX Hash: ${tx.hash}`);
            console.log(`   ⏳ Waiting for confirmation...`);
            
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                const gasUsed = receipt.gasUsed * receipt.gasPrice;
                this.stats.success++;
                this.lastFlushEpoch = epochInfo.epoch;
                
                console.log(`   ✅ SUCCESS!`);
                console.log(`   Block: ${receipt.blockNumber}`);
                console.log(`   Gas Used: ${ethers.formatEther(gasUsed)} ETH\n`);
                
                // Try to claim
                await this.tryClaimRewards();
                
                this.processing = false;
                return true;
            } else {
                this.stats.failed++;
                console.log(`   ❌ Transaction failed\n`);
                this.processing = false;
                return false;
            }
            
        } catch (error) {
            if (error.message.includes('execution reverted')) {
                console.log(`   ℹ️  Queue already flushed or empty for this epoch\n`);
                this.lastFlushEpoch = epochInfo.epoch; // Mark as attempted
            } else if (error.message.includes('insufficient funds')) {
                console.log(`   ❌ Insufficient funds for gas!`);
                console.log(`   Add more ETH to wallet: ${this.wallet.address}\n`);
            } else {
                this.stats.failed++;
                console.log(`   ❌ Error: ${error.message}\n`);
            }
            
            this.processing = false;
            return false;
        }
    }

    async tryClaimRewards() {
        try {
            const pending = await this.flush.rewardsOf(this.wallet.address);
            
            if (pending >= CONFIG.MIN_CLAIM) {
                console.log(`   💰 Claiming ${ethers.formatEther(pending)} AZTEC...`);
                
                const tx = await this.flush.claimRewards({ gasLimit: 100000 });
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                    this.stats.claimed += pending;
                    console.log(`   ✅ Claimed successfully!`);
                    console.log(`   TX: ${tx.hash}\n`);
                } else {
                    console.log(`   ❌ Claim failed\n`);
                }
            }
        } catch (error) {
            console.log(`   ⚠️  Claim error: ${error.message}\n`);
        }
    }

    progressBar(progress, length = 20) {
        const filled = Math.floor(progress * length);
        const empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    async run() {
        console.log('🤖 BOT IS NOW RUNNING...\n');
        console.log('Press Ctrl+C to stop\n');
        console.log('═'.repeat(60) + '\n');
        
        let currentEpoch = -1;
        
        while (true) {
            try {
                // Get current blockchain time
                const block = await this.provider.getBlock('latest');
                const info = this.getEpochInfo(block.timestamp);
                
                // Detect epoch change
                if (info.epoch !== currentEpoch && currentEpoch !== -1) {
                    console.log(`\n🔔 NEW EPOCH: ${currentEpoch} → ${info.epoch}`);
                    console.log(`   Time: ${new Date(block.timestamp * 1000).toISOString()}\n`);
                    this.lastFlushEpoch = -1; // Reset for new epoch
                }
                currentEpoch = info.epoch;
                
                // Display status
                const mins = Math.floor(info.remaining / 60);
                const secs = Math.floor(info.remaining % 60);
                const bar = this.progressBar(info.progress);
                const time = new Date().toLocaleTimeString();
                
                process.stdout.write(`\r[${time}] Epoch ${info.epoch} [${bar}] ${(info.progress*100).toFixed(1)}% | ${mins}m ${secs}s | ✅${this.stats.success} ❌${this.stats.failed}   `);
                
                // Trigger flush when close to epoch end
                if (info.remaining <= CONFIG.FLUSH_BEFORE_END && 
                    info.remaining > 0 && 
                    this.lastFlushEpoch !== info.epoch &&
                    !this.processing) {
                    
                    await this.tryFlush(info);
                }
                
                // Sleep
                await new Promise(r => setTimeout(r, CONFIG.CHECK_INTERVAL));
                
            } catch (error) {
                console.error(`\n\n❌ Error: ${error.message}`);
                console.log('Retrying in 5 seconds...\n');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
}

// Main
async function main() {
    const bot = new AztecFlushBot();
    await bot.init();
    await bot.run();
}

process.on('SIGINT', () => {
    console.log('\n\n⏹️  Bot stopping...\n');
    console.log('📊 Final Statistics:');
    console.log(`   Successful Flushes: ${bot?.stats?.success || 0}`);
    console.log(`   Failed Attempts: ${bot?.stats?.failed || 0}`);
    console.log(`   Total Claimed: ${ethers.formatEther(bot?.stats?.claimed || 0n)} AZTEC\n`);
    console.log('👋 Goodbye!\n');
    process.exit(0);
});

main().catch(error => {
    console.error('💥 Fatal Error:', error.message);
    process.exit(1);
});
