const express = require("express");
const path = require("path");
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_URL = "https://uzcoin.onrender.com";

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


// =========================
// DATABASE
// =========================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      balance NUMERIC DEFAULT 0,
      referrals INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      energy INTEGER DEFAULT 100,
      max_energy INTEGER DEFAULT 100,
      skin TEXT DEFAULT 'classic',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name TEXT,
      ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS energy INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS max_energy INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS skin TEXT DEFAULT 'classic',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    UPDATE users
    SET
      level = COALESCE(level, 1),
      energy = COALESCE(energy, 100),
      max_energy = COALESCE(max_energy, 100),
      skin = COALESCE(skin, 'classic'),
      referrals = COALESCE(referrals, 0),
      updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP),
      energy_updated_at = COALESCE(energy_updated_at, CURRENT_TIMESTAMP)
  `);

  console.log("Database tayyor!");
}


// =========================
// EXPRESS
// =========================

app.use(express.json());


// =========================
// TELEGRAM /START
// =========================

bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || null;

    const result = await pool.query(
      `
      INSERT INTO users (
        telegram_id,
        username,
        first_name
      )
      VALUES ($1, $2, $3)

      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = $2,
        first_name = $3,
        updated_at = CURRENT_TIMESTAMP

      RETURNING balance, level, energy, max_energy, skin
      `,
      [telegramId, username, firstName]
    );

    const user = result.rows[0];

    await ctx.reply(
      `Salom! 👋 ${firstName || ""}\n\n` +
      `🪙 UZCOIN\n` +
      `💰 Balans: ${user.balance} UZC\n` +
      `⭐ Level: ${user.level}\n` +
      `⚡ Energy: ${user.energy}/${user.max_energy}\n\n` +
      `UZCOIN Mini App'ni ochish uchun quyidagi tugmani bosing 👇`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🪙 UZCOIN'ni ochish",
                web_app: {
                  url: PUBLIC_URL
                }
              }
            ]
          ]
        }
      }
    );

    console.log(`Foydalanuvchi kirdi: ${telegramId}`);

  } catch (error) {
    console.error("START ERROR:", error);

    try {
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring."
      );
    } catch {}
  }
});


// =========================
// /BALANCE
// =========================

bot.command("balance", async (ctx) => {
  try {
    const telegramId = ctx.from.id;

    const result = await pool.query(
      `
      SELECT
        balance,
        level,
        energy,
        max_energy,
        skin
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramId]
    );

    if (result.rows.length === 0) {
      return ctx.reply("Avval /start buyrug‘ini bosing.");
    }

    const user = result.rows[0];

    await ctx.reply(
      `🪙 UZCOIN balansingiz: ${user.balance} UZC\n\n` +
      `⭐ Level: ${user.level}\n` +
      `⚡ Energy: ${user.energy}/${user.max_energy}\n` +
      `🎨 Skin: ${user.skin}`
    );

  } catch (error) {
    console.error("BALANCE ERROR:", error);
    await ctx.reply("❌ Balansni olishda xatolik.");
  }
});


// =========================
// MINI APP — TAP
// =========================

app.post("/api/tap", async (req, res) => {
  try {
    const { telegramId, amount } = req.body;

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        message: "telegramId kerak"
      });
    }

    const tapAmount = Number(amount);

    if (!Number.isFinite(tapAmount) || tapAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Noto‘g‘ri amount"
      });
    }

    const result = await pool.query(
      `
      WITH regenerated AS (
        SELECT
          telegram_id,
          GREATEST(
            LEAST(
              max_energy,
              energy + FLOOR(
                EXTRACT(
                  EPOCH FROM (
                    CURRENT_TIMESTAMP - energy_updated_at
                  )
                )
              )
            ),
            0
          ) AS new_energy
        FROM users
        WHERE telegram_id = $1
      )

      UPDATE users
      SET
        balance = balance + $2,
        energy = regenerated.new_energy - 1,
        updated_at = CURRENT_TIMESTAMP,
        energy_updated_at = CURRENT_TIMESTAMP
      FROM regenerated
      WHERE users.telegram_id = regenerated.telegram_id
        AND regenerated.new_energy > 0

      RETURNING balance, energy, max_energy
      `,
      [telegramId, tapAmount]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Energy tugagan yoki foydalanuvchi topilmadi"
      });
    }

    res.json({
      success: true,
      balance: result.rows[0].balance,
      energy: result.rows[0].energy,
      maxEnergy: result.rows[0].max_energy
    });

  } catch (error) {
    console.error("TAP ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Tap server xatosi"
    });
  }
});


// =========================
// USER DATA
// =========================

app.get("/api/user/:telegramId", async (req, res) => {
  try {
    const telegramId = req.params.telegramId;

    await pool.query(
      `
      UPDATE users
      SET
        energy = GREATEST(
          LEAST(
            max_energy,
            energy + FLOOR(
              EXTRACT(
                EPOCH FROM (
                  CURRENT_TIMESTAMP - energy_updated_at
                )
              )
            )
          ),
          0
        ),
        energy_updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [telegramId]
    );

    const result = await pool.query(
      `
      SELECT
        telegram_id,
        username,
        first_name,
        balance,
        level,
        energy,
        max_energy,
        skin
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Foydalanuvchi topilmadi"
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("USER API ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Server xatosi"
    });
  }
});


// =========================
// SERVER STATUS
// =========================

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "UZCOIN server ishlayapti!"
  });
});


// =========================
// STATIC MINI APP
// =========================

app.use(express.static(path.join(__dirname, "public")));


// =========================
// TELEGRAM WEBHOOK
// =========================

app.use(bot.webhookCallback("/telegram-webhook"));


// =========================
// SERVER START
// =========================

app.listen(PORT, async () => {
  console.log(`UZCOIN server ${PORT}-portda ishlayapti`);

  try {
    await initDatabase();

    await bot.telegram.setWebhook(
      `${PUBLIC_URL}/telegram-webhook`
    );

    console.log("Telegram webhook o‘rnatildi!");
    console.log(`${PUBLIC_URL}/telegram-webhook`);

  } catch (error) {
    console.error("STARTUP ERROR:", error);
  }
});


// =========================
// SHUTDOWN
// =========================

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
