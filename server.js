const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const { Telegraf } = require("telegraf");

const app = express();

/* =====================================================
   BASIC SETTINGS
===================================================== */

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const CHANNEL_USERNAME = "@uzcoin_officiall";
const BOT_USERNAME = "UZCoinTapBot";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   STATIC WEBSITE
===================================================== */

app.use(express.static(path.join(__dirname, "public")));

/* =====================================================
   ENV CHECK
===================================================== */

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN topilmadi.");
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL topilmadi.");
}

/* =====================================================
   DATABASE
===================================================== */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

/* =====================================================
   GAME SETTINGS
===================================================== */

const TAP_COSTS = [
  500,
  900,
  1620,
  2916,
  5249,
  9448,
  17006,
  30611,
  55099,
];

const ENERGY_COSTS = [
  1000,
  5000,
  25000,
  100000,
  500000,
  2500000,
  10000000,
  50000000,
  250000000,
];

const ENERGY_VALUES = [
  300,
  500,
  1000,
  5000,
  10000,
  25000,
  50000,
  100000,
  250000,
  500000,
];

const LEAGUES = [
  { level: 1, name: "Bronze", icon: "🥉", threshold: 0 },
  { level: 2, name: "Silver", icon: "🥈", threshold: 2000 },
  { level: 3, name: "Gold", icon: "🥇", threshold: 10000 },
  { level: 4, name: "Platinum", icon: "💎", threshold: 50000 },
  { level: 5, name: "Diamond", icon: "💠", threshold: 250000 },
  { level: 6, name: "Master", icon: "👑", threshold: 1000000 },
  { level: 7, name: "Grandmaster", icon: "🔥", threshold: 5000000 },
  { level: 8, name: "Champion", icon: "⚔️", threshold: 25000000 },
  { level: 9, name: "Legend", icon: "🌟", threshold: 100000000 },
  { level: 10, name: "Titan", icon: "🏆", threshold: 500000000 },
];

const REFERRAL_BONUS = 500;
const DAILY_REWARD = 100;

/* =====================================================
   TELEGRAM BOT
===================================================== */

const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

/* =====================================================
   INIT DATA VALIDATION
===================================================== */

function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
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

    if (
      calculatedHash.length !== receivedHash.length ||
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(receivedHash)
      )
    ) {
      return null;
    }

    const userRaw = params.get("user");

    if (!userRaw) {
      return null;
    }

    return JSON.parse(userRaw);
  } catch (error) {
    console.error("InitData validation error:", error);
    return null;
  }
}

/* =====================================================
   AUTH MIDDLEWARE
===================================================== */

function getTelegramUser(req) {
  const initData = req.headers["x-telegram-init-data"];

  if (!initData) {
    return null;
  }

  return validateInitData(initData);
}

function requireTelegramUser(req, res, next) {
  const telegramUser = getTelegramUser(req);

  if (!telegramUser || !telegramUser.id) {
    return res.status(401).json({
      error: "Telegram authorization kerak.",
    });
  }

  req.telegramUser = telegramUser;
  next();
}

/* =====================================================
   HELPERS
===================================================== */

function getLeagueByBalance(balance, currentLevel = 1) {
  const numericBalance = Number(balance || 0);

  let calculatedLevel = 1;

  for (const league of LEAGUES) {
    if (numericBalance >= league.threshold) {
      calculatedLevel = league.level;
    }
  }

  return Math.max(
    1,
    Number(currentLevel || 1),
    calculatedLevel
  );
}

function getLeague(level) {
  return (
    LEAGUES.find((x) => x.level === Number(level)) ||
    LEAGUES[0]
  );
}

function regenerateEnergy(user) {
  const maxEnergy = Number(user.max_energy || 300);
  let energy = Number(user.energy || 0);

  const updatedAt = user.energy_updated_at
    ? new Date(user.energy_updated_at).getTime()
    : Date.now();

  const now = Date.now();

  const secondsPassed = Math.max(
    0,
    Math.floor((now - updatedAt) / 1000)
  );

  if (secondsPassed > 0 && energy < maxEnergy) {
    energy = Math.min(
      maxEnergy,
      energy + secondsPassed
    );
  }

  return {
    energy,
    updatedAt:
      energy >= maxEnergy
        ? new Date()
        : new Date(
            updatedAt + secondsPassed * 1000
          ),
  };
}

async function getUserByTelegramId(
  client,
  telegramId,
  forUpdate = false
) {
  const query = `
    SELECT *
    FROM users
    WHERE telegram_id = $1
    ${forUpdate ? "FOR UPDATE" : ""}
  `;

  const result = await client.query(query, [telegramId]);

  return result.rows[0] || null;
}

function formatUser(user, rank = null) {
  const leagueLevel = Number(user.league_level || 1);
  const league = getLeague(leagueLevel);

  return {
    telegramId: String(user.telegram_id),

    username: user.username || "",
    firstName: user.first_name || "",
    photoUrl: user.photo_url || "",

    balance: Number(user.balance || 0),

    energy: Number(user.energy || 0),
    maxEnergy: Number(user.max_energy || 300),

    tapLevel: Number(user.tap_level || 1),
    energyLevel: Number(user.energy_level || 1),

    tapPower: Number(user.tap_level || 1),

    referrals: Number(user.referrals || 0),

    leagueLevel,
    leagueName: league.name,
    leagueIcon: league.icon,

    rank,

    dailyClaimedAt: user.daily_claimed_at
      ? new Date(user.daily_claimed_at).toISOString()
      : null,

    energyUpdatedAt: user.energy_updated_at
      ? new Date(user.energy_updated_at).toISOString()
      : new Date().toISOString(),

    nextTapUpgradeCost:
      Number(user.tap_level) < 10
        ? TAP_COSTS[Number(user.tap_level) - 1]
        : null,

    nextEnergyUpgradeCost:
      Number(user.energy_level) < 10
        ? ENERGY_COSTS[Number(user.energy_level) - 1]
        : null,
  };
}

async function updateLeague(client, user) {
  const newLevel = getLeagueByBalance(
    user.balance,
    user.league_level
  );

  if (
    Number(user.league_level || 1) !== newLevel
  ) {
    await client.query(
      `
      UPDATE users
      SET league_level = $1,
          updated_at = NOW()
      WHERE telegram_id = $2
      `,
      [newLevel, user.telegram_id]
    );

    user.league_level = newLevel;
  }

  return user;
}

/* =====================================================
   DATABASE INIT
===================================================== */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,

      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',

      balance NUMERIC(30, 0) NOT NULL DEFAULT 0,

      energy INTEGER NOT NULL DEFAULT 300,
      max_energy INTEGER NOT NULL DEFAULT 300,

      tap_level INTEGER NOT NULL DEFAULT 1,
      energy_level INTEGER NOT NULL DEFAULT 1,

      referrals INTEGER NOT NULL DEFAULT 0,

      referred_by BIGINT,

      league_level INTEGER NOT NULL DEFAULT 1,

      daily_claimed_at TIMESTAMP,

      energy_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  console.log("✅ Database tayyor.");
}

/* =====================================================
   CREATE / UPDATE USER
===================================================== */

async function createOrUpdateUser(telegramUser, referredBy = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let user = await getUserByTelegramId(
      client,
      telegramUser.id,
      true
    );

    if (!user) {
      let validReferrer = null;

      if (
        referredBy &&
        String(referredBy) !== String(telegramUser.id)
      ) {
        validReferrer = await getUserByTelegramId(
          client,
          referredBy,
          true
        );
      }

      const result = await client.query(
        `
        INSERT INTO users (
          telegram_id,
          username,
          first_name,
          photo_url,
          balance,
          energy,
          max_energy,
          tap_level,
          energy_level,
          referrals,
          referred_by,
          league_level
        )
        VALUES (
          $1, $2, $3, $4,
          0, 300, 300,
          1, 1,
          0, $5, 1
        )
        RETURNING *
        `,
        [
          telegramUser.id,
          telegramUser.username || "",
          telegramUser.first_name || "",
          telegramUser.photo_url || "",
          validReferrer
            ? validReferrer.telegram_id
            : null,
        ]
      );

      user = result.rows[0];

      if (validReferrer) {
        await client.query(
          `
          UPDATE users
          SET
            balance = balance + $1,
            referrals = referrals + 1,
            updated_at = NOW()
          WHERE telegram_id = $2
          `,
          [
            REFERRAL_BONUS,
            validReferrer.telegram_id,
          ]
        );
      }
    } else {
      const energyData = regenerateEnergy(user);

      const result = await client.query(
        `
        UPDATE users
        SET
          username = $1,
          first_name = $2,
          photo_url = $3,
          energy = $4,
          energy_updated_at = $5,
          updated_at = NOW()
        WHERE telegram_id = $6
        RETURNING *
        `,
        [
          telegramUser.username || "",
          telegramUser.first_name || "",
          telegramUser.photo_url || "",
          energyData.energy,
          energyData.updatedAt,
          telegramUser.id,
        ]
      );

      user = result.rows[0];
    }

    await updateLeague(client, user);

    await client.query("COMMIT");

    return user;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* =====================================================
   SUBSCRIPTION CHECK
===================================================== */

async function checkSubscription(userId) {
  if (!bot) {
    return false;
  }

  try {
    const member = await bot.telegram.getChatMember(
      CHANNEL_USERNAME,
      userId
    );

    const allowed = [
      "creator",
      "administrator",
      "member",
      "restricted",
    ];

    return allowed.includes(member.status);
  } catch (error) {
    console.error(
      "Subscription check error:",
      error.description || error.message
    );

    return false;
  }
}

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "UZCOIN",
      database: true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: false,
      error: error.message,
    });
  }
});

/* =====================================================
   API: SUBSCRIPTION
===================================================== */

app.get(
  "/api/subscription",
  requireTelegramUser,
  async (req, res) => {
    try {
      const subscribed = await checkSubscription(
        req.telegramUser.id
      );

      res.json({
        subscribed,
        channel: CHANNEL_USERNAME,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Subscription tekshirishda xato.",
      });
    }
  }
);

/* =====================================================
   API: ME
===================================================== */

app.get(
  "/api/me",
  requireTelegramUser,
  async (req, res) => {
    try {
      const user = await createOrUpdateUser(
        req.telegramUser
      );

      const rankResult = await pool.query(`
        SELECT COUNT(*) + 1 AS rank
        FROM users
        WHERE balance > $1
      `, [user.balance]);

      const rank = Number(
        rankResult.rows[0]?.rank || 1
      );

      res.json({
        ok: true,
        user: formatUser(user, rank),
      });
    } catch (error) {
      console.error("/api/me error:", error);

      res.status(500).json({
        error: "Foydalanuvchi ma'lumotlarini olishda xato.",
      });
    }
  }
);

/* =====================================================
   API: TAP
===================================================== */

app.post(
  "/api/tap",
  requireTelegramUser,
  async (req, res) => {
    const telegramId = req.telegramUser.id;

    let taps = Number(req.body?.taps || 0);

    if (!Number.isFinite(taps)) {
      taps = 0;
    }

    taps = Math.floor(taps);

    if (taps < 1) {
      return res.status(400).json({
        error: "Tap soni noto'g'ri.",
      });
    }

    taps = Math.min(taps, 50);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user = await getUserByTelegramId(
        client,
        telegramId,
        true
      );

      if (!user) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "User topilmadi.",
        });
      }

      const energyData = regenerateEnergy(user);

      const currentEnergy = Math.floor(
        energyData.energy
      );

      const actualTaps = Math.min(
        taps,
        currentEnergy
      );

      if (actualTaps <= 0) {
        await client.query("ROLLBACK");

        return res.json({
          ok: true,
          added: 0,
          user: formatUser(user),
        });
      }

      const tapPower = Math.max(
        1,
        Number(user.tap_level || 1)
      );

      const earned = actualTaps * tapPower;
      const newEnergy =
        currentEnergy - actualTaps;

      const result = await client.query(
        `
        UPDATE users
        SET
          balance = balance + $1,
          energy = $2,
          energy_updated_at = NOW(),
          updated_at = NOW()
        WHERE telegram_id = $3
        RETURNING *
        `,
        [
          earned,
          newEnergy,
          telegramId,
        ]
      );

      user = result.rows[0];

      await updateLeague(client, user);

      await client.query("COMMIT");

      res.json({
        ok: true,
        added: earned,
        taps: actualTaps,
        user: formatUser(user),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("/api/tap error:", error);

      res.status(500).json({
        error: "Tap saqlashda xato.",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   API: UPGRADE
===================================================== */

app.post(
  "/api/upgrade",
  requireTelegramUser,
  async (req, res) => {
    const telegramId = req.telegramUser.id;
    const type = req.body?.type;

    if (!["tap", "energy"].includes(type)) {
      return res.status(400).json({
        error: "Upgrade turi noto'g'ri.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user = await getUserByTelegramId(
        client,
        telegramId,
        true
      );

      if (!user) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "User topilmadi.",
        });
      }

      const level =
        type === "tap"
          ? Number(user.tap_level)
          : Number(user.energy_level);

      if (level >= 10) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "Bu upgrade maksimal darajada.",
        });
      }

      const cost =
        type === "tap"
          ? TAP_COSTS[level - 1]
          : ENERGY_COSTS[level - 1];

      if (Number(user.balance) < cost) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "UZCOIN yetarli emas.",
        });
      }

      if (type === "tap") {
        user = (
          await client.query(
            `
            UPDATE users
            SET
              balance = balance - $1,
              tap_level = tap_level + 1,
              updated_at = NOW()
            WHERE telegram_id = $2
            RETURNING *
            `,
            [cost, telegramId]
          )
        ).rows[0];
      } else {
        const newEnergyLevel = level + 1;
        const newMaxEnergy =
          ENERGY_VALUES[newEnergyLevel - 1] ||
          user.max_energy;

        user = (
          await client.query(
            `
            UPDATE users
            SET
              balance = balance - $1,
              energy_level = energy_level + 1,
              max_energy = $2,
              energy = LEAST(energy, $2),
              updated_at = NOW()
            WHERE telegram_id = $3
            RETURNING *
            `,
            [
              cost,
              newMaxEnergy,
              telegramId,
            ]
          )
        ).rows[0];
      }

      await updateLeague(client, user);

      await client.query("COMMIT");

      res.json({
        ok: true,
        user: formatUser(user),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("/api/upgrade error:", error);

      res.status(500).json({
        error: "Upgrade qilishda xato.",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   API: DAILY
===================================================== */

app.post(
  "/api/daily",
  requireTelegramUser,
  async (req, res) => {
    const telegramId = req.telegramUser.id;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user = await getUserByTelegramId(
        client,
        telegramId,
        true
      );

      if (!user) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "User topilmadi.",
        });
      }

      const now = new Date();

      if (user.daily_claimed_at) {
        const lastClaim = new Date(
          user.daily_claimed_at
        );

        const difference =
          now.getTime() -
          lastClaim.getTime();

        const oneDay =
          24 * 60 * 60 * 1000;

        if (difference < oneDay) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "Daily reward hali mavjud emas.",
          });
        }
      }

      user = (
        await client.query(
          `
          UPDATE users
          SET
            balance = balance + $1,
            daily_claimed_at = NOW(),
            updated_at = NOW()
          WHERE telegram_id = $2
          RETURNING *
          `,
          [DAILY_REWARD, telegramId]
        )
      ).rows[0];

      await updateLeague(client, user);

      await client.query("COMMIT");

      res.json({
        ok: true,
        reward: DAILY_REWARD,
        user: formatUser(user),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("/api/daily error:", error);

      res.status(500).json({
        error: "Daily reward olishda xato.",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   API: FRIENDS
===================================================== */

app.get(
  "/api/friends",
  requireTelegramUser,
  async (req, res) => {
    try {
      const telegramId = req.telegramUser.id;

      const result = await pool.query(
        `
        SELECT
          telegram_id,
          username,
          first_name,
          photo_url,
          balance,
          created_at
        FROM users
        WHERE referred_by = $1
        ORDER BY created_at DESC
        `,
        [telegramId]
      );

      const friends = result.rows.map(
        (friend) => ({
          telegramId: String(
            friend.telegram_id
          ),
          username: friend.username || "",
          firstName: friend.first_name || "",
          photoUrl: friend.photo_url || "",
          balance: Number(
            friend.balance || 0
          ),
          createdAt:
            friend.created_at
              ? new Date(
                  friend.created_at
                ).toISOString()
              : null,
        })
      );

      res.json({
        ok: true,
        referrals: friends.length,
        friends,
      });
    } catch (error) {
      console.error(
        "/api/friends error:",
        error
      );

      res.status(500).json({
        error: "Do'stlarni olishda xato.",
      });
    }
  }
);

/* =====================================================
   API: RANK
===================================================== */

app.get(
  "/api/rank",
  requireTelegramUser,
  async (req, res) => {
    try {
      let limit = Number(
        req.query.limit || 100
      );

      if (!Number.isFinite(limit)) {
        limit = 100;
      }

      limit = Math.max(
        1,
        Math.min(100, Math.floor(limit))
      );

      const result = await pool.query(
        `
        SELECT
          telegram_id,
          username,
          first_name,
          photo_url,
          balance,
          league_level
        FROM users
        ORDER BY balance DESC, created_at ASC
        LIMIT $1
        `,
        [limit]
      );

      const ranking = result.rows.map(
        (user, index) => {
          const league = getLeague(
            user.league_level
          );

          return {
            rank: index + 1,

            telegramId: String(
              user.telegram_id
            ),

            username:
              user.username || "",

            firstName:
              user.first_name || "",

            photoUrl:
              user.photo_url || "",

            balance:
              Number(user.balance || 0),

            leagueLevel:
              Number(
                user.league_level || 1
              ),

            leagueName:
              league.name,

            leagueIcon:
              league.icon,
          };
        }
      );

      res.json({
        ok: true,
        rank: ranking,
        users: ranking,
      });
    } catch (error) {
      console.error(
        "/api/rank error:",
        error
      );

      res.status(500).json({
        error: "Rankni olishda xato.",
      });
    }
  }
);

/* =====================================================
   TELEGRAM BOT COMMANDS
===================================================== */

if (bot) {
  bot.start(async (ctx) => {
    try {
      const telegramUser = ctx.from;

      let referredBy = null;

      const text = ctx.message?.text || "";

      const match =
        text.match(/\/start\s+ref_(\d+)/i);

      if (match) {
        referredBy = match[1];
      }

      await createOrUpdateUser(
        telegramUser,
        referredBy
      );

      const webAppUrl =
        process.env.WEBAPP_URL ||
        `https://${process.env.RENDER_EXTERNAL_HOSTNAME || "localhost"}`;

      await ctx.reply(
        `👋 Salom, ${telegramUser.first_name || "do'st"}!\n\n` +
        `🪙 UZCOIN'ga xush kelibsiz!\n\n` +
        `Pastdagi tugma orqali Mini App'ni oching.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🪙 UZCOIN'ni ochish",
                  web_app: {
                    url: webAppUrl,
                  },
                },
              ],
              [
                {
                  text: "📢 Kanal",
                  url: `https://t.me/${CHANNEL_USERNAME.replace(
                    "@",
                    ""
                  )}`,
                },
              ],
            ],
          },
        }
      );
    } catch (error) {
      console.error(
        "Bot /start error:",
        error
      );
    }
  });

  bot.catch((error) => {
    console.error(
      "Telegram bot error:",
      error
    );
  });
}

/* =====================================================
   API 404
===================================================== */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "UZCOIN API NOT FOUND",
    path: req.originalUrl,
  });
});

/* =====================================================
   FRONTEND FALLBACK
===================================================== */

app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/api")
  ) {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }

  next();
});

/* =====================================================
   GLOBAL ERROR HANDLER
===================================================== */

app.use((error, req, res, next) => {
  console.error(
    "GLOBAL ERROR:",
    error
  );

  res.status(500).json({
    error: "Server xatosi.",
  });
});

/* =====================================================
   START SERVER
===================================================== */

async function startServer() {
  try {
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL environment variable topilmadi."
      );
    }

    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `🚀 UZCOIN server ${PORT}-portda ishga tushdi.`
      );
    });

    if (bot) {
      try {
        await bot.telegram.deleteWebhook({
          drop_pending_updates: false,
        });

        await bot.launch();

        console.log(
          "🤖 Telegram bot ishga tushdi."
        );
      } catch (error) {
        console.error(
          "❌ Telegram bot ishga tushmadi:",
          error.message
        );
      }
    } else {
      console.log(
        "⚠️ BOT_TOKEN yo'q. Telegram bot ishga tushmaydi."
      );
    }
  } catch (error) {
    console.error(
      "❌ SERVER START ERROR:",
      error
    );

    process.exit(1);
  }
}

/* =====================================================
   SHUTDOWN
===================================================== */

process.once(
  "SIGINT",
  () => {
    if (bot) bot.stop("SIGINT");
  }
);

process.once(
  "SIGTERM",
  () => {
    if (bot) bot.stop("SIGTERM");
  }
);

startServer();
