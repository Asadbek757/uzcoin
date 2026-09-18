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
   CONFIG
===================================================== */

const LEAGUES = [
  {
    min: 0,
    name: "BRONZE",
    icon: "🥉"
  },
  {
    min: 2000,
    name: "SILVER",
    icon: "🥈"
  },
  {
    min: 10000,
    name: "GOLD",
    icon: "🥇"
  },
  {
    min: 50000,
    name: "DIAMOND",
    icon: "💎"
  },
  {
    min: 100000,
    name: "MASTER",
    icon: "👑"
  }
];

const REFERRAL_BONUS = 500;

/*
  Tap Power:
  Level 1 = +1 coin/tap
  Level 2 = +2 coin/tap
  Level 3 = +3 coin/tap
  ...
*/

function getTapUpgradeCost(level) {
  return Math.floor(
    500 * Math.pow(1.8, Number(level) - 1)
  );
}

/*
  Energy:
  Level 1 = 100
  Level 2 = 200
  Level 3 = 300
  ...
*/

function getEnergyUpgradeCost(level) {
  return Math.floor(
    1000 * Math.pow(1.75, Number(level) - 1)
  );
}

function getMaxEnergy(level) {
  return Number(level) * 100;
}

function getLeague(balance) {
  const amount = Number(balance) || 0;

  let current = LEAGUES[0];

  for (const league of LEAGUES) {
    if (amount >= league.min) {
      current = league;
    }
  }

  return current;
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

      balance NUMERIC NOT NULL DEFAULT 0,

      energy INTEGER NOT NULL DEFAULT 100,

      max_energy INTEGER NOT NULL DEFAULT 100,

      tap_level INTEGER NOT NULL DEFAULT 1,

      energy_level INTEGER NOT NULL DEFAULT 1,

      referrals INTEGER NOT NULL DEFAULT 0,

      referred_by BIGINT,

      daily_claimed_at TIMESTAMP,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
    Eski database bo'lsa ham ishlashi uchun
    kerakli ustunlarni qo'shamiz.
  */

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS first_name TEXT,
      ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS energy INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS max_energy INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS tap_level INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS energy_level INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS referred_by BIGINT,
      ADD COLUMN IF NOT EXISTS daily_claimed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  /*
    Eski skin/level ustunlari bo'lsa,
    ularga tegmaymiz.
    Faqat yangi tizimga kerakli qiymatlarni
    xavfsiz holatga keltiramiz.
  */

  await pool.query(`
    UPDATE users
    SET
      balance = COALESCE(balance, 0),
      tap_level = GREATEST(COALESCE(tap_level, 1), 1),
      energy_level = GREATEST(COALESCE(energy_level, 1), 1)
  `);

  await pool.query(`
    UPDATE users
    SET
      max_energy = GREATEST(
        COALESCE(max_energy, 100),
        COALESCE(energy_level, 1) * 100
      )
  `);

  await pool.query(`
    UPDATE users
    SET
      energy = LEAST(
        COALESCE(energy, max_energy),
        max_energy
      )
  `);

  console.log("Database tayyor!");
}

/* =====================================================
   ENERGY REGENERATION
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

      energy_updated_at = CURRENT_TIMESTAMP,

      updated_at = CURRENT_TIMESTAMP

    WHERE telegram_id = $1

    RETURNING *
    `,
    [telegramId]
  );

  return result.rows[0] || null;
}

/* =====================================================
   CREATE / UPDATE USER
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

  return result.rows[0];
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
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

    const secretKey = crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== hash) {
      return null;
    }

    const authDate =
      Number(params.get("auth_date"));

    if (
      authDate &&
      Math.floor(Date.now() / 1000) - authDate > 86400
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
      "Telegram validation:",
      error
    );

    return null;
  }
}

/* =====================================================
   AUTH HELPER
===================================================== */

async function authenticateRequest(req) {

  const {
    telegramId,
    initData
  } = req.body || {};

  if (!telegramId) {
    return {
      ok: false,
      status: 400,
      message: "telegramId kerak"
    };
  }

  /*
    Mini App initData yuborilsa,
    Telegram user ID tekshiriladi.
  */

  if (initData) {

    const telegramUser =
      validateTelegramInitData(
        initData
      );

    if (!telegramUser) {

      return {
        ok: false,
        status: 403,
        message: "Telegram sessiyasi noto'g'ri"
      };
    }

    if (
      String(telegramUser.id) !==
      String(telegramId)
    ) {

      return {
        ok: false,
        status: 403,
        message: "Telegram user mos emas"
      };
    }
  }

  const user =
    await regenerateEnergy(
      telegramId
    );

  if (!user) {

    return {
      ok: false,
      status: 404,
      message: "Foydalanuvchi topilmadi"
    };
  }

  return {
    ok: true,
    user
  };
}

/* =====================================================
   USER RESPONSE
===================================================== */

function formatUser(user) {

  const balance =
    Number(user.balance);

  const tapLevel =
    Number(user.tap_level || 1);

  const energyLevel =
    Number(user.energy_level || 1);

  const league =
    getLeague(balance);

  return {

    telegramId:
      String(user.telegram_id),

    username:
      user.username,

    firstName:
      user.first_name,

    balance,

    energy:
      Number(user.energy),

    maxEnergy:
      Number(user.max_energy),

    tapLevel,

    power:
      tapLevel,

    energyLevel,

    referrals:
      Number(user.referrals || 0),

    league: {
      name: league.name,
      icon: league.icon,
      min: league.min
    },

    upgrades: {

      tap: {
        level: tapLevel,
        nextLevel: tapLevel + 1,
        cost: getTapUpgradeCost(
          tapLevel
        ),
        currentPower: tapLevel,
        nextPower: tapLevel + 1
      },

      energy: {
        level: energyLevel,
        nextLevel: energyLevel + 1,
        cost: getEnergyUpgradeCost(
          energyLevel
        ),
        currentMaxEnergy:
          Number(user.max_energy),
        nextMaxEnergy:
          getMaxEnergy(
            energyLevel + 1
          )
      }
    }
  };
}

/* =====================================================
   /START
===================================================== */

bot.start(async (ctx) => {

  try {

    const telegramId =
      ctx.from.id;

    const username =
      ctx.from.username || null;

    const firstName =
      ctx.from.first_name || null;

    const user =
      await createOrUpdateUser(
        telegramId,
        username,
        firstName
      );

    const league =
      getLeague(user.balance);

    await ctx.reply(

      `Salom, ${firstName || "do'st"}! 👋\n\n` +

      `🪙 UZCOIN\n\n` +

      `💰 Balans: ` +
      `${Number(user.balance).toLocaleString("uz-UZ")} UZC\n` +

      `🏆 Liga: ${league.icon} ${league.name}\n` +

      `⚡ Energy: ` +
      `${user.energy}/${user.max_energy}\n\n` +

      `UZCOIN Mini App'ni oching 👇`,

      {
        reply_markup: {

          inline_keyboard: [

            [
              {
                text: "🪙 UZCOIN",
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

    console.error(
      "START ERROR:",
      error
    );

    await ctx.reply(
      "❌ Xatolik yuz berdi."
    );
  }
});

/* =====================================================
   /BALANCE
===================================================== */

bot.command(
  "balance",
  async (ctx) => {

    try {

      const user =
        await regenerateEnergy(
          ctx.from.id
        );

      if (!user) {

        return ctx.reply(
          "Avval /start buyrug'ini bosing."
        );
      }

      const league =
        getLeague(user.balance);

      await ctx.reply(

        `🪙 UZCOIN\n\n` +

        `💰 ` +
        `${Number(user.balance).toLocaleString("uz-UZ")} UZC\n` +

        `🏆 ${league.icon} ${league.name}\n` +

        `⚡ ` +
        `${user.energy}/${user.max_energy}\n` +

        `👆 Tap Power: +${user.tap_level}\n` +

        `⚡ Max Energy: ${user.max_energy}`

      );

    } catch (error) {

      console.error(
        "BALANCE ERROR:",
        error
      );

      await ctx.reply(
        "❌ Balansni olishda xatolik."
      );
    }
  }
);

/* =====================================================
   USER API
===================================================== */

app.get(
  "/api/user/:telegramId",
  async (req, res) => {

    try {

      const user =
        await regenerateEnergy(
          req.params.telegramId
        );

      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            "Foydalanuvchi topilmadi"
        });
      }

      res.json({
        success: true,
        user: formatUser(user)
      });

    } catch (error) {

      console.error(
        "USER API:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Server xatosi"
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

    try {

      const auth =
        await authenticateRequest(req);

      if (!auth.ok) {

        return res
          .status(auth.status)
          .json({
            success: false,
            message: auth.message
          });
      }

      const user =
        auth.user;

      const tapLevel =
        Number(user.tap_level || 1);

      const power =
        tapLevel;

      /*
        Frontend nechta tap qilganini yuborishi mumkin.
        Lekin server har bir tapni energy bilan tekshiradi.
      */

      let requestedTaps =
        Number(req.body.taps || 1);

      requestedTaps =
        Math.floor(requestedTaps);

      if (
        requestedTaps < 1
      ) {
        requestedTaps = 1;
      }

      /*
        Juda katta so'rov yuborilishining oldini olamiz.
      */

      requestedTaps =
        Math.min(
          requestedTaps,
          100
        );

      const availableEnergy =
        Number(user.energy);

      const actualTaps =
        Math.min(
          requestedTaps,
          availableEnergy
        );

      if (actualTaps <= 0) {

        return res.status(400).json({
          success: false,
          message: "Energy tugagan",
          balance:
            Number(user.balance),
          energy: 0,
          maxEnergy:
            Number(user.max_energy)
        });
      }

      const earned =
        actualTaps * power;

      const result =
        await pool.query(
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

            AND energy >= $3

          RETURNING *
          `,
          [
            user.telegram_id,
            earned,
            actualTaps
          ]
        );

      if (
        result.rows.length === 0
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Tap amalga oshmadi"
        });
      }

      const updated =
        result.rows[0];

      res.json({
        success: true,

        balance:
          Number(updated.balance),

        energy:
          Number(updated.energy),

        maxEnergy:
          Number(updated.max_energy),

        power:
          Number(updated.tap_level),

        tapLevel:
          Number(updated.tap_level),

        energyLevel:
          Number(updated.energy_level),

        earned,

        taps:
          actualTaps,

        league:
          getLeague(updated.balance)
      });

    } catch (error) {

      console.error(
        "TAP ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Tap server xatosi"
      });
    }
  }
);

/* =====================================================
   BOOST / UPGRADE
===================================================== */

app.post(
  "/api/upgrade",
  async (req, res) => {

    try {

      const auth =
        await authenticateRequest(req);

      if (!auth.ok) {

        return res
          .status(auth.status)
          .json({
            success: false,
            message: auth.message
          });
      }

      const user =
        auth.user;

      const type =
        req.body.type;

      /*
        TAP POWER
      */

      if (type === "tap") {

        const currentLevel =
          Number(user.tap_level || 1);

        const cost =
          getTapUpgradeCost(
            currentLevel
          );

        const result =
          await pool.query(
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

              AND balance >= $2

            RETURNING *
            `,
            [
              user.telegram_id,
              cost
            ]
          );

        if (
          result.rows.length === 0
        ) {

          return res.status(400).json({
            success: false,
            message:
              "Coin yetarli emas"
          });
        }

        const updated =
          result.rows[0];

        return res.json({
          success: true,

          type: "tap",

          balance:
            Number(updated.balance),

          power:
            Number(updated.tap_level),

          tapLevel:
            Number(updated.tap_level),

          energy:
            Number(updated.energy),

          maxEnergy:
            Number(updated.max_energy),

          cost,

          nextCost:
            getTapUpgradeCost(
              Number(updated.tap_level)
            )
        });
      }

      /*
        MAX ENERGY
      */

      if (type === "energy") {

        const currentLevel =
          Number(
            user.energy_level || 1
          );

        const cost =
          getEnergyUpgradeCost(
            currentLevel
          );

        const newLevel =
          currentLevel + 1;

        const newMaxEnergy =
          getMaxEnergy(
            newLevel
          );

        const result =
          await pool.query(
            `
            UPDATE users

            SET
              balance =
                balance - $2,

              energy_level =
                energy_level + 1,

              max_energy =
                $3,

              energy =
                energy + 100,

              updated_at =
                CURRENT_TIMESTAMP

            WHERE telegram_id = $1

              AND balance >= $2

            RETURNING *
            `,
            [
              user.telegram_id,
              cost,
              newMaxEnergy
            ]
          );

        if (
          result.rows.length === 0
        ) {

          return res.status(400).json({
            success: false,
            message:
              "Coin yetarli emas"
          });
        }

        const updated =
          result.rows[0];

        return res.json({
          success: true,

          type: "energy",

          balance:
            Number(updated.balance),

          power:
            Number(updated.tap_level),

          tapLevel:
            Number(updated.tap_level),

          energy:
            Number(updated.energy),

          maxEnergy:
            Number(updated.max_energy),

          energyLevel:
            Number(updated.energy_level),

          cost,

          nextCost:
            getEnergyUpgradeCost(
              Number(updated.energy_level)
            )
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Noto'g'ri upgrade turi"
      });

    } catch (error) {

      console.error(
        "UPGRADE ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Upgrade server xatosi"
      });
    }
  }
);

/* =====================================================
   REFERRAL
===================================================== */

app.post(
  "/api/referral",
  async (req, res) => {

    try {

      const {
        telegramId,
        referredBy
      } = req.body;

      if (
        !telegramId ||
        !referredBy
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Referral ma'lumotlari yetishmayapti"
        });
      }

      if (
        String(telegramId) ===
        String(referredBy)
      ) {

        return res.status(400).json({
          success: false,
          message:
            "O'zingizni referral qila olmaysiz"
        });
      }

      const user =
        await regenerateEnergy(
          telegramId
        );

      const inviter =
        await regenerateEnergy(
          referredBy
        );

      if (!user || !inviter) {

        return res.status(404).json({
          success: false,
          message:
            "Foydalanuvchi topilmadi"
        });
      }

      /*
        Referral faqat bir marta.
      */

      if (user.referred_by) {

        return res.json({
          success: true,
          alreadyUsed: true
        });
      }

      await pool.query(
        `
        UPDATE users

        SET
          referred_by = $2,
          updated_at = CURRENT_TIMESTAMP

        WHERE telegram_id = $1
        `,
        [
          telegramId,
          referredBy
        ]
      );

      await pool.query(
        `
        UPDATE users

        SET
          balance =
            balance + $2,

          referrals =
            referrals + 1,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE telegram_id = $1
        `,
        [
          referredBy,
          REFERRAL_BONUS
        ]
      );

      res.json({
        success: true,
        bonus:
          REFERRAL_BONUS
      });

    } catch (error) {

      console.error(
        "REFERRAL ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Referral xatosi"
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

      const user =
        await regenerateEnergy(
          req.params.telegramId
        );

      if (!user) {

        return res.status(404).json({
          success: false
        });
      }

      const friends =
        await pool.query(
          `
          SELECT
            telegram_id,
            username,
            first_name,
            balance
          FROM users

          WHERE referred_by = $1

          ORDER BY created_at DESC

          LIMIT 100
          `,
          [
            req.params.telegramId
          ]
        );

      res.json({
        success: true,

        referrals:
          Number(user.referrals || 0),

        bonus:
          Number(user.referrals || 0) *
          REFERRAL_BONUS,

        friends:
          friends.rows.map(friend => ({
            telegramId:
              String(friend.telegram_id),

            username:
              friend.username,

            firstName:
              friend.first_name,

            balance:
              Number(friend.balance)
          }))
      });

    } catch (error) {

      console.error(
        "FRIENDS ERROR:",
        error
      );

      res.status(500).json({
        success: false
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
            balance
          FROM users

          ORDER BY balance DESC

          LIMIT 100
          `
        );

      res.json({

        success: true,

        users:
          result.rows.map(
            (user, index) => {

              const league =
                getLeague(
                  user.balance
                );

              return {

                position:
                  index + 1,

                telegramId:
                  String(user.telegram_id),

                username:
                  user.username,

                firstName:
                  user.first_name,

                balance:
                  Number(user.balance),

                league:
                  league.name,

                leagueIcon:
                  league.icon
              };
            }
          )
      });

    } catch (error) {

      console.error(
        "RANK ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Rank xatosi"
      });
    }
  }
);

/* =====================================================
   PROFILE
===================================================== */

app.get(
  "/api/profile/:telegramId",
  async (req, res) => {

    try {

      const user =
        await regenerateEnergy(
          req.params.telegramId
        );

      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            "Foydalanuvchi topilmadi"
        });
      }

      res.json({
        success: true,
        profile:
          formatUser(user)
      });

    } catch (error) {

      console.error(
        "PROFILE ERROR:",
        error
      );

      res.status(500).json({
        success: false
      });
    }
  }
);

/* =====================================================
   LEAGUES
===================================================== */

app.get(
  "/api/leagues",
  async (req, res) => {

    res.json({
      success: true,
      leagues: LEAGUES
    });

  }
);

/* =====================================================
   DAILY REWARD
===================================================== */

app.post(
  "/api/daily",
  async (req, res) => {

    try {

      const auth =
        await authenticateRequest(req);

      if (!auth.ok) {

        return res
          .status(auth.status)
          .json({
            success: false,
            message: auth.message
          });
      }

      const user =
        auth.user;

      const result =
        await pool.query(
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

            AND (
              daily_claimed_at IS NULL
              OR daily_claimed_at < CURRENT_DATE
            )

          RETURNING *
          `,
          [
            user.telegram_id
          ]
        );

      if (
        result.rows.length === 0
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Bugungi reward allaqachon olingan"
        });
      }

      const updated =
        result.rows[0];

      res.json({
        success: true,

        reward: 100,

        balance:
          Number(updated.balance)
      });

    } catch (error) {

      console.error(
        "DAILY ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Daily reward xatosi"
      });
    }
  }
);

/* =====================================================
   STATUS
===================================================== */

app.get(
  "/api/status",
  async (req, res) => {

    try {

      await pool.query(
        "SELECT 1"
      );

      res.json({
        success: true,
        message:
          "UZCOIN server ishlayapti!",
        database:
          "connected"
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message:
          "Database ulanmagan"
      });
    }
  }
);

/* =====================================================
   STATIC FILES
===================================================== */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
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

app.listen(
  PORT,
  async () => {

    console.log(
      `UZCOIN server ${PORT}-portda ishlayapti`
    );

    try {

      await initDatabase();

      await bot.telegram.setWebhook(
        `${PUBLIC_URL}/telegram-webhook`
      );

      console.log(
        "Telegram webhook o'rnatildi!"
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
  }
);

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
