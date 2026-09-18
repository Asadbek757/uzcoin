const express = require("express");
const path = require("path");
const crypto = require("crypto");
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

app.use(express.json());

/* =====================================================
   UZCOIN CONFIG
===================================================== */

const SKINS = {
  classic: {
    level: 1,
    name: "Classic",
    icon: "🟡",
    color: "#f5b800",
    power: 1,
    maxEnergy: 100
  },

  ocean: {
    level: 2,
    name: "Ocean",
    icon: "🔵",
    color: "#2196f3",
    power: 3,
    maxEnergy: 200
  },

  nebula: {
    level: 3,
    name: "Nebula",
    icon: "🟣",
    color: "#9c27b0",
    power: 5,
    maxEnergy: 300
  },

  emerald: {
    level: 4,
    name: "Emerald",
    icon: "🟢",
    color: "#4caf50",
    power: 8,
    maxEnergy: 400
  },

  inferno: {
    level: 5,
    name: "Inferno",
    icon: "🔴",
    color: "#f44336",
    power: 12,
    maxEnergy: 500
  },

  cyber: {
    level: 6,
    name: "Cyber",
    icon: "🔷",
    color: "#00bcd4",
    power: 16,
    maxEnergy: 600
  },

  immortal: {
    level: 7,
    name: "Immortal",
    icon: "🔮",
    color: "#673ab7",
    power: 20,
    maxEnergy: 700
  }
};

function getLevel(balance) {
  const amount = Number(balance) || 0;

  if (amount >= 1000000) return 7;
  if (amount >= 100000) return 6;
  if (amount >= 50000) return 5;
  if (amount >= 10000) return 4;
  if (amount >= 5000) return 3;
  if (amount >= 2000) return 2;

  return 1;
}

function getSkinByLevel(level) {
  return Object.values(SKINS).find(
    skin => skin.level === Number(level)
  ) || SKINS.classic;
}

function getSkinKeyByLevel(level) {
  const entry = Object.entries(SKINS).find(
    ([, skin]) => skin.level === Number(level)
  );

  return entry ? entry[0] : "classic";
}

/* =====================================================
   DATABASE
===================================================== */

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
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS first_name TEXT,
      ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS energy INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS max_energy INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS skin TEXT DEFAULT 'classic',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  /*
    Eski foydalanuvchilarni yangi level tizimiga moslaymiz.
  */

  const users = await pool.query(`
    SELECT telegram_id, balance, skin
    FROM users
  `);

  for (const user of users.rows) {
    const level = getLevel(user.balance);

    let skin = user.skin;

    if (!SKINS[skin]) {
      skin = getSkinKeyByLevel(level);
    }

    const skinData = SKINS[skin];

    await pool.query(
      `
      UPDATE users
      SET
        level = $2,
        skin = $3,
        max_energy = GREATEST(
          COALESCE(max_energy, 100),
          $4
        ),
        energy = LEAST(
          COALESCE(energy, $4),
          $4
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        user.telegram_id,
        level,
        skin,
        skinData.maxEnergy
      ]
    );
  }

  console.log("Database tayyor!");
}

/* =====================================================
   ENERGY
===================================================== */

async function regenerateEnergy(telegramId) {
  const result = await pool.query(
    `
    UPDATE users
    SET
      energy = LEAST(
        max_energy,
        energy + FLOOR(
          EXTRACT(
            EPOCH FROM (
              CURRENT_TIMESTAMP - energy_updated_at
            )
          )
        )
      ),
      energy_updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = $1
    RETURNING *
    `,
    [telegramId]
  );

  return result.rows[0] || null;
}

/* =====================================================
   USER CREATE
===================================================== */

async function createOrUpdateUser(
  telegramId,
  username = null,
  firstName = null
) {
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
      username = COALESCE($2, users.username),
      first_name = COALESCE($3, users.first_name),
      updated_at = CURRENT_TIMESTAMP

    RETURNING *
    `,
    [
      telegramId,
      username,
      firstName
    ]
  );

  const user = result.rows[0];

  const level = getLevel(user.balance);

  if (Number(user.level) !== level) {
    await pool.query(
      `
      UPDATE users
      SET level = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [telegramId, level]
    );

    user.level = level;
  }

  return user;
}

/* =====================================================
   TELEGRAM WEBAPP VALIDATION
===================================================== */

function validateTelegramInitData(initData) {
  if (!initData) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);

    const hash = params.get("hash");

    if (!hash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== hash) {
      return null;
    }

    const authDate = Number(params.get("auth_date"));

    if (
      authDate &&
      Math.floor(Date.now() / 1000) - authDate > 86400
    ) {
      return null;
    }

    const userString = params.get("user");

    if (!userString) {
      return null;
    }

    return JSON.parse(userString);

  } catch (error) {
    console.error("Telegram validation error:", error);
    return null;
  }
}

/* =====================================================
   /START
===================================================== */

bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || null;

    const user = await createOrUpdateUser(
      telegramId,
      username,
      firstName
    );

    const level = getLevel(user.balance);
    const skin = SKINS[user.skin] || getSkinByLevel(level);

    await ctx.reply(
      `Salom! 👋 ${firstName || ""}\n\n` +
      `🪙 UZCOIN\n` +
      `💰 Balans: ${Number(user.balance).toLocaleString("uz-UZ")} UZC\n` +
      `⭐ Level: ${level}\n` +
      `⚡ Energy: ${user.energy}/${user.max_energy}\n` +
      `🎨 Skin: ${skin.icon} ${skin.name}\n\n` +
      `UZCOIN Mini App'ni ochish uchun tugmani bosing 👇`,
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

  } catch (error) {
    console.error("START ERROR:", error);

    await ctx.reply(
      "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring."
    );
  }
});

/* =====================================================
   /BALANCE
===================================================== */

bot.command("balance", async (ctx) => {
  try {
    const telegramId = ctx.from.id;

    const user = await regenerateEnergy(telegramId);

    if (!user) {
      return ctx.reply(
        "Avval /start buyrug‘ini bosing."
      );
    }

    const level = getLevel(user.balance);
    const skin = SKINS[user.skin] || getSkinByLevel(level);

    await ctx.reply(
      `🪙 UZCOIN balansingiz\n\n` +
      `💰 ${Number(user.balance).toLocaleString("uz-UZ")} UZC\n` +
      `⭐ Level: ${level}\n` +
      `⚡ Energy: ${user.energy}/${user.max_energy}\n` +
      `🎨 Skin: ${skin.icon} ${skin.name}`
    );

  } catch (error) {
    console.error("BALANCE ERROR:", error);

    await ctx.reply(
      "❌ Balansni olishda xatolik."
    );
  }
});

/* =====================================================
   USER API
===================================================== */

app.get("/api/user/:telegramId", async (req, res) => {
  try {
    const telegramId = req.params.telegramId;

    const user = await regenerateEnergy(telegramId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Foydalanuvchi topilmadi"
      });
    }

    const level = getLevel(user.balance);

    if (Number(user.level) !== level) {
      await pool.query(
        `
        UPDATE users
        SET level = $2
        WHERE telegram_id = $1
        `,
        [telegramId, level]
      );

      user.level = level;
    }

    const skin =
      SKINS[user.skin] ||
      getSkinByLevel(level);

    res.json({
      success: true,

      user: {
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,

        balance: Number(user.balance),

        level,

        energy: Number(user.energy),

        max_energy: Number(user.max_energy),

        skin: user.skin,

        skinData: skin,

        referrals: Number(user.referrals || 0)
      },

      skins: SKINS
    });

  } catch (error) {
    console.error("USER API ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Server xatosi"
    });
  }
});

/* =====================================================
   TAP
===================================================== */

app.post("/api/tap", async (req, res) => {
  try {
    const {
      telegramId,
      initData
    } = req.body;

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        message: "telegramId kerak"
      });
    }

    /*
      Telegram WebApp validation.
      Agar initData yuborilsa, user ID ni tekshiramiz.
    */

    if (initData) {
      const telegramUser =
        validateTelegramInitData(initData);

      if (!telegramUser) {
        return res.status(403).json({
          success: false,
          message: "Telegram sessiyasi noto‘g‘ri"
        });
      }

      if (String(telegramUser.id) !== String(telegramId)) {
        return res.status(403).json({
          success: false,
          message: "Telegram user mos emas"
        });
      }
    }

    const user = await regenerateEnergy(telegramId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Foydalanuvchi topilmadi"
      });
    }

    const level = getLevel(user.balance);

    const skin =
      SKINS[user.skin] ||
      getSkinByLevel(level);

    /*
      TAP miqdorini frontenddan olmaymiz.
      Server o‘zi hisoblaydi.
    */

    if (Number(user.energy) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Energy tugagan",
        balance: Number(user.balance),
        energy: 0,
        maxEnergy: Number(user.max_energy)
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        balance = balance + $2,
        energy = energy - 1,
        level = $3,
        updated_at = CURRENT_TIMESTAMP,
        energy_updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
        AND energy > 0
      RETURNING
        balance,
        energy,
        max_energy,
        level,
        skin
      `,
      [
        telegramId,
        skin.power,
        level
      ]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tap amalga oshmadi"
      });
    }

    const updated = result.rows[0];

    const newLevel =
      getLevel(updated.balance);

    if (Number(updated.level) !== newLevel) {
      await pool.query(
        `
        UPDATE users
        SET level = $2
        WHERE telegram_id = $1
        `,
        [telegramId, newLevel]
      );

      updated.level = newLevel;
    }

    res.json({
      success: true,

      balance: Number(updated.balance),

      energy: Number(updated.energy),

      maxEnergy: Number(updated.max_energy),

      level: newLevel,

      tapPower: skin.power,

      skin: updated.skin
    });

  } catch (error) {
    console.error("TAP ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Tap server xatosi"
    });
  }
});

/* =====================================================
   SELECT SKIN
===================================================== */

app.post("/api/skin", async (req, res) => {
  try {
    const {
      telegramId,
      skin
    } = req.body;

    if (!telegramId || !skin) {
      return res.status(400).json({
        success: false,
        message: "Ma'lumot yetishmayapti"
      });
    }

    if (!SKINS[skin]) {
      return res.status(400).json({
        success: false,
        message: "Bunday skin mavjud emas"
      });
    }

    const user = await regenerateEnergy(telegramId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Foydalanuvchi topilmadi"
      });
    }

    const level = getLevel(user.balance);
    const selectedSkin = SKINS[skin];

    if (level < selectedSkin.level) {
      return res.status(403).json({
        success: false,
        message:
          `Bu skin uchun Level ${selectedSkin.level} kerak`
      });
    }

    await pool.query(
      `
      UPDATE users
      SET
        skin = $2,
        max_energy = $3,
        energy = LEAST(energy, $3),
        level = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        telegramId,
        skin,
        selectedSkin.maxEnergy,
        level
      ]
    );

    const updated = await pool.query(
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

    res.json({
      success: true,
      user: updated.rows[0],
      skinData: selectedSkin
    });

  } catch (error) {
    console.error("SKIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Skin tanlashda xatolik"
    });
  }
});

/* =====================================================
   RANK
===================================================== */

app.get("/api/rank", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        telegram_id,
        username,
        first_name,
        balance,
        level
      FROM users
      ORDER BY balance DESC
      LIMIT 100
    `);

    res.json({
      success: true,
      users: result.rows.map((user, index) => ({
        position: index + 1,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        balance: Number(user.balance),
        level: Number(user.level)
      }))
    });

  } catch (error) {
    console.error("RANK ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Rank xatosi"
    });
  }
});

/* =====================================================
   PROFILE
===================================================== */

app.get("/api/profile/:telegramId", async (req, res) => {
  try {
    const user = await regenerateEnergy(
      req.params.telegramId
    );

    if (!user) {
      return res.status(404).json({
        success: false
      });
    }

    const level = getLevel(user.balance);
    const skin =
      SKINS[user.skin] ||
      getSkinByLevel(level);

    res.json({
      success: true,
      profile: {
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        balance: Number(user.balance),
        level,
        energy: Number(user.energy),
        max_energy: Number(user.max_energy),
        skin: user.skin,
        skinName: skin.name,
        referrals: Number(user.referrals || 0)
      }
    });

  } catch (error) {
    console.error("PROFILE ERROR:", error);

    res.status(500).json({
      success: false
    });
  }
});

/* =====================================================
   STATUS
===================================================== */

app.get("/api/status", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "UZCOIN server ishlayapti!",
      database: "connected"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Database ulanmagan"
    });
  }
});

/* =====================================================
   STATIC
===================================================== */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =====================================================
   TELEGRAM WEBHOOK
===================================================== */

app.use(
  bot.webhookCallback(
    "/telegram-webhook"
  )
);

/* =====================================================
   SERVER
===================================================== */

app.listen(PORT, async () => {
  console.log(
    `UZCOIN server ${PORT}-portda ishlayapti`
  );

  try {
    await initDatabase();

    await bot.telegram.setWebhook(
      `${PUBLIC_URL}/telegram-webhook`
    );

    console.log(
      "Telegram webhook o‘rnatildi!"
    );

    console.log(
      `${PUBLIC_URL}/telegram-webhook`
    );

  } catch (error) {
    console.error(
      "STARTUP ERROR:",
      error
    );
  }
});

/* =====================================================
   SHUTDOWN
===================================================== */

process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
);
