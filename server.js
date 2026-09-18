const express = require("express");
const path = require("path");
const { Telegraf } = require("telegraf");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN topilmadi!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply("Salom! 👋 UZCOIN botiga xush kelibsiz!");
});

bot.command("help", (ctx) => {
  ctx.reply("UZCOIN bot ishlayapti ✅");
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "UZCOIN server ishlayapti!"
  });
});

app.listen(PORT, () => {
  console.log(`UZCOIN server ${PORT}-portda ishlayapti`);
  console.log("Telegram botni ishga tushiryapman...");

  bot.launch()
    .then(() => {
      console.log("UZCOIN Telegram bot ishga tushdi!");
    })
    .catch((err) => {
      console.error("TELEGRAM BOT ERROR:", err);
    });
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
