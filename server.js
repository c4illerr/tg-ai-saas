const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN || ''; // Наш новый токен крипты

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const userSettings = {}; 
const LIMIT = 5; 
const PRICE_USD = 3; // Цена Премиума в долларах (CryptoBot работает в USD/EUR/крипте)

const STYLES = {
    expert: "Строгий, экспертный и аналитический стиль. Меньше воды, больше фактов.",
    creative: "Креативный, живой и вовлекающий стиль. Используй сторителлинг.",
    clickbait: "Провокационный, кликбейтный стиль. Яркие метафоры, интригующий заголовок.",
    friendly: "Дружелюбный, простой стиль «как для старого друга». Легкий и непринужденный."
};

function safeMarkdown(text) {
    const stars = (text.match(/\*/g) || []).length;
    if (stars % 2 !== 0) {
        return text.replace(/\*/g, '');
    }
    return text;
}

function getMainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: "🔥 Создать пост" }, { text: "⚙️ Настройки стиля" }],
                [{ text: "💎 Мой профиль / Купить Premium" }]
            ],
            resize_keyboard: true
        }
    };
}

function initUser(chatId) {
    if (!userSettings[chatId]) {
        userSettings[chatId] = { 
            count: 0, 
            isPremium: false, 
            style: 'creative', 
            includeHashtags: true, 
            status: 'idle' 
        };
    }
    return userSettings[chatId];
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    bot.sendMessage(chatId, `Привет, ${msg.from.first_name}! 👋\n\nЯ твой ИИ-копирайтер. Настрой стиль кнопками ниже и присылай текст!`, getMainKeyboard());
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    const user = initUser(chatId);

    if (text === "🔥 Создать пост") {
        user.status = 'waiting_text';
        return bot.sendMessage(chatId, "📝 Отправь мне сырой текст или тезисы, я сделаю из этого конфету!");
    }

    if (text === "⚙️ Настройки стиля") {
        const hashtagsStatus = user.includeHashtags ? '✅ Включены' : '❌ Выключены';
        return bot.sendMessage(chatId, `Управление стилем ИИ:\n\nХэштеги в конце: *${hashtagsStatus}*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💼 Экспертный стиль", callback_data: "style_expert" }, { text: "🎨 Креативный", callback_data: "style_creative" }],
                    [{ text: "⚡ Кликбейт", callback_data: "style_clickbait" }, { text: "🤝 Дружелюбный", callback_data: "style_friendly" }],
                    [{ text: `#️⃣ Хэштеги: ${user.includeHashtags ? 'Вкл' : 'Выкл'}`, callback_data: "toggle_hashtags" }]
                ]
            }
        });
    }

    if (text === "💎 Мой профиль / Купить Premium") {
        const status = user.isPremium ? "💎 Безлимитный Premium" : `🆓 Бесплатный (${user.count}/${LIMIT} генераций)`;
        let message = `👤 *Твой профиль:*\n\n• Твой ID: \`${chatId}\`\n• Статус подписки: *${status}*\n\n`;
        
        if (user.isPremium) {
            message += "✨ Вам доступны безлимитные генерации!";
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            message += `🚀 Закончились лимиты? Активируй Premium-доступ всего за *$${PRICE_USD} / месяц* через CryptoBot.`;
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🪙 Оплатить через CryptoBot", callback_data: "buy_crypto" }]
                    ]
                }
            });
        }
    }

    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥'))) {
        if (user.count >= LIMIT && !user.isPremium) {
            return bot.sendMessage(chatId, `❌ Бесплатные попытки исчерпаны (${LIMIT}/${LIMIT}).`, getMainKeyboard());
        }

        bot.sendChatAction(chatId, 'typing');
        const chosenStyleInstructions = STYLES[user.style];
        const hashtagInstruction = user.includeHashtags ? "В самом конце поста добавь 3-5 хэштегов." : "Не добавляй хэштеги.";

        try {
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "model": "google/gemini-2.5-flash", 
                    "max_tokens": 1200, 
                    "messages": [
                        { role: "system", content: `Ты — Telegram-копирайтер. Стиль: ${chosenStyleInstructions}. ${hashtagInstruction}` },
                        { role: "user", content: text }
                    ]
                },
                { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" } }
            );

            let aiReply = response.data.choices[0].message.content;
            aiReply = safeMarkdown(aiReply);

            if (!user.isPremium) user.count++;
            user.status = 'idle';

            try {
                await bot.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.sendMessage(chatId, aiReply);
            }
            bot.sendMessage(chatId, `💡 Использовано генераций: ${user.count}/${LIMIT}`, getMainKeyboard());
        } catch (error) {
            bot.sendMessage(chatId, "⚠️ Ошибка связи с ИИ.", getMainKeyboard());
        }
    }
});

// Обработка инлайн кнопок и генерации РЕАЛЬНОГО счета
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    if (data.startsWith('style_')) {
        user.style = data.replace('style_', '');
        bot.answerCallbackQuery(query.id, { text: "Стиль изменен!" });
        return bot.sendMessage(chatId, `Стиль успешно обновлен.`, getMainKeyboard());
    }

    if (data === 'toggle_hashtags') {
        user.includeHashtags = !user.includeHashtags;
        bot.answerCallbackQuery(query.id, { text: "Хэштеги изменены!" });
        return bot.sendMessage(chatId, `Генерация хэштегов: ${user.includeHashtags ? 'ВКЛ' : 'ВЫКЛ'}`, getMainKeyboard());
    }

    // === СОЗДАНИЕ РЕАЛЬНОГО ИНВОЙСА В CRYPTOBOT ===
    if (data === 'buy_crypto') {
        bot.answerCallbackQuery(query.id);

        if (!CRYPTO_BOT_TOKEN) {
            return bot.sendMessage(chatId, "❌ Ошибка: На сервере не настроен токен платежной системы.");
        }

        try {
            // Делаем запрос к CryptoBot для создания счета
            const cryptoResponse = await axios.post(
                'https://pay.crypton.sh/api/createInvoice',
                {
                    asset: 'USDT', // Основная валюта (можно выбрать TON, BTC, или оставить пустой для выбора юзером)
                    amount: PRICE_USD.toString(),
                    description: 'Premium подписка на TG AI Копирайтер',
                    payload: chatId.toString(), // Передаем chatId, чтобы потом узнать, кто оплатил
                    create_invoice_link: true
                },
                { headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN } }
            );

            if (cryptoResponse.data && cryptoResponse.data.result) {
                const invoice = cryptoResponse.data.result;
                const payUrl = invoice.pay_url; // Реальная ссылка на оплату

                // Отправляем пользователю кнопку с реальной ссылкой
                bot.sendMessage(chatId, `💸 *Счет на оплату сгенерирован!*\n\nСтоимость: *${PRICE_USD} USDT*\n\nНажмите кнопку ниже, чтобы перейти к оплате. После оплаты Premium активируется автоматически в течение минуты.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔗 Оплатить счет в CryptoBot", url: payUrl }],
                            [{ text: "🔄 Проверить оплату", callback_data: `check_pay_${invoice.invoice_id}` }]
                        ]
                    }
                });
            }
        } catch (error) {
            console.error('Ошибка создания счета:', error.message);
            bot.sendMessage(chatId, '⚠️ Не удалось создать счет. Попробуйте позже.');
        }
    }

    // Ручная кнопка проверки оплаты
    if (data.startsWith('check_pay_')) {
        const invoiceId = data.replace('check_pay_', '');
        bot.answerCallbackQuery(query.id);

        try {
            const checkResponse = await axios.post(
                'https://pay.crypton.sh/api/getInvoices',
                { invoice_ids: invoiceId },
                { headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN } }
            );

            if (checkResponse.data && checkResponse.data.result) {
                const invoice = checkResponse.data.result.items[0];
                
                if (invoice.status === 'paid') {
                    user.isPremium = true;
                    return bot.sendMessage(chatId, "🎉 Ура! Оплата успешно подтверждена. Вам выдан безлимитный Premium!", getMainKeyboard());
                } else {
                    return bot.sendMessage(chatId, "❌ Оплата еще не поступила. Пожалуйста, оплатите счет в CryptoBot и попробуйте снова.");
                }
            }
        } catch (err) {
            bot.sendMessage(chatId, "⚠️ Ошибка при проверке статуса платежа.");
        }
    }
});

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('SaaS AI Копирайтер запущен!'));
app.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
