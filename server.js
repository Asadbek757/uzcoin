const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Telegraf } = require("telegraf");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public"));

/* =====================================================
   ENV
===================================================== */

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const CHANNEL_USERNAME = "@uzcoin_officiall";
const BOT_USERNAME = "UZCoinTapBot";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN topilmadi.");
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL topilmadi.");
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
  {
    level: 1,
    name: "Bronze",
    icon: "🥉",
    threshold: 0,
  },
  {
    level: 2,
    name: "Silver",
    icon: "🥈",
    threshold: 2000,
  },
  {
    level: 3,
    name: "Gold",
    icon: "🥇",
    threshold: 10000,
  },
  {
    level: 4,
    name: "Platinum",
    icon: "💎",
    threshold: 50000,
  },
  {
    level: 5,
    name: "Diamond",
    icon: "💠",
    threshold: 250000,
  },
  {
    level: 6,
    name: "Master",
    icon: "👑",
    threshold: 1000000,
  },
  {
    level: 7,
    name: "Grandmaster",
    icon: "🔥",
    threshold: 5000000,
  },
  {
    level: 8,
    name: "Champion",
    icon: "⚔️",
    threshold: 25000000,
  },
  {
    level: 9,
    name: "Legend",
    icon: "🌟",
    threshold: 100000000,
  },
  {
    level: 10,
    name: "Titan",
    icon: "🏆",
    threshold: 500000000,
  },
];

const REFERRAL_BONUS = 500;
const DAILY_REWARD = 100;

/* =====================================================
   TELEGRAM
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

  // Liga faqat yuqoriga ko'tariladi.
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
            now -
              Math.max(
                0,
                Math.floor(
                  (now - updatedAt) / 1000
                )
              ) *
                1000
          ),
  };
}

async function getUserByTelegramId(client, telegramId, forUpdate = false) {
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
      SET league_level = $1
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

  const columns = [
    ["username", "TEXT DEFAULT ''"],
    ["first_name", "TEXT DEFAULT ''"],
    ["photo_url", "TEXT DEFAULT ''"],
    ["balance", "NUMERIC(30, 0) NOT NULL DEFAULT 0"],
    ["energy", "INTEGER NOT NULL DEFAULT 300"],
    ["max_energy", "INTEGER NOT NULL DEFAULT 300"],
    ["tap_level", "INTEGER NOT NULL DEFAULT 1"],
    ["energy_level", "INTEGER NOT NULL DEFAULT 1"],
    ["referrals", "INTEGER NOT NULL DEFAULT 0"],
    ["referred_by", "BIGINT"],
    ["league_level", "INTEGER NOT NULL DEFAULT 1"],
    ["daily_claimed_at", "TIMESTAMP"],
    ["energy_updated_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
    ["created_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
    ["updated_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
  ];

  for (const [name, type] of columns) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS ${name} ${type}
    `);
  }

  await pool.query(`
    UPDATE users
    SET
      tap_level = LEAST(10, GREATEST(1, COALESCE(tap_level, 1))),
      energy_level = LEAST(10, GREATEST(1, COALESCE(energy_level, 1))),
      league_level = LEAST(10, GREATEST(1, COALESCE(league_level, 1))),
      energy = GREATEST(0, COALESCE(energy, 300)),
      max_energy = GREATEST(300, COALESCE(max_energy, 300))
  `);

  // Eski foydalanuvchilar ligasini balansga qarab
  // faqat yuqoriga ko'taramiz.
  for (const league of LEAGUES) {
    await pool.query(
      `
      UPDATE users
      SET league_level = GREATEST(
        league_level,
        $1
      )
      WHERE balance >= $2
      `,
      [league.level, league.threshold]
    );
  }

  console.log("Database tayyor.");
}

/* =====================================================
   AUTH MIDDLEWARE
===================================================== */

function authenticatedUser(req, res, next) {
  const initData =
    req.body?.initData ||
    req.query?.initData ||
    req.headers["x-telegram-init-data"];

  const telegramUser =
    validateInitData(initData);

  if (!telegramUser) {
    return res.status(401).json({
      error: "INVALID_INIT_DATA",
    });
  }

  req.telegramUser = telegramUser;
  next();
}

/* =====================================================
   SUBSCRIPTION
===================================================== */

const subscriptionCache = new Map();

async function checkSubscription(telegramId) {
  const cached = subscriptionCache.get(
    String(telegramId)
  );

  if (
    cached &&
    Date.now() - cached.time < 60000
  ) {
    return cached.result;
  }

  if (!bot) {
    return false;
  }

  try {
    const member =
      await bot.telegram.getChatMember(
        CHANNEL_USERNAME,
        telegramId
      );

    const subscribed =
      member.status === "creator" ||
      member.status === "administrator" ||
      member.status === "member" ||
      (
        member.status === "restricted" &&
        member.is_member === true
      );

    subscriptionCache.set(
      String(telegramId),
      {
        result: subscribed,
        time: Date.now(),
      }
    );

    return subscribed;
  } catch (error) {
    console.error(
      "Subscription check error:",
      error.message
    );

    return false;
  }
}

/* =====================================================
   SUBSCRIPTION API
===================================================== */

app.post(
  "/api/subscription",
  authenticatedUser,
  async (req, res) => {
    try {
      const subscribed =
        await checkSubscription(
          req.telegramUser.id
        );

      return res.json({
        subscribed,
        channel: CHANNEL_USERNAME,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "SUBSCRIPTION_ERROR",
      });
    }
  }
);

/* Eski frontend uchun */
app.post(
  "/api/check-subscription",
  authenticatedUser,
  async (req, res) => {
    try {
      const subscribed =
        await checkSubscription(
          req.telegramUser.id
        );

      return res.json({
        subscribed,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "SUBSCRIPTION_ERROR",
      });
    }
  }
);

/* =====================================================
   CREATE / UPDATE USER
===================================================== */

async function ensureUser(telegramUser) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let user = await getUserByTelegramId(
      client,
      telegramUser.id,
      true
    );

    if (!user) {
      user = (
        await client.query(
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
            league_level,
            energy_updated_at
          )
          VALUES (
            $1,$2,$3,$4,
            0,300,300,1,1,0,1,NOW()
          )
          RETURNING *
          `,
          [
            telegramUser.id,
            telegramUser.username || "",
            telegramUser.first_name || "",
            telegramUser.photo_url || "",
          ]
        )
      ).rows[0];
    } else {
      user = (
        await client.query(
          `
          UPDATE users
          SET
            username = $1,
            first_name = $2,
            photo_url = $3,
            updated_at = NOW()
          WHERE telegram_id = $4
          RETURNING *
          `,
          [
            telegramUser.username || "",
            telegramUser.first_name || "",
            telegramUser.photo_url || "",
            telegramUser.id,
          ]
        )
      ).rows[0];
    }

    const regen = regenerateEnergy(user);

    await client.query(
      `
      UPDATE users
      SET
        energy = $1,
        energy_updated_at = $2,
        updated_at = NOW()
      WHERE telegram_id = $3
      `,
      [
        regen.energy,
        regen.updatedAt,
        telegramUser.id,
      ]
    );

    user.energy = regen.energy;
    user.energy_updated_at = regen.updatedAt;

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
   ME
===================================================== */

app.post(
  "/api/me",
  authenticatedUser,
  async (req, res) => {
    try {
      const user =
        await ensureUser(
          req.telegramUser
        );

      const rankResult =
        await pool.query(`
          SELECT COUNT(*) + 1 AS rank
          FROM users u1
          WHERE u1.balance > (
            SELECT balance
            FROM users u2
            WHERE u2.telegram_id = $1
          )
        `, [req.telegramUser.id]);

      const rank = Number(
        rankResult.rows[0]?.rank || 1
      );

      return res.json({
        success: true,
        user: formatUser(user, rank),
      });
    } catch (error) {
      console.error(
        "ME ERROR:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR",
      });
    }
  }
);

/* =====================================================
   TAP
===================================================== */

app.post(
  "/api/tap",
  authenticatedUser,
  async (req, res) => {
    const requested =
      Math.floor(
        Number(req.body.taps || 1)
      );

    if (
      !Number.isFinite(requested) ||
      requested < 1
    ) {
      return res.status(400).json({
        error: "INVALID_TAPS",
      });
    }

    const taps = Math.min(
      requested,
      100
    );

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user =
        await getUserByTelegramId(
          client,
          req.telegramUser.id,
          true
        );

      if (!user) {
        user = (
          await client.query(
            `
            INSERT INTO users (
              telegram_id,
              username,
              first_name,
              photo_url
            )
            VALUES ($1,$2,$3,$4)
            RETURNING *
            `,
            [
              req.telegramUser.id,
              req.telegramUser.username || "",
              req.telegramUser.first_name || "",
              req.telegramUser.photo_url || "",
            ]
          )
        ).rows[0];
      }

      // Server-side energy regeneration
      const regen =
        regenerateEnergy(user);

      let energy = regen.energy;

      const actualTaps = Math.min(
        taps,
        energy
      );

      if (actualTaps <= 0) {
        await client.query("COMMIT");

        return res.json({
          success: false,
          tapped: 0,
          message: "NO_ENERGY",
          user: formatUser(user),
        });
      }

      const tapPower = Math.min(
        10,
        Math.max(
          1,
          Number(user.tap_level || 1)
        )
      );

      const earned =
        actualTaps * tapPower;

      energy -= actualTaps;

      await client.query(
        `
        UPDATE users
        SET
          balance = balance + $1,
          energy = $2,
          energy_updated_at = $3,
          updated_at = NOW()
        WHERE telegram_id = $4
        `,
        [
          earned,
          energy,
          new Date(),
          req.telegramUser.id,
        ]
      );

      user.balance =
        Number(user.balance || 0) +
        earned;

      user.energy = energy;
      user.energy_updated_at =
        new Date();

      await updateLeague(
        client,
        user
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        tapped: actualTaps,
        earned,
        user: formatUser(user),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "TAP ERROR:",
        error
      );

      return res.status(500).json({
        error: "TAP_SERVER_ERROR",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   UPGRADE
===================================================== */

app.post(
  "/api/upgrade",
  authenticatedUser,
  async (req, res) => {
    const type = req.body.type;

    if (
      type !== "tap" &&
      type !== "energy"
    ) {
      return res.status(400).json({
        error: "INVALID_UPGRADE",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user =
        await getUserByTelegramId(
          client,
          req.telegramUser.id,
          true
        );

      if (!user) {
        return res.status(404).json({
          error: "USER_NOT_FOUND",
        });
      }

      const regen =
        regenerateEnergy(user);

      user.energy = regen.energy;
      user.energy_updated_at =
        regen.updatedAt;

      await client.query(
        `
        UPDATE users
        SET
          energy = $1,
          energy_updated_at = $2
        WHERE telegram_id = $3
        `,
        [
          user.energy,
          user.energy_updated_at,
          req.telegramUser.id,
        ]
      );

      if (type === "tap") {
        const level =
          Number(user.tap_level || 1);

        if (level >= 10) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "MAX_LEVEL",
          });
        }

        const cost =
          TAP_COSTS[level - 1];

        const balance =
          Number(user.balance || 0);

        if (balance < cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "NOT_ENOUGH_BALANCE",
            cost,
          });
        }

        const newLevel = level + 1;

        const result =
          await client.query(
            `
            UPDATE users
            SET
              balance = balance - $1,
              tap_level = $2,
              updated_at = NOW()
            WHERE telegram_id = $3
            RETURNING *
            `,
            [
              cost,
              newLevel,
              req.telegramUser.id,
            ]
          );

        user = result.rows[0];
      }

      if (type === "energy") {
        const level =
          Number(
            user.energy_level || 1
          );

        if (level >= 10) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "MAX_LEVEL",
          });
        }

        const cost =
          ENERGY_COSTS[level - 1];

        const balance =
          Number(user.balance || 0);

        if (balance < cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "NOT_ENOUGH_BALANCE",
            cost,
          });
        }

        const newLevel = level + 1;

        const newMaxEnergy =
          ENERGY_VALUES[newLevel - 1];

        const result =
          await client.query(
            `
            UPDATE users
            SET
              balance = balance - $1,
              energy_level = $2,
              max_energy = $3,
              energy = $3,
              energy_updated_at = NOW(),
              updated_at = NOW()
            WHERE telegram_id = $4
            RETURNING *
            `,
            [
              cost,
              newLevel,
              newMaxEnergy,
              req.telegramUser.id,
            ]
          );

        user = result.rows[0];
      }

      await updateLeague(
        client,
        user
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        user: formatUser(user),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "UPGRADE ERROR:",
        error
      );

      return res.status(500).json({
        error: "UPGRADE_SERVER_ERROR",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   DAILY REWARD
===================================================== */

app.post(
  "/api/daily",
  authenticatedUser,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user =
        await getUserByTelegramId(
          client,
          req.telegramUser.id,
          true
        );

      if (!user) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "USER_NOT_FOUND",
        });
      }

      const now = new Date();

      if (user.daily_claimed_at) {
        const last =
          new Date(
            user.daily_claimed_at
          );

        const diff =
          now.getTime() -
          last.getTime();

        if (
          diff <
          24 * 60 * 60 * 1000
        ) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "ALREADY_CLAIMED",
            claimedAt:
              last.toISOString(),
          });
        }
      }

      const result =
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
          [
            DAILY_REWARD,
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      await updateLeague(
        client,
        user
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        reward: DAILY_REWARD,
        user: formatUser(user),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "DAILY ERROR:",
        error
      );

      return res.status(500).json({
        error: "DAILY_SERVER_ERROR",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   REFERRAL
===================================================== */

app.post(
  "/api/referral",
  authenticatedUser,
  async (req, res) => {
    const referrerId =
      String(
        req.body.referrerId || ""
      );

    if (
      !referrerId ||
      referrerId ===
        String(req.telegramUser.id)
    ) {
      return res.status(400).json({
        error: "INVALID_REFERRER",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let user =
        await getUserByTelegramId(
          client,
          req.telegramUser.id,
          true
        );

      if (!user) {
        user = (
          await client.query(
            `
            INSERT INTO users (
              telegram_id,
              username,
              first_name,
              photo_url
            )
            VALUES ($1,$2,$3,$4)
            RETURNING *
            `,
            [
              req.telegramUser.id,
              req.telegramUser.username || "",
              req.telegramUser.first_name || "",
              req.telegramUser.photo_url || "",
            ]
          )
        ).rows[0];
      }

      if (user.referred_by) {
        await client.query("ROLLBACK");

        return res.json({
          success: false,
          message: "ALREADY_REFERRED",
        });
      }

      const referrerResult =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [referrerId]
        );

      if (
        referrerResult.rows.length === 0
      ) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "REFERRER_NOT_FOUND",
        });
      }

      await client.query(
        `
        UPDATE users
        SET
          referred_by = $1,
          updated_at = NOW()
        WHERE telegram_id = $2
        `,
        [
          referrerId,
          req.telegramUser.id,
        ]
      );

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
          referrerId,
        ]
      );

      user.referred_by =
        Number(referrerId);

      await client.query("COMMIT");

      return res.json({
        success: true,
        bonus: REFERRAL_BONUS,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "REFERRAL ERROR:",
        error
      );

      return res.status(500).json({
        error: "REFERRAL_SERVER_ERROR",
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   FRIENDS
===================================================== */

app.post(
  "/api/friends",
  authenticatedUser,
  async (req, res) => {
    try {
      const userId =
        req.telegramUser.id;

      const result =
        await pool.query(
          `
          SELECT
            telegram_id,
            username,
            first_name,
            photo_url,
            balance,
            league_level
          FROM users
          WHERE referred_by = $1
          ORDER BY balance DESC
          LIMIT 100
          `,
          [userId]
        );

      return res.json({
        success: true,
        friends: result.rows.map(
          (friend) => {
            const league =
              getLeague(
                friend.league_level
              );

            return {
              telegramId:
                String(
                  friend.telegram_id
                ),
              username:
                friend.username || "",
              firstName:
                friend.first_name || "",
              photoUrl:
                friend.photo_url || "",
              balance:
                Number(
                  friend.balance || 0
                ),
              leagueLevel:
                Number(
                  friend.league_level || 1
                ),
              leagueName:
                league.name,
              leagueIcon:
                league.icon,
            };
          }
        ),
      });
    } catch (error) {
      console.error(
        "FRIENDS ERROR:",
        error
      );

      return res.status(500).json({
        error: "FRIENDS_SERVER_ERROR",
      });
    }
  }
);

/* Eski frontend uchun */
app.get(
  "/api/friends/:telegramId",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            telegram_id,
            username,
            first_name,
            photo_url,
            balance,
            league_level
          FROM users
          WHERE referred_by = $1
          ORDER BY balance DESC
          LIMIT 100
          `,
          [req.params.telegramId]
        );

      return res.json({
        success: true,
        friends: result.rows,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "FRIENDS_ERROR",
      });
    }
  }
);

/* =====================================================
   RANK TOP 100
===================================================== */

app.post(
  "/api/rank",
  authenticatedUser,
  async (req, res) => {
    try {
      const limit = Math.min(
        100,
        Math.max(
          1,
          Number(req.body.limit || 100)
        )
      );

      const result =
        await pool.query(
          `
          SELECT
            telegram_id,
            username,
            first_name,
            photo_url,
            balance,
            league_level,
            RANK() OVER (
              ORDER BY balance DESC
            ) AS rank
          FROM users
          ORDER BY
            balance DESC,
            telegram_id ASC
          LIMIT $1
          `,
          [limit]
        );

      return res.json({
        success: true,
        users: result.rows.map(
          (user) => {
            const league =
              getLeague(
                user.league_level
              );

            return {
              telegramId:
                String(
                  user.telegram_id
                ),
              username:
                user.username || "",
              firstName:
                user.first_name || "",
              photoUrl:
                user.photo_url || "",
              balance:
                Number(
                  user.balance || 0
                ),
              leagueLevel:
                Number(
                  user.league_level || 1
                ),
              leagueName:
                league.name,
              leagueIcon:
                league.icon,
              rank:
                Number(user.rank),
            };
          }
        ),
      });
    } catch (error) {
      console.error(
        "RANK ERROR:",
        error
      );

      return res.status(500).json({
        error: "RANK_SERVER_ERROR",
      });
    }
  }
);

/* GET ham qo'shildi */
app.get(
  "/api/rank",
  async (req, res) => {
    try {
      const limit = Math.min(
        100,
        Math.max(
          1,
          Number(req.query.limit || 100)
        )
      );

      const result =
        await pool.query(
          `
          SELECT
            telegram_id,
            username,
            first_name,
            photo_url,
            balance,
            league_level,
            RANK() OVER (
              ORDER BY balance DESC
            ) AS rank
          FROM users
          ORDER BY
            balance DESC,
            telegram_id ASC
          LIMIT $1
          `,
          [limit]
        );

      return res.json({
        success: true,
        users: result.rows.map(
          (user) => {
            const league =
              getLeague(
                user.league_level
              );

            return {
              telegramId:
                String(
                  user.telegram_id
                ),
              username:
                user.username || "",
              firstName:
                user.first_name || "",
              photoUrl:
                user.photo_url || "",
              balance:
                Number(
                  user.balance || 0
                ),
              leagueLevel:
                Number(
                  user.league_level || 1
                ),
              leagueName:
                league.name,
              leagueIcon:
                league.icon,
              rank:
                Number(user.rank),
            };
          }
        ),
      });
    } catch (error) {
      console.error(
        "RANK GET ERROR:",
        error
      );

      return res.status(500).json({
        error: "RANK_SERVER_ERROR",
      });
    }
  }
);

/* =====================================================
   LEAGUES
===================================================== */

app.get(
  "/api/leagues",
  (req, res) => {
    res.json({
      success: true,
      leagues: LEAGUES,
    });
  }
);

/* =====================================================
   STATUS
===================================================== */

app.get(
  "/api/status",
  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      return res.json({
        success: true,
        server: "online",
        database: "online",
        time: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        server: "online",
        database: "offline",
      });
    }
  }
);

/* =====================================================
   TELEGRAM BOT
===================================================== */

if (bot) {
  bot.start(async (ctx) => {
    try {
      const telegramUser =
        ctx.from;

      await ensureUser(
        telegramUser
      );

      const startPayload =
        ctx.startPayload || "";

      if (
        startPayload.startsWith("ref_")
      ) {
        const referrerId =
          startPayload.substring(4);

        if (
          referrerId &&
          String(referrerId) !==
            String(telegramUser.id)
        ) {
          const client =
            await pool.connect();

          try {
            await client.query(
              "BEGIN"
            );

            const user =
              await getUserByTelegramId(
                client,
                telegramUser.id,
                true
              );

            if (
              user &&
              !user.referred_by
            ) {
              const referrer =
                await getUserByTelegramId(
                  client,
                  referrerId,
                  true
                );

              if (referrer) {
                await client.query(
                  `
                  UPDATE users
                  SET
                    referred_by = $1,
                    updated_at = NOW()
                  WHERE telegram_id = $2
                  `,
                  [
                    referrerId,
                    telegramUser.id,
                  ]
                );

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
                    referrerId,
                  ]
                );
              }
            }

            await client.query(
              "COMMIT"
            );
          } catch (error) {
            await client.query(
              "ROLLBACK"
            );
            console.error(
              "BOT REFERRAL:",
              error
            );
          } finally {
            client.release();
          }
        }
      }

      await ctx.reply(
        `🪙 UZCOIN\n\n` +
        `Tap qilib UZCOIN yig'ing!\n\n` +
        `👇 Mini Appni oching:`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🪙 UZCOIN OCHISH",
                  web_app: {
                    url:
                      process.env.WEB_APP_URL ||
                      "https://uzcoin.onrender.com",
                  },
                },
              ],
            ],
          },
        }
      );
    } catch (error) {
      console.error(
        "BOT START ERROR:",
        error
      );
    }
  });

  bot.command(
    "help",
    async (ctx) => {
      await ctx.reply(
        "🪙 UZCOIN\n\n" +
        "• Tap — coin yig'ing\n" +
        "• Boost — Tap Power va Energy oshiring\n" +
        "• Earn — vazifalarni bajaring\n" +
        "• Friends — do'st taklif qiling\n" +
        "• Rank — Top 100 ni ko'ring\n" +
        "• League — ligangizni oshiring"
      );
    }
  );
}

/* =====================================================
   TELEGRAM WEBHOOK
===================================================== */

app.post(
  "/telegram-webhook",
  async (req, res) => {
    if (!bot) {
      return res.sendStatus(200);
    }

    try {
      await bot.handleUpdate(
        req.body
      );

      return res.sendStatus(200);
    } catch (error) {
      console.error(
        "WEBHOOK ERROR:",
        error
      );

      return res.sendStatus(500);
    }
  }
);

/* =====================================================
   HOME
===================================================== */

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      require("path").join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =====================================================
   404 API
===================================================== */

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      error: "API_NOT_FOUND",
      path: req.path,
    });
  }
);

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
  (err, req, res, next) => {
    console.error(
      "GLOBAL ERROR:",
      err
    );

    res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
);

/* =====================================================
   START
===================================================== */

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      () => {
        console.log(
          `UZCOIN server ${PORT}-portda ishga tushdi.`
        );
      }
    );

    if (bot) {
      console.log(
        "Telegram bot tayyor."
      );

      // WEBHOOK_URL bo'lsa webhook o'rnatiladi.
      if (process.env.WEBHOOK_URL) {
        const webhookUrl =
          `${process.env.WEBHOOK_URL}/telegram-webhook`;

        bot.telegram
          .setWebhook(webhookUrl)
          .then(() => {
            console.log(
              "Webhook o'rnatildi:",
              webhookUrl
            );
          })
          .catch((error) => {
            console.error(
              "Webhook error:",
              error.message
            );
          });
      }
    }
  } catch (error) {
    console.error(
      "SERVER START ERROR:",
      error
    );

    process.exit(1);
  }
}

startServer();
