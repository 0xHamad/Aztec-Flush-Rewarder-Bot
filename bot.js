require('dotenv').config();
const { ethers } = require('ethers');

// ════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const FLUSH_REWARDER_ADDRESS = process.env.FLUSH_REWARDER_ADDRESS || '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';
const MAX_GAS_USD = parseFloat(process.env.MAX_GAS_USD || '0.30');
const ETH_PRICE_USD = parseFloat(process.env.ETH_PRICE_USD || '3300');

const ABI = [
  'function flushEntryQueue() external returns (uint256)',
  'function rewardsOf(address) external view returns (uint256)',
  'function rewardsAvailable() external view returns (uint256)'
];

// Aztec epoch constants (FIXED)
const GENESIS_TIMESTAMP = 1704067200; // Aztec genesis block
const EPOCH_DURATION_SECONDS = 2304; // 38.4 minutes = 32 slots × 72 seconds
const SLOT_DURATION_SECONDS = 72; // 6 blocks × 12 seconds
const SLOTS_PER_EPOCH = 32;

// Setup
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(FLUSH_REWARDER_ADDRESS, ABI, wallet);

// ════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════

function getLocalTime(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-PK', { 
    timeZone: 'Asia/Karachi',
    hour12: true,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDuration(seconds) {
  if (seconds < 0) return '0s'; // Handle negative
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getProgressBar(percentage, width = 30) {
  const percent = Math.max(0, Math.min(100, percentage)); // Clamp 0-100
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

// ════════════════════════════════════════════════════════════
// SMART INTERVAL CALCULATOR
// ════════════════════════════════════════════════════════════

function getSmartInterval(secondsUntilNext) {
  if (secondsUntilNext < 0) return 5; // If negative, check in 5 sec
  if (secondsUntilNext <= 30) return 3;
  if (secondsUntilNext <= 120) return 5;
  if (secondsUntilNext <= 300) return 10;
  return 30;
}

// ════════════════════════════════════════════════════════════
// EPOCH CALCULATOR (FIXED)
// ════════════════════════════════════════════════════════════

async function getEpochInfo() {
  const block = await provider.getBlock('latest');
  const timestamp = block.timestamp;
  
  // Calculate elapsed time since genesis
  const elapsedTime = timestamp - GENESIS_TIMESTAMP;
  
  // Calculate current epoch number
  const epochNumber = Math.floor(elapsedTime / EPOCH_DURATION_SECONDS);
  
  // Time within current epoch
  const timeInEpoch = elapsedTime % EPOCH_DURATION_SECONDS;
  
  // Current slot (0-31)
  const currentSlot = Math.floor(timeInEpoch / SLOT_DURATION_SECONDS);
  
  // Progress percentage
  const epochProgress = (timeInEpoch / EPOCH_DURATION_SECONDS) * 100;
  
  // Next epoch timing
  const nextEpochElapsed = (epochNumber + 1) * EPOCH_DURATION_SECONDS;
  const nextEpochTimestamp = GENESIS_TIMESTAMP + nextEpochElapsed;
  const secondsUntilNext = nextEpochTimestamp - timestamp;
  
  // Is this epoch start? (First 3 slots = ~3.6 minutes)
  const isEpochStart = currentSlot <= 2;
  
  return {
    epochNumber,
    currentSlot,
    epochProgress,
    secondsUntilNext,
    blockNumber: block.number,
    timestamp,
    nextEpochTimestamp,
    isEpochStart,
    currentTime: getLocalTime(timestamp),
    nextEpochTime: getLocalTime(nextEpochTimestamp)
  };
}

// ════════════════════════════════════════════════════════════
// BALANCE & GAS CHECKER (FIXED)
// ════════════════════════════════════════════════════════════

async function checkBalanceAndGas() {
  const balance = await provider.getBalance(wallet.address);
  const ethBalance = parseFloat(ethers.formatEther(balance));
  
  const feeData = await provider.getFeeData();
  let maxFeePerGas = feeData.maxFeePerGas;
  
  // Safety check for gas price
  if (!maxFeePerGas || maxFeePerGas === 0n) {
    maxFeePerGas = ethers.parseUnits('20', 'gwei'); // Default fallback
  }
  
  const gasPriceGwei = parseFloat(ethers.formatUnits(maxFeePerGas, 'gwei'));
  
  // More accurate gas estimation
  const estimatedGasUnits = 350000n; // Realistic estimate (not 500k)
  const estimatedGasCostWei = estimatedGasUnits * maxFeePerGas;
  const estimatedGasCostEth = parseFloat(ethers.formatEther(estimatedGasCostWei));
  const estimatedGasCostUsd = estimatedGasCostEth * ETH_PRICE_USD;
  
  // Calculate budget cap
  const maxAllowedGasUsd = MAX_GAS_USD;
  const maxAllowedGasEth = maxAllowedGasUsd / ETH_PRICE_USD;
  const maxAllowedGasWei = ethers.parseEther(maxAllowedGasEth.toFixed(18));
  const cappedMaxFeePerGas = maxAllowedGasWei / estimatedGasUnits;
  
  const gasWithinBudget = estimatedGasCostUsd <= MAX_GAS_USD;
  const finalMaxFeePerGas = gasWithinBudget ? maxFeePerGas : cappedMaxFeePerGas;
  
  return {
    ethBalance,
    balanceWei: balance,
    isLow: ethBalance < 0.01,
    isCritical: ethBalance < 0.005,
    isEmpty: ethBalance === 0,
    gasPriceGwei,
    estimatedCostEth: estimatedGasCostEth,
    estimatedCostUsd: estimatedGasCostUsd,
    gasWithinBudget,
    finalMaxFeePerGas,
    maxBudgetUsd: MAX_GAS_USD
  };
}

// ════════════════════════════════════════════════════════════
// FLUSH ATTEMPT
// ════════════════════════════════════════════════════════════

async function attemptFlush(epochInfo, balanceInfo) {
  try {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║         🚀 ATTEMPTING FLUSH                        ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');
    
    console.log('📋 Step 1: Checking if queue is flushable...');
    try {
      await contract.flushEntryQueue.staticCall();
      console.log('   ✅ Queue has validators ready to flush!\n');
    } catch (error) {
      console.log('   ❌ Queue is empty or already flushed');
      console.log('   💡 Skipping transaction to save gas\n');
      return false;
    }
    
    console.log('📋 Step 2: Checking gas price...');
    console.log(`   Current gas: ${balanceInfo.gasPriceGwei.toFixed(2)} gwei`);
    console.log(`   Estimated cost: $${balanceInfo.estimatedCostUsd.toFixed(2)} USD`);
    console.log(`   Budget limit: $${balanceInfo.maxBudgetUsd.toFixed(2)} USD`);
    
    if (!balanceInfo.gasWithinBudget) {
      console.log(`   ⚠️  Gas too expensive! ($${balanceInfo.estimatedCostUsd.toFixed(2)} > $${MAX_GAS_USD})`);
      console.log('   💡 Waiting for cheaper gas prices...\n');
      return false;
    }
    console.log('   ✅ Gas price acceptable!\n');
    
    console.log('📋 Step 3: Sending transaction...');
    const maxPriorityFeePerGas = balanceInfo.finalMaxFeePerGas * 115n / 100n;
    
    console.log(`   Gas Limit: 350,000`);
    console.log(`   Max Fee: ${ethers.formatUnits(balanceInfo.finalMaxFeePerGas, 'gwei')} gwei`);
    console.log(`   Priority: +15% boost`);
    
    const tx = await contract.flushEntryQueue({
      gasLimit: 350000,
      maxFeePerGas: balanceInfo.finalMaxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas
    });
    
    console.log(`\n   📤 TX Hash: ${tx.hash}`);
    console.log('   ⏳ Waiting for confirmation...\n');
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('\n╔═══════════════════════════════════════════════════╗');
      console.log('║  🎉🎉🎉  SUCCESS! FLUSH CONFIRMED!  🎉🎉🎉       ║');
      console.log('╚═══════════════════════════════════════════════════╝\n');
      
      const gasUsed = receipt.gasUsed;
      const effectiveGasPrice = receipt.gasPrice || receipt.effectiveGasPrice;
      const actualCostWei = gasUsed * effectiveGasPrice;
      const actualCostEth = parseFloat(ethers.formatEther(actualCostWei));
      const actualCostUsd = actualCostEth * ETH_PRICE_USD;
      
      console.log('📊 TRANSACTION DETAILS:');
      console.log('─────────────────────────────────────────────────');
      console.log(`   Block: #${receipt.blockNumber}`);
      console.log(`   Gas Used: ${gasUsed.toString()}`);
      console.log(`   Gas Price: ${ethers.formatUnits(effectiveGasPrice, 'gwei')} gwei`);
      console.log(`   Actual Cost: ${actualCostEth.toFixed(6)} ETH ($${actualCostUsd.toFixed(2)})`);
      console.log('─────────────────────────────────────────────────\n');
      
      const myRewards = await contract.rewardsOf(wallet.address);
      const rewardsAztec = parseFloat(ethers.formatEther(myRewards));
      
      console.log('💎 REWARDS:');
      console.log('─────────────────────────────────────────────────');
      console.log(`   Total Unclaimed: ${rewardsAztec.toFixed(2)} AZTEC`);
      console.log(`   Latest Earned: 100 AZTEC`);
      console.log('─────────────────────────────────────────────────\n');
      
      return true;
    } else {
      console.log('\n❌ Transaction failed!\n');
      return false;
    }
    
  } catch (error) {
    console.log(`\n❌ Error: ${error.message.substring(0, 100)}\n`);
    
    if (error.message.includes('insufficient funds')) {
      console.log('⚠️  Not enough ETH for gas fees!\n');
    } else if (error.message.includes('nonce')) {
      console.log('⚠️  Nonce issue - transaction might be pending\n');
    }
    
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// DISPLAY STATUS
// ════════════════════════════════════════════════════════════

async function displayStatus() {
  const epoch = await getEpochInfo();
  const balance = await checkBalanceAndGas();
  
  console.log('\n┌───────────────────────────────────────────────────┐');
  console.log('│              🔍 STATUS CHECK                       │');
  console.log('└───────────────────────────────────────────────────┘');
  
  console.log('\n⏰ CURRENT TIME:');
  console.log('─────────────────────────────────────────────────');
  console.log(`   ${epoch.currentTime} (PKT)`);
  console.log(`   Block: #${epoch.blockNumber}`);
  console.log('─────────────────────────────────────────────────');
  
  console.log('\n📊 EPOCH STATUS:');
  console.log('─────────────────────────────────────────────────');
  console.log(`   Current Epoch: #${epoch.epochNumber}`);
  console.log(`   Current Slot: ${epoch.currentSlot}/${SLOTS_PER_EPOCH}`);
  console.log(`   Progress: ${getProgressBar(epoch.epochProgress)} ${epoch.epochProgress.toFixed(1)}%`);
  console.log(`   Time Until Next: ${formatDuration(epoch.secondsUntilNext)}`);
  console.log(`   Next Epoch At: ${epoch.nextEpochTime} (PKT)`);
  console.log('─────────────────────────────────────────────────');
  
  console.log('\n💰 WALLET STATUS:');
  console.log('─────────────────────────────────────────────────');
  console.log(`   Address: ${wallet.address}`);
  console.log(`   Balance: ${balance.ethBalance.toFixed(6)} ETH`);
  
  if (balance.isEmpty) {
    console.log('   Status: 🔴 CRITICAL - No ETH!');
  } else if (balance.isCritical) {
    console.log('   Status: 🟠 WARNING - Very Low ETH!');
    console.log(`   ⚠️  Add more ETH soon! Current: ${balance.ethBalance.toFixed(6)} ETH`);
  } else if (balance.isLow) {
    console.log('   Status: 🟡 Low ETH');
  } else {
    console.log('   Status: 🟢 OK');
  }
  console.log('─────────────────────────────────────────────────');
  
  console.log('\n⛽ GAS STATUS:');
  console.log('─────────────────────────────────────────────────');
  console.log(`   Current Price: ${balance.gasPriceGwei.toFixed(2)} gwei`);
  console.log(`   Est. TX Cost: ${balance.estimatedCostEth.toFixed(6)} ETH ($${balance.estimatedCostUsd.toFixed(2)})`);
  console.log(`   Budget Limit: $${balance.maxBudgetUsd.toFixed(2)}`);
  console.log(`   Within Budget: ${balance.gasWithinBudget ? '✅ Yes' : '❌ No'}`);
  console.log('─────────────────────────────────────────────────');
  
  try {
    const poolRewards = await contract.rewardsAvailable();
    const poolAztec = parseFloat(ethers.formatEther(poolRewards));
    console.log('\n🏆 REWARD POOL:');
    console.log('─────────────────────────────────────────────────');
    console.log(`   Available: ${poolAztec.toFixed(2)} AZTEC`);
    console.log('─────────────────────────────────────────────────');
  } catch (error) {
    // Ignore pool fetch errors
  }
  
  console.log('\n🎯 DECISION:');
  console.log('─────────────────────────────────────────────────');
  
  if (balance.isEmpty) {
    console.log('   ❌ Cannot flush - No ETH!');
    console.log(`   💡 Send ETH to: ${wallet.address}`);
  } else if (balance.isCritical) {
    console.log('   ⚠️  ETH critically low - add more soon!');
  } else if (!balance.gasWithinBudget) {
    console.log(`   ⏸️  Gas too expensive ($${balance.estimatedCostUsd.toFixed(2)})`);
  } else if (epoch.isEpochStart) {
    console.log('   🚀 EPOCH START - Attempting flush!');
  } else {
    console.log(`   ⏳ Waiting ${formatDuration(epoch.secondsUntilNext)} for next epoch`);
  }
  console.log('─────────────────────────────────────────────────\n');
  
  return { epoch, balance };
}

// ════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════

let lastFlushEpoch = -1;
let flushCount = 0;

async function mainLoop() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('      🤖 AZTEC FLUSH BOT - SMART INTERVAL v2');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📍 Wallet: ${wallet.address}`);
  console.log(`📍 Contract: ${FLUSH_REWARDER_ADDRESS}`);
  console.log(`⏰ Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  console.log(`🧠 Intervals: 30s→10s→5s→3s (adaptive)`);
  console.log(`💵 Max Gas: $${MAX_GAS_USD}/tx`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  while (true) {
    try {
      const { epoch, balance } = await displayStatus();
      
      if (!balance.isEmpty && 
          balance.gasWithinBudget && 
          epoch.isEpochStart && 
          epoch.epochNumber !== lastFlushEpoch) {
        
        const success = await attemptFlush(epoch, balance);
        
        if (success) {
          lastFlushEpoch = epoch.epochNumber;
          flushCount++;
          
          console.log('📈 SESSION STATS:');
          console.log('─────────────────────────────────────────────────');
          console.log(`   Successful Flushes: ${flushCount}`);
          console.log(`   Total Rewards: ${flushCount * 100} AZTEC`);
          console.log('─────────────────────────────────────────────────\n');
        }
      }
      
      const interval = getSmartInterval(epoch.secondsUntilNext);
      console.log(`🧠 Next check: ${interval}s\n`);
      console.log('═'.repeat(55) + '\n');
      
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      
    } catch (error) {
      console.error('\n💥 Error:', error.message.substring(0, 100));
      console.log('⏳ Retry in 30s...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

mainLoop().catch(error => {
  console.error('💥 Fatal:', error);
  process.exit(1);
});
