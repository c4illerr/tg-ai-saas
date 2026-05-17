const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { CryptoPay } = require('@foile/crypto-pay-api'); // Официальный защищенный SDK

// Валидация ключей (Защита от запуска вслепую)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN; 

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !CRYPTO_BOT_TOKEN) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Проверьте Environment! Не хватает TELEGRAM_TOKEN, OPENROUTER_API_KEY или CRYPTO_BOT_TOKEN!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
// Инициализируем защищенный шлюз CryptoBot Mainnet
const cryptoPay = new CryptoPay(CRYPTO_BOT_TOKEN);

// Локальная база данных
const DB_PATH = path.join(__dirname, 'users.json');
let userSettings = {};

function loadDatabase() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const fileData = fs.readFileSync(DB_PATH, 'utf8');
            if (fileData.trim()) {
                userSettings = JSON.parse(fileData);
                console.log("✅ База данных пользователей успешно загружена.");
            }
        }
    } catch (err) {
        console.error("⚠️ Создаем чистую БД:", err.message);
        userSettings = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(userSettings, null, 2), 'utf8');
    } catch (err) {
        console.error("⚠️ Ошибка записи БД:", err.message);
    }
}

loadDatabase();

const LIMIT = 5; 
const PRICE_USD = 3; 

const STYLES = {
    expert: "Строгий, экспертный и аналитический стиль. Меньше воды, максимум фактов, цифр и пользы.",
    creative: "Креативный, живой стиль с элементами сторителлинга. Держи интригу и вовлекай читателя.",
    clickbait: "Провокационный, взрывной стиль. Яркие метафоры, кричащий заголовок, сильный призыв к действию (CTA).",
    friendly: "Дружелюбный, простой стиль «как для старого друга». Легкий, ламповый и непринужденный.",
    marketing: "Продающий SMM-стиль. Четкое выделение болей целевой аудитории, презентация решения и сочный оффер.",
    short: "Ультра-короткий формат. Только тезисы, списки и самая суть. Идеально для инфографики и карточек."
};

// Исправление битых тегов Markdown (Уязвимость падения отправки)
function safeMarkdown(text) {
    if (!text) return '';
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
            useEmojis: true, 
            status: 'idle' 
        };
        saveDatabase();
    }
    return userSettings[chatId];
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    const welcomeText = `Привет, ${msg.from.first_name}! 👋\n\nЯ твой персональный ИИ-копирайтер для Telegram-каналов. Я превращаю поток мыслей в готовые структурированные посты.\n\nНастрой параметры текста под себя в меню «⚙️ Настройки стиля» и присылай задачу!`;
    bot.sendMessage(chatId, welcomeText, getMainKeyboard());
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    const user = initUser(chatId);

    if (text === "🔥 Создать пост") {
        user.status = 'waiting_text';
        saveDatabase();
        return bot.sendMessage(chatId, "📝 Отправь мне сырой текст, тему или тезисы. Я оформлю их по всем канонам коммерческого копирайтинга!");
    }

    if (text === "⚙️ Настройки стиля") {
        const currentStyleName = 
            user.style === 'expert' ? '💼 Экспертный' : 
            user.style === 'creative' ? '🎨 Креативный' : 
            user.style === 'clickbait' ? '⚡ Кликбейт' : 
            user.style === 'marketing' ? '📈 Продающий' :
            user.style === 'short' ? '📝 Краткий' : '🤝 Дружелюбный';

        return bot.sendMessage(chatId, `🎨 *Персонализация твоего ИИ-копирайтера:*\n\nТекущий стиль: *${currentStyleName}*\nСмайлики (эмодзи): *${user.useEmojis ? '✅ Включены' : '❌ Выключены'}*\nХэштеги в конце: *${user.includeHashtags ? '✅ Включены' : '❌ Выключены'}*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💼 Экспертный", callback_data: "style_expert" }, { text: "🎨 Креативный", callback_data: "style_creative" }],
                    [{ text: "⚡ Кликбейт", callback_data: "style_clickbait" }, { text: "🤝 Дружелюбный", callback_data: "style_friendly" }],
                    [{ text: "📈 Продающий SMM", callback_data: "style_marketing" }, { text: "📝 Краткий тезисный", callback_data: "style_short" }],
                    [{ text: `💥 Смайлики: ${user.useEmojis ? 'ВКЛ' : 'ВЫКЛ'}`, callback_data: "toggle_emojis" }],
                    [{ text: `#️⃣ Хэштеги: ${user.includeHashtags ? 'ВКЛ' : 'ВЫКЛ'}`, callback_data: "toggle_hashtags" }]
                ]
            }
        });
    }

    if (text === "💎 Мой профиль / Купить Premium") {
        const status = user.isPremium ? "💎 Безлимитный Premium" : `🆓 Бесплатный план (${user.count}/${LIMIT} генераций)`;
        let message = `👤 *Твой профиль:*\n\n• Твой ID: \`${chatId}\`\n• Статус подписки: *${status}*\n\n`;
        
        if (user.isPremium) {
            message += "✨ Вам доступны безлимитные генерации и все расширенные стили!";
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            message += `🚀 Избавься от лимитов! Активируй Premium всего за *${PRICE_USD} USDT / месяц*.`;
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "🪙 Оплатить через CryptoBot (USDT)", callback_data: "buy_crypto" }]] }
            });
        }
    }

    // Запрос к ИИ
    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥'))) {
        if (user.count >= LIMIT && !user.isPremium) {
            return bot.sendMessage(chatId, `❌ Бесплатные генерации исчерпаны (${LIMIT}/${LIMIT}).\n\nАктивируйте Premium в профиле, чтобы продолжить.`, getMainKeyboard());
        }

        bot.sendChatAction(chatId, 'typing');
        
        const chosenStyleInstructions = STYLES[user.style];
        const hashtagInstruction = user.includeHashtags ? "В самом конце поста добавь 3-5 хэштегов." : "Не добавляй хэштеги.";
        const emojiInstruction = user.useEmojis ? "Используй подходящие эмодзи для структуры." : "Категорически запрещено использовать эмодзи.";

        try {
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "model": "google/gemini-2.5-flash", 
                    "max_tokens": 1500, 
                    "messages": [
                        { 
                            role: "system", 
                            content: `Ты — профессиональный копирайтер для Telegram. Стиль: ${chosenStyleInstructions}. Эмодзи: ${emojiInstruction}. Хэштеги: ${hashtagInstruction}. Выдавай только готовый текст.` 
                        },
                        { role: "user", content: text }
                    ]
                },
                { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` }, timeout: 25000 }
            );

            let aiReply = response.data.choices[0].message.content;
            aiReply = safeMarkdown(aiReply);

            if (!user.isPremium) user.count++;
            user.status = 'idle';
            saveDatabase();

            try {
                await bot.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.sendMessage(chatId, aiReply);
            }
            
            bot.sendMessage(chatId, `💡 Использовано генераций: ${user.count}/${LIMIT}`, getMainKeyboard());

        } catch (error) {
            bot.sendMessage(chatId, "⚠️ Ошибка связи с нейросетью. Попробуйте еще раз.", getMainKeyboard());
        }
    }
});

// Кнопки настроек и защищенная оплата
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    const answerCallback = () => {
        try { bot.answerCallbackQuery(query.id); } catch (e) {}
    };

    if (data.startsWith('style_')) {
        answerCallback();
        user.style = data.replace('style_', '');
        saveDatabase();
        return bot.sendMessage(chatId, `Стиль успешно обновлен!`, getMainKeyboard());
    }

    if (data === 'toggle_hashtags') {
        answerCallback();
        user.includeHashtags = !user.includeHashtags;
        saveDatabase();
        return bot.sendMessage(chatId, `Хэштеги теперь: ${user.includeHashtags ? 'ВКЛ ✅' : 'ВЫКЛ ❌'}`, getMainKeyboard());
    }

    if (data === 'toggle_emojis') {
        answerCallback();
        user.useEmojis = !user.useEmojis;
        saveDatabase();
        return bot.sendMessage(chatId, `Смайлики теперь: ${user.useEmojis ? 'ВКЛ ✅' : 'ВЫКЛ ❌'}`, getMainKeyboard());
    }

    // ЗАЩИЩЕННОЕ СОЗДАНИЕ СЧЕТА ЧЕРЕЗ ОФИЦИАЛЬНЫЙ SDK CRYPTOBOT
    if (data === 'buy_crypto') {
        answerCallback();
        try {
            // SDK сам генерирует защищенные заголовки для Cloudflare
            const invoice = await cryptoPay.createInvoice('USDT', PRICE_USD, {
                description: 'Premium ИИ-Копирайтер',
                payload: chatId.toString()
            });

            if (invoice && invoice.payUrl) {
                bot.sendMessage(chatId, `💸 *Счет успешно создан!*\n\nСтоимость: *${PRICE_USD} USDT*\n\nОплатите счет в кошельке и нажмите кнопку проверки ниже.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔗 Оплатить счет", url: invoice.payUrl }],
                            [{ text: "🔄 Проверить оплату", callback_data: `check_pay_${invoice.invoiceId}` }]
                        ]
                    }
                });
            }
        } catch (error) {
            console.error('Ошибка SDK CryptoBot:', error.message);
            bot.sendMessage(chatId, '⚠️ Не удалось связаться с платежным шлюзом. Шлюз перегружен, попробуйте через пару минут.');
        }
    }

    // ЗАЩИЩЕННАЯ ПРОВЕРКА СЧЕТА
    if (data.startsWith('check_pay_')) {
        answerCallback();
        const invoiceId = parseInt(data.replace('check_pay_', ''), 10);

        try {
            const invoices = await cryptoPay.getInvoices({ invoice_ids: invoiceId });
            
            if (invoices && invoices.items && invoices.items.length > 0) {
                const inv = invoices.items[0];
                
                if (inv.status === 'paid') {
                    user.isPremium = true; 
                    saveDatabase(); 
                    return bot.sendMessage(chatId, "🎉 *Premium успешно активирован!*\n\nВсе лимиты сняты.", { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
                } else {
                    return bot.sendMessage(chatId, "❌ Оплата еще не поступила. Завершите платеж в кошельке.");
                }
            }
        } catch (err) {
            bot.sendMessage(chatId, "⚠️ Ошибка верификации платежа шлюзом.");
        }
    }
});

const app = document = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Protected AI SaaS is Live!'));
app.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
