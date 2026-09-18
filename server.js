const express = require("express");
const path = require("path");
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN topilmadi!");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL topilmadi!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Database jadvalini yaratish
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      balance NUMERIC DEFAULT 0,
      referrals INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database tayyor!");
}

// /start
bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || null;

    const result = await pool.query(
      `
      INSERT INTO users (telegram_id, username)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id)
      DO UPDATE SET username = $2
      RETURNING balance
      `,
      [telegramId, username]
    );

    const balance = result.rows[0].balance;

    await ctx.reply(
      `Salom! 👋 ${ctx.from.first_name || ""}\n\n` +
      `🪙 UZCOIN\n` +
      `💰 Balans: ${balance} UZC\n\n` +
      `Tap-to-Earn tez orada ishga tushadi! 🚀`
    );

    console.log(`Foydalanuvchi kirdi: ${telegramId}`);
  } catch (error) {
    console.error("START ERROR:", error);
    await ctx.reply("❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring.");
  }
});

// /balance
bot.command("balance", async (ctx) => {
  try {
    const telegramId = ctx.from.id;

    const result = await pool.query(
      "SELECT balance FROM users WHERE telegram_id = $1",
      [telegramId]
    );

    if (result.rows.length === 0) {
      return ctx.reply("Avval /start buyrug‘ini bosing.");
    }

    await ctx.reply(
      `🪙 UZCOIN balansingiz: ${result.rows[0].balance} UZC`
    );
  } catch (error) {
    console.error("BALANCE ERROR:", error);
    await ctx.reply("❌ Balansni olishda xatolik.");
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "UZCOIN server ishlayapti!"
  });
});

app.listen(PORT, async () => {
  console.log(`UZCOIN server ${PORT}-portda ishlayapti`);

  try {
    await initDatabase();

    console.log("Telegram botni ishga tushiryapman...");

    await bot.launch();

    console.log("UZCOIN Telegram bot ishga tushdi!");
  } catch (error) {
    console.error("STARTUP ERROR:", error);
  }
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
