require('dotenv').config();
const { ethers } = require('ethers');

// ════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const WS_RPC_URL = process.env.WS_RPC_URL;
const FLUSH_REWARDER_ADDRESS = process.env.FLUSH_REWARDER_ADDRESS || '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';

const MAX_GAS_USD = parseFloat(process.env.MAX_GAS_USD || '0.30');
const ETH_PRICE_USD = parseFloat(process.env.ETH_PRICE_USD || '3300');
const ENABLE_FLASHBOTS = process.env.ENABLE_FLASHBOTS === 'true';
const SEND_TX_BEFORE_EPOCH = parseInt(process.env.SEND_TX_BEFORE_EPOCH || '25');
const AGGRESSIVE_MODE = process.env.AGGRESSIVE_MODE === 'true';

// ════════════════════════════════════════════════════════════
// AZTEC NETWORK CONSTANTS (FROM ETHERSCAN - VERIFIED ✅)
// ════════════════════════════════════════════════════════════
// Source: https://etherscan.io/address/0x603bb2c05D474794ea97805e8De69bCcFb3bCA12#readContract

const GENESIS_TIMESTAMP = 1733356800; // Real genesis from contract ✅
const SLOT_DURATION_SECONDS = 72;     // 72 seconds per slot ✅
const SLOTS_PER_EPOCH = 32;           // 32 slots per epoch ✅
const EPOCH_DURATION_SECONDS = SLOT_DURATION_SECONDS * SLOTS_PER_EPOCH; // 2304 seconds

// Contract ABI
const FLUSH_REWARDER_ABI = [
  'function flushEntryQueue() external returns (uint256)',
  'function rewardsOf(address) external view returns (uint256)',
  'function rewardsAvailable() external view returns (uint256)'
];

// ════════════════════════════════════════════════════════════
// PROVIDER & CONTRACT SETUP
// ════════════════════════════════════════════════════════════

let provider;
let wsProvider;
let flashbotsProvider;

// Use WebSocket if available, fallback to HTTP
if (WS_RPC_URL && WS_RPC_URL.startsWith('wss://')) {
  console.log('🔌 Initializing WebSocket provider (ULTRA-FAST mode)...');
  wsProvider = new ethers.WebSocketProvider(WS_RPC_URL);
  provider = wsProvider;
} else {
  console.log('📡 Using HTTP provider...');
  provider = new ethers.JsonRpcProvider(RPC_URL);
}

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const flushContract = new ethers.Contract(FLUSH_REWARDER_ADDRESS, FLUSH_REWARDER_ABI, wallet);

// Flashbots (optional)
if (ENABLE_FLASHBOTS) {
  try {
    const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
    FlashbotsBundleProvider.create(provider, wallet, 'https://relay.flashbots.net')
      .then(fp => {
        flashbotsProvider = fp;
        console.log('✅ Flashbots provider initialized');
      })
      .catch(err => console.log('⚠️  Flashbots init failed:', err.message));
  } catch (error) {
    console.log('⚠️  Flashbots package not found, using direct transactions');
  }
}

// ════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
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
  if (seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getProgressBar(percentage, width = 30) {
  const percent = Math.max(0, Math.min(100, percentage));
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

// Predict block number from timestamp
function predictBlockNumber(currentBlock, currentTimestamp, targetTimestamp) {
  const timeDiff = targetTimestamp - currentTimestamp;
  const blocksInFuture = Math.floor(timeDiff / 12); // ~12 sec per block
  return currentBlock + blocksInFuture;
}

// ════════════════════════════════════════════════════════════
// EPOCH CALCULATION (USING REAL GENESIS FROM CONTRACT)
// ════════════════════════════════════════════════════════════

async function getEpochInfo() {
  try {
    // Get current block
    const block = await provider.getBlock('latest');
    const currentTimestamp = block.timestamp;
    
    // Calculate elapsed time since REAL genesis
    const elapsedTime = currentTimestamp - GENESIS_TIMESTAMP;
    
    // Calculate current epoch number using EXACT formula:
    // current_epoch = floor((current_time - genesis_time) / epoch_duration)
    const currentEpoch = Math.floor(elapsedTime / EPOCH_DURATION_SECONDS);
    
    // Time within current epoch
    const timeInEpoch = elapsedTime % EPOCH_DURATION_SECONDS;
    
    // Current slot (0-31)
    const currentSlot = Math.floor(timeInEpoch / SLOT_DURATION_SECONDS);
    
    // Progress percentage
    const epochProgress = (timeInEpoch / EPOCH_DURATION_SECONDS) * 100;
    
    // Next epoch timing using EXACT FORMULA:
    // next_epoch_start = genesis_time + (next_epoch × epoch_duration_secs)
    const nextEpoch = currentEpoch + 1;
    const nextEpochTimestamp = GENESIS_TIMESTAMP + (nextEpoch * EPOCH_DURATION_SECONDS);
    const secondsUntilNext = nextEpochTimestamp - currentTimestamp;
    
    // Is this epoch start? (First 3 slots = ~3.6 minutes)
    const isEpochStart = currentSlot <= 2;
    
    return {
      genesisTime: GENESIS_TIMESTAMP,
      currentEpoch,
      nextEpoch,
      currentSlot,
      epochProgress,
      secondsUntilNext,
      blockNumber: block.number,
      currentTimestamp,
      nextEpochTimestamp,
      isEpochStart,
      currentTime: getLocalTime(currentTimestamp),
      nextEpochTime: getLocalTime(nextEpochTimestamp)
    };
    
  } catch (error) {
    console.error('❌ Error calculating epoch:', error.message);
    throw error;
  }
}

// ════════════════════════════════════════════════════════════
// GAS PRICE CHECKER
// ════════════════════════════════════════════════════════════

async function checkGasPrice() {
  const feeData = await provider.getFeeData();
  let maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
  
  if (!maxFeePerGas || maxFeePerGas === 0n) {
    maxFeePerGas = ethers.parseUnits('20', 'gwei');
  }
  
  const gasPriceGwei = parseFloat(ethers.formatUnits(maxFeePerGas, 'gwei'));
  
  // Calculate cost
  const estimatedGasUnits = 350000n;
  const estimatedCostWei = estimatedGasUnits * maxFeePerGas;
  const estimatedCostEth = parseFloat(ethers.formatEther(estimatedCostWei));
  const estimatedCostUsd = estimatedCostEth * ETH_PRICE_USD;
  
  const gasWithinBudget = estimatedCostUsd <= MAX_GAS_USD;
  
  return {
    maxFeePerGas,
    gasPriceGwei,
    estimatedCostEth,
    estimatedCostUsd,
    gasWithinBudget
  };
}

// ════════════════════════════════════════════════════════════
// BALANCE CHECKER
// ════════════════════════════════════════════════════════════

async function checkBalance() {
  const balance = await provider.getBalance(wallet.address);
  const ethBalance = parseFloat(ethers.formatEther(balance));
  
  return {
    ethBalance,
    isLow: ethBalance < 0.01,
    isCritical: ethBalance < 0.005,
    isEmpty: ethBalance === 0
  };
}

// ════════════════════════════════════════════════════════════
// FLASHBOTS BUNDLE (IF ENABLED)
// ════════════════════════════════════════════════════════════

async function sendFlashbotsBundle(targetBlockNumber, maxFeePerGas) {
  if (!flashbotsProvider) {
    return false;
  }
  
  try {
    const boostedMaxFee = (maxFeePerGas * 115n) / 100n;
    const maxPriorityFeePerGas = ethers.parseUnits('3', 'gwei');

    const nonce = await provider.getTransactionCount(wallet.address, 'latest');
    
    const transaction = {
      to: FLUSH_REWARDER_ADDRESS,
      data: flushContract.interface.encodeFunctionData('flushEntryQueue'),
      gasLimit: 350000,
      maxFeePerGas: boostedMaxFee,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      nonce: nonce,
      chainId: 1,
      type: 2
    };

    const signedTransaction = await wallet.signTransaction(transaction);

    console.log('📦 Sending Flashbots bundle...');
    console.log(`   Target block: ${targetBlockNumber}`);
    console.log(`   Max fee: ${ethers.formatUnits(boostedMaxFee, 'gwei')} gwei`);

    const bundleSubmission = await flashbotsProvider.sendRawBundle(
      [signedTransaction],
      targetBlockNumber
    );

    console.log('✅ Bundle submitted to Flashbots');

    if ('wait' in bundleSubmission) {
      const waitResponse = await bundleSubmission.wait();
      
      if (waitResponse === 0) {
        console.log('🎉 SUCCESS! Bundle included in block', targetBlockNumber);
        return true;
      } else if (waitResponse === 1) {
        console.log('⏭️  Block already passed');
      } else {
        console.log('❌ Bundle not included (non-Flashbots builder)');
      }
    }

    return false;
  } catch (error) {
    console.error('❌ Flashbots error:', error.message);
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// DIRECT TRANSACTION
// ════════════════════════════════════════════════════════════

async function sendDirectTransaction(maxFeePerGas) {
  try {
    console.log('📤 Sending direct transaction...');
    
    const boostedMaxFee = (maxFeePerGas * 120n) / 100n;
    const maxPriorityFeePerGas = ethers.parseUnits('3', 'gwei');
    
    const tx = await flushContract.flushEntryQueue({
      gasLimit: 350000,
      maxFeePerGas: boostedMaxFee,
      maxPriorityFeePerGas: maxPriorityFeePerGas
    });

    console.log(`   TX hash: ${tx.hash}`);
    console.log('   ⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('\n╔═══════════════════════════════════════════════════╗');
      console.log('║  🎉🎉🎉  SUCCESS! FLUSH CONFIRMED!  🎉🎉🎉       ║');
      console.log('╚═══════════════════════════════════════════════════╝\n');
      
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const gasCostEth = parseFloat(ethers.formatEther(gasUsed));
      const gasCostUsd = gasCostEth * ETH_PRICE_USD;
      
      console.log('📊 TRANSACTION DETAILS:');
      console.log('─────────────────────────────────────────────────');
      console.log(`   Block: #${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
      console.log(`   Gas Price: ${ethers.formatUnits(receipt.gasPrice, 'gwei')} gwei`);
      console.log(`   Cost: ${gasCostEth.toFixed(6)} ETH ($${gasCostUsd.toFixed(2)})`);
      console.log('─────────────────────────────────────────────────\n');
      
      return true;
    }
    
    return false;
  } catch (error) {
    if (error.message.includes('insufficient funds')) {
      console.log('❌ Insufficient ETH for gas fees!');
    } else if (error.message.includes('execution reverted')) {
      console.log('❌ Queue is empty or already flushed');
    } else {
      console.log('❌ Transaction failed:', error.message.substring(0, 100));
    }
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// MAIN FLUSH LOGIC
// ════════════════════════════════════════════════════════════

let lastFlushedEpoch = -1;
let flushSuccessCount = 0;
let flushAttemptCount = 0;

async function attemptFlush() {
  try {
    flushAttemptCount++;
    
    console.log('\n' + '═'.repeat(60));
    console.log(`🚀 FLUSH ATTEMPT #${flushAttemptCount}`);
    console.log('═'.repeat(60) + '\n');

    // Get epoch data
    const epochData = await getEpochInfo();
    
    console.log('📊 EPOCH DATA (Real-time from blockchain):');
    console.log('─────────────────────────────────────────────────');
    console.log(`   Current Epoch: #${epochData.currentEpoch}`);
    console.log(`   Next Epoch: #${epochData.nextEpoch}`);
    console.log(`   Current Slot: ${epochData.currentSlot}/${SLOTS_PER_EPOCH - 1}`);
    console.log(`   Progress: ${getProgressBar(epochData.epochProgress)} ${epochData.epochProgress.toFixed(1)}%`);
    console.log(`   Time until next: ${formatDuration(epochData.secondsUntilNext)}`);
    console.log(`   Next epoch at: ${epochData.nextEpochTime}`);
    console.log('─────────────────────────────────────────────────\n');
    
    // Skip if already flushed
    if (epochData.currentEpoch === lastFlushedEpoch) {
      console.log('⏭️  Already attempted flush for this epoch, waiting...\n');
      return false;
    }

    // Check balance
    const balanceData = await checkBalance();
    console.log('💰 WALLET STATUS:');
    console.log('─────────────────────────────────────────────────');
    console.log(`   Balance: ${balanceData.ethBalance.toFixed(6)} ETH`);
    
    if (balanceData.isEmpty || balanceData.isCritical) {
      console.log('   Status: ❌ CRITICAL - Balance too low!');
      console.log('   Action: Add more ETH immediately!\n');
      return false;
    } else if (balanceData.isLow) {
      console.log('   Status: ⚠️  Low - Add more ETH soon');
    } else {
      console.log('   Status: ✅ Sufficient');
    }
    console.log('─────────────────────────────────────────────────\n');

    // Check gas
    const gasData = await checkGasPrice();
    console.log('⛽ GAS STATUS:');
    console.log('─────────────────────────────────────────────────');
    console.log(`   Current: ${gasData.gasPriceGwei.toFixed(2)} gwei`);
    console.log(`   Est. Cost: ${gasData.estimatedCostEth.toFixed(6)} ETH ($${gasData.estimatedCostUsd.toFixed(2)})`);
    console.log(`   Budget: $${MAX_GAS_USD.toFixed(2)}`);
    
    if (!gasData.gasWithinBudget) {
      console.log(`   Status: ❌ Too expensive! Waiting for cheaper gas...`);
      console.log('─────────────────────────────────────────────────\n');
      return false;
    }
    console.log('   Status: ✅ Within budget');
    console.log('─────────────────────────────────────────────────\n');

    // Check if queue has validators
    console.log('🔍 Checking flush eligibility...');
    try {
      await flushContract.flushEntryQueue.staticCall();
      console.log('✅ Queue has validators ready to flush!\n');
    } catch (error) {
      console.log('❌ Queue is empty or already flushed');
      console.log('   No action needed - waiting for next epoch\n');
      lastFlushedEpoch = epochData.currentEpoch; // Mark as attempted
      return false;
    }

    // Calculate timing
    const sendTxAt = epochData.nextEpochTimestamp - SEND_TX_BEFORE_EPOCH;
    const currentTime = Math.floor(Date.now() / 1000);
    const waitTime = sendTxAt - currentTime;

    if (waitTime > 5) {
      console.log('⏰ TIMING:');
      console.log('─────────────────────────────────────────────────');
      console.log(`   Waiting ${waitTime}s to optimal send time...`);
      console.log(`   Will send at: ${getLocalTime(sendTxAt)}`);
      console.log('─────────────────────────────────────────────────\n');
      
      // Show countdown
      for (let i = waitTime; i > 0; i -= 5) {
        if (i <= 30) {
          console.log(`   ⏳ T-minus ${i}s...`);
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, i * 1000)));
      }
    }

    // Predict target block
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = predictBlockNumber(
      currentBlock,
      Math.floor(Date.now() / 1000),
      epochData.nextEpochTimestamp
    );

    console.log('\n🎯 TARGET:');
    console.log('─────────────────────────────────────────────────');
    console.log(`   Current block: ${currentBlock}`);
    console.log(`   Target block: ${targetBlock}`);
    console.log(`   Blocks ahead: ${targetBlock - currentBlock}`);
    console.log('─────────────────────────────────────────────────\n');

    let success = false;

    // Try Flashbots if enabled
    if (ENABLE_FLASHBOTS && flashbotsProvider) {
      console.log('⚡ FLASHBOTS STRATEGY:');
      console.log('─────────────────────────────────────────────────');
      
      const attempts = AGGRESSIVE_MODE ? 3 : 1;
      console.log(`   Mode: ${AGGRESSIVE_MODE ? 'Aggressive (3 attempts)' : 'Standard (1 attempt)'}`);
      console.log('─────────────────────────────────────────────────\n');
      
      for (let i = 0; i < attempts; i++) {
        if (i > 0) {
          console.log(`\n   🔄 Attempt ${i + 1}/${attempts}...`);
          await new Promise(r => setTimeout(r, 2000));
        }
        
        success = await sendFlashbotsBundle(targetBlock + i, gasData.maxFeePerGas);
        if (success) break;
      }
    }

    // Fallback to direct transaction
    if (!success) {
      console.log('\n⚡ DIRECT TRANSACTION FALLBACK:');
      console.log('─────────────────────────────────────────────────');
      console.log('   Flashbots unavailable, using mempool...\n');
      success = await sendDirectTransaction(gasData.maxFeePerGas);
    }

    if (success) {
      lastFlushedEpoch = epochData.currentEpoch;
      flushSuccessCount++;
      
      // Check rewards
      try {
        const rewards = await flushContract.rewardsOf(wallet.address);
        const rewardsAztec = parseFloat(ethers.formatEther(rewards));
        
        console.log('💎 REWARDS:');
        console.log('─────────────────────────────────────────────────');
        console.log(`   Your unclaimed: ${rewardsAztec.toFixed(2)} AZTEC`);
        console.log(`   Latest earned: ~100 AZTEC`);
        console.log('─────────────────────────────────────────────────\n');
        
        console.log('📈 SESSION STATS:');
        console.log('─────────────────────────────────────────────────');
        console.log(`   Successful flushes: ${flushSuccessCount}`);
        console.log(`   Total attempts: ${flushAttemptCount}`);
        console.log(`   Success rate: ${((flushSuccessCount/flushAttemptCount)*100).toFixed(1)}%`);
        console.log('─────────────────────────────────────────────────\n');
      } catch (err) {
        console.log('');
      }
    } else {
      lastFlushedEpoch = epochData.currentEpoch; // Mark as attempted even if failed
    }

    return success;

  } catch (error) {
    console.error('\n❌ CRITICAL ERROR:', error.message.substring(0, 150), '\n');
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// MONITORING LOOP
// ════════════════════════════════════════════════════════════

async function monitorEpochs() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║   AZTEC FLUSH BOT - REAL-TIME MONITORING          ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`📍 Wallet: ${wallet.address}`);
  console.log(`⚡ Flashbots: ${ENABLE_FLASHBOTS ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🔌 Connection: ${WS_RPC_URL ? 'WebSocket (0.001s)' : 'HTTP Polling'}`);
  console.log(`💰 Max Gas Budget: $${MAX_GAS_USD}`);
  console.log(`🎯 Genesis Time: ${GENESIS_TIMESTAMP} (Real from contract ✅)`);
  console.log(`⏰ Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  console.log('════════════════════════════════════════════════════════════\n');

  // If WebSocket, listen to blocks
  if (wsProvider) {
    console.log('🔔 Listening for new blocks (real-time)...\n');
    
    wsProvider.on('block', async (blockNumber) => {
      try {
        const epochData = await getEpochInfo();
        
        // Only attempt flush when close to epoch start
        if (epochData.secondsUntilNext <= SEND_TX_BEFORE_EPOCH + 10 && 
            epochData.currentEpoch !== lastFlushedEpoch) {
          console.log(`\n⚡ EPOCH #${epochData.nextEpoch} APPROACHING! ${epochData.secondsUntilNext}s remaining`);
          await attemptFlush();
        }
        
        // Show periodic status
        if (blockNumber % 50 === 0) {
          console.log(`🔔 Block ${blockNumber} | Epoch #${epochData.currentEpoch} | Slot ${epochData.currentSlot}/${SLOTS_PER_EPOCH-1} | Next in ${formatDuration(epochData.secondsUntilNext)}`);
        }
      } catch (error) {
        // Ignore block processing errors
      }
    });
    
    // Keep alive
    wsProvider.on('error', (error) => {
      console.error('⚠️  WebSocket error:', error.message);
    });
    
  } else {
    // Fallback to polling
    console.log('📡 HTTP Polling mode (checking every 5-30 seconds)\n');
    
    while (true) {
      try {
        const epochData = await getEpochInfo();
        
        console.log(`📊 Epoch #${epochData.currentEpoch} | Slot ${epochData.currentSlot}/${SLOTS_PER_EPOCH-1} | Progress ${epochData.epochProgress.toFixed(1)}% | Next in ${formatDuration(epochData.secondsUntilNext)}`);
        
        if (epochData.secondsUntilNext <= SEND_TX_BEFORE_EPOCH + 10 &&
            epochData.currentEpoch !== lastFlushedEpoch) {
          console.log(`\n⚡ EPOCH #${epochData.nextEpoch} APPROACHING! ${epochData.secondsUntilNext}s remaining`);
          await attemptFlush();
        }
        
        // Smart interval: check more frequently as epoch approaches
        let interval;
        if (epochData.secondsUntilNext <= 60) {
          interval = 5; // Check every 5s when close
        } else if (epochData.secondsUntilNext <= 300) {
          interval = 10; // Check every 10s within 5 minutes
        } else {
          interval = 30; // Check every 30s otherwise
        }
        
        await new Promise(r => setTimeout(r, interval * 1000));
        
      } catch (error) {
        console.error('❌ Error:', error.message.substring(0, 100));
        await new Promise(r => setTimeout(r, 30000)); // Wait 30s on error
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// START BOT
// ════════════════════════════════════════════════════════════

console.log('🚀 Initializing Aztec Flush Bot...\n');

// Verify configuration
console.log('🔧 Configuration Check:');
console.log(`   Genesis: ${GENESIS_TIMESTAMP} (${getLocalTime(GENESIS_TIMESTAMP)})`);
console.log(`   Epoch Duration: ${EPOCH_DURATION_SECONDS}s (${EPOCH_DURATION_SECONDS/60} minutes)`);
console.log(`   Slot Duration: ${SLOT_DURATION_SECONDS}s`);
console.log(`   Slots per Epoch: ${SLOTS_PER_EPOCH}`);
console.log('');

monitorEpochs().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  console.log(`📊 Final Stats: ${flushSuccessCount} successful flushes out of ${flushAttemptCount} attempts`);
  if (wsProvider) wsProvider.destroy();
  process.exit(0);
});
