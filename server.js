const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ========================================================
// ДЛЯ ЛОКАЛЬНОГО ТЕСТА (можно вписать сюда ключи на компе)
// ДЛЯ RENDER (код автоматически заберет ключи из панели управления):
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
// ========================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const userUsage = {}; 
const LIMIT = 5; 

function safeMarkdown(text) {
    const stars = (text.match(/\*/g) || []).length;
    if (stars % 2 !== 0) {
        return text.replace(/\*/g, '');
    }
    return text;
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Привет! Я твой ИИ-редактор постов. 🔥\n\nОтправь мне любой сырой текст или мысли, и я превращу это в идеальный, вовлекающий пост для твоего канала.\n\nУ тебя есть ${LIMIT} бесплатных генераций.`);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    if (!userUsage[chatId]) {
        userUsage[chatId] = { count: 0, isPremium: false };
    }

    const user = userUsage[chatId];

    if (user.count >= LIMIT && !user.isPremium) {
        return bot.sendMessage(chatId, `❌ У вас закончились бесплатные генерации (${LIMIT}/${LIMIT}).\n\nЧтобы продолжить пользоваться сервисом без ограничений, активируйте Premium.`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "💎 Включить Premium (Тест)", callback_data: "buy_premium" }
                ]]
            }
        });
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                "model": "google/gemini-2.5-flash", 
                "max_tokens": 1000, 
                "messages": [
                    { 
                        role: "system", 
                        content: "Ты — профессиональный копирайтер Telegram-каналов. Твоя задача — взять сырой текст пользователя и превратить его в структурированный, интересный пост. Добавь цепляющий заголовок, разбей на абзацы, используй списки и уместно расставь эмодзи. Стиль: вовлекающий и современный. Выдавай сразу готовый пост. ВАЖНО: не используй нижние подчеркивания (_) для форматирования, используй только двойные звездочки (**) для жирного текста и следи, чтобы у каждой открывающей звездочки была закрывающая." 
                    },
                    { role: "user", content: text }
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "TG AI SaaS"
                }
            }
        );

        let aiReply = response.data.choices[0].message.content;
        aiReply = safeMarkdown(aiReply);

        if (!user.isPremium) user.count++;

        try {
            await bot.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
        } catch (markdownError) {
            await bot.sendMessage(chatId, aiReply);
        }

        bot.sendMessage(chatId, `💡 Использовано генераций: ${user.count}/${LIMIT}`);

    } catch (error) {
        console.error("Ошибка от OpenRouter:", error.response ? error.response.data : error.message);
        bot.sendMessage(chatId, "⚠️ Произошла ошибка при обращении к ИИ. Попробуйте еще раз позже.");
    }
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'buy_premium') {
        userUsage[chatId].isPremium = true;
        bot.sendMessage(chatId, "🎉 Тестовая оплата прошла! Вам выдан безлимитный Premium-доступ.");
    }
});

// Нам нужен простой HTTP-сервер, чтобы Render не закрывал деплой по таймауту
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Бот работает 24/7!'));
app.listen(PORT, () => console.log(`Бот запущен на порту ${PORT}`));
