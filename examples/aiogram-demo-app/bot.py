# Демо-бот на long polling: отвечает на /start и повторяет текстовые сообщения.
# Токен берётся из .env (BOT_TOKEN) — файл создаётся на вкладке «Переменные».
import asyncio
import os
import sys

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import Message
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("BOT_TOKEN")
if not token:
    print("Не задан BOT_TOKEN. Добавьте его в .env рядом с bot.py.", file=sys.stderr)
    sys.exit(1)

dp = Dispatcher()


@dp.message(CommandStart())
async def start(message: Message) -> None:
    await message.answer("Бот работает. Отправьте любое сообщение — он повторит его.")


@dp.message()
async def echo(message: Message) -> None:
    await message.answer(message.text or "Это не текстовое сообщение.")


async def main() -> None:
    await dp.start_polling(Bot(token))


if __name__ == "__main__":
    asyncio.run(main())
