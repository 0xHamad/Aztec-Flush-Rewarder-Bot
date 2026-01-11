require('dotenv').config();
const { ethers } = require('ethers');

const FLUSH_REWARDER = '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';
const ROLLUP = '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12';

const FLUSH_ABI = [
  'function rewardsOf(address) external view returns (uint256)',
  'function rewardsAvailable() external view returns (uint256)'
];

const ROLLUP_ABI = [
  'function GENESIS_TIME() external view returns (uint256)',
  'function getCurrentEpoch() external view returns (uint256)'
];

async function testConnection() {
  console.log('\n🔍 Testing Advanced Aztec Flush Bot Configuration...\n');
  console.log('═'.repeat(60));
  
  let errors = [];
  
  // 1. Check .env
  console.log('\n1️⃣  Checking environment variables...');
  
  if (!process.env.RPC_URL) {
    errors.push('❌ RPC_URL missing');
  } else {
    console.log('   ✅ RPC_URL found');
  }
  
  if (!process.env.PRIVATE_KEY) {
    errors.push('❌ PRIVATE_KEY missing');
  } else if (!process.env.PRIVATE_KEY.startsWith('0x') || process.env.PRIVATE_KEY.length !== 66) {
    errors.push('❌ PRIVATE_KEY invalid format');
  } else {
    console.log('   ✅ PRIVATE_KEY valid');
  }
  
  if (process.env.WS_RPC_URL && process.env.WS_RPC_URL.startsWith('wss://')) {
    console.log('   ✅ WebSocket RPC configured (ULTRA-FAST mode)');
  } else {
    console.log('   ⚠️  WebSocket not configured (slower performance)');
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Configuration errors:');
    errors.forEach(err => console.log(`   ${err}`));
    process.exit(1);
  }
  
  // 2. Test RPC
  console.log('\n2️⃣  Testing RPC connection...');
  
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();
    
    console.log(`   ✅ Connected to Ethereum Mainnet`);
    console.log(`   Block: ${blockNumber}`);
    console.log(`   Chain ID: ${network.chainId}`);
    
    if (network.chainId !== 1n) {
      console.log('   ⚠️  WARNING: Not on mainnet!');
    }
  } catch (error) {
    errors.push('❌ RPC connection failed: ' + error.message);
  }
  
  // 3. Test Wallet
  console.log('\n3️⃣  Testing wallet...');
  
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    const ethBalance = parseFloat(ethers.formatEther(balance));
    
    console.log(`   ✅ Wallet: ${wallet.address}`);
    console.log(`   ETH Balance: ${ethBalance.toFixed(6)} ETH`);
    
    if (ethBalance < 0.005) {
      console.log('   ⚠️  CRITICAL: Balance too low! Add more ETH');
    } else if (ethBalance < 0.01) {
      console.log('   ⚠️  WARNING: Balance low, add more ETH soon');
    } else {
      console.log('   ✅ Balance sufficient');
    }
  } catch (error) {
    errors.push('❌ Wallet error: ' + error.message);
  }
  
  // 4. Test Rollup Contract (Real Epoch Data)
  console.log('\n4️⃣  Testing Rollup contract (real epoch data)...');
  
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const rollup = new ethers.Contract(ROLLUP, ROLLUP_ABI, provider);
    
    const [genesisTime, currentEpoch] = await Promise.all([
      rollup.GENESIS_TIME(),
      rollup.getCurrentEpoch()
    ]);
    
    console.log(`   ✅ Rollup contract accessible`);
    console.log(`   Genesis Time: ${Number(genesisTime)}`);
    console.log(`   Current Epoch: #${Number(currentEpoch)}`);
    
    // Calculate next epoch
    const EPOCH_DURATION = 2304;
    const nextEpoch = Number(currentEpoch) + 1;
    const nextEpochStart = Number(genesisTime) + (nextEpoch * EPOCH_DURATION);
    const now = Math.floor(Date.now() / 1000);
    const timeUntilNext = nextEpochStart - now;
    
    console.log(`   Next Epoch: #${nextEpoch}`);
    console.log(`   Time until next: ${Math.floor(timeUntilNext / 60)}m ${timeUntilNext % 60}s`);
    
  } catch (error) {
    errors.push('❌ Rollup contract error: ' + error.message);
  }
  
  // 5. Test Flush Rewarder
  console.log('\n5️⃣  Testing Flush Rewarder contract...');
  
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const flush = new ethers.Contract(FLUSH_REWARDER, FLUSH_ABI, wallet);
    
    const [poolRewards, myRewards] = await Promise.all([
      flush.rewardsAvailable(),
      flush.rewardsOf(wallet.address)
    ]);
    
    console.log(`   ✅ Flush Rewarder accessible`);
    console.log(`   Pool rewards: ${ethers.formatEther(poolRewards)} AZTEC`);
    console.log(`   Your rewards: ${ethers.formatEther(myRewards)} AZTEC`);
    
  } catch (error) {
    errors.push('❌ Flush Rewarder error: ' + error.message);
  }
  
  // 6. Test Gas Prices
  console.log('\n6️⃣  Checking gas prices...');
  
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const feeData = await provider.getFeeData();
    const gasPriceGwei = parseFloat(ethers.formatUnits(feeData.maxFeePerGas || feeData.gasPrice, 'gwei'));
    
    const estimatedCost = 350000n * (feeData.maxFeePerGas || feeData.gasPrice);
    const costInEth = parseFloat(ethers.formatEther(estimatedCost));
    const costInUsd = costInEth * 3300;
    
    console.log(`   Current gas: ${gasPriceGwei.toFixed(2)} gwei`);
    console.log(`   Estimated flush cost: ${costInEth.toFixed(6)} ETH (~${costInUsd.toFixed(2)})`);
    
    const maxBudget = parseFloat(process.env.MAX_GAS_USD || '0.30');
    if (costInUsd <= maxBudget) {
      console.log(`   ✅ Within budget (${maxBudget})`);
    } else {
      console.log(`   ⚠️  Above budget (max: ${maxBudget})`);
    }
    
  } catch (error) {
    console.log('   ⚠️  Could not fetch gas prices');
  }
  
  // 7. Test Flashbots (if enabled)
  console.log('\n7️⃣  Checking Flashbots configuration...');
  
  const flashbotsEnabled = process.env.ENABLE_FLASHBOTS === 'true';
  if (flashbotsEnabled) {
    console.log('   ✅ Flashbots ENABLED');
    console.log(`   Relay: ${process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net'}`);
    console.log('   Note: Flashbots requires @flashbots/ethers-provider-bundle package');
    
    try {
      require('@flashbots/ethers-provider-bundle');
      console.log('   ✅ Flashbots package installed');
    } catch (error) {
      console.log('   ❌ Flashbots package NOT installed!');
      console.log('   Run: npm install @flashbots/ethers-provider-bundle');
    }
  } else {
    console.log('   ⚠️  Flashbots DISABLED (using direct transactions)');
  }
  
  // Final Summary
  console.log('\n' + '═'.repeat(60));
  
  if (errors.length > 0) {
    console.log('\n❌ TEST FAILED! Fix these errors:\n');
    errors.forEach(err => console.log(`   ${err}`));
    console.log('\n');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED! Bot is ready.\n');
    console.log('🚀 Features enabled:');
    console.log(`   • Real-time epoch tracking from Rollup contract`);
    console.log(`   • Precise timing formula: genesis_time + (epoch × 2304)`);
    console.log(`   • ${process.env.WS_RPC_URL ? 'WebSocket (0.001s response)' : 'HTTP polling'}`);
    console.log(`   • ${flashbotsEnabled ? 'Flashbots MEV protection' : 'Direct transactions'}`);
    console.log(`   • Max gas budget: ${process.env.MAX_GAS_USD || '0.30'}`);
    console.log(`   • Send TX ${process.env.SEND_TX_BEFORE_EPOCH || '25'}s before epoch\n`);
    
    console.log('📊 Expected behavior:');
    console.log('   • Bot monitors epochs in real-time');
    console.log('   • Automatically calculates next epoch start');
    console.log('   • Sends transaction precisely before epoch boundary');
    console.log('   • Uses Flashbots for block targeting (if enabled)');
    console.log('   • Falls back to direct transaction if Flashbots fails\n');
    
    console.log('▶️  Start bot: npm start\n');
  }
}

testConnection().catch(error => {
  console.error('\n💥 Fatal error:', error.message);
  process.exit(1);
});
