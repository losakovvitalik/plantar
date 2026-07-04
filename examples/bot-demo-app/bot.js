// Демо-бот на long polling: отвечает на /start и повторяет текстовые сообщения.
// Токен берётся из .env (BOT_TOKEN) — файл создаётся на вкладке «Переменные».
require("dotenv/config");
const { Bot } = require("grammy");

if (!process.env.BOT_TOKEN) {
  console.error("Не задан BOT_TOKEN. Добавьте его в .env рядом с bot.js.");
  process.exit(1);
}

const bot = new Bot(process.env.BOT_TOKEN);

bot.command("start", (ctx) =>
  ctx.reply("Бот работает. Отправьте любое сообщение — он повторит его."),
);
bot.on("message:text", (ctx) => ctx.reply(ctx.msg.text));

bot.start();
