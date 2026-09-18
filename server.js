const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_URL =
  process.env.PUBLIC_URL || "https://uzcoin.onrender.com";

const REQUIRED_CHANNEL = "@uzcoin_officiall";
const CHANNEL_URL = "https://t.me/uzcoin_officiall";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN topilmadi");
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL topilmadi");
}

const bot = new Telegraf(BOT_TOKEN);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const LEAGUES = [
  { name: "BRONZE", icon: "🥉", min: 0 },
  { name: "SILVER", icon: "🥈", min: 2000 },
  { name: "GOLD", icon: "🥇", min: 10000 },
  { name: "DIAMOND", icon: "💎", min: 50000 },
  { name: "MASTER", icon: "👑", min: 100000 },
];

const REFERRAL_BONUS = 500;

function getTapUpgradeCost(level) {
  return Math.floor(500 * Math.pow(1.8, level - 1));
}

function getMaxEnergy(level) {
  const limits = [
    300,
    500,
    1000,
    5000,
    10000,
    25000,
    50000,
    100000,
  ];

  return limits[Math.min(level - 1, limits.length - 1)];
}

function getEnergyUpgradeCost(level) {
  const costs = [
    1000,
    5000,
    25000,
    100000,
    500000,
    2500000,
    10000000,
  ];

  return costs[Math.min(level - 1, costs.length - 1)];
}

function getLeague(balance) {
  let league = LEAGUES[0];

  for (const item of LEAGUES) {
    if (balance >= item.min) {
      league = item;
    }
  }

  return league;
}

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      photo_url TEXT,
      balance NUMERIC DEFAULT 0,
      energy INTEGER DEFAULT 300,
      max_energy INTEGER DEFAULT 300,
      tap_level INTEGER DEFAULT 1,
      energy_level INTEGER DEFAULT 1,
      referrals INTEGER DEFAULT 0,
      referred_by BIGINT,
      daily_claimed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Eski database bo'lsa, yangi ustunlarni qo'shadi
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS photo_url TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS energy_level INTEGER DEFAULT 1
  `);

  // Eski userlarni yangi Energy tizimiga moslaymiz
  const users = await pool.query(`
    SELECT telegram_id, energy_level, energy, max_energy
    FROM users
  `);

  for (const user of users.rows) {
    const level = Math.max(1, Number(user.energy_level || 1));
    const newMax = getMaxEnergy(level);
    const oldEnergy = Number(user.energy || 0);

    // Birinchi migrationda energy 300 dan past bo'lsa 300 qilamiz.
    const newEnergy = Math.min(
      newMax,
      Math.max(oldEnergy, level === 1 ? 300 : oldEnergy)
    );

    await pool.query(
      `
      UPDATE users
      SET
        max_energy = $2,
        energy = $3,
        energy_updated_at = COALESCE(energy_updated_at, CURRENT_TIMESTAMP)
      WHERE telegram_id = $1
      `,
      [user.telegram_id, newMax, newEnergy]
    );
  }

  console.log("Database tayyor");
}

/* =========================
   ENERGY
========================= */

async function regenerateEnergy(telegramId) {
  const result = await pool.query(
    `
    SELECT *
    FROM users
    WHERE telegram_id = $1
    `,
    [telegramId]
  );

  if (!result.rows.length) return null;

  const user = result.rows[0];

  const currentEnergy = Number(user.energy || 0);
  const maxEnergy = Number(user.max_energy || 300);

  const lastUpdate = new Date(
    user.energy_updated_at ||
      user.updated_at ||
      Date.now()
  );

  const now = Date.now();

  const elapsedSeconds = Math.floor(
    (now - lastUpdate.getTime()) / 1000
  );

  if (elapsedSeconds <= 0) {
    return user;
  }

  if (currentEnergy >= maxEnergy) {
    return user;
  }

  const newEnergy = Math.min(
    maxEnergy,
    currentEnergy + elapsedSeconds
  );

  const newTimestamp = new Date(
    lastUpdate.getTime() + elapsedSeconds * 1000
  );

  const updated = await pool.query(
    `
    UPDATE users
    SET
      energy = $2,
      energy_updated_at = $3,
      updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = $1
    RETURNING *
    `,
    [telegramId, newEnergy, newTimestamp]
  );

  return updated.rows[0];
}

/* =========================
   USER
========================= */

async function createOrUpdateUser(userData) {
  const {
    id,
    username,
    first_name,
    photo_url,
  } = userData;

  const result = await pool.query(
    `
    INSERT INTO users (
      telegram_id,
      username,
      first_name,
      photo_url
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      id,
      username || "",
      first_name || "Player",
      photo_url || null,
    ]
  );

  return result.rows[0];
}

/* =========================
   TELEGRAM INIT DATA
========================= */

function validateTelegramInitData(initData) {
  if (!initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) return null;

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

    const userString = params.get("user");

    if (!userString) return null;

    return JSON.parse(userString);
  } catch (error) {
    console.error("InitData error:", error.message);
    return null;
  }
}

async function authenticateRequest(req) {
  const initData = req.body?.initData || req.query?.initData;

  if (!initData) {
    return null;
  }

  const user = validateTelegramInitData(initData);

  if (!user) {
    return null;
  }

  return user;
}

/* =========================
   CHANNEL SUBSCRIPTION
========================= */

async function isSubscribed(telegramId) {
  try {
    const member = await bot.telegram.getChatMember(
      REQUIRED_CHANNEL,
      telegramId
    );

    return [
      "creator",
      "administrator",
      "member",
    ].includes(member.status);
  } catch (error) {
    console.error(
      "Subscription check error:",
      error.description || error.message
    );

    return false;
  }
}

/* =========================
   FORMAT USER
========================= */

function formatUser(user) {
  const balance = Number(user.balance || 0);
  const tapLevel = Number(user.tap_level || 1);
  const energyLevel = Number(user.energy_level || 1);

  const league = getLeague(balance);

  return {
    telegramId: String(user.telegram_id),
    username: user.username || "",
    firstName: user.first_name || "Player",
    photoUrl: user.photo_url || null,

    balance,

    energy: Number(user.energy || 0),
    maxEnergy: Number(user.max_energy || 300),

    tapLevel,
    power: tapLevel,

    energyLevel,

    referrals: Number(user.referrals || 0),

    league,

    upgrades: {
      tap: {
        level: tapLevel,
        nextLevel: tapLevel + 1,
        cost: getTapUpgradeCost(tapLevel),
        currentPower: tapLevel,
        nextPower: tapLevel + 1,
      },

      energy: {
        level: energyLevel,
        nextLevel: energyLevel + 1,
        cost: getEnergyUpgradeCost(energyLevel),
        currentMaxEnergy: getMaxEnergy(energyLevel),
        nextMaxEnergy: getMaxEnergy(energyLevel + 1),
      },
    },
  };
}

/* =========================
   BOT /START
========================= */

bot.start(async (ctx) => {
  try {
    const telegramUser = ctx.from;

    const subscribed = await isSubscribed(telegramUser.id);

    if (!subscribed) {
      await ctx.reply(
        `🎉 UZCOIN'ga xush kelibsiz!\n\n` +
          `O‘yinni boshlash uchun avval rasmiy kanalimizga obuna bo‘ling:\n\n` +
          `📢 @uzcoin_officiall\n\n` +
          `Obuna bo‘lgandan keyin "✅ Tekshirish" tugmasini bosing.`,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📢 Kanalga obuna bo‘lish",
              CHANNEL_URL
            ),
          ],
          [
            Markup.button.callback(
              "✅ Tekshirish",
              "check_subscription"
            ),
          ],
        ])
      );

      return;
    }

    await createOrUpdateUser({
      id: telegramUser.id,
      username: telegramUser.username,
      first_name: telegramUser.first_name,
      photo_url: null,
    });

    await ctx.reply(
      `🪙 UZCOIN\n\n` +
        `Xush kelibsiz, ${
          telegramUser.first_name || "Player"
        }!`,
      Markup.inlineKeyboard([
        [
          Markup.button.webApp(
            "🚀 UZCOIN'ni ochish",
            PUBLIC_URL
          ),
        ],
      ])
    );
  } catch (error) {
    console.error("/start error:", error);

    await ctx.reply(
      "Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko‘ring."
    );
  }
});

/* =========================
   SUBSCRIPTION CALLBACK
========================= */

bot.action("check_subscription", async (ctx) => {
  try {
    const telegramUser = ctx.from;

    const subscribed = await isSubscribed(telegramUser.id);

    if (!subscribed) {
      await ctx.answerCbQuery(
        "❌ Hali kanalga obuna bo‘lmagansiz.",
        {
          show_alert: true,
        }
      );

      return;
    }

    await createOrUpdateUser({
      id: telegramUser.id,
      username: telegramUser.username,
      first_name: telegramUser.first_name,
      photo_url: null,
    });

    await ctx.answerCbQuery(
      "✅ Obuna tasdiqlandi!"
    );

    await ctx.editMessageText(
      `✅ Obunangiz tasdiqlandi!\n\n` +
        `Endi UZCOIN o‘yinini boshlashingiz mumkin.`,
      Markup.inlineKeyboard([
        [
          Markup.button.webApp(
            "🚀 UZCOIN'ni ochish",
            PUBLIC_URL
          ),
        ],
      ])
    );
  } catch (error) {
    console.error("Callback error:", error);

    await ctx.answerCbQuery(
      "Tekshirishda xatolik.",
      { show_alert: true }
    );
  }
});

/* =========================
   API: CHECK SUBSCRIPTION
========================= */

app.post("/api/check-subscription", async (req, res) => {
  try {
    const telegramUser = await authenticateRequest(req);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        subscribed: false,
        message: "Telegram authentication failed",
      });
    }

    const subscribed = await isSubscribed(
      telegramUser.id
    );

    return res.json({
      success: true,
      subscribed,
      channel: CHANNEL_URL,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      subscribed: false,
    });
  }
});

/* =========================
   API: USER
========================= */

app.get("/api/user/:telegramId", async (req, res) => {
  try {
    const telegramId = req.params.telegramId;

    const user = await regenerateEnergy(telegramId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: formatUser(user),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* =========================
   API: TAP
========================= */

app.post("/api/tap", async (req, res) => {
  try {
    const telegramUser = await authenticateRequest(req);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed",
      });
    }

    const telegramId = telegramUser.id;

    const subscribed = await isSubscribed(telegramId);

    if (!subscribed) {
      return res.status(403).json({
        success: false,
        message: "Channel subscription required",
        requireSubscription: true,
      });
    }

    const requestedTaps = Math.min(
      Math.max(Number(req.body.taps || 1), 1),
      100
    );

    await regenerateEnergy(telegramId);

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      FOR UPDATE
      `,
      [telegramId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
      });
    }

    const user = result.rows[0];

    const energy = Number(user.energy || 0);
    const power = Number(user.tap_level || 1);

    const actualTaps = Math.min(
      requestedTaps,
      energy
    );

    if (actualTaps <= 0) {
      return res.json({
        success: true,
        taps: 0,
        earned: 0,
        user: formatUser(user),
      });
    }

    const earned = actualTaps * power;
    const newEnergy = energy - actualTaps;
    const newBalance =
      Number(user.balance || 0) + earned;

    const updated = await pool.query(
      `
      UPDATE users
      SET
        balance = $2,
        energy = $3,
        energy_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      RETURNING *
      `,
      [
        telegramId,
        newBalance,
        newEnergy,
      ]
    );

    res.json({
      success: true,
      taps: actualTaps,
      earned,
      user: formatUser(updated.rows[0]),
    });
  } catch (error) {
    console.error("Tap error:", error);

    res.status(500).json({
      success: false,
      message: "Tap error",
    });
  }
});

/* =========================
   API: UPGRADE
========================= */

app.post("/api/upgrade", async (req, res) => {
  try {
    const telegramUser = await authenticateRequest(req);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
      });
    }

    const subscribed = await isSubscribed(
      telegramUser.id
    );

    if (!subscribed) {
      return res.status(403).json({
        success: false,
        requireSubscription: true,
      });
    }

    const type = req.body.type;

    if (!["tap", "energy"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid upgrade",
      });
    }

    await regenerateEnergy(telegramUser.id);

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      FOR UPDATE
      `,
      [telegramUser.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
      });
    }

    const user = result.rows[0];

    const balance = Number(user.balance || 0);

    if (type === "tap") {
      const level = Number(user.tap_level || 1);
      const cost = getTapUpgradeCost(level);

      if (balance < cost) {
        return res.json({
          success: false,
          message: "Not enough UZCOIN",
        });
      }

      const updated = await pool.query(
        `
        UPDATE users
        SET
          balance = balance - $2,
          tap_level = tap_level + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $1
        RETURNING *
        `,
        [telegramUser.id, cost]
      );

      return res.json({
        success: true,
        user: formatUser(updated.rows[0]),
      });
    }

    if (type === "energy") {
      const level = Number(
        user.energy_level || 1
      );

      const cost = getEnergyUpgradeCost(level);

      if (balance < cost) {
        return res.json({
          success: false,
          message: "Not enough UZCOIN",
        });
      }

      const newLevel = level + 1;
      const newMax = getMaxEnergy(newLevel);

      // Energy Boost sotib olinganda yangi limitga to'ldiriladi.
      const updated = await pool.query(
        `
        UPDATE users
        SET
          balance = balance - $2,
          energy_level = $3,
          max_energy = $4,
          energy = $4,
          energy_updated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $1
        RETURNING *
        `,
        [
          telegramUser.id,
          cost,
          newLevel,
          newMax,
        ]
      );

      return res.json({
        success: true,
        user: formatUser(updated.rows[0]),
      });
    }
  } catch (error) {
    console.error("Upgrade error:", error);

    res.status(500).json({
      success: false,
      message: "Upgrade error",
    });
  }
});

/* =========================
   API: DAILY
========================= */

app.post("/api/daily", async (req, res) => {
  try {
    const telegramUser =
      await authenticateRequest(req);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
      });
    }

    const subscribed = await isSubscribed(
      telegramUser.id
    );

    if (!subscribed) {
      return res.status(403).json({
        success: false,
        requireSubscription: true,
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramUser.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
      });
    }

    const user = result.rows[0];

    const now = new Date();
    const last = user.daily_claimed_at
      ? new Date(user.daily_claimed_at)
      : null;

    if (
      last &&
      now.toDateString() === last.toDateString()
    ) {
      return res.json({
        success: false,
        message: "Daily reward already claimed",
        user: formatUser(user),
      });
    }

    const updated = await pool.query(
      `
      UPDATE users
      SET
        balance = balance + 100,
        daily_claimed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      RETURNING *
      `,
      [telegramUser.id]
    );

    res.json({
      success: true,
      reward: 100,
      user: formatUser(updated.rows[0]),
    });
  } catch (error) {
    console.error("Daily error:", error);

    res.status(500).json({
      success: false,
    });
  }
});

/* =========================
   API: REFERRAL
========================= */

app.post("/api/referral", async (req, res) => {
  try {
    const telegramUser =
      await authenticateRequest(req);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
      });
    }

    const referrerId = Number(
      req.body.referrerId
    );

    if (
      !referrerId ||
      referrerId === Number(telegramUser.id)
    ) {
      return res.status(400).json({
        success: false,
      });
    }

    const userResult = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramUser.id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        success: false,
      });
    }

    const user = userResult.rows[0];

    if (user.referred_by) {
      return res.json({
        success: false,
        message: "Referral already used",
      });
    }

    const referrer = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      `,
      [referrerId]
    );

    if (!referrer.rows.length) {
      return res.status(404).json({
        success: false,
      });
    }

    await pool.query(
      `
      UPDATE users
      SET
        referred_by = $2,
        balance = balance + $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        telegramUser.id,
        referrerId,
        REFERRAL_BONUS,
      ]
    );

    await pool.query(
      `
      UPDATE users
      SET
        referrals = referrals + 1,
        balance = balance + $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        referrerId,
        REFERRAL_BONUS,
      ]
    );

    res.json({
      success: true,
      bonus: REFERRAL_BONUS,
    });
  } catch (error) {
    console.error("Referral error:", error);

    res.status(500).json({
      success: false,
    });
  }
});

/* =========================
   API: FRIENDS
========================= */

app.get(
  "/api/friends/:telegramId",
  async (req, res) => {
    try {
      const telegramId = req.params.telegramId;

      const result = await pool.query(
        `
        SELECT
          telegram_id,
          username,
          first_name,
          photo_url,
          balance
        FROM users
        WHERE referred_by = $1
        ORDER BY balance DESC
        `,
        [telegramId]
      );

      res.json({
        success: true,
        friends: result.rows.map((u) => ({
          telegramId: String(u.telegram_id),
          username: u.username || "",
          firstName: u.first_name || "Player",
          photoUrl: u.photo_url || null,
          balance: Number(u.balance || 0),
        })),
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
      });
    }
  }
);

/* =========================
   API: RANK
========================= */

app.get("/api/rank", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        telegram_id,
        username,
        first_name,
        photo_url,
        balance
      FROM users
      ORDER BY balance DESC
      LIMIT 100
    `);

    res.json({
      success: true,
      users: result.rows.map((u, index) => ({
        rank: index + 1,
        telegramId: String(u.telegram_id),
        username: u.username || "",
        firstName: u.first_name || "Player",
        photoUrl: u.photo_url || null,
        balance: Number(u.balance || 0),
      })),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
    });
  }
});

/* =========================
   API: PROFILE
========================= */

app.get(
  "/api/profile/:telegramId",
  async (req, res) => {
    try {
      const user = await regenerateEnergy(
        req.params.telegramId
      );

      if (!user) {
        return res.status(404).json({
          success: false,
        });
      }

      res.json({
        success: true,
        user: formatUser(user),
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
      });
    }
  }
);

/* =========================
   API: LEAGUES
========================= */

app.get("/api/leagues", (req, res) => {
  res.json({
    success: true,
    leagues: LEAGUES,
  });
});

/* =========================
   API: STATUS
========================= */

app.get("/api/status", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      status: "online",
      channel: REQUIRED_CHANNEL,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "offline",
    });
  }
});

/* =========================
   BOT WEBHOOK
========================= */

async function setupBot() {
  try {
    const webhookUrl = `${PUBLIC_URL}/telegram-webhook`;

    await bot.telegram.setWebhook(webhookUrl);

    console.log(
      "Telegram webhook:",
      webhookUrl
    );
  } catch (error) {
    console.error(
      "Webhook error:",
      error.message
    );
  }
}

app.post(
  "/telegram-webhook",
  async (req, res) => {
    try {
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error(
        "Telegram update error:",
        error
      );

      res.sendStatus(500);
    }
  }
);

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, async () => {
      console.log(
        `UZCOIN server running on port ${PORT}`
      );

      await setupBot();
    });
  } catch (error) {
    console.error(
      "Server start error:",
      error
    );

    process.exit(1);
  }
}

startServer();
