const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "https://uzcoin.onrender.com";

const REQUIRED_CHANNEL = "@uzcoin_officiall";
const CHANNEL_URL = "https://t.me/uzcoin_officiall";
const BOT_USERNAME = "UZCoinTapBot";

// =========================
// ADMIN CONFIG
// =========================

const ADMIN_ID = String(process.env.ADMIN_ID || "");

function isAdmin(telegramId) {
  if (!ADMIN_ID) return false;
  return String(telegramId) === ADMIN_ID;
}

async function getAdminFromInitData(initData) {
  try {
    const telegramUser = validateInitData(initData);

    if (!telegramUser) {
      return null;
    }

    if (!isAdmin(telegramUser.id)) {
      return null;
    }

    return telegramUser;

  } catch (error) {
    console.error("Admin auth error:", error);
    return null;
  }
}

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing");
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing");
}

const bot = new Telegraf(BOT_TOKEN);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));


/* =====================================================
   LEAGUES
===================================================== */

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
    name: "PLATINUM",
    icon: "💎",
    min: 50000
  },
  {
    level: 5,
    name: "DIAMOND",
    icon: "💠",
    min: 250000
  },
  {
    level: 6,
    name: "MASTER",
    icon: "👑",
    min: 1000000
  },
  {
    level: 7,
    name: "GRANDMASTER",
    icon: "🔥",
    min: 5000000
  },
  {
    level: 8,
    name: "CHAMPION",
    icon: "⚔️",
    min: 25000000
  },
  {
    level: 9,
    name: "LEGEND",
    icon: "🌟",
    min: 100000000
  },
  {
    level: 10,
    name: "TITAN",
    icon: "🏆",
    min: 500000000
  }
];

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

async function updatePermanentLeague(
  client,
  telegramId,
  balance,
  currentLeagueLevel
) {
  const current = Number(currentLeagueLevel || 1);

  const earnedLeague =
    getLeagueFromBalance(balance);

  const newLevel = Math.max(
    current,
    earnedLeague.level
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
      [telegramId, newLevel]
    );
  }

  return newLevel;
}


/* =====================================================
   COSTS / LEVELS
===================================================== */

const MAX_TAP_LEVEL = 10;
const MAX_ENERGY_LEVEL = 10;

function getTapUpgradeCost(level) {

  const currentLevel =
    Number(level) || 1;

  const costs = [
    1500,     // 1 -> 2
    3500,     // 2 -> 3
    7000,     // 3 -> 4
    15000,    // 4 -> 5
    30000,    // 5 -> 6
    55000,    // 6 -> 7
    85000,    // 7 -> 8
    115000,   // 8 -> 9
    150000    // 9 -> 10
  ];

  if (currentLevel >= MAX_TAP_LEVEL) {
    return 0;
  }

  const index =
    Math.min(
      Math.max(currentLevel - 1, 0),
      costs.length - 1
    );

  return costs[index];
}


function getMaxEnergy(level) {

  const currentLevel =
    Number(level) || 1;

  const limits = [
    500,      // Level 1
    1000,     // Level 2
    1500,     // Level 3
    2000,     // Level 4
    3000,     // Level 5
    4000,     // Level 6
    5000,     // Level 7
    6500,     // Level 8
    8000,     // Level 9
    10000     // Level 10
  ];

  const index =
    Math.min(
      Math.max(currentLevel - 1, 0),
      limits.length - 1
    );

  return limits[index];
}


function getEnergyUpgradeCost(level) {

  const currentLevel =
    Number(level) || 1;

  const costs = [
    5000,       // 1 -> 2
    15000,      // 2 -> 3
    40000,      // 3 -> 4
    100000,     // 4 -> 5
    250000,     // 5 -> 6
    600000,     // 6 -> 7
    1500000,    // 7 -> 8
    3500000,    // 8 -> 9
    8000000     // 9 -> 10
  ];

  if (currentLevel >= MAX_ENERGY_LEVEL) {
    return 0;
  }

  const index =
    Math.min(
      Math.max(currentLevel - 1, 0),
      costs.length - 1
    );

  return costs[index];
}


const REFERRAL_BONUS = 1000;

/* =====================================================
   SERVER ANTI-CHEAT
===================================================== */

const ANTI_CHEAT = {
  MAX_TAPS_PER_REQUEST: 25,

  // Bir foydalanuvchining tap requestlari orasidagi
  // juda qisqa vaqtni aniqlash.
  MIN_REQUEST_INTERVAL_MS: 70,

  // Juda ko‘p request yuborilsa shubhali hisoblanadi.
  MAX_REQUESTS_PER_SECOND: 12,

  // Replay request uchun vaqt oynasi.
  REPLAY_WINDOW_MS: 10000
};

// RAM ichidagi tezkor rate-limit.
// Server qayta ishga tushsa avtomatik tozalanadi.
const tapRateMap = new Map();

function checkTapRate(telegramId) {
  const key = String(telegramId);
  const now = Date.now();

  let state = tapRateMap.get(key);

  if (!state) {
    state = {
      requests: [],
      lastRequestAt: 0
    };

    tapRateMap.set(key, state);
  }

  // Eski requestlarni olib tashlaymiz
  state.requests =
    state.requests.filter(
      time => now - time < 1000
    );

  const tooFast =
    state.lastRequestAt > 0 &&
    now - state.lastRequestAt <
      ANTI_CHEAT.MIN_REQUEST_INTERVAL_MS;

  const tooMany =
    state.requests.length >=
    ANTI_CHEAT.MAX_REQUESTS_PER_SECOND;

  state.requests.push(now);
  state.lastRequestAt = now;

  return {
    tooFast,
    tooMany,
    requestsLastSecond:
      state.requests.length
  };
}

function getTapRequestId(body) {
  const value =
    body &&
    (
      body.requestId ||
      body.request_id ||
      body.tapId ||
      body.tap_id
    );

  if (!value) {
    return null;
  }

  const id = String(value).trim();

  if (!id || id.length > 200) {
    return null;
  }

  return id;
}


/* =====================================================
   SUBSCRIPTION CACHE
===================================================== */

const subscriptionCache = new Map();

const SUB_CACHE_MS = 60 * 1000;

async function isSubscribed(telegramId) {
  try {
    const member =
      await bot.telegram.getChatMember(
        REQUIRED_CHANNEL,
        telegramId
      );

    if (
      [
        "creator",
        "administrator",
        "member"
      ].includes(member.status)
    ) {
      return true;
    }

    if (
      member.status === "restricted" &&
      member.is_member === true
    ) {
      return true;
    }

    return false;

  } catch (error) {
    console.error(
      "Subscription check:",
      error.description ||
      error.message
    );

    return false;
  }
}

async function isSubscribedCached(
  telegramId,
  force = false
) {
  const key = String(telegramId);

  const cached =
    subscriptionCache.get(key);

  if (
    !force &&
    cached &&
    Date.now() - cached.checkedAt <
      SUB_CACHE_MS
  ) {
    return cached.value;
  }

  const value =
    await isSubscribed(telegramId);

  subscriptionCache.set(
    key,
    {
      value,
      checkedAt: Date.now()
    }
  );

  return value;
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
      photo_url TEXT,

      balance NUMERIC DEFAULT 0,

      energy INTEGER DEFAULT 500,
      max_energy INTEGER DEFAULT 500,

      tap_level INTEGER DEFAULT 1,
      energy_level INTEGER DEFAULT 1,

      referrals INTEGER DEFAULT 0,

      referred_by BIGINT,

      league_level INTEGER DEFAULT 1,

      daily_claimed_at TIMESTAMP,

      energy_updated_at TIMESTAMP,

      blocked BOOLEAN DEFAULT FALSE,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columns = [
    ["username", "TEXT"],
    ["first_name", "TEXT"],
    ["photo_url", "TEXT"],
    ["balance", "NUMERIC DEFAULT 0"],
    ["energy", "INTEGER DEFAULT 500"],
    ["max_energy", "INTEGER DEFAULT 500"],
    ["tap_level", "INTEGER DEFAULT 1"],
    ["energy_level", "INTEGER DEFAULT 1"],
    ["referrals", "INTEGER DEFAULT 0"],
    ["referred_by", "BIGINT"],
    ["league_level", "INTEGER DEFAULT 1"],
    ["daily_claimed_at", "TIMESTAMP"],
    ["energy_updated_at", "TIMESTAMP"],
    ["blocked", "BOOLEAN DEFAULT FALSE"],
    ["anti_cheat_score", "INTEGER DEFAULT 0"],
    ["suspicious_taps", "INTEGER DEFAULT 0"],
    ["last_tap_at", "TIMESTAMP"],
    ["last_tap_request_id", "TEXT"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ];

  for (const [name, type] of columns) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS ${name} ${type}
    `);
  }

  // =========================
  // LEVEL LIMITS
  // =========================

  // Eski 11, 12 va undan yuqori Tap level
  // foydalanuvchilarni 10 ga tushiramiz.
  await pool.query(`
    UPDATE users
    SET tap_level = ${MAX_TAP_LEVEL}
    WHERE tap_level IS NULL
       OR tap_level > ${MAX_TAP_LEVEL}
  `);

  await pool.query(`
    UPDATE users
    SET tap_level = 1
    WHERE tap_level < 1
  `);

  // Eski 11, 12 va undan yuqori Energy level
  // foydalanuvchilarni 10 ga tushiramiz.
  await pool.query(`
    UPDATE users
    SET energy_level = ${MAX_ENERGY_LEVEL}
    WHERE energy_level IS NULL
       OR energy_level > ${MAX_ENERGY_LEVEL}
  `);

  await pool.query(`
    UPDATE users
    SET energy_level = 1
    WHERE energy_level < 1
  `);

  // Har bir Energy level uchun to'g'ri max energy.
  for (let level = 1; level <= MAX_ENERGY_LEVEL; level++) {

    const maxEnergy =
      getMaxEnergy(level);

    await pool.query(
      `
      UPDATE users
      SET max_energy = $1
      WHERE energy_level = $2
      `,
      [
        maxEnergy,
        level
      ]
    );
  }

  await pool.query(`
    UPDATE users
    SET max_energy = 500
    WHERE max_energy IS NULL
       OR max_energy < 1
  `);

  await pool.query(`
    UPDATE users
    SET energy = LEAST(
      GREATEST(COALESCE(energy, 0), 0),
      GREATEST(COALESCE(max_energy, 500), 500)
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

  await pool.query(`
    UPDATE users
    SET blocked = FALSE
    WHERE blocked IS NULL
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
        league.min
      ]
    );
  }

  console.log("Database initialized");
}


/* =====================================================
   TELEGRAM INIT DATA
===================================================== */

function validateInitData(initData) {

  if (!initData || !BOT_TOKEN) {
    return null;
  }

  try {

    const params =
      new URLSearchParams(initData);

    const hash =
      params.get("hash");

    if (!hash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString =
      Array.from(params.entries())
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(
          ([key, value]) =>
            `${key}=${value}`
        )
        .join("\n");

    const secretKey =
      crypto
        .createHmac(
          "sha256",
          "WebAppData"
        )
        .update(BOT_TOKEN)
        .digest();

    const calculatedHash =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(dataCheckString)
        .digest("hex");

    if (
      calculatedHash.length !==
      hash.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(hash)
      )
    ) {
      return null;
    }

    const userString =
      params.get("user");

    if (!userString) {
      return null;
    }

    return JSON.parse(userString);

  } catch (error) {

    console.error(
      "initData validation:",
      error.message
    );

    return null;
  }
}


/* =====================================================
   USER
===================================================== */

async function createOrUpdateUser(
  telegramUser,
  client = pool
) {

  const telegramId =
    telegramUser.id;

  const result =
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
        energy_updated_at,
        blocked
      )

      VALUES (
        $1,
        $2,
        $3,
        $4,
        0,
        500,
        500,
        1,
        1,
        0,
        1,
        CURRENT_TIMESTAMP,
        FALSE
      )

      ON CONFLICT (telegram_id)

      DO UPDATE SET
        username = EXCLUDED.username,

        first_name =
          EXCLUDED.first_name,

        photo_url =
          COALESCE(
            EXCLUDED.photo_url,
            users.photo_url
          ),

        updated_at =
          CURRENT_TIMESTAMP

      RETURNING *
      `,
      [
        telegramId,
        telegramUser.username || null,
        telegramUser.first_name || "Player",
        telegramUser.photo_url || null
      ]
    );

  return result.rows[0];
}


/* =====================================================
   ENERGY REGENERATION
===================================================== */

async function regenerateEnergy(
  client,
  user
) {

  let energy =
    Number(user.energy || 0);

  const maxEnergy =
    Number(user.max_energy || 500);

  if (energy >= maxEnergy) {
    return {
      energy: maxEnergy,
      energyUpdatedAt:
        user.energy_updated_at ||
        new Date()
    };
  }

  const lastUpdate =
    new Date(
      user.energy_updated_at ||
      user.updated_at ||
      Date.now()
    );

  const now =
    Date.now();

  const elapsedSeconds =
    Math.floor(
      (now - lastUpdate.getTime()) / 1000
    );

  if (elapsedSeconds <= 0) {
    return {
      energy,
      energyUpdatedAt: lastUpdate
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
      newTimestamp
    ]
  );

  return {
    energy: newEnergy,
    energyUpdatedAt: newTimestamp
  };
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

  const tapLevel =
    Math.min(
      Math.max(
        Number(user.tap_level || 1),
        1
      ),
      MAX_TAP_LEVEL
    );

  const energyLevel =
    Math.min(
      Math.max(
        Number(user.energy_level || 1),
        1
      ),
      MAX_ENERGY_LEVEL
    );

  const maxEnergy =
    getMaxEnergy(energyLevel);

  return {

    telegramId:
      String(user.telegram_id),

    username:
      user.username || "",

    firstName:
      user.first_name || "Player",

    photoUrl:
      user.photo_url || null,

    balance:
      Number(user.balance || 0),

    energy:
      Math.min(
        Number(user.energy || 0),
        maxEnergy
      ),

    maxEnergy,

    energyUpdatedAt:
      user.energy_updated_at
        ? new Date(
            user.energy_updated_at
          ).toISOString()
        : new Date().toISOString(),

    tapLevel,

    power:
      tapLevel,

    energyLevel,

    referrals:
      Number(user.referrals || 0),

    league: {
      level: league.level,
      name: league.name,
      icon: league.icon,
      min: league.min
    },

    rank,

    upgrades: {

      tap: {
        level:
          tapLevel,

        cost:
          getTapUpgradeCost(
            tapLevel
          )
      },

      energy: {
        level:
          energyLevel,

        max:
          maxEnergy,

        cost:
          getEnergyUpgradeCost(
            energyLevel
          )
      }
    }
  };
}


/* =====================================================
   AUTHENTICATION
===================================================== */

async function getAuthenticatedUser(
  initData,
  useCache = true
) {

  const telegramUser =
    validateInitData(initData);

  if (!telegramUser) {
    return null;
  }

  const subscribed =
    await isSubscribedCached(
      telegramUser.id,
      !useCache
    );

  if (!subscribed) {
    return {
      telegramUser,
      subscribed: false,
      user: null
    };
  }

  const user =
    await createOrUpdateUser(
      telegramUser
    );

  if (user.blocked) {
    return {
      telegramUser,
      subscribed: true,
      user: null,
      blocked: true
    };
  }

  return {
    telegramUser,
    subscribed: true,
    user,
    blocked: false
  };
}


/* =====================================================
   REFERRALS
===================================================== */

async function processReferral(
  newUserId,
  referrerId
) {

  if (!referrerId) {
    return false;
  }

  const newId =
    String(newUserId);

  const refId =
    String(referrerId);

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

    if (!newUserResult.rows.length) {
      await client.query("ROLLBACK");
      return false;
    }

    const newUser =
      newUserResult.rows[0];

    if (
      newUser.referred_by ||
      newUser.blocked
    ) {
      await client.query("ROLLBACK");
      return false;
    }

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
      !referrerResult.rows.length ||
      referrerResult.rows[0].blocked
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `
      UPDATE users
      SET
        balance = balance + $2,
        referred_by = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        newId,
        REFERRAL_BONUS,
        refId
      ]
    );

    await client.query(
      `
      UPDATE users
      SET
        balance = balance + $2,
        referrals = referrals + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        refId,
        REFERRAL_BONUS
      ]
    );

    const updatedNew =
      await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        `,
        [newId]
      );

    const updatedRef =
      await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        `,
        [refId]
      );

    await updatePermanentLeague(
      client,
      newId,
      updatedNew.rows[0].balance,
      updatedNew.rows[0].league_level
    );

    await updatePermanentLeague(
      client,
      refId,
      updatedRef.rows[0].balance,
      updatedRef.rows[0].league_level
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


/* =====================================================
   BOT START
===================================================== */

bot.start(
  async (ctx) => {

    try {

      const telegramUser =
        ctx.from;

      const subscribed =
        await isSubscribed(
          telegramUser.id
        );

      const payload =
        ctx.startPayload || "";

      const referrerId =
        payload.startsWith("ref_")
          ? payload.substring(4)
          : null;

      if (!subscribed) {

        await ctx.reply(
          `
📢 <b>UZCOIN</b>

O‘yinni boshlash uchun avval rasmiy kanalimizga obuna bo‘ling.

Keyin <b>✅ Tekshirish</b> tugmasini bosing.
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

        return;
      }

      const user =
        await createOrUpdateUser(
          telegramUser
        );

      if (user.blocked) {
        await ctx.reply(
          "🚫 Sizning UZCOIN akkauntingiz bloklangan."
        );
        return;
      }

      if (referrerId) {

        await processReferral(
          telegramUser.id,
          referrerId
        );
      }

      const buttons = [
        [
          Markup.button.webApp(
            "🚀 Open UZCOIN",
            PUBLIC_URL
          )
        ]
      ];

      if (
        ADMIN_ID &&
        String(telegramUser.id) === ADMIN_ID
      ) {

        buttons.push([
          Markup.button.webApp(
            "🛠 Admin Panel",
            `${PUBLIC_URL}/admin.html`
          )
        ]);

      }

      await ctx.reply(
        `
🪙 <b>UZCOIN</b>

Xush kelibsiz, ${
          telegramUser.first_name ||
          "Player"
        }!
        `,
        {
          parse_mode: "HTML",

          ...Markup.inlineKeyboard(
            buttons
          )
        }
      );

    } catch (error) {

      console.error(
        "/start error:",
        error
      );

      await ctx.reply(
        "Xatolik yuz berdi. Keyinroq qayta urinib ko‘ring."
      );
    }
  }
);


/* =====================================================
   ADMIN BROADCAST
===================================================== */

const broadcastSessions = new Map();

function isBotAdmin(ctx) {
  if (!ADMIN_ID) return false;
  return String(ctx.from.id) === ADMIN_ID;
}


/* =========================
   START BROADCAST
========================= */

bot.command("broadcast", async (ctx) => {

  try {

    if (!isBotAdmin(ctx)) {
      return;
    }

    broadcastSessions.set(
      String(ctx.from.id),
      {
        step: "photo"
      }
    );

    await ctx.reply(
      `
📢 <b>UZCOIN BROADCAST</b>

🖼 Rasmni yuboring.

Agar rasmsiz xabar yubormoqchi bo‘lsangiz:
<b>/skip</b>
      `,
      {
        parse_mode: "HTML"
      }
    );

  } catch (error) {

    console.error(
      "Broadcast start error:",
      error
    );

  }

});


/* =========================
   PHOTO
========================= */

bot.on("photo", async (ctx) => {

  try {

    if (!isBotAdmin(ctx)) {
      return;
    }

    const adminId =
      String(ctx.from.id);

    const session =
      broadcastSessions.get(adminId);

    if (!session) {
      return;
    }

    if (
      session.step !== "photo"
    ) {
      return;
    }

    const photos =
      ctx.message.photo;

    const largestPhoto =
      photos[
        photos.length - 1
      ];

    session.photo =
      largestPhoto.file_id;

    session.step =
      "text";

    broadcastSessions.set(
      adminId,
      session
    );

    await ctx.reply(
      `
✅ Rasm qabul qilindi.

✍️ Endi xabar matnini yuboring.
      `,
      {
        parse_mode: "HTML"
      }
    );

  } catch (error) {

    console.error(
      "Broadcast photo error:",
      error
    );

  }

});


/* =========================
   SKIP PHOTO
========================= */

bot.command("skip", async (ctx) => {

  try {

    if (!isBotAdmin(ctx)) {
      return;
    }

    const adminId =
      String(ctx.from.id);

    const session =
      broadcastSessions.get(adminId);

    if (!session) {
      return;
    }

    if (
      session.step !== "photo"
    ) {
      return;
    }

    session.photo = null;

    session.step =
      "text";

    broadcastSessions.set(
      adminId,
      session
    );

    await ctx.reply(
      "✍️ Endi xabar matnini yuboring."
    );

  } catch (error) {

    console.error(
      "Broadcast skip error:",
      error
    );

  }

});


/* =========================
   ALL BROADCAST TEXT STEPS
========================= */

bot.on("text", async (ctx, next) => {

  try {

    if (!isBotAdmin(ctx)) {
      return next();
    }

    const adminId =
      String(ctx.from.id);

    const session =
      broadcastSessions.get(adminId);

    if (!session) {
      return next();
    }

    const text =
      ctx.message.text.trim();

    if (text.startsWith("/")) {
      return next();
    }


    /* =========================
       1. MESSAGE TEXT
    ========================= */

    if (session.step === "text") {

      session.text = text;
      session.step = "button";

      broadcastSessions.set(
        adminId,
        session
      );

      await ctx.reply(
        `🔘 <b>Tugma qo‘shamizmi?</b>

Ha yoki yo‘q deb yozing.

Masalan:
<b>ha</b>
yoki
<b>yo‘q</b>`,
        {
          parse_mode: "HTML"
        }
      );

      return;
    }


    /* =========================
       2. BUTTON YES / NO
    ========================= */

    if (session.step === "button") {

      const answer =
        text.toLowerCase();

      if (
        answer === "ha" ||
        answer === "yes"
      ) {

        session.step =
          "button_name";

        broadcastSessions.set(
          adminId,
          session
        );

        await ctx.reply(
          `🔘 Tugmada ko‘rinadigan nomni yuboring.

Masalan:
🎮 UZCOIN'ni ochish`
        );

        return;
      }


      if (
        answer === "yo'q" ||
        answer === "yo‘q" ||
        answer === "yoq" ||
        answer === "no"
      ) {

        session.button = null;
        session.step = "preview";

        broadcastSessions.set(
          adminId,
          session
        );

        await showBroadcastPreview(
          ctx,
          session
        );

        return;
      }


      await ctx.reply(
        "❗ Faqat <b>ha</b> yoki <b>yo‘q</b> deb yozing.",
        {
          parse_mode: "HTML"
        }
      );

      return;
    }


    /* =========================
       3. BUTTON NAME
    ========================= */

    if (session.step === "button_name") {

      session.buttonName = text;
      session.step = "button_url";

      broadcastSessions.set(
        adminId,
        session
      );

      await ctx.reply(
        `🔗 Endi tugma ochadigan linkni yuboring.

Masalan:
https://t.me/UZCoinTapBot`
      );

      return;
    }


    /* =========================
       4. BUTTON URL
    ========================= */

    if (session.step === "button_url") {

      const url = text;

      if (
        !/^https?:\/\/\S+$/i.test(url)
      ) {

        await ctx.reply(
          `❌ Link noto‘g‘ri.

https:// bilan boshlanadigan link yuboring.`
        );

        return;
      }

      session.button = {
        text: session.buttonName,
        url: url
      };

      session.step = "preview";

      broadcastSessions.set(
        adminId,
        session
      );

      await showBroadcastPreview(
        ctx,
        session
      );

      return;
    }

    return next();

  } catch (error) {

    console.error(
      "Broadcast text steps error:",
      error
    );

    return next();
  }

});


/* =========================
   PREVIEW
========================= */

async function showBroadcastPreview(
  ctx,
  session
) {

  const keyboard = [];

  if (session.button) {

    keyboard.push([
      Markup.button.webApp(
        session.button.text,
        "https://uzcoin.onrender.com"
      )
    ]);

  }

  keyboard.push([
    Markup.button.callback(
      "✅ YUBORISH",
      "broadcast_send"
    ),
    Markup.button.callback(
      "❌ BEKOR QILISH",
      "broadcast_cancel"
    )
  ]);

  const extra = {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard(
      keyboard
    )
  };

  const previewText =
    `
📢 <b>BROADCAST PREVIEW</b>

${session.text}

━━━━━━━━━━━━━━

Yuqoridagi xabarni barcha foydalanuvchilarga yuborish uchun:

<b>✅ YUBORISH</b> tugmasini bosing.
    `;

  if (session.photo) {

    await ctx.replyWithPhoto(
      session.photo,
      {
        caption: previewText,
        ...extra
      }
    );

  } else {

    await ctx.reply(
      previewText,
      extra
    );

  }
}


/* =========================
   BROADCAST CANCEL
========================= */

bot.action("broadcast_cancel", async (ctx) => {

  if (!isBotAdmin(ctx)) return;

  const adminId =
    String(ctx.from.id);

  broadcastSessions.delete(adminId);

  await ctx.answerCbQuery(
    "Bekor qilindi ❌"
  );

  await ctx.reply(
    "❌ Broadcast bekor qilindi."
  );

});


/* =========================
   BROADCAST SEND
========================= */

bot.action("broadcast_send", async (ctx) => {

  if (!isBotAdmin(ctx)) return;

  const adminId =
    String(ctx.from.id);

  const session =
    broadcastSessions.get(adminId);

  if (!session || !session.text) {

    await ctx.answerCbQuery(
      "❌ Broadcast topilmadi."
    );

    return;
  }

  await ctx.answerCbQuery(
    "📤 Yuborish boshlandi..."
  );

  try {

    const result =
      await pool.query(`
        SELECT telegram_id
        FROM users
        WHERE blocked = false
      `);

    const users =
      result.rows;

    let sent = 0;
    let failed = 0;

    for (const user of users) {

      try {

        const keyboard = [];

        if (session.button) {

          keyboard.push([
            Markup.button.webApp(
              session.button.text,
              "https://uzcoin.onrender.com"
            )
          ]);

        }

        const extra =
          keyboard.length > 0
            ? Markup.inlineKeyboard(
                keyboard
              )
            : {};

        if (session.photo) {

          await bot.telegram.sendPhoto(
            user.telegram_id,
            session.photo,
            {
              caption: session.text,
              ...extra
            }
          );

        } else {

          await bot.telegram.sendMessage(
            user.telegram_id,
            session.text,
            extra
          );

        }

        sent++;

        await new Promise(
          resolve =>
            setTimeout(resolve, 50)
        );

      } catch (error) {

        failed++;

        console.error(
          "Broadcast user error:",
          user.telegram_id,
          error.message
        );

      }

    }

    broadcastSessions.delete(
      adminId
    );

    await ctx.reply(
      `📢 <b>BROADCAST YAKUNLANDI</b>

👥 Jami: <b>${users.length}</b>
✅ Yuborildi: <b>${sent}</b>
❌ Yuborilmadi: <b>${failed}</b>`,
      {
        parse_mode: "HTML"
      }
    );

  } catch (error) {

    console.error(
      "Broadcast send error:",
      error
    );

    await ctx.reply(
      "❌ Broadcast yuborishda xatolik yuz berdi."
    );

  }

});


/* =====================================================
   SUBSCRIPTION CALLBACK
===================================================== */

bot.action(
  "check_subscription",
  async (ctx) => {

    try {

      const telegramId =
        ctx.from.id;

      const subscribed =
        await isSubscribed(
          telegramId
        );

      subscriptionCache.set(
        String(telegramId),
        {
          value: subscribed,
          checkedAt: Date.now()
        }
      );

      if (!subscribed) {

        await ctx.answerCbQuery(
          "❌ Hali kanalga obuna bo‘lmagansiz.",
          {
            show_alert: true
          }
        );

        return;
      }

      const user =
        await createOrUpdateUser(
          ctx.from
        );

      if (user.blocked) {

        await ctx.answerCbQuery(
          "🚫 Akkauntingiz bloklangan.",
          {
            show_alert: true
          }
        );

        return;
      }

      await ctx.answerCbQuery(
        "✅ Obuna tasdiqlandi!"
      );

      await ctx.reply(
        "🎉 Tayyor! UZCOIN'ni oching.",
        Markup.inlineKeyboard([
          [
            Markup.button.webApp(
              "🪙 Open UZCOIN",
              PUBLIC_URL
            )
          ]
        ])
      );

    } catch (error) {

      console.error(
        "Callback error:",
        error
      );

      await ctx.answerCbQuery(
        "Xatolik yuz berdi.",
        {
          show_alert: true
        }
      );
    }
  }
);


/* =====================================================
   CHECK SUBSCRIPTION API
===================================================== */

app.post(
  "/api/check-subscription",
  async (req, res) => {

    try {

      const telegramUser =
        validateInitData(
          req.body.initData
        );

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribed(
          telegramUser.id
        );

      subscriptionCache.set(
        String(telegramUser.id),
        {
          value: subscribed,
          checkedAt: Date.now()
        }
      );

      if (subscribed) {

        const user =
          await createOrUpdateUser(
            telegramUser
          );

        if (user.blocked) {
          return res.json({
            subscribed: true,
            blocked: true
          });
        }
      }

      return res.json({
        subscribed,
        blocked: false
      });

    } catch (error) {

      console.error(
        "/api/check-subscription:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   ME
===================================================== */

app.post(
  "/api/me",
  async (req, res) => {

    try {

      const auth =
        await getAuthenticatedUser(
          req.body.initData,
          true
        );

      if (!auth) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      if (!auth.subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      if (auth.blocked) {
        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

      const client =
        await pool.connect();

      try {

        await client.query(
          `
          UPDATE users
          SET
            username = $2,
            first_name = $3,
            photo_url =
              COALESCE($4, photo_url),
            updated_at =
              CURRENT_TIMESTAMP
          WHERE telegram_id = $1
          `,
          [
            auth.telegramUser.id,
            auth.telegramUser.username || null,
            auth.telegramUser.first_name || "Player",
            auth.telegramUser.photo_url || null
          ]
        );

        let result =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            `,
            [auth.telegramUser.id]
          );

        let user =
          result.rows[0];

        if (!user || user.blocked) {
          return res.status(403).json({
            error: "USER_BLOCKED"
          });
        }

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
            `,
            [auth.telegramUser.id]
          );

        user =
          result.rows[0];

        await updatePermanentLeague(
          client,
          auth.telegramUser.id,
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
            [auth.telegramUser.id]
          );

        user =
          result.rows[0];

        const rankResult =
          await client.query(
            `
            SELECT COUNT(*) + 1 AS rank
            FROM users
            WHERE blocked = FALSE
              AND balance > $1
            `,
            [user.balance]
          );

        return res.json(
          formatUser(
            user,
            Number(
              rankResult.rows[0].rank
            )
          )
        );

      } finally {
        client.release();
      }

    } catch (error) {

      console.error(
        "/api/me error:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   OLD USER API
===================================================== */

app.get(
  "/api/user/:telegramId",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [req.params.telegramId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "USER_NOT_FOUND"
        });
      }

      const user =
        result.rows[0];

      const rankResult =
        await pool.query(
          `
          SELECT COUNT(*) + 1 AS rank
          FROM users
          WHERE blocked = FALSE
            AND balance > $1
          `,
          [user.balance]
        );

      return res.json(
        formatUser(
          user,
          Number(
            rankResult.rows[0].rank
          )
        )
      );

    } catch (error) {

      console.error(
        "/api/user:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   TAP
===================================================== */

app.post(
  "/api/tap",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const telegramUser =
        validateInitData(
          req.body.initData
        );

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      // =========================
      // BLOCK CHECK
      // =========================

      const blockedResult =
        await client.query(
          `
          SELECT blocked
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      if (
        blockedResult.rows.length &&
        blockedResult.rows[0].blocked
      ) {
        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

      // =========================
      // SUBSCRIPTION
      // =========================

      const subscribed =
        await isSubscribedCached(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
            
 // =========================
// TAP COUNT + ANTI-CHEAT
// =========================

let rawTaps =
  Number(req.body.taps || 0);

if (
  !Number.isFinite(rawTaps) ||
  rawTaps <= 0
) {
  return res.status(400).json({
    error: "INVALID_TAPS"
  });
}

let taps =
  Math.floor(rawTaps);

// Server bir requestda ko‘pi bilan 25 ta tapni
// hisoblaydi.
const requestedTooMany =
  taps > ANTI_CHEAT.MAX_TAPS_PER_REQUEST;

if (requestedTooMany) {
  taps =
    ANTI_CHEAT.MAX_TAPS_PER_REQUEST;
}

// Juda tez requestlarni kuzatamiz.
// Normal foydalanuvchini bloklamaymiz.
const rate =
  checkTapRate(telegramUser.id);

// Replay ID bo‘lsa tekshiramiz.
// Eski frontend requestId yubormasa ham endpoint
// ishlashda davom etadi.
const requestId =
  getTapRequestId(req.body);

if (rate.tooMany) {

  console.warn(
    "[ANTI-CHEAT] High tap request rate:",
    {
      telegramId: telegramUser.id,
      requestsLastSecond:
        rate.requestsLastSecond,
      taps
    }
  );
}

// Juda katta taps yuborilgan bo‘lsa,
// faqat server limitiga tushiramiz.
if (requestedTooMany) {

  console.warn(
    "[ANTI-CHEAT] Large tap request:",
    {
      telegramId: telegramUser.id,
      requested: Math.floor(rawTaps),
      accepted:
        ANTI_CHEAT.MAX_TAPS_PER_REQUEST
    }
  );
}

      await client.query("BEGIN");

      let result =
        await client.query(

// =========================
// SERVER-SIDE ANTI-CHEAT
// =========================

let suspiciousPoints = 0;

if (rate.tooFast) {
  suspiciousPoints += 1;
}

if (rate.tooMany) {
  suspiciousPoints += 2;
}

if (requestedTooMany) {
  suspiciousPoints += 2;
}          
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );

      if (!result.rows.length) {

        await createOrUpdateUser(
          telegramUser,
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
            [telegramUser.id]
          );
      }

      let user =
        result.rows[0];

      if (user.blocked) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

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
          [telegramUser.id]
        );

      user =
        result.rows[0];

// =========================
// REPLAY DETECTION
// =========================

if (requestId) {

  const previousRequestId =
    user.last_tap_request_id
      ? String(user.last_tap_request_id)
      : null;

  const lastTapAt =
    user.last_tap_at
      ? new Date(user.last_tap_at).getTime()
      : 0;

  const isRecentReplay =
    previousRequestId &&
    previousRequestId === requestId &&
    lastTapAt > 0 &&
    Date.now() - lastTapAt <
      ANTI_CHEAT.REPLAY_WINDOW_MS;

  if (isRecentReplay) {

    await client.query(
      "ROLLBACK"
    );

    console.warn(
      "[ANTI-CHEAT] Replay request:",
      {
        telegramId:
          telegramUser.id,
        requestId
      }
    );

    return res.status(409).json({
      error: "DUPLICATE_TAP_REQUEST"
    });
  }
}        

      const availableEnergy =
        Number(user.energy || 0);

      const actualTaps =
        Math.min(
          taps,
          availableEnergy
        );

      if (actualTaps <= 0) {

        await client.query("COMMIT");

        return res.json({
          earned: 0,
          taps: 0,
          user:
            formatUser(user)
        });
      }

      const power =
        Math.min(
          Math.max(
            Number(user.tap_level || 1),
            1
          ),
          MAX_TAP_LEVEL
        );

      const earned =
        actualTaps * power;

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
        `,
        [
          telegramUser.id,
          earned,
          actualTaps
        ]
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      user =
        result.rows[0];

      await updatePermanentLeague(
        client,
        telegramUser.id,
        user.balance,
        user.league_level
      );

        
// =========================
// SAVE ANTI-CHEAT DATA
// =========================

await client.query(
  `
  UPDATE users
  SET
    anti_cheat_score =
      LEAST(
        COALESCE(anti_cheat_score, 0) + $2,
        100
      ),

    suspicious_taps =
      LEAST(
        COALESCE(suspicious_taps, 0) + $3,
        1000000
      ),

    last_tap_at =
      CURRENT_TIMESTAMP,

    last_tap_request_id =
      COALESCE($4, last_tap_request_id),

    updated_at =
      CURRENT_TIMESTAMP

  WHERE telegram_id = $1
  `,
  [
    telegramUser.id,
    suspiciousPoints,
    requestedTooMany
      ? Math.floor(rawTaps)
      : 0,
    requestId
  ]
);
      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      user =
        result.rows[0];

      await client.query("COMMIT");

      return res.json({
        earned,
        taps: actualTaps,
        user:
          formatUser(user)
      });

    } catch (error) {

      try {
        await client.query("ROLLBACK");
      } catch (e) {}

      console.error(
        "/api/tap:",
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


/* =====================================================
   UPGRADE
===================================================== */

app.post(
  "/api/upgrade",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const telegramUser =
        validateInitData(
          req.body.initData
        );

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribedCached(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      const blockedResult =
        await client.query(
          `
          SELECT blocked
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      if (
        blockedResult.rows.length &&
        blockedResult.rows[0].blocked
      ) {
        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

      const type =
        req.body.type;

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

      if (!result.rows.length) {

        await createOrUpdateUser(
          telegramUser,
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
            [telegramUser.id]
          );
      }

      let user =
        result.rows[0];

      if (user.blocked) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

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
          [telegramUser.id]
        );

      user =
        result.rows[0];

      const balance =
        Number(user.balance || 0);


      /* =================================================
         TAP UPGRADE
      ================================================= */

      if (type === "tap") {

        const level =
          Math.min(
            Math.max(
              Number(
                user.tap_level || 1
              ),
              1
            ),
            MAX_TAP_LEVEL
          );

        // =========================
        // MAX LEVEL = 10
        // =========================

        if (
          level >= MAX_TAP_LEVEL
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error: "MAX_LEVEL"
          });
        }

        const cost =
          getTapUpgradeCost(
            level
          );

        if (
          !cost ||
          cost <= 0
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error: "MAX_LEVEL"
          });
        }

        if (balance < cost) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error:
              "NOT_ENOUGH_BALANCE"
          });
        }

        const newLevel =
          level + 1;

        await client.query(
          `
          UPDATE users
          SET
            balance =
              balance - $2,

            tap_level =
              $3,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE telegram_id = $1
          `,
          [
            telegramUser.id,
            cost,
            newLevel
          ]
        );
      }


      /* =================================================
         ENERGY UPGRADE
      ================================================= */

      if (type === "energy") {

        const level =
          Math.min(
            Math.max(
              Number(
                user.energy_level || 1
              ),
              1
            ),
            MAX_ENERGY_LEVEL
          );

        // =========================
        // MAX LEVEL = 10
        // =========================

        if (
          level >= MAX_ENERGY_LEVEL
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error: "MAX_LEVEL"
          });
        }

        const cost =
          getEnergyUpgradeCost(
            level
          );

        if (
          !cost ||
          cost <= 0
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error: "MAX_LEVEL"
          });
        }

        if (balance < cost) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error:
              "NOT_ENOUGH_BALANCE"
          });
        }

        const newLevel =
          level + 1;

        const newMax =
          getMaxEnergy(
            newLevel
          );

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
          `,
          [
            telegramUser.id,
            cost,
            newLevel,
            newMax
          ]
        );
      }


      /* =================================================
         UPDATE USER
      ================================================= */

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      user =
        result.rows[0];

      await updatePermanentLeague(
        client,
        telegramUser.id,
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
          [telegramUser.id]
        );

      user =
        result.rows[0];

      await client.query(
        "COMMIT"
      );

      return res.json({
        success: true,
        user:
          formatUser(user)
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (e) {}

      console.error(
        "/api/upgrade:",
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


/* =====================================================
   DAILY
===================================================== */

app.post(
  "/api/daily",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const telegramUser =
        validateInitData(
          req.body.initData
        );

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribedCached(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      const blockedResult =
        await client.query(
          `
          SELECT blocked
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      if (
        blockedResult.rows.length &&
        blockedResult.rows[0].blocked
      ) {
        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

      await client.query(
        "BEGIN"
      );

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

      if (!result.rows.length) {

        await createOrUpdateUser(
          telegramUser,
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
            [telegramUser.id]
          );
      }

      const user =
        result.rows[0];

      if (user.blocked) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

      const now =
        new Date();

      const lastClaim =
        user.daily_claimed_at
          ? new Date(
              user.daily_claimed_at
            )
          : null;

      let alreadyClaimed = false;

      if (lastClaim) {

        alreadyClaimed =
          lastClaim.toDateString() ===
          now.toDateString();
      }

      if (alreadyClaimed) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "ALREADY_CLAIMED"
        });
      }

      await client.query(
        `
        UPDATE users
        SET
          balance =
            balance + 100,

          daily_claimed_at =
            CURRENT_TIMESTAMP,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE telegram_id = $1
        `,
        [telegramUser.id]
      );

      result =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      let updatedUser =
        result.rows[0];

      await updatePermanentLeague(
        client,
        telegramUser.id,
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
          [telegramUser.id]
        );

      updatedUser =
        result.rows[0];

      await client.query(
        "COMMIT"
      );

      return res.json({
        success: true,
        reward: 100,
        user:
          formatUser(updatedUser)
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (e) {}

      console.error(
        "/api/daily:",
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


/* =====================================================
   REFERRAL API
===================================================== */

app.post(
  "/api/referral",
  async (req, res) => {

    try {

      const telegramUser =
        validateInitData(
          req.body.initData
        );

      if (!telegramUser) {
        return res.status(401).json({
          error: "INVALID_INIT_DATA"
        });
      }

      const subscribed =
        await isSubscribedCached(
          telegramUser.id
        );

      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED"
        });
      }

      const blockedResult =
        await pool.query(
          `
          SELECT blocked
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      if (
        blockedResult.rows.length &&
        blockedResult.rows[0].blocked
      ) {
        return res.status(403).json({
          error: "USER_BLOCKED"
        });
      }

      const success =
        await processReferral(
          telegramUser.id,
          req.body.referrerId
        );

      return res.json({
        success
      });

    } catch (error) {

      console.error(
        "/api/referral:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   FRIENDS
===================================================== */

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
            created_at

          FROM users

          WHERE referred_by = $1

          ORDER BY created_at DESC
          `,
          [req.params.telegramId]
        );

      return res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "/api/friends:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   RANK
===================================================== */

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
            league_level,
            created_at

          FROM users

          WHERE blocked = FALSE

          ORDER BY
            balance DESC,
            created_at ASC

          LIMIT 100
          `
        );

      const users =
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
                user.photo_url ||
                null,

              balance:
                Number(
                  user.balance || 0
                ),

              league: {
                name:
                  league.name,

                icon:
                  league.icon
              }
            };
          }
        );

      return res.json({
        users
      });

    } catch (error) {

      console.error(
        "/api/rank:",
        error
      );

      return res.status(500).json({
        error: "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   ADMIN STATS
===================================================== */

app.post(
  "/api/admin/stats",
  async (req, res) => {

    try {

      const { initData } =
        req.body;

      const admin =
        await getAdminFromInitData(
          initData
        );

      if (!admin) {
        return res.status(403).json({
          success: false,
          error: "Admin access denied"
        });
      }

      const usersResult =
        await pool.query(`
          SELECT
            COUNT(*)::int AS users,

            COALESCE(
              SUM(balance),
              0
            ) AS total_balance,

            COALESCE(
              SUM(referrals),
              0
            )::int AS total_referrals

          FROM users
        `);

      const todayResult =
        await pool.query(`
          SELECT COUNT(*)::int AS today_users
          FROM users
          WHERE created_at::date =
            CURRENT_DATE
        `);

      const row =
        usersResult.rows[0];

      return res.json({
        success: true,

        stats: {
          users:
            row.users,

          totalBalance:
            Number(
              row.total_balance || 0
            ),

          totalReferrals:
            row.total_referrals,

          todayUsers:
            todayResult.rows[0].today_users
        }
      });

    } catch (error) {

      console.error(
        "Admin stats error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  }
);


/* =====================================================
   ADMIN USERS SEARCH
===================================================== */

app.post(
  "/api/admin/users",
  async (req, res) => {

    try {

      const {
        initData,
        search = ""
      } = req.body;

      const admin =
        await getAdminFromInitData(
          initData
        );

      if (!admin) {
        return res.status(403).json({
          success: false,
          error: "Admin access denied"
        });
      }

      const q =
        String(search).trim();

      let result;

      if (!q) {

        result =
          await pool.query(`
            SELECT
              telegram_id,
              username,
              first_name,
              balance,
              energy,
              max_energy,
              tap_level,
              energy_level,
              referrals,
              league_level,
              blocked,
              created_at

            FROM users

            ORDER BY balance DESC

            LIMIT 100
          `);

      } else {

        result =
          await pool.query(
            `
            SELECT
              telegram_id,
              username,
              first_name,
              balance,
              energy,
              max_energy,
              tap_level,
              energy_level,
              referrals,
              league_level,
              blocked,
              created_at

            FROM users

            WHERE
              telegram_id::text ILIKE $1
              OR username ILIKE $1
              OR first_name ILIKE $1

            ORDER BY balance DESC

            LIMIT 100
            `,
            [`%${q}%`]
          );
      }

      return res.json({
        success: true,
        users: result.rows
      });

    } catch (error) {

      console.error(
        "Admin users error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  }
);


/* =====================================================
   ADMIN USER BALANCE UPDATE
===================================================== */

app.post(
  "/api/admin/user/update",
  async (req, res) => {

    try {

      const {
        initData,
        telegramId,
        balanceChange
      } = req.body;

      const admin =
        await getAdminFromInitData(
          initData
        );

      if (!admin) {
        return res.status(403).json({
          success: false,
          error: "Admin access denied"
        });
      }

      if (!telegramId) {
        return res.status(400).json({
          success: false,
          error: "telegramId required"
        });
      }

      const change =
        Number(balanceChange);

      if (!Number.isFinite(change)) {
        return res.status(400).json({
          success: false,
          error: "Invalid balanceChange"
        });
      }

      const client =
        await pool.connect();

      try {

        await client.query(
          "BEGIN"
        );

        const userResult =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [telegramId]
          );

        if (
          userResult.rows.length === 0
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(404).json({
            success: false,
            error: "User not found"
          });
        }

        const user =
          userResult.rows[0];

        const oldBalance =
          Number(
            user.balance || 0
          );

        const newBalance =
          Math.max(
            0,
            oldBalance + change
          );

        const newLeague =
          getLeagueFromBalance(
            newBalance
          );

        await client.query(
          `
          UPDATE users
          SET
            balance = $1,

            league_level =
              GREATEST(
                league_level,
                $2
              ),

            updated_at =
              CURRENT_TIMESTAMP

          WHERE telegram_id = $3
          `,
          [
            newBalance,
            newLeague.level,
            telegramId
          ]
        );

        await client.query(
          "COMMIT"
        );

        return res.json({
          success: true,
          telegramId,
          oldBalance,
          newBalance,
          change
        });

      } catch (error) {

        await client.query(
          "ROLLBACK"
        );

        throw error;

      } finally {
        client.release();
      }

    } catch (error) {

      console.error(
        "Admin update error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  }
);


/* =====================================================
   ADMIN BLOCK / UNBLOCK
===================================================== */

app.post(
  "/api/admin/user/block",
  async (req, res) => {

    try {

      const {
        initData,
        telegramId,
        blocked
      } = req.body;

      const admin =
        await getAdminFromInitData(
          initData
        );

      if (!admin) {
        return res.status(403).json({
          success: false,
          error: "Admin access denied"
        });
      }

      if (!telegramId) {
        return res.status(400).json({
          success: false,
          error: "telegramId required"
        });
      }

      let newBlocked;

      if (
        blocked === true ||
        blocked === "true" ||
        blocked === 1 ||
        blocked === "1"
      ) {
        newBlocked = true;
      } else {
        newBlocked = false;
      }

      const result =
        await pool.query(
          `
          UPDATE users

          SET
            blocked = $1,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE telegram_id = $2

          RETURNING
            telegram_id,
            username,
            first_name,
            blocked
          `,
          [
            newBlocked,
            telegramId
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }

      return res.json({
        success: true,
        user: result.rows[0]
      });

    } catch (error) {

      console.error(
        "/api/admin/user/block:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "SERVER_ERROR"
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
      leagues: LEAGUES
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

      const result =
        await pool.query(
          `
          SELECT
            COUNT(*) AS users,

            COALESCE(
              SUM(balance),
              0
            ) AS total_balance

          FROM users
          `
        );

      return res.json({
        online: true,

        users:
          Number(
            result.rows[0].users
          ),

        totalBalance:
          Number(
            result.rows[0].total_balance
          )
      });

    } catch (error) {

      console.error(
        "/api/status:",
        error
      );

      return res.status(500).json({
        online: false
      });
    }
  }
);


/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  (req, res) => {

    return res.status(200).json({
      status: "ok",
      service: "UZCOIN",
      uptime: process.uptime()
    });
  }
);


/* =====================================================
   WEBHOOK
===================================================== */

app.post(
  "/telegram-webhook",
  async (req, res) => {

    try {

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


/* =====================================================
   START SERVER
===================================================== */

async function startServer() {

  try {

    await initDatabase();

    try {

      await bot.telegram.setWebhook(
        `${PUBLIC_URL}/telegram-webhook`
      );

      console.log(
        "Telegram webhook:",
        `${PUBLIC_URL}/telegram-webhook`
      );

    } catch (error) {

      console.error(
        "Webhook setup error:",
        error.message
      );
    }

    const PORT =
      process.env.PORT || 3000;

    app.listen(
      PORT,
      () => {

        console.log(
          `UZCOIN server running on port ${PORT}`
        );

      }
    );

  } catch (error) {

    console.error(
      "Server startup error:",
      error
    );

    process.exit(1);
  }
}

startServer();
