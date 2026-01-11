require('dotenv').config();
const { ethers } = require('ethers');

// ════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const FLUSH_REWARDER_ADDRESS = process.env.FLUSH_REWARDER_ADDRESS || '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';
const ROLLUP_ADDRESS = process.env.ROLLUP_ADDRESS || '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12';
const MAX_GAS_USD = parseFloat(process.env.MAX_GAS_USD || '0.30');
const ETH_PRICE_USD = parseFloat(process.env.ETH_PRICE_USD || '3300');

// Contract ABIs
const FLUSH_REWARDER_ABI = [
  'function flushEntryQueue() external returns (uint256)',
  'function rewardsOf(address) external view returns (uint256)',
  'function rewardsAvailable() external view returns (uint256)'
];

const ROLLUP_ABI = [
  'function getCurrentEpoch() external view returns (uint256)',
  'function getCurrentSlot() external view returns (uint256)',
  'function getEpochAtTimestamp(uint256 timestamp) external view returns (uint256)',
  'function getTimestampForSlot(uint256 slot) external view returns (uint256)'
];

// Aztec epoch constants
const EPOCH_DURATION_SECONDS = 2304; // 38.4 minutes
const SLOT_DURATION_SECONDS = 72; // 12 sec/block × 6 blocks
const SLOTS_PER_EPOCH = 32;

// Setup
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const flushContract = new ethers.Contract(FLUSH_REWARDER_ADDRESS, FLUSH_REWARDER_ABI, wallet);
const rollupContract = new ethers.Contract(ROLLUP_ADDRESS, ROLLUP_ABI, provider);

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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getProgressBar(percentage, width = 30) {
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

// ════════════════════════════════════════════════════════════
// SMART INTERVAL CALCULATOR
// ════════════════════════════════════════════════════════════

function getSmartInterval(secondsUntilNext) {
  if (secondsUntilNext <= 30) {
    return 3;  // 3 seconds when VERY close (last 30 sec)
  } else if (secondsUntilNext <= 120) {
    return 5;  // 5 seconds when close (last 2 min)
  } else if (secondsUntilNext <= 300) {
    return 10; // 10 seconds when approaching (last 5 min)
  } else {
    return 30; // 30 seconds when far away
  }
}

// ════════════════════════════════════════════════════════════
// EPOCH CALCULATOR (ENHANCED WITH ROLLUP CONTRACT)
// ════════════════════════════════════════════════════════════

async function getEpochInfo() {
  const block = await provider.getBlock('latest');
  const timestamp = block.timestamp;
  
  // Try to get epoch from rollup contract (more accurate)
  let epochNumber, currentSlot;
  let usingRollup = false;
  
  try {
    epochNumber = Number(await rollupContract.getCurrentEpoch());
    currentSlot = Number(await rollupContract.getCurrentSlot());
    usingRollup = true;
  } catch (error) {
    // Fallback to calculation if rollup contract call fails
    epochNumber = Math.floor(timestamp / EPOCH_DURATION_SECONDS);
    const timeInEpoch = timestamp % EPOCH_DURATION_SECONDS;
    currentSlot = Math.floor(timeInEpoch / SLOT_DURATION_SECONDS);
  }
  
  const timeInEpoch = timestamp % EPOCH_DURATION_SECONDS;
  const epochProgress = (timeInEpoch / EPOCH_DURATION_SECONDS) * 100;
  
  const nextEpochStart = (epochNumber + 1) * EPOCH_DURATION_SECONDS;
  const secondsUntilNext = nextEpochStart - timestamp;
  const nextEpochDate = new Date(nextEpochStart * 1000);
  const isEpochStart = currentSlot <= 2;
  
  return {
    epochNumber,
    currentSlot,
    epochProgress,
    secondsUntilNext,
    blockNumber: block.number,
    timestamp,
    nextEpochStart,
    nextEpochDate,
    isEpochStart,
    currentTime: getLocalTime(timestamp),
    nextEpochTime: getLocalTime(nextEpochStart),
    usingRollup
  };
}

// ════════════════════════════════════════════════════════════
// BALANCE & GAS CHECKER
// ════════════════════════════════════════════════════════════

async function checkBalanceAndGas() {
  const balance = await provider.getBalance(wallet.address);
  const ethBalance = parseFloat(ethers.formatEther(balance));
  
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas;
  const gasPriceGwei = parseFloat(ethers.formatUnits(maxFeePerGas, 'gwei'));
  
  const estimatedGasUnits = 500000n;
  const estimatedGasCostWei = estimatedGasUnits * maxFeePerGas;
  const estimatedGasCostEth = parseFloat(ethers.formatEther(estimatedGasCostWei));
  const estimatedGasCostUsd = estimatedGasCostEth * ETH_PRICE_USD;
  
  const maxGasEth = MAX_GAS_USD / ETH_PRICE_USD;
  let cappedMaxFeePerGas;
  
  try {
    const maxGasWei = ethers.parseUnits(maxGasEth.toFixed(10), 'ether');
    cappedMaxFeePerGas = maxGasWei / estimatedGasUnits;
  } catch (e) {
    cappedMaxFeePerGas = maxFeePerGas;
  }
  
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
      await flushContract.flushEntryQueue.staticCall();
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
    
    console.log(`   Gas Limit: 500,000`);
    console.log(`   Max Fee: ${ethers.formatUnits(balanceInfo.finalMaxFeePerGas, 'gwei')} gwei`);
    console.log(`   Priority Fee: +15% for competitive edge`);
    
    const tx = await flushContract.flushEntryQueue({
      gasLimit: 500000,
      maxFeePerGas: balanceInfo.finalMaxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas
    });
    
    console.log(`\n   📤 Transaction Hash: ${tx.hash}`);
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
      console.log(`   Cost: ${actualCostEth.toFixed(6)} ETH ($${actualCostUsd.toFixed(2)})`);
      console.log('─────────────────────────────────────────────────\n');
      
      const myRewards = await flushContract.rewardsOf(wallet.address);
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
    console.log(`\n❌ Error: ${error.message}\n`);
    
    if (error.message.includes('insufficient funds')) {
      console.log('⚠️  Not enough ETH for gas fees!\n');
    } else if (error.message.includes('nonce')) {
      console.log('⚠️  Transaction nonce issue - might be pending\n');
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
  console.log(`   Data Source: ${epoch.usingRollup ? '🔗 Rollup Contract' : '🧮 Calculation'}`);
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
  console.log(`   Within Budget: ${balance.gasWithinBudget ? '✅ Yes' : '❌ No (too expensive)'}`);
  console.log('─────────────────────────────────────────────────');
  
  try {
    const poolRewards = await flushContract.rewardsAvailable();
    const poolAztec = parseFloat(ethers.formatEther(poolRewards));
    console.log('\n🏆 REWARD POOL:');
    console.log('─────────────────────────────────────────────────');
    console.log(`   Available: ${poolAztec.toFixed(2)} AZTEC`);
    console.log('─────────────────────────────────────────────────');
  } catch (error) {
    // Ignore
  }
  
  console.log('\n🎯 DECISION:');
  console.log('─────────────────────────────────────────────────');
  
  if (balance.isEmpty) {
    console.log('   ❌ Cannot flush - No ETH balance!');
    console.log(`   💡 Add ETH to: ${wallet.address}`);
  } else if (!balance.gasWithinBudget) {
    console.log(`   ⏸️  Waiting - Gas too expensive ($${balance.estimatedCostUsd.toFixed(2)})`);
    console.log('   💡 Will retry when gas drops');
  } else if (epoch.isEpochStart) {
    console.log('   🚀 NEW EPOCH DETECTED - Attempting flush!');
  } else {
    console.log(`   ⏳ Waiting for next epoch (${formatDuration(epoch.secondsUntilNext)})`);
  }
  console.log('─────────────────────────────────────────────────\n');
  
  return { epoch, balance };
}

// ════════════════════════════════════════════════════════════
// MAIN LOOP WITH SMART INTERVALS
// ════════════════════════════════════════════════════════════

let lastFlushEpoch = -1;
let flushCount = 0;

async function mainLoop() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('      🤖 AZTEC FLUSH BOT - SMART INTERVAL VERSION');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📍 Wallet: ${wallet.address}`);
  console.log(`📍 Flush Contract: ${FLUSH_REWARDER_ADDRESS}`);
  console.log(`📍 Rollup Contract: ${ROLLUP_ADDRESS}`);
  console.log(`⏰ Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  console.log(`🧠 Smart Intervals: 3s→5s→10s→30s (adaptive)`);
  console.log(`💵 Max Gas Budget: $${MAX_GAS_USD} per transaction`);
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
          console.log(`   Total Successful Flushes: ${flushCount}`);
          console.log(`   Total Rewards Earned: ${flushCount * 100} AZTEC`);
          console.log('─────────────────────────────────────────────────\n');
        }
      }
      
      // Calculate smart interval based on time until next epoch
      const smartInterval = getSmartInterval(epoch.secondsUntilNext);
      
      console.log(`🧠 Next check in: ${smartInterval}s (${epoch.secondsUntilNext}s until epoch)\n`);
      console.log('═'.repeat(55) + '\n');
      
      await new Promise(resolve => setTimeout(resolve, smartInterval * 1000));
      
    } catch (error) {
      console.error('\n💥 Error in main loop:', error.message);
      console.log('⏳ Retrying in 30 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

mainLoop().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
