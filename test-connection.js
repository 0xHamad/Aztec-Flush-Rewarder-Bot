// Test Connection Script
// Run this before starting the bot to verify everything is configured correctly

require('dotenv').config();
const { ethers } = require('ethers');

const FLUSH_REWARDER = '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';
const ROLLUP = '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12';

const FLUSH_REWARDER_ABI = [
    'function rewardsOf(address account) external view returns (uint256)',
    'function rewardsAvailable() external view returns (uint256)',
    'function rewardPerInsertion() external view returns (uint256)'
];

async function testConnection() {
    console.log('🔍 Testing Aztec Flush Bot Configuration...\n');
    console.log('━'.repeat(60));
    
    let errors = [];
    
    // 1. Check Environment Variables
    console.log('\n1️⃣  Checking environment variables...');
    
    if (!process.env.RPC_URL) {
        errors.push('❌ RPC_URL not found in .env file');
    } else {
        console.log('   ✅ RPC_URL found');
    }
    
    if (!process.env.PRIVATE_KEY) {
        errors.push('❌ PRIVATE_KEY not found in .env file');
    } else if (!process.env.PRIVATE_KEY.startsWith('0x')) {
        errors.push('❌ PRIVATE_KEY must start with 0x');
    } else if (process.env.PRIVATE_KEY.length !== 66) {
        errors.push('❌ PRIVATE_KEY must be 66 characters (including 0x)');
    } else {
        console.log('   ✅ PRIVATE_KEY format valid');
    }
    
    if (errors.length > 0) {
        console.log('\n❌ Configuration errors found:');
        errors.forEach(err => console.log(`   ${err}`));
        console.log('\n💡 Fix these errors in your .env file and try again.\n');
        process.exit(1);
    }
    
    // 2. Test RPC Connection
    console.log('\n2️⃣  Testing RPC connection...');
    
    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const blockNumber = await provider.getBlockNumber();
        console.log(`   ✅ Connected to Ethereum`);
        console.log(`   Current block: ${blockNumber}`);
        
        const network = await provider.getNetwork();
        console.log(`   Chain ID: ${network.chainId}`);
        
        if (network.chainId !== 1n) {
            console.log('   ⚠️  Warning: Not connected to Ethereum Mainnet!');
            console.log('   Make sure you are using mainnet RPC URL');
        }
    } catch (error) {
        errors.push('❌ Cannot connect to RPC: ' + error.message);
    }
    
    // 3. Test Wallet
    console.log('\n3️⃣  Testing wallet...');
    
    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        
        console.log(`   ✅ Wallet address: ${wallet.address}`);
        
        const balance = await provider.getBalance(wallet.address);
        const ethBalance = ethers.formatEther(balance);
        console.log(`   ETH Balance: ${ethBalance} ETH`);
        
        if (parseFloat(ethBalance) < 0.005) {
            console.log('   ⚠️  Warning: Low ETH balance! Add at least 0.01 ETH for gas fees.');
        } else if (parseFloat(ethBalance) < 0.01) {
            console.log('   ⚠️  Recommended: Add more ETH for sustained operation (0.05 ETH)');
        } else {
            console.log('   ✅ ETH balance sufficient for operations');
        }
    } catch (error) {
        errors.push('❌ Wallet error: ' + error.message);
    }
    
    // 4. Test Contract Connection
    console.log('\n4️⃣  Testing contract connections...');
    
    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const flushContract = new ethers.Contract(FLUSH_REWARDER, FLUSH_REWARDER_ABI, wallet);
        
        const availableRewards = await flushContract.rewardsAvailable();
        console.log(`   ✅ Flush Rewarder contract accessible`);
        console.log(`   Reward pool: ${ethers.formatEther(availableRewards)} AZTEC`);
        
        const pendingRewards = await flushContract.rewardsOf(wallet.address);
        console.log(`   Your pending rewards: ${ethers.formatEther(pendingRewards)} AZTEC`);
        
        const rewardRate = await flushContract.rewardPerInsertion();
        console.log(`   Reward per insertion: ${ethers.formatEther(rewardRate)} AZTEC`);
        
    } catch (error) {
        errors.push('❌ Contract connection error: ' + error.message);
    }
    
    // 5. Test Gas Prices
    console.log('\n5️⃣  Checking current gas prices...');
    
    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const feeData = await provider.getFeeData();
        
        const gasPriceGwei = ethers.formatUnits(feeData.gasPrice, 'gwei');
        console.log(`   Current gas price: ${parseFloat(gasPriceGwei).toFixed(2)} Gwei`);
        
        const estimatedCost = 200000n * feeData.gasPrice; // Estimated gas for flush
        const costInEth = ethers.formatEther(estimatedCost);
        const costInUsd = parseFloat(costInEth) * 3300; // Rough ETH price
        
        console.log(`   Estimated flush cost: ${parseFloat(costInEth).toFixed(6)} ETH (~$${costInUsd.toFixed(2)})`);
        
        if (parseFloat(gasPriceGwei) > 12) {
            console.log('   ⚠️  Gas currently high! Bot will wait for lower gas.');
        } else {
            console.log('   ✅ Gas price acceptable for operations');
        }
        
    } catch (error) {
        console.log('   ⚠️  Could not fetch gas prices');
    }
    
    // Final Summary
    console.log('\n━'.repeat(60));
    
    if (errors.length > 0) {
        console.log('\n❌ Test Failed! Fix the following errors:\n');
        errors.forEach(err => console.log(`   ${err}`));
        console.log('\n');
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed! Your bot is ready to run.\n');
        console.log('🚀 Start the bot with: npm start\n');
        console.log('📊 Expected behavior:');
        console.log('   • Bot will monitor epochs every 15 seconds');
        console.log('   • At 95% epoch completion, switches to 0.2s checks');
        console.log('   • Automatically flushes when validators are available');
        console.log('   • Auto-claims rewards when ≥ 100 AZTEC earned');
        console.log('   • Only operates when gas is 4-12 Gwei\n');
    }
}

testConnection().catch(error => {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
});
