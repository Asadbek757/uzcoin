const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");

const app = express();

/* =====================================================
   ENV
===================================================== */

const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "https://uzcoin.onrender.com";

const REQUIRED_CHANNEL = "@uzcoin_officiall";
const CHANNEL_URL = "https://t.me/uzcoin_officiall";
const BOT_USERNAME = "UZCoinTapBot";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing");
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing");
}

/* =====================================================
   EXPRESS
===================================================== */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* =====================================================
   TELEGRAM BOT
===================================================== */

const bot = BOT_TOKEN
  ? new Telegraf(BOT_TOKEN)
  : null;

/* =====================================================
   DATABASE
===================================================== */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: false,
        }
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
    name: "BRONZE",
    icon: "🥉",
    min: 0,
  },
  {
    level: 2,
    name: "SILVER",
    icon: "🥈",
    min: 2000,
  },
  {
    level: 3,
    name: "GOLD",
    icon: "🥇",
    min: 10000,
  },
  {
    level: 4,
    name: "PLATINUM",
    icon: "💎",
    min: 50000,
  },
  {
    level: 5,
    name: "DIAMOND",
    icon: "💠",
    min: 250000,
  },
  {
    level: 6,
    name: "MASTER",
    icon: "👑",
    min: 1000000,
  },
  {
    level: 7,
    name: "GRANDMASTER",
    icon: "🔥",
    min: 5000000,
  },
  {
    level: 8,
    name: "CHAMPION",
    icon: "⚔️",
    min: 25000000,
  },
  {
    level: 9,
    name: "LEGEND",
    icon: "🌟",
    min: 100000000,
  },
  {
    level: 10,
    name: "TITAN",
    icon: "🏆",
    min: 500000000,
  },
];

const REFERRAL_BONUS = 500;
const DAILY_REWARD = 100;

/* =====================================================
   HELPERS
===================================================== */

function getLeagueByLevel(level) {
  let result = LEAGUES[0];

  for (const league of LEAGUES) {
    if (league.level <= Number(level || 1)) {
      result = league;
    }
  }

  return result;
}

function getLeagueFromBalance(balance) {
  const amount = Number(balance || 0);

  let result = LEAGUES[0];

  for (const league of LEAGUES) {
    if (amount >= league.min) {
      result = league;
    }
  }

  return result;
}

function getTapUpgradeCost(level) {
  const numericLevel = Number(level || 1);

  if (numericLevel >= 10) {
    return null;
  }

  return (
    TAP_COSTS[numericLevel - 1] ||
    Math.floor(
      500 * Math.pow(1.8, numericLevel - 1)
    )
  );
}

function getMaxEnergy(level) {
  const numericLevel = Number(level || 1);

  return (
    ENERGY_VALUES[
      Math.min(
        Math.max(numericLevel - 1, 0),
        ENERGY_VALUES.length - 1
      )
    ] || 300
  );
}

function getEnergyUpgradeCost(level) {
  const numericLevel = Number(level || 1);

  if (numericLevel >= 10) {
    return null;
  }

  return (
    ENERGY_COSTS[numericLevel - 1] || null
  );
}

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

    const dataCheckString =
      Array.from(params.entries())
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
      calculatedHash.length !==
      receivedHash.length
    ) {
      return null;
    }

    if (
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
    console.error(
      "❌ InitData validation error:",
      error.message
    );

    return null;
  }
}

/* =====================================================
   AUTH
===================================================== */

function getInitDataFromRequest(req) {
  return (
    req.headers["x-telegram-init-data"] ||
    req.headers["X-Telegram-Init-Data"] ||
    req.body?.initData ||
    req.query?.initData ||
    ""
  );
}

function getTelegramUserFromRequest(req) {
  const initData =
    getInitDataFromRequest(req);

  return validateInitData(initData);
}

function requireTelegramUser(req, res, next) {
  const telegramUser =
    getTelegramUserFromRequest(req);

  if (
    !telegramUser ||
    !telegramUser.id
  ) {
    return res.status(401).json({
      error:
        "Telegram authorization kerak.",
    });
  }

  req.telegramUser = telegramUser;

  next();
}

/* =====================================================
   DATABASE INIT
===================================================== */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,

      username TEXT,
      first_name TEXT,
      photo_url TEXT,

      balance NUMERIC(30, 0) DEFAULT 0,

      energy INTEGER DEFAULT 300,
      max_energy INTEGER DEFAULT 300,

      tap_level INTEGER DEFAULT 1,
      energy_level INTEGER DEFAULT 1,

      referrals INTEGER DEFAULT 0,
      referred_by BIGINT,

      league_level INTEGER DEFAULT 1,

      daily_claimed_at TIMESTAMP,

      energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columns = [
    ["username", "TEXT"],
    ["first_name", "TEXT"],
    ["photo_url", "TEXT"],
    ["balance", "NUMERIC(30, 0) DEFAULT 0"],
    ["energy", "INTEGER DEFAULT 300"],
    ["max_energy", "INTEGER DEFAULT 300"],
    ["tap_level", "INTEGER DEFAULT 1"],
    ["energy_level", "INTEGER DEFAULT 1"],
    ["referrals", "INTEGER DEFAULT 0"],
    ["referred_by", "BIGINT"],
    ["league_level", "INTEGER DEFAULT 1"],
    ["daily_claimed_at", "TIMESTAMP"],
    [
      "energy_updated_at",
      "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    ],
    [
      "created_at",
      "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    ],
    [
      "updated_at",
      "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    ],
  ];

  for (const [name, type] of columns) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS
      ${name} ${type}
    `);
  }

  await pool.query(`
    UPDATE users
    SET tap_level = 1
    WHERE tap_level IS NULL
       OR tap_level < 1
  `);

  await pool.query(`
    UPDATE users
    SET energy_level = 1
    WHERE energy_level IS NULL
       OR energy_level < 1
  `);

  await pool.query(`
    UPDATE users
    SET max_energy = 300
    WHERE max_energy IS NULL
       OR max_energy < 300
  `);

  await pool.query(`
    UPDATE users
    SET energy =
      LEAST(
        GREATEST(
          COALESCE(energy, 0),
          0
        ),
        GREATEST(
          COALESCE(max_energy, 300),
          300
        )
      )
  `);

  await pool.query(`
    UPDATE users
    SET league_level = 1
    WHERE league_level IS NULL
       OR league_level < 1
  `);

  await pool.query(`
    UPDATE users
    SET energy_updated_at =
      COALESCE(
        energy_updated_at,
        updated_at,
        CURRENT_TIMESTAMP
      )
    WHERE energy_updated_at IS NULL
  `);

  for (const league of LEAGUES) {
    await pool.query(
      `
      UPDATE users
      SET league_level =
        GREATEST(
          COALESCE(league_level, 1),
          $1
        )
      WHERE balance >= $2
      `,
      [
        league.level,
        league.min,
      ]
    );
  }

  console.log("✅ Database initialized");
}

/* =====================================================
   USER
===================================================== */

async function createOrUpdateUser(
  telegramUser,
  client = pool
) {
  const result =
    await client.query(
      `
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        photo_url
      )

      VALUES (
        $1,
        $2,
        $3,
        $4
      )

      ON CONFLICT (telegram_id)

      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        photo_url =
          COALESCE(
            EXCLUDED.photo_url,
            users.photo_url
          ),
        updated_at = CURRENT_TIMESTAMP

      RETURNING *
      `,
      [
        telegramUser.id,
        telegramUser.username || "",
        telegramUser.first_name || "Player",
        telegramUser.photo_url || null,
      ]
    );

  return result.rows[0];
}

/* =====================================================
   ENERGY
===================================================== */

async function regenerateEnergy(
  client,
  user
) {
  let energy =
    Number(user.energy || 0);

  const maxEnergy =
    Number(
      user.max_energy || 300
    );

  if (energy >= maxEnergy) {
    return {
      energy: maxEnergy,
      energyUpdatedAt:
        user.energy_updated_at ||
        new Date(),
    };
  }

  const lastUpdate = new Date(
    user.energy_updated_at ||
      user.updated_at ||
      Date.now()
  );

  const now = Date.now();

  const elapsedSeconds =
    Math.floor(
      (now -
        lastUpdate.getTime()) /
        1000
    );

  if (elapsedSeconds <= 0) {
    return {
      energy,
      energyUpdatedAt:
        lastUpdate,
    };
  }

  const newEnergy =
    Math.min(
      maxEnergy,
      energy + elapsedSeconds
    );

  const newTimestamp =
    new Date(
      lastUpdate.getTime() +
        elapsedSeconds * 1000
    );

  await client.query(
    `
    UPDATE users
    SET
      energy = $2,
      energy_updated_at = $3,
      updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = $1
    `,
    [
      user.telegram_id,
      newEnergy,
      newTimestamp,
    ]
  );

  return {
    energy: newEnergy,
    energyUpdatedAt:
      newTimestamp,
  };
}

/* =====================================================
   LEAGUE
===================================================== */

async function updatePermanentLeague(
  client,
  telegramId,
  balance,
  currentLeagueLevel
) {
  const current =
    Number(currentLeagueLevel || 1);

  const earned =
    getLeagueFromBalance(balance);

  const newLevel =
    Math.max(
      current,
      earned.level
    );

  if (newLevel !== current) {
    await client.query(
      `
      UPDATE users
      SET
        league_level = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        telegramId,
        newLevel,
      ]
    );
  }

  return newLevel;
}

/* =====================================================
   FORMAT USER
===================================================== */

function formatUser(
  user,
  rank = null
) {
  const league =
    getLeagueByLevel(
      Number(
        user.league_level || 1
      )
    );

  return {
    telegramId:
      String(user.telegram_id),

    username:
      user.username || "",

    firstName:
      user.first_name || "Player",

    photoUrl:
      user.photo_url || "",

    balance:
      Number(user.balance || 0),

    energy:
      Number(user.energy || 0),

    maxEnergy:
      Number(
        user.max_energy || 300
      ),

    tapLevel:
      Number(
        user.tap_level || 1
      ),

    energyLevel:
      Number(
        user.energy_level || 1
      ),

    tapPower:
      Number(
        user.tap_level || 1
      ),

    power:
      Number(
        user.tap_level || 1
      ),

    referrals:
      Number(
        user.referrals || 0
      ),

    leagueLevel:
      league.level,

    leagueName:
      league.name,

    leagueIcon:
      league.icon,

    league: {
      level: league.level,
      name: league.name,
      icon: league.icon,
    },

    rank,

    dailyClaimedAt:
      user.daily_claimed_at
        ? new Date(
            user.daily_claimed_at
          ).toISOString()
        : null,

    energyUpdatedAt:
      user.energy_updated_at
        ? new Date(
            user.energy_updated_at
          ).toISOString()
        : new Date().toISOString(),

    nextTapUpgradeCost:
      Number(
        user.tap_level || 1
      ) < 10
        ? getTapUpgradeCost(
            Number(
              user.tap_level || 1
            )
          )
        : null,

    nextEnergyUpgradeCost:
      Number(
        user.energy_level || 1
      ) < 10
        ? getEnergyUpgradeCost(
            Number(
              user.energy_level || 1
            )
          )
        : null,

    upgrades: {
      tap: {
        level:
          Number(
            user.tap_level || 1
          ),

        cost:
          Number(
            user.tap_level || 1
          ) < 10
            ? getTapUpgradeCost(
                Number(
                  user.tap_level || 1
                )
              )
            : null,
      },

      energy: {
        level:
          Number(
            user.energy_level || 1
          ),

        max:
          Number(
            user.max_energy || 300
          ),

        cost:
          Number(
            user.energy_level || 1
          ) < 10
            ? getEnergyUpgradeCost(
                Number(
                  user.energy_level || 1
                )
              )
            : null,
      },
    },
  };
}

/* =====================================================
   SUBSCRIPTION CACHE
===================================================== */

const subscriptionCache = new Map();

const SUB_CACHE_MS = 60 * 1000;

/* =====================================================
   TELEGRAM SUBSCRIPTION CHECK
===================================================== */

async function isSubscribed(telegramId) {
  if (!bot) {
    console.error(
      "❌ Subscription check: BOT_TOKEN mavjud emas"
    );

    return false;
  }

  try {
    const member =
      await bot.telegram.getChatMember(
        REQUIRED_CHANNEL,
        telegramId
      );

    console.log(
      `📢 Telegram member status: user=${telegramId}, status=${member.status}`
    );

    /*
      Kanal egasi
    */
    if (member.status === "creator") {
      return true;
    }

    /*
      Kanal administratori
    */
    if (member.status === "administrator") {
      return true;
    }

    /*
      Oddiy obunachi
    */
    if (member.status === "member") {
      return true;
    }

    /*
      Restricted, lekin hali kanal a'zosi
    */
    if (
      member.status === "restricted" &&
      member.is_member === true
    ) {
      return true;
    }

    /*
      left / kicked / boshqa holatlar
    */
    return false;

  } catch (error) {
    console.error(
      "❌ Telegram subscription API error:",
      error?.description ||
        error?.message ||
        error
    );

    return false;
  }
}

async function isSubscribedCached(
  telegramId,
  force = false
) {
  const key = String(telegramId);

  /*
    force=true bo'lsa cache ishlatilmaydi.
    Bu aynan "Obunani tekshirish" tugmasi
    uchun kerak.
  */
  if (!force) {
    const cached =
      subscriptionCache.get(key);

    if (
      cached &&
      Date.now() -
        cached.checkedAt <
        SUB_CACHE_MS
    ) {
      return cached.value;
    }
  }

  const value =
    await isSubscribed(telegramId);

  subscriptionCache.set(key, {
    value,
    checkedAt: Date.now(),
  });

  return value;
}

/* =====================================================
   RANK
===================================================== */

async function getUserRank(
  client,
  balance
) {
  const result =
    await client.query(
      `
      SELECT COUNT(*) + 1 AS rank
      FROM users
      WHERE balance > $1
      `,
      [balance]
    );

  return Number(
    result.rows[0]?.rank || 1
  );
}

/* =====================================================
   API: SUBSCRIPTION
===================================================== */

app.get(
  "/api/subscription",
  requireTelegramUser,
  async (req, res) => {
    try {
      const force =
        String(
          req.query.force || ""
        ).toLowerCase() === "true";

      const telegramId =
        req.telegramUser.id;

      console.log(
        `🔎 Subscription check: user=${telegramId}, force=${force}`
      );

      const subscribed =
        await isSubscribedCached(
          telegramId,
          force
        );

      console.log(
        `📢 Subscription result: user=${telegramId}, subscribed=${subscribed}`
      );

      return res.json({
        ok: true,
        subscribed,
        channel: CHANNEL_URL,
        telegramId:
          String(telegramId),
      });
    } catch (error) {
      console.error(
        "❌ /api/subscription:",
        error?.description ||
          error?.message ||
          error
      );

      return res.status(500).json({
        ok: false,
        error: "Server xatosi",
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
    const client =
      await pool.connect();

    try {
      const subscribed =
        await isSubscribedCached(
          req.telegramUser.id
        );

      let user =
        await createOrUpdateUser(
          req.telegramUser,
          client
        );

      await regenerateEnergy(
        client,
        user
      );

      let result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      await updatePermanentLeague(
        client,
        req.telegramUser.id,
        user.balance,
        user.league_level
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      const rank =
        await getUserRank(
          client,
          user.balance
        );

      return res.json({
        ok: true,
        subscribed,
        user:
          formatUser(
            user,
            rank
          ),
      });
    } catch (error) {
      console.error(
        "❌ /api/me:",
        error
      );

      return res.status(500).json({
        error: "Server xatosi",
      });
    } finally {
      client.release();
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
    const client =
      await pool.connect();

    try {
      const subscribed =
        await isSubscribedCached(
          req.telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED",
        });
      }

      let taps =
        Math.floor(
          Number(
            req.body?.taps || 0
          )
        );

      if (
        !Number.isFinite(taps) ||
        taps < 1
      ) {
        return res.status(400).json({
          error:
            "INVALID_TAPS",
        });
      }

      taps = Math.min(taps, 100);

      await client.query("BEGIN");

      let result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            req.telegramUser.id,
          ]
        );

      if (!result.rows.length) {
        await createOrUpdateUser(
          req.telegramUser,
          client
        );

        result =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [
              req.telegramUser.id,
            ]
          );
      }

      let user =
        result.rows[0];

      await regenerateEnergy(
        client,
        user
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      const energy =
        Number(user.energy || 0);

      const actualTaps =
        Math.min(
          taps,
          energy
        );

      if (actualTaps <= 0) {
        await client.query("COMMIT");

        return res.json({
          ok: true,
          added: 0,
          earned: 0,
          taps: 0,
          user:
            formatUser(user),
        });
      }

      const power =
        Number(
          user.tap_level || 1
        );

      const earned =
        actualTaps * power;

      result =
        await client.query(
          `
          UPDATE users
          SET
            balance =
              balance + $2,

            energy =
              energy - $3,

            energy_updated_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE telegram_id = $1

          RETURNING *
          `,
          [
            req.telegramUser.id,
            earned,
            actualTaps,
          ]
        );

      user = result.rows[0];

      await updatePermanentLeague(
        client,
        req.telegramUser.id,
        user.balance,
        user.league_level
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      await client.query("COMMIT");

      return res.json({
        ok: true,
        added: earned,
        earned,
        taps: actualTaps,
        user:
          formatUser(user),
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "❌ /api/tap:",
        error
      );

      return res.status(500).json({
        error: "Server xatosi",
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
    const client =
      await pool.connect();

    try {
      const subscribed =
        await isSubscribedCached(
          req.telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED",
        });
      }

      const type =
        req.body?.type;

      if (
        type !== "tap" &&
        type !== "energy"
      ) {
        return res.status(400).json({
          error:
            "INVALID_UPGRADE",
        });
      }

      await client.query("BEGIN");

      let result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            req.telegramUser.id,
          ]
        );

      if (!result.rows.length) {
        await createOrUpdateUser(
          req.telegramUser,
          client
        );

        result =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [
              req.telegramUser.id,
            ]
          );
      }

      let user =
        result.rows[0];

      await regenerateEnergy(
        client,
        user
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      const balance =
        Number(
          user.balance || 0
        );

      if (type === "tap") {
        const level =
          Number(
            user.tap_level || 1
          );

        if (level >= 10) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error:
              "MAX_LEVEL",
          });
        }

        const cost =
          getTapUpgradeCost(level);

        if (balance < cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error:
              "NOT_ENOUGH_BALANCE",
          });
        }

        result =
          await client.query(
            `
            UPDATE users
            SET
              balance =
                balance - $2,

              tap_level =
                tap_level + 1,

              updated_at =
                CURRENT_TIMESTAMP

            WHERE telegram_id = $1

            RETURNING *
            `,
            [
              req.telegramUser.id,
              cost,
            ]
          );
      }

      if (type === "energy") {
        const level =
          Number(
            user.energy_level || 1
          );

        if (level >= 10) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error:
              "MAX_LEVEL",
          });
        }

        const cost =
          getEnergyUpgradeCost(level);

        if (balance < cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error:
              "NOT_ENOUGH_BALANCE",
          });
        }

        const newLevel =
          level + 1;

        const newMaxEnergy =
          getMaxEnergy(newLevel);

        result =
          await client.query(
            `
            UPDATE users
            SET
              balance =
                balance - $2,

              energy_level =
                $3,

              max_energy =
                $4,

              energy =
                $4,

              energy_updated_at =
                CURRENT_TIMESTAMP,

              updated_at =
                CURRENT_TIMESTAMP

            WHERE telegram_id = $1

            RETURNING *
            `,
            [
              req.telegramUser.id,
              cost,
              newLevel,
              newMaxEnergy,
            ]
          );
      }

      user = result.rows[0];

      await updatePermanentLeague(
        client,
        req.telegramUser.id,
        user.balance,
        user.league_level
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [
            req.telegramUser.id,
          ]
        );

      user = result.rows[0];

      await client.query("COMMIT");

      return res.json({
        ok: true,
        success: true,
        user:
          formatUser(user),
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "❌ /api/upgrade:",
        error
      );

      return res.status(500).json({
        error: "Server xatosi",
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
    const client =
      await pool.connect();

    try {
      const subscribed =
        await isSubscribedCached(
          req.telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED",
        });
      }

      await client.query("BEGIN");

      let result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            req.telegramUser.id,
          ]
        );

      if (!result.rows.length) {
        await createOrUpdateUser(
          req.telegramUser,
          client
        );

        result =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [
              req.telegramUser.id,
            ]
          );
      }

      const user =
        result.rows[0];

      let claimedToday = false;

      if (user.daily_claimed_at) {
        const last =
          new Date(
            user.daily_claimed_at
          );

        const now = new Date();

        claimedToday =
          last.getFullYear() ===
            now.getFullYear() &&
          last.getMonth() ===
            now.getMonth() &&
          last.getDate() ===
            now.getDate();
      }

      if (claimedToday) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error:
            "ALREADY_CLAIMED",
        });
      }

      result =
        await client.query(
          `
          UPDATE users
          SET
            balance =
              balance + $2,

            daily_claimed_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE telegram_id = $1

          RETURNING *
          `,
          [
            req.telegramUser.id,
            DAILY_REWARD,
          ]
        );

      let updatedUser =
        result.rows[0];

      await updatePermanentLeague(
        client,
        req.telegramUser.id,
        updatedUser.balance,
        updatedUser.league_level
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [
            req.telegramUser.id,
          ]
        );

      updatedUser =
        result.rows[0];

      await client.query("COMMIT");

      return res.json({
        ok: true,
        success: true,
        reward:
          DAILY_REWARD,
        user:
          formatUser(updatedUser),
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "❌ /api/daily:",
        error
      );

      return res.status(500).json({
        error: "Server xatosi",
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
      const result =
        await pool.query(
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
          [
            req.telegramUser.id,
          ]
        );

      const friends =
        result.rows.map(
          (friend) => ({
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

            createdAt:
              friend.created_at
                ? new Date(
                    friend.created_at
                  ).toISOString()
                : null,
          })
        );

      return res.json({
        ok: true,
        referrals:
          friends.length,
        friends,
      });
    } catch (error) {
      console.error(
        "❌ /api/friends:",
        error
      );

      return res.status(500).json({
        error: "Server xatosi",
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
      let limit =
        Number(
          req.query.limit || 100
        );

      if (!Number.isFinite(limit)) {
        limit = 100;
      }

      limit =
        Math.max(
          1,
          Math.min(
            100,
            Math.floor(limit)
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
            created_at

          FROM users

          ORDER BY
            balance DESC,
            created_at ASC

          LIMIT $1
          `,
          [limit]
        );

      const ranking =
        result.rows.map(
          (user, index) => {
            const league =
              getLeagueByLevel(
                Number(
                  user.league_level || 1
                )
              );

            return {
              rank:
                index + 1,

              telegramId:
                String(
                  user.telegram_id
                ),

              username:
                user.username || "",

              firstName:
                user.first_name ||
                "Player",

              photoUrl:
                user.photo_url || "",

              balance:
                Number(
                  user.balance || 0
                ),

              leagueLevel:
                league.level,

              leagueName:
                league.name,

              leagueIcon:
                league.icon,

              league: {
                level:
                  league.level,

                name:
                  league.name,

                icon:
                  league.icon,
              },
            };
          }
        );

      const myUser =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [
            req.telegramUser.id,
          ]
        );

      let myRank = null;
      let myData = null;

      if (myUser.rows.length) {
        const me =
          myUser.rows[0];

        myRank =
          await getUserRank(
            pool,
            me.balance
          );

        const league =
          getLeagueByLevel(
            Number(
              me.league_level || 1
            )
          );

        myData = {
          rank: myRank,
          balance:
            Number(
              me.balance || 0
            ),
          league: {
            level:
              league.level,
            name:
              league.name,
            icon:
              league.icon,
          },
        };
      }

      return res.json({
        ok: true,

        rank: ranking,

        users: ranking,

        user: myData,

        players: ranking,
      });
    } catch (error) {
      console.error(
        "❌ /api/rank:",
        error
      );

      return res.status(500).json({
        error: "Server xatosi",
      });
    }
  }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      return res.json({
        ok: true,
        service: "UZCOIN",
        database: true,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        database: false,
      });
    }
  }
);

/* =====================================================
   REFERRAL
===================================================== */

async function processReferral(
  newUserId,
  referrerId
) {
  if (!referrerId) {
    return false;
  }

  if (
    String(newUserId) ===
    String(referrerId)
  ) {
    return false;
  }

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    const newUserResult =
      await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        FOR UPDATE
        `,
        [newUserId]
      );

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
      !newUserResult.rows.length ||
      !referrerResult.rows.length
    ) {
      await client.query("ROLLBACK");

      return false;
    }

    const newUser =
      newUserResult.rows[0];

    if (newUser.referred_by) {
      await client.query("ROLLBACK");

      return false;
    }

    await client.query(
      `
      UPDATE users
      SET
        referred_by = $2,
        balance =
          balance + $3,
        updated_at =
          CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        newUserId,
        referrerId,
        REFERRAL_BONUS,
      ]
    );

    await client.query(
      `
      UPDATE users
      SET
        referrals =
          referrals + 1,

        balance =
          balance + $2,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE telegram_id = $1
      `,
      [
        referrerId,
        REFERRAL_BONUS,
      ]
    );

    await client.query("COMMIT");

    return true;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error(
      "❌ Referral error:",
      error
    );

    return false;
  } finally {
    client.release();
  }
}

/* =====================================================
   TELEGRAM BOT
===================================================== */

if (bot) {
  bot.start(
    async (ctx) => {
      try {
        const telegramUser =
          ctx.from;

        const payload =
          ctx.startPayload || "";

        const referrerId =
          payload.startsWith("ref_")
            ? payload.substring(4)
            : null;

        await createOrUpdateUser(
          telegramUser
        );

        if (
          referrerId &&
          String(referrerId) !==
            String(telegramUser.id)
        ) {
          await processReferral(
            telegramUser.id,
            referrerId
          );
        }

        await ctx.reply(
          `👋 Salom, ${
            telegramUser.first_name ||
            "Player"
          }!\n\n🪙 UZCOIN'ga xush kelibsiz.`,
          Markup.inlineKeyboard([
            [
              Markup.button.webApp(
                "🪙 UZCOIN'ni ochish",
                PUBLIC_URL
              ),
            ],
            [
              Markup.button.url(
                "📢 Kanal",
                CHANNEL_URL
              ),
            ],
          ])
        );
      } catch (error) {
        console.error(
          "❌ Bot start error:",
          error
        );
      }
    }
  );

  bot.catch((error) => {
    console.error(
      "❌ Telegram bot error:",
      error
    );
  });
}

/* =====================================================
   API 404
===================================================== */

app.use(
  "/api",
  (req, res) => {
    return res.status(404).json({
      ok: false,
      error:
        "UZCOIN API NOT FOUND",
      path:
        req.originalUrl,
    });
  }
);

/* =====================================================
   TELEGRAM WEBHOOK
===================================================== */

if (bot) {
  app.post(
    "/telegram-webhook",
    async (req, res) => {
      try {
        await bot.handleUpdate(
          req.body
        );

        res.sendStatus(200);
      } catch (error) {
        console.error(
          "❌ Webhook error:",
          error
        );

        res.sendStatus(500);
      }
    }
  );
}

/* =====================================================
   FRONTEND FALLBACK
===================================================== */

app.use(
  (req, res, next) => {
    if (
      req.method === "GET" &&
      !req.path.startsWith("/api") &&
      !req.path.startsWith("/health")
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
  }
);

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ GLOBAL ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      error:
        "Server xatosi",
    });
  }
);

/* =====================================================
   START
===================================================== */

async function startServer() {
  try {
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL environment variable topilmadi."
      );
    }

    await initDatabase();

    app.listen(
      PORT,
      () => {
        console.log(
          `🚀 UZCOIN server running on port ${PORT}`
        );

        console.log(
          `🌐 Public URL: ${PUBLIC_URL}`
        );

        console.log(
          `📢 Required channel: ${REQUIRED_CHANNEL}`
        );

        console.log(
          `🤖 Bot: @${BOT_USERNAME}`
        );
      }
    );

    if (bot) {
      try {
        await bot.telegram.setWebhook(
          `${PUBLIC_URL}/telegram-webhook`
        );

        console.log(
          "🤖 Telegram webhook configured"
        );
      } catch (error) {
        console.error(
          "❌ Webhook setup error:",
          error?.description ||
            error?.message ||
            error
        );
      }
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
    if (bot) {
      bot.stop("SIGINT");
    }

    pool.end();
  }
);

process.once(
  "SIGTERM",
  () => {
    if (bot) {
      bot.stop("SIGTERM");
    }

    pool.end();
  }
);

/* =====================================================
   START SERVER
===================================================== */

startServer();
