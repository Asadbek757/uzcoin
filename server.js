const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");

const app = express();

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


// ============================================================
// EXPRESS
// ============================================================

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));


// ============================================================
// BOT
// ============================================================

let bot = null;

if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);
} else {
  console.warn("WARNING: BOT_TOKEN is not set.");
}


// ============================================================
// DATABASE
// ============================================================

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});


// ============================================================
// GAME SETTINGS
// OLD VERSION
// ============================================================

const TAP_COSTS = [
  500,
  900,
  1620,
  2916,
  5249,
  9448,
  17006,
  30611,
  55099
];

const ENERGY_COSTS = [
  1000,
  5000,
  25000,
  100000,
  500000,
  2500000,
  10000000
];

const MAX_ENERGY_VALUES = [
  300,
  500,
  1000,
  5000,
  10000,
  25000,
  50000,
  100000
];

const REFERRAL_BONUS = 500;
const DAILY_REWARD = 100;


// ============================================================
// OLD LEAGUES
// ============================================================

const LEAGUES = [
  {
    level: 1,
    name: "BRONZE",
    icon: "🥉",
    min: 0
  },
  {
    level: 2,
    name: "SILVER",
    icon: "🥈",
    min: 2000
  },
  {
    level: 3,
    name: "GOLD",
    icon: "🥇",
    min: 10000
  },
  {
    level: 4,
    name: "DIAMOND",
    icon: "💎",
    min: 50000
  },
  {
    level: 5,
    name: "MASTER",
    icon: "👑",
    min: 100000
  }
];


// ============================================================
// HELPERS
// ============================================================

function getLeagueByLevel(level) {
  return (
    LEAGUES.find((x) => x.level === Number(level)) ||
    LEAGUES[0]
  );
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
  const index = Number(level) - 1;

  if (index < 0) {
    return TAP_COSTS[0];
  }

  if (index >= TAP_COSTS.length) {
    return TAP_COSTS[TAP_COSTS.length - 1];
  }

  return TAP_COSTS[index];
}


function getEnergyUpgradeCost(level) {
  const index = Number(level) - 1;

  if (index < 0) {
    return ENERGY_COSTS[0];
  }

  if (index >= ENERGY_COSTS.length) {
    return null;
  }

  return ENERGY_COSTS[index];
}


function getMaxEnergy(level) {
  const index = Number(level) - 1;

  if (index < 0) {
    return MAX_ENERGY_VALUES[0];
  }

  if (index >= MAX_ENERGY_VALUES.length) {
    return MAX_ENERGY_VALUES[MAX_ENERGY_VALUES.length - 1];
  }

  return MAX_ENERGY_VALUES[index];
}


// ============================================================
// TELEGRAM INIT DATA VALIDATION
// ============================================================

function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) {
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

    if (
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(hash)
      )
    ) {
      return null;
    }

    const userRaw = params.get("user");

    if (!userRaw) {
      return null;
    }

    const user = JSON.parse(userRaw);

    if (!user || !user.id) {
      return null;
    }

    return {
      ...user,
      id: Number(user.id)
    };
  } catch (error) {
    console.error("validateInitData error:", error.message);
    return null;
  }
}


// ============================================================
// GET INIT DATA FROM OLD OR NEW CLIENT
// ============================================================

function getInitData(req) {
  return (
    req.body?.initData ||
    req.query?.initData ||
    req.headers["x-telegram-init-data"] ||
    ""
  );
}


// ============================================================
// SUBSCRIPTION CACHE
// ============================================================

const subscriptionCache = new Map();

const SUBSCRIPTION_CACHE_TIME = 60 * 1000;


async function isSubscribed(telegramId, force = false) {
  const key = String(telegramId);

  const cached = subscriptionCache.get(key);

  if (
    !force &&
    cached &&
    Date.now() - cached.time < SUBSCRIPTION_CACHE_TIME
  ) {
    return cached.value;
  }

  if (!bot) {
    return false;
  }

  try {
    const member = await bot.telegram.getChatMember(
      REQUIRED_CHANNEL,
      Number(telegramId)
    );

    const status = member?.status;

    const subscribed =
      status === "creator" ||
      status === "administrator" ||
      status === "member" ||
      (status === "restricted" && member.is_member === true);

    subscriptionCache.set(key, {
      value: subscribed,
      time: Date.now()
    });

    return subscribed;
  } catch (error) {
    console.error(
      "Subscription check error:",
      error.message
    );

    return false;
  }
}


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
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

      league_level INTEGER DEFAULT 1,

      daily_claimed_at TIMESTAMP NULL,

      energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);


  const columns = [
    ["username", "TEXT"],
    ["first_name", "TEXT"],
    ["photo_url", "TEXT"],
    ["balance", "NUMERIC DEFAULT 0"],
    ["energy", "INTEGER DEFAULT 300"],
    ["max_energy", "INTEGER DEFAULT 300"],
    ["tap_level", "INTEGER DEFAULT 1"],
    ["energy_level", "INTEGER DEFAULT 1"],
    ["referrals", "INTEGER DEFAULT 0"],
    ["referred_by", "BIGINT"],
    ["league_level", "INTEGER DEFAULT 1"],
    ["daily_claimed_at", "TIMESTAMP NULL"],
    ["energy_updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ];

  for (const [name, type] of columns) {
    try {
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS ${name} ${type}`
      );
    } catch (error) {
      console.error(
        `Column ${name} error:`,
        error.message
      );
    }
  }


  // Normalize old data safely
  await pool.query(`
    UPDATE users
    SET tap_level = 1
    WHERE tap_level IS NULL OR tap_level < 1
  `);

  await pool.query(`
    UPDATE users
    SET energy_level = 1
    WHERE energy_level IS NULL OR energy_level < 1
  `);

  await pool.query(`
    UPDATE users
    SET max_energy = 300
    WHERE max_energy IS NULL OR max_energy < 1
  `);

  await pool.query(`
    UPDATE users
    SET energy = 0
    WHERE energy IS NULL OR energy < 0
  `);

  await pool.query(`
    UPDATE users
    SET energy = max_energy
    WHERE energy > max_energy
  `);

  await pool.query(`
    UPDATE users
    SET league_level = 1
    WHERE league_level IS NULL OR league_level < 1
  `);

  await pool.query(`
    UPDATE users
    SET energy_updated_at = CURRENT_TIMESTAMP
    WHERE energy_updated_at IS NULL
  `);

  // Permanent league promotion
  const result = await pool.query(`
    SELECT telegram_id, balance, league_level
    FROM users
  `);

  for (const user of result.rows) {
    const league = getLeagueFromBalance(user.balance);

    if (league.level > Number(user.league_level || 1)) {
      await pool.query(
        `
        UPDATE users
        SET league_level = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
        `,
        [
          league.level,
          user.telegram_id
        ]
      );
    }
  }

  console.log("Database initialized.");
}


// ============================================================
// CREATE / UPDATE USER
// ============================================================

async function createOrUpdateUser(telegramUser) {
  const telegramId = Number(telegramUser.id);

  if (!telegramId) {
    throw new Error("Invalid Telegram user ID");
  }

  const username =
    telegramUser.username || null;

  const firstName =
    telegramUser.first_name ||
    telegramUser.firstName ||
    "";

  const photoUrl =
    telegramUser.photo_url ||
    telegramUser.photoUrl ||
    null;

  const existing = await pool.query(
    `
    SELECT *
    FROM users
    WHERE telegram_id = $1
    `,
    [telegramId]
  );

  if (existing.rows.length === 0) {
    const result = await pool.query(
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
        $1,
        $2,
        $3,
        $4,
        0,
        300,
        300,
        1,
        1,
        0,
        1,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        telegramId,
        username,
        firstName,
        photoUrl
      ]
    );

    return result.rows[0];
  }


  const result = await pool.query(
    `
    UPDATE users
    SET
      username = $1,
      first_name = $2,
      photo_url = $3,
      updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = $4
    RETURNING *
    `,
    [
      username,
      firstName,
      photoUrl,
      telegramId
    ]
  );

  return result.rows[0];
}


// ============================================================
// ENERGY REGENERATION
// ============================================================

async function regenerateEnergy(user) {
  const maxEnergy = Number(user.max_energy || 300);

  let energy = Number(user.energy || 0);

  if (energy >= maxEnergy) {
    return user;
  }

  const updatedAt = user.energy_updated_at
    ? new Date(user.energy_updated_at)
    : new Date();

  const now = new Date();

  const elapsedSeconds = Math.floor(
    (now.getTime() - updatedAt.getTime()) / 1000
  );

  if (elapsedSeconds <= 0) {
    return user;
  }

  const newEnergy = Math.min(
    maxEnergy,
    energy + elapsedSeconds
  );

  const secondsActuallyAdded =
    newEnergy - energy;

  if (secondsActuallyAdded <= 0) {
    return user;
  }

  const newUpdatedAt = new Date(
    updatedAt.getTime() +
      secondsActuallyAdded * 1000
  );

  const result = await pool.query(
    `
    UPDATE users
    SET
      energy = $1,
      energy_updated_at = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = $3
    RETURNING *
    `,
    [
      newEnergy,
      newUpdatedAt,
      user.telegram_id
    ]
  );

  return result.rows[0] || user;
}


// ============================================================
// PERMANENT LEAGUE
// ============================================================

async function updatePermanentLeague(user) {
  const currentLevel =
    Number(user.league_level || 1);

  const balance =
    Number(user.balance || 0);

  const possibleLeague =
    getLeagueFromBalance(balance);

  // League never decreases
  const newLevel = Math.max(
    currentLevel,
    possibleLeague.level
  );

  if (newLevel !== currentLevel) {
    const result = await pool.query(
      `
      UPDATE users
      SET
        league_level = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $2
      RETURNING *
      `,
      [
        newLevel,
        user.telegram_id
      ]
    );

    return result.rows[0] || user;
  }

  return user;
}


// ============================================================
// RANK
// ============================================================

async function getUserRank(telegramId) {
  const result = await pool.query(
    `
    SELECT COUNT(*) + 1 AS rank
    FROM users
    WHERE balance > (
      SELECT balance
      FROM users
      WHERE telegram_id = $1
    )
    `,
    [telegramId]
  );

  return Number(result.rows[0]?.rank || 1);
}


// ============================================================
// FORMAT USER
// ============================================================

async function formatUser(user) {
  const regenerated =
    await regenerateEnergy(user);

  const finalUser =
    await updatePermanentLeague(regenerated);

  const league =
    getLeagueByLevel(
      finalUser.league_level
    );

  const rank =
    await getUserRank(
      finalUser.telegram_id
    );

  const tapLevel =
    Number(finalUser.tap_level || 1);

  const energyLevel =
    Number(finalUser.energy_level || 1);

  const tapCost =
    getTapUpgradeCost(tapLevel);

  const energyCost =
    getEnergyUpgradeCost(energyLevel);

  const maxEnergy =
    Number(finalUser.max_energy || 300);

  const energy =
    Math.min(
      Number(finalUser.energy || 0),
      maxEnergy
    );

  return {
    telegramId: Number(finalUser.telegram_id),

    username: finalUser.username || "",

    firstName: finalUser.first_name || "",

    photoUrl: finalUser.photo_url || "",

    balance: Number(finalUser.balance || 0),

    energy,

    maxEnergy,

    energyUpdatedAt:
      finalUser.energy_updated_at,

    tapLevel,

    power: tapLevel,

    energyLevel,

    referrals:
      Number(finalUser.referrals || 0),

    league: {
      level: league.level,
      name: league.name,
      icon: league.icon,
      min: league.min
    },

    rank,

    upgrades: {
      tap: {
        level: tapLevel,
        cost: tapCost
      },

      energy: {
        level: energyLevel,
        max: maxEnergy,
        cost: energyCost
      }
    }
  };
}


// ============================================================
// AUTHENTICATED USER
// ============================================================

async function getAuthenticatedUser(
  initData,
  useCache = true
) {
  const telegramUser =
    validateInitData(initData);

  if (!telegramUser) {
    return {
      error: "INVALID_INIT_DATA"
    };
  }

  const subscribed =
    await isSubscribed(
      telegramUser.id,
      !useCache
    );

  if (!subscribed) {
    return {
      error: "NOT_SUBSCRIBED",
      telegramUser
    };
  }

  let user =
    await createOrUpdateUser(
      telegramUser
    );

  user =
    await regenerateEnergy(user);

  user =
    await updatePermanentLeague(user);

  return {
    telegramUser,
    user
  };
}


// ============================================================
// REFERRAL
// ============================================================

async function processReferral(
  newUserId,
  referrerId
) {
  const newId = Number(newUserId);
  const refId = Number(referrerId);

  if (!newId || !refId) {
    return false;
  }

  if (newId === refId) {
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
        [newId]
      );

    const referrerResult =
      await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        FOR UPDATE
        `,
        [refId]
      );

    if (
      newUserResult.rows.length === 0 ||
      referrerResult.rows.length === 0
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    const newUser =
      newUserResult.rows[0];

    const referrer =
      referrerResult.rows[0];

    if (newUser.referred_by) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `
      UPDATE users
      SET
        balance = balance + $1,
        referred_by = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $3
      `,
      [
        REFERRAL_BONUS,
        refId,
        newId
      ]
    );

    await client.query(
      `
      UPDATE users
      SET
        balance = balance + $1,
        referrals = referrals + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $2
      `,
      [
        REFERRAL_BONUS,
        refId
      ]
    );

    await client.query(
      `
      UPDATE users
      SET league_level = GREATEST(
        league_level,
        $1
      )
      WHERE telegram_id = $2
      `,
      [
        getLeagueFromBalance(
          Number(newUser.balance) +
            REFERRAL_BONUS
        ).level,
        newId
      ]
    );

    await client.query(
      `
      UPDATE users
      SET league_level = GREATEST(
        league_level,
        $1
      )
      WHERE telegram_id = $2
      `,
      [
        getLeagueFromBalance(
          Number(referrer.balance) +
            REFERRAL_BONUS
        ).level,
        refId
      ]
    );

    await client.query("COMMIT");

    return true;
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "Referral error:",
      error.message
    );

    return false;
  } finally {
    client.release();
  }
}


// ============================================================
// SUBSCRIPTION API
// ============================================================

app.get(
  "/api/subscription",
  async (req, res) => {
    try {
      const initData =
        getInitData(req);

      const telegramUser =
        validateInitData(initData);

      if (!telegramUser) {
        return res.status(401).json({
          subscribed: false,
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id,
          true
        );

      return res.json({
        subscribed,
        channel: REQUIRED_CHANNEL,
        channelUrl: CHANNEL_URL
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        subscribed: false,
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// OLD CHECK SUBSCRIPTION
// ============================================================

app.post(
  "/api/check-subscription",
  async (req, res) => {
    try {
      const initData =
        getInitData(req);

      const telegramUser =
        validateInitData(initData);

      if (!telegramUser) {
        return res.status(401).json({
          subscribed: false,
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id,
          true
        );

      if (subscribed) {
        await createOrUpdateUser(
          telegramUser
        );
      }

      return res.json({
        subscribed,
        channel: REQUIRED_CHANNEL,
        channelUrl: CHANNEL_URL
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        subscribed: false,
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// OLD POST /api/me
// IMPORTANT: OLD INDEX COMPATIBILITY
// ============================================================

app.post(
  "/api/me",
  async (req, res) => {
    try {
      const initData =
        getInitData(req);

      const auth =
        await getAuthenticatedUser(
          initData,
          true
        );

      if (auth.error === "INVALID_INIT_DATA") {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      if (auth.error === "NOT_SUBSCRIBED") {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED",
          channel: REQUIRED_CHANNEL,
          channelUrl: CHANNEL_URL
        });
      }

      const user =
        await formatUser(auth.user);

      return res.json(user);
    } catch (error) {
      console.error(
        "POST /api/me:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// NEW GET /api/me COMPATIBILITY
// ============================================================

app.get(
  "/api/me",
  async (req, res) => {
    try {
      const initData =
        getInitData(req);

      const auth =
        await getAuthenticatedUser(
          initData,
          true
        );

      if (auth.error === "INVALID_INIT_DATA") {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      if (auth.error === "NOT_SUBSCRIBED") {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED",
          channel: REQUIRED_CHANNEL,
          channelUrl: CHANNEL_URL
        });
      }

      const user =
        await formatUser(auth.user);

      return res.json({
        ok: true,
        user
      });
    } catch (error) {
      console.error(
        "GET /api/me:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// OLD USER ENDPOINT
// ============================================================

app.get(
  "/api/user/:telegramId",
  async (req, res) => {
    try {
      const telegramId =
        Number(req.params.telegramId);

      if (!telegramId) {
        return res.status(400).json({
          error: "INVALID_ID"
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramId]
        );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "USER_NOT_FOUND"
        });
      }

      const user =
        await formatUser(
          result.rows[0]
        );

      return res.json(user);
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// TAP
// ============================================================

app.post(
  "/api/tap",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const initData =
        getInitData(req);

      const telegramUser =
        validateInitData(initData);

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      let taps =
        Number(req.body?.taps || 1);

      if (!Number.isFinite(taps)) {
        taps = 1;
      }

      taps =
        Math.floor(taps);

      taps =
        Math.max(1, Math.min(100, taps));

      await client.query("BEGIN");

      let result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "USER_NOT_FOUND"
        });
      }

      let user =
        result.rows[0];

      user =
        await regenerateEnergy(user);

      // Re-read locked row after regeneration
      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );

      user =
        result.rows[0];

      const availableEnergy =
        Number(user.energy || 0);

      const actualTaps =
        Math.min(
          taps,
          availableEnergy
        );

      if (actualTaps <= 0) {
        await client.query("COMMIT");

        const fresh =
          await pool.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            `,
            [telegramUser.id]
          );

        const formatted =
          await formatUser(
            fresh.rows[0]
          );

        return res.json({
          earned: 0,
          taps: 0,
          user: formatted
        });
      }

      const power =
        Number(user.tap_level || 1);

      const earned =
        actualTaps * power;

      const newBalance =
        Number(user.balance || 0) +
        earned;

      const newEnergy =
        availableEnergy -
        actualTaps;

      const league =
        getLeagueFromBalance(
          newBalance
        );

      const permanentLeague =
        Math.max(
          Number(user.league_level || 1),
          league.level
        );

      await client.query(
        `
        UPDATE users
        SET
          balance = $1,
          energy = $2,
          league_level = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $4
        `,
        [
          newBalance,
          newEnergy,
          permanentLeague,
          telegramUser.id
        ]
      );

      await client.query("COMMIT");

      const fresh =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      const formatted =
        await formatUser(
          fresh.rows[0]
        );

      return res.json({
        earned,
        taps: actualTaps,
        user: formatted
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "POST /api/tap:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    } finally {
      client.release();
    }
  }
);


// ============================================================
// UPGRADE
// ============================================================

app.post(
  "/api/upgrade",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const initData =
        getInitData(req);

      const telegramUser =
        validateInitData(initData);

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      const type =
        req.body?.type;

      if (
        type !== "tap" &&
        type !== "energy"
      ) {
        return res.status(400).json({
          error: "INVALID_UPGRADE"
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
          [telegramUser.id]
        );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "USER_NOT_FOUND"
        });
      }

      let user =
        result.rows[0];

      user =
        await regenerateEnergy(user);

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );

      user =
        result.rows[0];

      const balance =
        Number(user.balance || 0);

      if (type === "tap") {
        const level =
          Number(user.tap_level || 1);

        const cost =
          getTapUpgradeCost(level);

        if (balance < cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "NOT_ENOUGH_COINS",
            cost
          });
        }

        await client.query(
          `
          UPDATE users
          SET
            balance = balance - $1,
            tap_level = tap_level + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE telegram_id = $2
          `,
          [
            cost,
            telegramUser.id
          ]
        );
      }


      if (type === "energy") {
        const level =
          Number(user.energy_level || 1);

        const cost =
          getEnergyUpgradeCost(level);

        if (!cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "MAX_LEVEL"
          });
        }

        if (balance < cost) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "NOT_ENOUGH_COINS",
            cost
          });
        }

        const newMaxEnergy =
          getMaxEnergy(level + 1);

        await client.query(
          `
          UPDATE users
          SET
            balance = balance - $1,
            energy_level = energy_level + 1,
            max_energy = $2,
            energy = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE telegram_id = $3
          `,
          [
            cost,
            newMaxEnergy,
            telegramUser.id
          ]
        );
      }


      await client.query("COMMIT");

      const fresh =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      const formatted =
        await formatUser(
          fresh.rows[0]
        );

      return res.json({
        success: true,
        user: formatted
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "POST /api/upgrade:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    } finally {
      client.release();
    }
  }
);


// ============================================================
// DAILY REWARD
// ============================================================

app.post(
  "/api/daily",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const initData =
        getInitData(req);

      const telegramUser =
        validateInitData(initData);

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      await client.query("BEGIN");

      const result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "USER_NOT_FOUND"
        });
      }

      const user =
        result.rows[0];

      const now =
        new Date();

      if (user.daily_claimed_at) {
        const last =
          new Date(
            user.daily_claimed_at
          );

        if (
          last.toDateString() ===
          now.toDateString()
        ) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "ALREADY_CLAIMED"
          });
        }
      }

      const newBalance =
        Number(user.balance || 0) +
        DAILY_REWARD;

      const league =
        getLeagueFromBalance(
          newBalance
        );

      const permanentLeague =
        Math.max(
          Number(user.league_level || 1),
          league.level
        );

      await client.query(
        `
        UPDATE users
        SET
          balance = $1,
          daily_claimed_at = CURRENT_TIMESTAMP,
          league_level = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $3
        `,
        [
          newBalance,
          permanentLeague,
          telegramUser.id
        ]
      );

      await client.query("COMMIT");

      const fresh =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      const formatted =
        await formatUser(
          fresh.rows[0]
        );

      return res.json({
        success: true,
        reward: DAILY_REWARD,
        user: formatted
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "POST /api/daily:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    } finally {
      client.release();
    }
  }
);


// ============================================================
// REFERRAL
// ============================================================

app.post(
  "/api/referral",
  async (req, res) => {
    try {
      const initData =
        getInitData(req);

      const telegramUser =
        validateInitData(initData);

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      const referrerId =
        Number(
          req.body?.referrerId ||
          req.body?.referrer_id
        );

      const success =
        await processReferral(
          telegramUser.id,
          referrerId
        );

      return res.json({
        success
      });
    } catch (error) {
      console.error(
        "POST /api/referral:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// FRIENDS
// ============================================================

app.get(
  "/api/friends/:telegramId",
  async (req, res) => {
    try {
      const telegramId =
        Number(req.params.telegramId);

      if (!telegramId) {
        return res.status(400).json({
          error: "INVALID_ID"
        });
      }

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
          `,
          [telegramId]
        );

      return res.json({
        friends: result.rows
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// RANK
// ============================================================

app.get(
  "/api/rank",
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
          ORDER BY balance DESC
          LIMIT 100
          `
        );

      const users =
        result.rows.map(
          (user, index) => {
            const league =
              getLeagueByLevel(
                user.league_level
              );

            return {
              rank: index + 1,

              telegramId:
                Number(user.telegram_id),

              username:
                user.username || "",

              firstName:
                user.first_name || "",

              photoUrl:
                user.photo_url || "",

              balance:
                Number(user.balance || 0),

              league: {
                name: league.name,
                icon: league.icon
              }
            };
          }
        );

      return res.json({
        users
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


// ============================================================
// LEAGUES
// ============================================================

app.get(
  "/api/leagues",
  (req, res) => {
    res.json({
      leagues: LEAGUES
    });
  }
);


// ============================================================
// STATUS
// ============================================================

app.get(
  "/api/status",
  async (req, res) => {
    try {
      const usersResult =
        await pool.query(
          `SELECT COUNT(*) AS count FROM users`
        );

      const balanceResult =
        await pool.query(
          `SELECT COALESCE(SUM(balance), 0) AS total FROM users`
        );

      return res.json({
        online: true,
        users: Number(
          usersResult.rows[0].count
        ),
        totalBalance: Number(
          balanceResult.rows[0].total || 0
        )
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        online: false
      });
    }
  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "UZCOIN",
      time: new Date().toISOString()
    });
  }
);


// ============================================================
// BOT
// ============================================================

if (bot) {
  bot.start(
    async (ctx) => {
      try {
        const telegramUser =
          ctx.from;

        const subscribed =
          await isSubscribed(
            telegramUser.id,
            true
          );

        if (!subscribed) {
          return ctx.reply(
            `
🔒 <b>UZCOIN</b>

O‘yinni ishlatish uchun avval kanalimizga obuna bo‘ling.

📢 Kanal:
${CHANNEL_URL}

Obuna bo‘lgach, <b>✅ Tekshirish</b> tugmasini bosing.
            `,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([
                [
                  Markup.button.url(
                    "📢 Kanalga obuna bo‘lish",
                    CHANNEL_URL
                  )
                ],
                [
                  Markup.button.callback(
                    "✅ Tekshirish",
                    "check_subscription"
                  )
                ]
              ])
            }
          );
        }


        let user =
          await createOrUpdateUser(
            telegramUser
          );


        // /start referrer
        const text =
          ctx.message?.text || "";

        const parts =
          text.split(" ");

        if (
          parts.length > 1 &&
          parts[1]
        ) {
          const referrerId =
            Number(
              String(parts[1])
                .replace("ref_", "")
                .replace("ref", "")
            );

          if (
            Number.isFinite(referrerId) &&
            referrerId > 0
          ) {
            await processReferral(
              telegramUser.id,
              referrerId
            );
          }
        }


        const webAppUrl =
          `${PUBLIC_URL}/?user=${telegramUser.id}`;


        return ctx.reply(
          `
🪙 <b>UZCOIN</b>

Tap qiling va coin yig‘ing! 🚀

⚡ Energy
💰 Coin
👥 Referral
🏆 Ranking
          `,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [
                Markup.button.webApp(
                  "🪙 UZCOINNI OCHISH",
                  webAppUrl
                )
              ]
            ])
          }
        );
      } catch (error) {
        console.error(
          "/start error:",
          error
        );

        return ctx.reply(
          "❌ Server xatosi. Iltimos, keyinroq urinib ko‘ring."
        );
      }
    }
  );


  bot.action(
    "check_subscription",
    async (ctx) => {
      try {
        await ctx.answerCbQuery();

        const telegramUser =
          ctx.from;

        const subscribed =
          await isSubscribed(
            telegramUser.id,
            true
          );

        if (!subscribed) {
          return ctx.reply(
            `
❌ Hali kanalga obuna bo‘lmagansiz.

Avval kanalga obuna bo‘ling:
${CHANNEL_URL}
            `,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([
                [
                  Markup.button.url(
                    "📢 Kanalga obuna bo‘lish",
                    CHANNEL_URL
                  )
                ],
                [
                  Markup.button.callback(
                    "✅ Qayta tekshirish",
                    "check_subscription"
                  )
                ]
              ])
            }
          );
        }


        await createOrUpdateUser(
          telegramUser
        );


        const webAppUrl =
          `${PUBLIC_URL}/?user=${telegramUser.id}`;


        return ctx.reply(
          "✅ Obuna tasdiqlandi!\n\nUZCOIN'ni oching:",
          Markup.inlineKeyboard([
            [
              Markup.button.webApp(
                "🪙 UZCOINNI OCHISH",
                webAppUrl
              )
            ]
          ])
        );
      } catch (error) {
        console.error(
          "check_subscription error:",
          error
        );

        return ctx.reply(
          "❌ Tekshirishda xatolik yuz berdi."
        );
      }
    }
  );
}


// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

app.post(
  "/telegram-webhook",
  async (req, res) => {
    try {
      if (!bot) {
        return res.status(503).json({
          error: "BOT_TOKEN_NOT_CONFIGURED"
        });
      }

      await bot.handleUpdate(
        req.body
      );

      return res.sendStatus(200);
    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );

      return res.sendStatus(500);
    }
  }
);


// ============================================================
// API 404
// ============================================================

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      error: "API_NOT_FOUND",
      path: req.originalUrl
    });
  }
);


// ============================================================
// FRONTEND FALLBACK
// ============================================================

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      ),
      (error) => {
        if (error) {
          res.status(404).send(
            "UZCOIN frontend not found"
          );
        }
      }
    );
  }
);


// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "Global error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error: "SERVER_ERROR"
    });
  }
);


// ============================================================
// START
// ============================================================

async function startServer() {
  try {
    await initDatabase();

    if (bot) {
      try {
        const webhookUrl =
          `${PUBLIC_URL}/telegram-webhook`;

        await bot.telegram.setWebhook(
          webhookUrl
        );

        console.log(
          "Webhook:",
          webhookUrl
        );
      } catch (error) {
        console.error(
          "Webhook setup error:",
          error.message
        );
      }
    }

    app.listen(
      PORT,
      () => {
        console.log(
          `UZCOIN server running on port ${PORT}`
        );

        console.log(
          `PUBLIC_URL: ${PUBLIC_URL}`
        );
      }
    );
  } catch (error) {
    console.error(
      "STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
}


startServer();
