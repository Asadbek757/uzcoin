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
