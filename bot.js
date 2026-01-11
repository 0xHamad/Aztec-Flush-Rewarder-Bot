require("dotenv").config();
const { ethers } = require("ethers");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");

/* ================= CONFIG ================= */

const CONFIG = {
  RPC_URL: process.env.RPC_URL,
  PRIVATE_KEY: process.env.PRIVATE_KEY,

  FLUSH_REWARDER: "0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65",
  ROLLUP: "0x603bb2c05D474794ea97805e8De69bCcFb3bCA12",

  GAS_LIMIT: 200_000,
  CHECK_INTERVAL: 1000, // 1s
  FLASHBOTS_BLOCKS_AHEAD: 3
};

/* ================= ABIs ================= */

const FLUSH_ABI = [
  "function flushEntryQueue() external",
  "function rewardsOf(address) view returns (uint256)",
  "function claimRewards() external"
];

const ROLLUP_ABI = [
  "function getCurrentEpoch() view returns (uint256)"
];

/* ================= BOT ================= */

class AztecFlushBot {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.flashbots = null;

    this.flush = null;
    this.rollup = null;

    this.lastEpoch = null;
    this.processing = false;

    this.stats = {
      detected: 0,
      submitted: 0,
      included: 0,
      failed: 0
    };
  }

  async init() {
    console.log("🚀 AZTEC FLUSH BOT (ON-CHAIN EPOCH MODE)");
    console.log("=".repeat(55));

    if (!CONFIG.RPC_URL || !CONFIG.PRIVATE_KEY) {
      throw new Error("RPC_URL or PRIVATE_KEY missing");
    }

    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);

    this.flashbots = await FlashbotsBundleProvider.create(
      this.provider,
      this.wallet,
      "https://relay.flashbots.net",
      "mainnet"
    );

    this.flush = new ethers.Contract(
      CONFIG.FLUSH_REWARDER,
      FLUSH_ABI,
      this.wallet
    );

    this.rollup = new ethers.Contract(
      CONFIG.ROLLUP,
      ROLLUP_ABI,
      this.provider
    );

    this.lastEpoch = Number(await this.rollup.getCurrentEpoch());

    console.log("Wallet:", this.wallet.address);
    console.log("Starting Epoch:", this.lastEpoch);
    console.log("=".repeat(55));
  }

  async run() {
    while (true) {
      try {
        const currentEpoch = Number(await this.rollup.getCurrentEpoch());

        if (currentEpoch > this.lastEpoch && !this.processing) {
          this.processing = true;
          this.stats.detected++;

          console.log(`\n🔥 NEW EPOCH DETECTED → ${currentEpoch}`);

          await this.executeFlush(currentEpoch);

          this.lastEpoch = currentEpoch;
          this.processing = false;
        }

        process.stdout.write(
          `\r[${new Date().toLocaleTimeString()}] Epoch ${currentEpoch} | Detected ${this.stats.detected} | Included ${this.stats.included}/${this.stats.submitted}`
        );

        await this.sleep(CONFIG.CHECK_INTERVAL);
      } catch (err) {
        console.error("\n❌ Loop error:", err.message);
        await this.sleep(3000);
      }
    }
  }

  async executeFlush(epoch) {
    try {
      const block = await this.provider.getBlock("latest");
      const targetBlock = block.number + 1;

      const tx = await this.flush.flushEntryQueue.populateTransaction();

      const bundle = await this.flashbots.signBundle([
        {
          signer: this.wallet,
          transaction: {
            to: CONFIG.FLUSH_REWARDER,
            data: tx.data,
            gasLimit: CONFIG.GAS_LIMIT,
            maxFeePerGas: ethers.parseUnits("50", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
            type: 2,
            chainId: 1
          }
        }
      ]);

      for (let i = 0; i < CONFIG.FLASHBOTS_BLOCKS_AHEAD; i++) {
        await this.flashbots.sendRawBundle(bundle, targetBlock + i);
        this.stats.submitted++;
      }

      console.log(`📦 Bundle sent for blocks ${targetBlock} → ${targetBlock + 2}`);

      const result = await this.flashbots.sendRawBundle(bundle, targetBlock);
      const res = await result.wait();

      if (res === 0) {
        console.log("✅ FLUSH SUCCESS");
        this.stats.included++;
        await this.autoClaim();
      } else {
        console.log("⚠️ Bundle not included");
        this.stats.failed++;
      }

    } catch (err) {
      console.error("❌ Flush error:", err.message);
      this.stats.failed++;
    }
  }

  async autoClaim() {
    try {
      const pending = await this.flush.rewardsOf(this.wallet.address);
      if (pending > 0n) {
        console.log("💰 Claiming rewards...");
        const tx = await this.flush.claimRewards({ gasLimit: 120_000 });
        await tx.wait();
        console.log("✅ Rewards claimed");
      }
    } catch (e) {
      console.log("⚠️ Claim skipped:", e.message);
    }
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

/* ================= START ================= */

(async () => {
  const bot = new AztecFlushBot();
  await bot.init();
  await bot.run();
})();
