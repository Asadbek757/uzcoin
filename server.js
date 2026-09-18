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
const CHANNEL_URL =
  "https://t.me/uzcoin_officiall";

const BOT_USERNAME = "UZCoinTapBot";

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

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


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


function getLeagueByLevel(level) {

  let result = LEAGUES[0];

  for (const league of LEAGUES) {

    if (league.level <= level) {
      result = league;
    }

  }

  return result;
}


function getLeagueFromBalance(balance) {

  const amount =
    Number(balance || 0);

  let result = LEAGUES[0];

  for (const league of LEAGUES) {

    if (amount >= league.min) {
      result = league;
    }

  }

  return result;
}


/*
  Juda muhim:

  league_level hech qachon kamaymaydi.

  Masalan:
  Bronze -> Silver

  keyin user 1500 coin qilib qolsa ham
  Silver bo'lib qoladi.
*/


async function updatePermanentLeague(
  client,
  telegramId,
  balance,
  currentLeagueLevel
) {

  const current =
    Number(currentLeagueLevel || 1);

  const earnedLeague =
    getLeagueFromBalance(balance);

  const newLevel =
    Math.max(
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
      [
        telegramId,
        newLevel
      ]
    );
  }

  return newLevel;
}


/* =====================================================
   COSTS
===================================================== */

function getTapUpgradeCost(level) {

  return Math.floor(
    500 *
    Math.pow(
      1.8,
      Number(level) - 1
    )
  );
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
    100000
  ];

  return limits[
    Math.min(
      Number(level) - 1,
      limits.length - 1
    )
  ];
}


function getEnergyUpgradeCost(level) {

  const costs = [
    1000,
    5000,
    25000,
    100000,
    500000,
    2500000,
    10000000
  ];

  return costs[
    Math.min(
      Number(level) - 1,
      costs.length - 1
    )
  ];
}


const REFERRAL_BONUS = 500;


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

      energy INTEGER DEFAULT 300,
      max_energy INTEGER DEFAULT 300,

      tap_level INTEGER DEFAULT 1,
      energy_level INTEGER DEFAULT 1,

      referrals INTEGER DEFAULT 0,

      referred_by BIGINT,

      league_level INTEGER DEFAULT 1,

      daily_claimed_at TIMESTAMP,

      energy_updated_at TIMESTAMP,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);


  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS photo_url TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS energy INTEGER DEFAULT 300
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS max_energy INTEGER DEFAULT 300
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tap_level INTEGER DEFAULT 1
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS energy_level INTEGER DEFAULT 1
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS referred_by BIGINT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS league_level INTEGER DEFAULT 1
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS daily_claimed_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);


  /*
    Eski userlarda energy levelga mos
    max energy o'rnatiladi.
  */

  await pool.query(`
    UPDATE users
    SET
      energy_level =
        CASE
          WHEN energy_level IS NULL
            OR energy_level < 1
          THEN 1
          ELSE energy_level
        END
  `);


  await pool.query(`
    UPDATE users
    SET
      max_energy =
        CASE
          WHEN max_energy IS NULL
            OR max_energy < 1
          THEN 300
          ELSE max_energy
        END
  `);


  await pool.query(`
    UPDATE users
    SET
      league_level =
        CASE
          WHEN league_level IS NULL
            OR league_level < 1
          THEN 1
          ELSE league_level
        END
  `);


  /*
    Eski userlarning mavjud balanceiga qarab
    boshlang'ich liga aniqlanadi.
  */

  for (const league of LEAGUES) {

    await pool.query(
      `
      UPDATE users
      SET league_level = GREATEST(
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
   TELEGRAM INIT DATA VALIDATION
===================================================== */

function validateInitData(initData) {

  if (!initData || !BOT_TOKEN) {
    return null;
  }

  try {

    const params =
      new URLSearchParams(
        initData
      );

    const hash =
      params.get("hash");

    if (!hash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString =
      Array.from(params.entries())
        .sort(
          ([a], [b]) =>
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


    const valid =
      crypto.timingSafeEqual(
        Buffer.from(
          calculatedHash
        ),
        Buffer.from(hash)
      );


    if (!valid) {
      return null;
    }


    const userString =
      params.get("user");

    if (!userString) {
      return null;
    }


    return JSON.parse(
      userString
    );

  } catch (error) {

    console.error(
      "initData validation error:",
      error.message
    );

    return null;
  }
}


/* =====================================================
   SUBSCRIPTION
===================================================== */

async function isSubscribed(
  telegramId
) {

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
      ].includes(
        member.status
      )
    ) {
      return true;
    }


    if (
      member.status ===
        "restricted" &&
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


/* =====================================================
   ENERGY
===================================================== */

async function regenerateEnergy(
  client,
  user
) {

  const currentEnergy =
    Number(
      user.energy || 0
    );

  const maxEnergy =
    Number(
      user.max_energy || 300
    );


  if (
    currentEnergy >=
    maxEnergy
  ) {

    return currentEnergy;
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
      (
        now -
        lastUpdate.getTime()
      ) / 1000
    );


  if (
    elapsedSeconds <= 0
  ) {
    return currentEnergy;
  }


  const newEnergy =
    Math.min(
      maxEnergy,
      currentEnergy +
      elapsedSeconds
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


  return newEnergy;
}


/* =====================================================
   USER CREATION / UPDATE
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

      ON CONFLICT (
        telegram_id
      )

      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,

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
        telegramUser.username ||
          null,
        telegramUser.first_name ||
          "Player",
        telegramUser.photo_url ||
          null
      ]
    );


  return result.rows[0];
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

    energy:
      Number(
        user.energy || 0
      ),

    maxEnergy:
      Number(
        user.max_energy || 300
      ),

    tapLevel:
      Number(
        user.tap_level || 1
      ),

    power:
      Number(
        user.tap_level || 1
      ),

    energyLevel:
      Number(
        user.energy_level || 1
      ),

    referrals:
      Number(
        user.referrals || 0
      ),

    league: {
      level:
        league.level,

      name:
        league.name,

      icon:
        league.icon,

      min:
        league.min
    },

    rank,

    upgrades: {

      tap: {
        level:
          Number(
            user.tap_level || 1
          ),

        cost:
          getTapUpgradeCost(
            Number(
              user.tap_level || 1
            )
          )
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
          getEnergyUpgradeCost(
            Number(
              user.energy_level || 1
            )
          )
      }

    }

  };
}


/* =====================================================
   AUTHENTICATED USER
===================================================== */

async function getAuthenticatedUser(
  initData
) {

  const telegramUser =
    validateInitData(
      initData
    );


  if (!telegramUser) {
    return null;
  }


  const subscribed =
    await isSubscribed(
      telegramUser.id
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


  return {
    telegramUser,
    subscribed: true,
    user
  };
}


/* =====================================================
   REFERRAL PROCESS
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


  if (
    newId === refId
  ) {
    return false;
  }


  const client =
    await pool.connect();


  try {

    await client.query(
      "BEGIN"
    );


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


    if (
      !newUserResult.rows.length
    ) {

      await client.query(
        "ROLLBACK"
      );

      return false;
    }


    const newUser =
      newUserResult.rows[0];


    /*
      Agar oldin referral olgan bo'lsa,
      ikkinchi marta bonus berilmaydi.
    */

    if (
      newUser.referred_by
    ) {

      await client.query(
        "ROLLBACK"
      );

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
      !referrerResult.rows.length
    ) {

      await client.query(
        "ROLLBACK"
      );

      return false;
    }


    await client.query(
      `
      UPDATE users
      SET
        balance =
          balance + $2,

        referred_by =
          $3,

        updated_at =
          CURRENT_TIMESTAMP
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
        balance =
          balance + $2,

        referrals =
          referrals + 1,

        updated_at =
          CURRENT_TIMESTAMP
      WHERE telegram_id = $1
      `,
      [
        refId,
        REFERRAL_BONUS
      ]
    );


    /*
      Yangi userning ligasini yangilaymiz.
      Referrerning ligasi ham yuqorilashi mumkin.
    */

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


    await client.query(
      "COMMIT"
    );


    return true;

  } catch (error) {

    await client.query(
      "ROLLBACK"
    );

    console.error(
      "Referral error:",
      error
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


      /*
        Referral payload:
        /start ref_123456
      */

      const payload =
        ctx.startPayload || "";


      const referrerId =
        payload.startsWith(
          "ref_"
        )
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


      await createOrUpdateUser(
        telegramUser
      );


      /*
        Referralni serverning o'zida
        qayta ishlaymiz.
      */

      if (referrerId) {

        await processReferral(
          telegramUser.id,
          referrerId
        );
      }


      await ctx.reply(
        `
🪙 <b>UZCOIN</b>

Xush kelibsiz, ${telegramUser.first_name || "Player"}!
        `,
        {
          parse_mode: "HTML",

          ...Markup.inlineKeyboard([
            [
              Markup.button.webApp(
                "🚀 Open UZCOIN",
                PUBLIC_URL
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

      await ctx.reply(
        "Xatolik yuz berdi. Keyinroq qayta urinib ko‘ring."
      );
    }
  }
);


/* =====================================================
   CHECK SUBSCRIPTION CALLBACK
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


      if (!subscribed) {

        await ctx.answerCbQuery(
          "❌ Hali kanalga obuna bo‘lmagansiz.",
          {
            show_alert: true
          }
        );

        return;
      }


      await createOrUpdateUser(
        ctx.from
      );


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


      if (subscribed) {

        await createOrUpdateUser(
          telegramUser
        );
      }


      return res.json({
        subscribed
      });

    } catch (error) {

      console.error(error);

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
          req.body.initData
        );


      if (!auth) {

        return res.status(401).json({
          error:
            "INVALID_INIT_DATA"
        });
      }


      if (!auth.subscribed) {

        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED"
        });
      }


      /*
        Telegram photo URL shu yerda
        databasega saqlanadi.
      */

      const client =
        await pool.connect();


      try {

        await client.query(
          `
          UPDATE users
          SET
            username = $2,
            first_name = $3,
            photo_url = COALESCE($4, photo_url),
            updated_at = CURRENT_TIMESTAMP
          WHERE telegram_id = $1
          `,
          [
            auth.telegramUser.id,
            auth.telegramUser.username ||
              null,
            auth.telegramUser.first_name ||
              "Player",
            auth.telegramUser.photo_url ||
              null
          ]
        );


        let userResult =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            `,
            [auth.telegramUser.id]
          );


        let user =
          userResult.rows[0];


        const regenerated =
          await regenerateEnergy(
            client,
            user
          );


        userResult =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            `,
            [auth.telegramUser.id]
          );


        user =
          userResult.rows[0];


        /*
          Balance orqali faqat yuqoriga liga.
        */

        await updatePermanentLeague(
          client,
          auth.telegramUser.id,
          user.balance,
          user.league_level
        );


        userResult =
          await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            `,
            [auth.telegramUser.id]
          );


        user =
          userResult.rows[0];


        const rankResult =
          await client.query(
            `
            SELECT COUNT(*) + 1 AS rank
            FROM users
            WHERE balance > $1
            `,
            [user.balance]
          );


        const rank =
          Number(
            rankResult.rows[0].rank
          );


        return res.json(
          formatUser(
            user,
            rank
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
        error:
          "SERVER_ERROR"
      });
    }
  }
);


/* =====================================================
   OLD USER API COMPATIBILITY
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
          WHERE balance > $1
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

      console.error(error);

      return res.status(500).json({
        error:
          "SERVER_ERROR"
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
          error:
            "INVALID_INIT_DATA"
        });
      }


      const subscribed =
        await isSubscribed(
          telegramUser.id
        );


      if (!subscribed) {

        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED"
        });
      }


      let taps =
        Number(
          req.body.taps || 0
        );


      taps =
        Math.floor(taps);


      if (
        taps <= 0
      ) {

        return res.status(400).json({
          error:
            "INVALID_TAPS"
        });
      }


      taps =
        Math.min(
          taps,
          100
        );


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
          [telegramUser.id]
        );


      user =
        result.rows[0];


      const availableEnergy =
        Number(
          user.energy || 0
        );


      const actualTaps =
        Math.min(
          taps,
          availableEnergy
        );


      if (
        actualTaps <= 0
      ) {

        await client.query(
          "COMMIT"
        );

        return res.json({
          user:
            formatUser(
              user
            )
        });
      }


      const power =
        Number(
          user.tap_level || 1
        );


      const earned =
        actualTaps *
        power;


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
        earned,
        taps: actualTaps,
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
        "/api/tap:",
        error
      );

      return res.status(500).json({
        error:
          "SERVER_ERROR"
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
          error:
            "INVALID_INIT_DATA"
        });
      }


      const subscribed =
        await isSubscribed(
          telegramUser.id
        );


      if (!subscribed) {

        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED"
        });
      }


      const type =
        req.body.type;


      if (
        type !== "tap" &&
        type !== "energy"
      ) {

        return res.status(400).json({
          error:
            "INVALID_UPGRADE"
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


      const balance =
        Number(
          user.balance || 0
        );


      if (type === "tap") {

        const level =
          Number(
            user.tap_level || 1
          );


        const cost =
          getTapUpgradeCost(
            level
          );


        if (
          balance < cost
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error:
              "NOT_ENOUGH_BALANCE"
          });
        }


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
          `,
          [
            telegramUser.id,
            cost
          ]
        );

      }


      if (type === "energy") {

        const level =
          Number(
            user.energy_level || 1
          );


        const cost =
          getEnergyUpgradeCost(
            level
          );


        if (
          balance < cost
        ) {

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


      /*
        Liga pasaymaydi.
      */

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
        user:
          formatUser(
            updatedUser
          )
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
        error:
          "SERVER_ERROR"
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
          error:
            "INVALID_INIT_DATA"
        });
      }


      const subscribed =
        await isSubscribed(
          telegramUser.id
        );


      if (!subscribed) {

        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED"
        });
      }


      await client.query(
        "BEGIN"
      );


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


      if (!result.rows.length) {

        await createOrUpdateUser(
          telegramUser,
          client
        );
      }


      const userResult =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );


      const user =
        userResult.rows[0];


      const now =
        new Date();


      const lastClaim =
        user.daily_claimed_at
          ? new Date(
              user.daily_claimed_at
            )
          : null;


      let alreadyClaimed =
        false;


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


      let updated =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );


      let updatedUser =
        updated.rows[0];


      await updatePermanentLeague(
        client,
        telegramUser.id,
        updatedUser.balance,
        updatedUser.league_level
      );


      updated =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );


      updatedUser =
        updated.rows[0];


      await client.query(
        "COMMIT"
      );


      return res.json({
        success: true,
        reward: 100,
        user:
          formatUser(
            updatedUser
          )
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
        error:
          "SERVER_ERROR"
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
          error:
            "INVALID_INIT_DATA"
        });
      }


      const subscribed =
        await isSubscribed(
          telegramUser.id
        );


      if (!subscribed) {

        return res.status(403).json({
          error:
            "NOT_SUBSCRIBED"
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
        error:
          "SERVER_ERROR"
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
          [
            req.params.telegramId
          ]
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
        error:
          "SERVER_ERROR"
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
            league_level

          FROM users

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
        error:
          "SERVER_ERROR"
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
      leagues:
        LEAGUES
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

      return res.status(500).json({
        online: false
      });
    }
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

      return res.sendStatus(
        200
      );

    } catch (error) {

      console.error(
        "Webhook error:",
        error
      );

      return res.sendStatus(
        500
      );
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
