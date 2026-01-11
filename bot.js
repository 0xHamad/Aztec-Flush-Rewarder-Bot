require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

// ════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const WS_RPC_URL = process.env.WS_RPC_URL;
const FLUSH_REWARDER_ADDRESS = process.env.FLUSH_REWARDER_ADDRESS || '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';
const ROLLUP_ADDRESS = process.env.ROLLUP_ADDRESS || '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12';

const MAX_GAS_USD = parseFloat(process.env.MAX_GAS_USD || '0.30');
const ETH_PRICE_USD = parseFloat(process.env.ETH_PRICE_USD || '3300');
const ENABLE_FLASHBOTS = process.env.ENABLE_FLASHBOTS === 'true';
const FLASHBOTS_RELAY_URL = process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net';
const SEND_TX_BEFORE_EPOCH = parseInt(process.env.SEND_TX_BEFORE_EPOCH || '25');
const AGGRESSIVE_MODE = process.env.AGGRESSIVE_MODE === 'true';

// Aztec network constants
const GENESIS_TIMESTAMP = parseInt(process.env.GENESIS_TIMESTAMP || '1704067200');
const EPOCH_DURATION_SECONDS = parseInt(process.env.EPOCH_DURATION_SECONDS || '2304');
const SLOT_DURATION_SECONDS = parseInt(process.env.SLOT_DURATION_SECONDS || '72');
const SLOTS_PER_EPOCH = 32;

// Contract ABIs
const ROLLUP_ABI = [
  'function GENESIS_TIME() external view returns (uint256)',
  'function getCurrentEpoch() external view returns (uint256)'
];

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
  console.log('📡 Using HTTP provider (slower)...');
  provider = new ethers.JsonRpcProvider(RPC_URL);
}

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const flushContract = new ethers.Contract(FLUSH_REWARDER_ADDRESS, FLUSH_REWARDER_ABI, wallet);
const rollupContract = new ethers.Contract(ROLLUP_ADDRESS, ROLLUP_ABI, provider);

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

// Predict block number from timestamp
function predictBlockNumber(currentBlock, currentTimestamp, targetTimestamp) {
  const timeDiff = targetTimestamp - currentTimestamp;
  const blocksInFuture = Math.floor(timeDiff / 12); // ~12 sec per block
  return currentBlock + blocksInFuture;
}

// ════════════════════════════════════════════════════════════
// REAL-TIME EPOCH CALCULATION (FROM ROLLUP CONTRACT)
// ════════════════════════════════════════════════════════════

async function getRealTimeEpochInfo() {
  try {
    // Get data from Rollup contract
    const [genesisTime, currentEpoch] = await Promise.all([
      rollupContract.GENESIS_TIME(),
      rollupContract.getCurrentEpoch()
    ]);
    
    const genesis = Number(genesisTime);
    const epoch = Number(currentEpoch);
    
    // Get current block for accurate timestamp
    const block = await provider.getBlock('latest');
    const currentTimestamp = block.timestamp;
    
    // Calculate next epoch using EXACT formula:
    // next_epoch_start = genesis_time + (next_epoch × epoch_duration_secs)
    const nextEpoch = epoch + 1;
    const nextEpochStartTimestamp = genesis + (nextEpoch * EPOCH_DURATION_SECONDS);
    
    // Calculate time remaining
    const secondsUntilNext = nextEpochStartTimestamp - currentTimestamp;
    
    // Calculate current progress
    const timeInCurrentEpoch = currentTimestamp - (genesis + (epoch * EPOCH_DURATION_SECONDS));
    const currentSlot = Math.floor(timeInCurrentEpoch / SLOT_DURATION_SECONDS);
    const epochProgress = (timeInCurrentEpoch / EPOCH_DURATION_SECONDS) * 100;
    
    return {
      genesisTime: genesis,
      currentEpoch: epoch,
      nextEpoch: nextEpoch,
      currentTimestamp,
      nextEpochStartTimestamp,
      secondsUntilNext,
      currentSlot,
      epochProgress,
      blockNumber: block.number,
      isEpochStart: currentSlot <= 2
    };
    
  } catch (error) {
    console.error('❌ Error fetching epoch data:', error.message);
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
// FLASHBOTS BUNDLE SENDING
// ════════════════════════════════════════════════════════════

async function sendFlashbotsBundle(targetBlockNumber, maxFeePerGas) {
  try {
    // Initialize Flashbots provider
    if (!flashbotsProvider) {
      flashbotsProvider = await FlashbotsBundleProvider.create(
        provider,
        wallet,
        FLASHBOTS_RELAY_URL
      );
      console.log('✅ Flashbots provider initialized');
    }

    // Add 15% buffer for competitiveness
    const boostedMaxFee = (maxFeePerGas * 115n) / 100n;
    const maxPriorityFeePerGas = ethers.parseUnits('3', 'gwei');

    // Create transaction
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

    console.log('✅ Bundle submitted to Flashbots relay');

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
// DIRECT TRANSACTION (FALLBACK)
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
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('✅ Direct transaction confirmed!');
      
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      console.log(`   Gas spent: ${ethers.formatEther(gasUsed)} ETH`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.log('❌ Direct transaction failed:', error.message);
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// MAIN FLUSH LOGIC WITH PRECISE TIMING
// ════════════════════════════════════════════════════════════

let lastFlushedEpoch = -1;

async function attemptFlushWithPreciseTiming() {
  try {
    console.log('\n' + '═'.repeat(60));
    console.log('🚀 FLUSH ATTEMPT - PRECISE EPOCH TIMING');
    console.log('═'.repeat(60) + '\n');

    // Get real-time epoch data from Rollup contract
    const epochData = await getRealTimeEpochInfo();
    
    console.log('📊 EPOCH DATA (from Rollup contract):');
    console.log(`   Genesis Time: ${epochData.genesisTime} (${getLocalTime(epochData.genesisTime)})`);
    console.log(`   Current Epoch: #${epochData.currentEpoch}`);
    console.log(`   Next Epoch: #${epochData.nextEpoch}`);
    console.log(`   Current Slot: ${epochData.currentSlot}/${SLOTS_PER_EPOCH}`);
    console.log(`   Progress: ${epochData.epochProgress.toFixed(2)}%`);
    console.log(`   Time until next: ${formatDuration(epochData.secondsUntilNext)}`);
    console.log(`   Next epoch at: ${getLocalTime(epochData.nextEpochStartTimestamp)}`);
    
    // Skip if already flushed this epoch
    if (epochData.currentEpoch === lastFlushedEpoch) {
      console.log('\n⏭️  Already flushed this epoch, waiting for next...\n');
      return false;
    }

    // Check gas price
    const gasData = await checkGasPrice();
    console.log(`\n⛽ GAS: ${gasData.gasPriceGwei.toFixed(2)} gwei ($${gasData.estimatedCostUsd.toFixed(2)})`);
    
    if (!gasData.gasWithinBudget) {
      console.log(`❌ Gas too expensive (max: $${MAX_GAS_USD})\n`);
      return false;
    }

    // Calculate when to send transaction
    const sendTxAt = epochData.nextEpochStartTimestamp - SEND_TX_BEFORE_EPOCH;
    const currentTime = Math.floor(Date.now() / 1000);
    const waitTime = sendTxAt - currentTime;

    if (waitTime > 5) {
      console.log(`\n⏰ Waiting ${waitTime}s to send transaction...`);
      console.log(`   Will send at: ${getLocalTime(sendTxAt)}\n`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    }

    // Predict target block
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = predictBlockNumber(
      currentBlock,
      currentTime,
      epochData.nextEpochStartTimestamp
    );

    console.log(`\n🎯 TIMING:`);
    console.log(`   Current block: ${currentBlock}`);
    console.log(`   Target block: ${targetBlock}`);
    console.log(`   Blocks ahead: ${targetBlock - currentBlock}`);

    let success = false;

    // Try Flashbots if enabled
    if (ENABLE_FLASHBOTS) {
      console.log(`\n⚡ Attempting Flashbots (${AGGRESSIVE_MODE ? '3 attempts' : '1 attempt'})...`);
      
      const attempts = AGGRESSIVE_MODE ? 3 : 1;
      for (let i = 0; i < attempts; i++) {
        if (i > 0) {
          console.log(`\n   Attempt ${i + 1}/${attempts}...`);
          await new Promise(r => setTimeout(r, 2000));
        }
        
        success = await sendFlashbotsBundle(targetBlock + i, gasData.maxFeePerGas);
        if (success) break;
      }
    }

    // Fallback to direct transaction
    if (!success) {
      console.log('\n⚡ Flashbots failed, trying direct transaction...');
      success = await sendDirectTransaction(gasData.maxFeePerGas);
    }

    if (success) {
      lastFlushedEpoch = epochData.nextEpoch;
      
      // Check rewards
      const rewards = await flushContract.rewardsOf(wallet.address);
      console.log(`\n💎 Total rewards: ${ethers.formatEther(rewards)} AZTEC\n`);
    }

    return success;

  } catch (error) {
    console.error('\n❌ Error:', error.message, '\n');
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// REAL-TIME EPOCH MONITORING WITH WEBSOCKET
// ════════════════════════════════════════════════════════════

async function monitorEpochsRealTime() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║   AZTEC FLUSH BOT - REAL-TIME EPOCH MONITORING     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');
  console.log(`📍 Wallet: ${wallet.address}`);
  console.log(`⚡ Flashbots: ${ENABLE_FLASHBOTS ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🔌 WebSocket: ${WS_RPC_URL ? 'ENABLED (0.001s response)' : 'HTTP ONLY'}`);
  console.log(`💰 Max Gas: $${MAX_GAS_USD}`);
  console.log(`⏰ Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  console.log('\n' + '═'.repeat(60) + '\n');

  // If WebSocket available, listen to new blocks for instant detection
  if (wsProvider) {
    console.log('🔔 Listening for new blocks (real-time)...\n');
    
    wsProvider.on('block', async (blockNumber) => {
      const epochData = await getRealTimeEpochInfo();
      
      // Check if we're close to epoch start
      if (epochData.secondsUntilNext <= SEND_TX_BEFORE_EPOCH + 5) {
        console.log(`\n⚡ EPOCH APPROACHING! ${epochData.secondsUntilNext}s remaining`);
        await attemptFlushWithPreciseTiming();
      }
    });
  } else {
    // Fallback to polling
    console.log('📡 Polling mode (slower without WebSocket)\n');
    
    while (true) {
      const epochData = await getRealTimeEpochInfo();
      
      if (epochData.secondsUntilNext <= SEND_TX_BEFORE_EPOCH + 10) {
        await attemptFlushWithPreciseTiming();
      }
      
      // Smart interval
      const interval = epochData.secondsUntilNext > 60 ? 30 : 5;
      await new Promise(r => setTimeout(r, interval * 1000));
    }
  }
}

// ════════════════════════════════════════════════════════════
// START BOT
// ════════════════════════════════════════════════════════════

monitorEpochsRealTime().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  if (wsProvider) wsProvider.destroy();
  process.exit(0);
});
