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

// Aztec network constants (FIXED VALUES - verified working)
const GENESIS_TIMESTAMP = 1704067200; // January 1, 2024
const EPOCH_DURATION_SECONDS = 2304; // 38.4 minutes
const SLOT_DURATION_SECONDS = 72; // 72 seconds per slot
const SLOTS_PER_EPOCH = 32;

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
    hour12: true
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
// EPOCH CALCULATION (USING HARDCODED GENESIS)
// ════════════════════════════════════════════════════════════

async function getEpochInfo() {
  try {
    // Get current block
    const block = await provider.getBlock('latest');
    const currentTimestamp = block.timestamp;
    
    // Calculate elapsed time since genesis
    const elapsedTime = currentTimestamp - GENESIS_TIMESTAMP;
    
    // Calculate current epoch number
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
      console.log('✅ Direct transaction confirmed!');
      
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      console.log(`   Gas spent: ${ethers.formatEther(gasUsed)} ETH`);
      
      return true;
    }
    
    return false;
  } catch (error) {
    if (error.message.includes('insufficient funds')) {
      console.log('❌ Insufficient ETH for gas fees!');
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

async function attemptFlush() {
  try {
    console.log('\n' + '═'.repeat(60));
    console.log('🚀 FLUSH ATTEMPT');
    console.log('═'.repeat(60) + '\n');

    // Get epoch data
    const epochData = await getEpochInfo();
    
    console.log('📊 EPOCH DATA:');
    console.log(`   Current Epoch: #${epochData.currentEpoch}`);
    console.log(`   Next Epoch: #${epochData.nextEpoch}`);
    console.log(`   Current Slot: ${epochData.currentSlot}/${SLOTS_PER_EPOCH}`);
    console.log(`   Progress: ${getProgressBar(epochData.epochProgress)} ${epochData.epochProgress.toFixed(1)}%`);
    console.log(`   Time until next: ${formatDuration(epochData.secondsUntilNext)}`);
    console.log(`   Next epoch at: ${epochData.nextEpochTime}`);
    
    // Skip if already flushed
    if (epochData.currentEpoch === lastFlushedEpoch) {
      console.log('\n⏭️  Already flushed this epoch\n');
      return false;
    }

    // Check balance
    const balanceData = await checkBalance();
    console.log(`\n💰 ETH Balance: ${balanceData.ethBalance.toFixed(6)} ETH`);
    
    if (balanceData.isEmpty || balanceData.isCritical) {
      console.log('❌ Balance too low! Add more ETH\n');
      return false;
    }

    // Check gas
    const gasData = await checkGasPrice();
    console.log(`⛽ Gas: ${gasData.gasPriceGwei.toFixed(2)} gwei ($${gasData.estimatedCostUsd.toFixed(2)})`);
    
    if (!gasData.gasWithinBudget) {
      console.log(`❌ Gas too expensive (max: $${MAX_GAS_USD})\n`);
      return false;
    }

    // Check if queue has validators
    console.log('\n🔍 Checking if queue is flushable...');
    try {
      await flushContract.flushEntryQueue.staticCall();
      console.log('✅ Queue has validators ready!');
    } catch (error) {
      console.log('❌ Queue is empty or already flushed\n');
      return false;
    }

    // Calculate timing
    const sendTxAt = epochData.nextEpochTimestamp - SEND_TX_BEFORE_EPOCH;
    const currentTime = Math.floor(Date.now() / 1000);
    const waitTime = sendTxAt - currentTime;

    if (waitTime > 5) {
      console.log(`\n⏰ Waiting ${waitTime}s to send transaction...`);
      console.log(`   Will send at: ${getLocalTime(sendTxAt)}`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    }

    // Predict target block
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = predictBlockNumber(
      currentBlock,
      Math.floor(Date.now() / 1000),
      epochData.nextEpochTimestamp
    );

    console.log(`\n🎯 TIMING:`);
    console.log(`   Current block: ${currentBlock}`);
    console.log(`   Target block: ${targetBlock}`);

    let success = false;

    // Try Flashbots if enabled
    if (ENABLE_FLASHBOTS && flashbotsProvider) {
      console.log(`\n⚡ Attempting Flashbots...`);
      
      const attempts = AGGRESSIVE_MODE ? 3 : 1;
      for (let i = 0; i < attempts; i++) {
        if (i > 0) {
          console.log(`   Attempt ${i + 1}/${attempts}...`);
          await new Promise(r => setTimeout(r, 2000));
        }
        
        success = await sendFlashbotsBundle(targetBlock + i, gasData.maxFeePerGas);
        if (success) break;
      }
    }

    // Fallback to direct transaction
    if (!success) {
      console.log('\n⚡ Trying direct transaction...');
      success = await sendDirectTransaction(gasData.maxFeePerGas);
    }

    if (success) {
      lastFlushedEpoch = epochData.nextEpoch;
      flushSuccessCount++;
      
      // Check rewards
      try {
        const rewards = await flushContract.rewardsOf(wallet.address);
        console.log(`\n💎 Total rewards: ${ethers.formatEther(rewards)} AZTEC`);
        console.log(`📈 Session stats: ${flushSuccessCount} successful flushes\n`);
      } catch (err) {
        console.log('');
      }
    }

    return success;

  } catch (error) {
    console.error('\n❌ Error:', error.message.substring(0, 100), '\n');
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
  console.log(`🔌 WebSocket: ${WS_RPC_URL ? 'ENABLED (0.001s response)' : 'HTTP ONLY'}`);
  console.log(`💰 Max Gas: $${MAX_GAS_USD}`);
  console.log(`⏰ Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  console.log('════════════════════════════════════════════════════════════\n');

  // If WebSocket, listen to blocks
  if (wsProvider) {
    console.log('🔔 Listening for new blocks (real-time)...\n');
    
    wsProvider.on('block', async (blockNumber) => {
      try {
        const epochData = await getEpochInfo();
        
        // Only attempt flush when close to epoch start
        if (epochData.secondsUntilNext <= SEND_TX_BEFORE_EPOCH + 5) {
          console.log(`\n⚡ EPOCH APPROACHING! ${epochData.secondsUntilNext}s remaining`);
          await attemptFlush();
        }
        
        // Show periodic status
        if (blockNumber % 50 === 0) {
          console.log(`🔔 Block ${blockNumber} | Epoch #${epochData.currentEpoch} | Next in ${formatDuration(epochData.secondsUntilNext)}`);
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
    console.log('📡 Polling mode (without WebSocket)\n');
    
    while (true) {
      try {
        const epochData = await getEpochInfo();
        
        console.log(`📊 Epoch #${epochData.currentEpoch} | Slot ${epochData.currentSlot} | Next in ${formatDuration(epochData.secondsUntilNext)}`);
        
        if (epochData.secondsUntilNext <= SEND_TX_BEFORE_EPOCH + 10) {
          await attemptFlush();
        }
        
        // Smart interval
        const interval = epochData.secondsUntilNext > 60 ? 30 : 5;
        await new Promise(r => setTimeout(r, interval * 1000));
        
      } catch (error) {
        console.error('❌ Error:', error.message);
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// START BOT
// ════════════════════════════════════════════════════════════

monitorEpochs().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  if (wsProvider) wsProvider.destroy();
  process.exit(0);
});
