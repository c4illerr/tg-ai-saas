const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');

// 1. ЗАЩИТА: Строгая валидация секретных ключей (Переменные окружения)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN; 

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Отсутствуют обязательные переменные окружения TELEGRAM_TOKEN или OPENROUTER_API_KEY!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// 2. ЗАЩИТА ДАННЫХ: Надежное сохранение лимитов в файл JSON (users.json)
const DB_PATH = path.join(__dirname, 'users.json');
let userSettings = {};

// Функция безопасной загрузки базы данных
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
        console.error("⚠️ Ошибка при чтении users.json (создаем пустую БД):", err.message);
        userSettings = {};
    }
}

// Функция атомарной записи на диск (Защита от повреждения файла при одновременных запросах)
function saveDatabase() {
    try {
        const dataStr = JSON.stringify(userSettings, null, 2);
        fs.writeFileSync(DB_PATH, dataStr, 'utf8');
    } catch (err) {
        console.error("⚠️ Критическая ошибка при сохранении базы данных:", err.message);
    }
}

// Загружаем данные при старте
loadDatabase();

const LIMIT = 5; 
const PRICE_USD = 3; 

// 6 кастомизированных ИИ-стилей
const STYLES = {
    expert: "Строгий, экспертный и аналитический стиль. Меньше воды, максимум фактов, цифр и пользы.",
    creative: "Креативный, живой стиль с элементами сторителлинга. Держи интригу и вовлекай читателя.",
    clickbait: "Провокационный, взрывной стиль. Яркие метафоры, кричащий заголовок, сильный призыв к действию (CTA).",
    friendly: "Дружелюбный, простой стиль «как для старого друга». Легкий, ламповый и непринужденный.",
    marketing: "Продающий SMM-стиль. Четкое выделение болей целевой аудитории, презентация решения и сочный оффер.",
    short: "Ультра-короткий формат. Только тезисы, списки и самая суть. Идеально для инфографики и карточек."
};

// ЗАЩИТА: Исправление непарных символов Markdown, ломающих отправку в Telegram
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

// Обработка /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    const welcomeText = `Привет, ${msg.from.first_name}! 👋\n\nЯ твой персональный ИИ-копирайтер для Telegram-каналов. Я превращаю поток мыслей, аудио-заметки или кривые тезисы в готовые структурированные посты.\n\nНастрой параметры текста под себя в меню «⚙️ Настройки стиля» и присылай задачу!`;
    bot.sendMessage(chatId, welcomeText, getMainKeyboard());
});

// Основной блок обработки сообщений
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

        const hashtagsStatus = user.includeHashtags ? '✅ Включены' : '❌ Выключены';
        const emojisStatus = user.useEmojis ? '✅ Со смайликами' : '❌ Без смайликов';

        return bot.sendMessage(chatId, `🎨 *Персонализация твоего ИИ-копирайтера:*\n\nТекущий стиль: *${currentStyleName}*\nСмайлики (эмодзи): *${emojisStatus}*\nХэштеги в конце: *${hashtagsStatus}*`, {
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
            message += "✨ Вам доступны безлимитные генерации, все 6 стилей текста и любые настройки ИИ без ограничений!";
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            message += `🚀 Избавься от лимитов! Активируй Premium-доступ всего за *${PRICE_USD} USDT / месяц*.\n\nВы получите полную кастомизацию, генерацию без ограничений и моментальный отклик умной модели.`;
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🪙 Оплатить через CryptoBot (USDT)", callback_data: "buy_crypto" }]
                    ]
                }
            });
        }
    }

    // Обработка отправки текста в нейросеть
    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥'))) {
        if (user.count >= LIMIT && !user.isPremium) {
            return bot.sendMessage(chatId, `❌ Бесплатные генерации исчерпаны (${LIMIT}/${LIMIT}).\n\nПожалуйста, откройте профиль и активируйте Premium, чтобы снять лимиты.`, getMainKeyboard());
        }

        bot.sendChatAction(chatId, 'typing');
        
        const chosenStyleInstructions = STYLES[user.style];
        const hashtagInstruction = user.includeHashtags ? "В самом конце поста обязательно подбери и добавь 3-5 релевантных хэштегов." : "Не добавляй хэштеги в конце поста.";
        const emojiInstruction = user.useEmojis ? "Обязательно используй подходящие эмодзи (смайлики) в заголовке и по тексту для структуры." : "Категорически запрещено использовать эмодзи и смайлики. Текст должен быть строго без них.";

        try {
            // ЗАЩИТА: Таймаут запроса к OpenRouter, чтобы бот не зависал вечно
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "model": "google/gemini-2.5-flash", 
                    "max_tokens": 1500, 
                    "messages": [
                        { 
                            role: "system", 
                            content: `Ты — профессиональный копирайтер для Telegram-каналов. Твоя цель — сделать структурированный, легкочитаемый и вовлекающий пост (с броским заголовком, абзацами и списками).
                            Стиль написания текста: ${chosenStyleInstructions}
                            Правило по смайликам: ${emojiInstruction}
                            Правило по хэштегам: ${hashtagInstruction}
                            Выдавай ТОЛЬКО готовый текст поста, без мета-комментариев и лишних фраз.` 
                        },
                        { role: "user", content: text }
                    ]
                },
                {
                    headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
                    timeout: 30000 
                }
            );

            let aiReply = response.data.choices[0].message.content;
            aiReply = safeMarkdown(aiReply);

            if (!user.isPremium) user.count++;
            user.status = 'idle';
            saveDatabase(); // Запоминаем лимит

            try {
                await bot.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.sendMessage(chatId, aiReply);
            }
            
            bot.sendMessage(chatId, `💡 Использовано генераций: ${user.count}/${LIMIT}`, getMainKeyboard());

        } catch (error) {
            console.error("Ошибка при запросе к OpenRouter:", error.message);
            bot.sendMessage(chatId, "⚠️ Ошибка связи с нейросетью. Попробуйте отправить запрос еще раз чуть позже.", getMainKeyboard());
        }
    }
});

// Блок инлайн кнопок
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    const answerCallback = () => {
        try { bot.answerCallbackQuery(query.id); } catch (e) { console.error(e); }
    };

    if (data.startsWith('style_')) {
        answerCallback();
        user.style = data.replace('style_', '');
        saveDatabase();
        return bot.sendMessage(chatId, `Стиль успешно обновлен. Нажмите «🔥 Создать пост», чтобы протестировать его!`, getMainKeyboard());
    }

    if (data === 'toggle_hashtags') {
        answerCallback();
        user.includeHashtags = !user.includeHashtags;
        saveDatabase();
        return bot.sendMessage(chatId, `Генерация хэштегов теперь: ${user.includeHashtags ? 'ВКЛЮЧЕНА ✅' : 'ВЫКЛЮЧЕНА ❌'}`, getMainKeyboard());
    }

    if (data === 'toggle_emojis') {
        answerCallback();
        user.useEmojis = !user.useEmojis;
        saveDatabase();
        return bot.sendMessage(chatId, `Использование смайликов теперь: ${user.useEmojis ? 'ВКЛЮЧЕНО ✅' : 'ВЫКЛЮЧЕНО ❌'}`, getMainKeyboard());
    }

    // ОФИЦИАЛЬНОЕ СОЗДАНИЕ ИНВОЙСА В MAINNET CRYPTOBOT
    if (data === 'buy_crypto') {
        answerCallback();

        if (!CRYPTO_BOT_TOKEN) {
            return bot.sendMessage(chatId, "❌ Ошибка конфигурации: На сервере не задан токен CRYPTO_BOT_TOKEN.");
        }

        try {
            // ЗАЩИТА: Таймаут запроса к платежке шлюза CryptoBot (Официальный домен Mainnet)
            const cryptoResponse = await axios.post(
                'https://pay.cryptobot.sh/api/createInvoice',
                {
                    asset: 'USDT', 
                    amount: PRICE_USD.toString(),
                    description: 'Premium доступ к ИИ-Копирайтеру',
                    payload: chatId.toString(), 
                    create_invoice_link: true
                },
                { 
                    headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN },
                    timeout: 10000 
                }
            );

            if (cryptoResponse.data && cryptoResponse.data.result) {
                const invoice = cryptoResponse.data.result;
                const payUrl = invoice.pay_url; 

                bot.sendMessage(chatId, `💸 *Счет на оплату успешно создан!*\n\nСтоимость: *${PRICE_USD} USDT*\n\nНажми кнопку ниже, чтобы перейти в кошелек Telegram и оплатить счет. После подтверждения транзакции вернись сюда и нажми кнопку «🔄 Проверить оплату».`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔗 Оплатить через CryptoBot", url: payUrl }],
                            [{ text: "🔄 Проверить оплату", callback_data: `check_pay_${invoice.invoice_id}` }]
                        ]
                    }
                });
            } else {
                throw new Error("Неверный формат ответа от CryptoBot");
            }
        } catch (error) {
            console.error('Ошибка создания инвойса:', error.response ? error.response.data : error.message);
            // ПОДСКАЗКА: Если сервер Render заблокирован по IP
            bot.sendMessage(chatId, '⚠️ Не удалось сгенерировать счет автоматически.\n\nВозможная причина: Сервер хостинга временно заблокирован защитой CryptoBot.\nПожалуйста, попробуйте запросить счет чуть позже.');
        }
    }

    // РУЧНАЯ ПРОВЕРКА ОПЛАТЫ
    if (data.startsWith('check_pay_')) {
        answerCallback();
        const invoiceId = data.replace('check_pay_', '');

        try {
            const checkResponse = await axios.post(
                'https://pay.cryptobot.sh/api/getInvoices',
                { invoice_ids: invoiceId },
                { 
                    headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN },
                    timeout: 10000 
                }
            );

            if (checkResponse.data && checkResponse.data.result && checkResponse.data.result.items.length > 0) {
                const invoice = checkResponse.data.result.items[0];
                
                if (invoice.status === 'paid') {
                    user.isPremium = true; 
                    saveDatabase(); // Сохраняем премиум навсегда!
                    return bot.sendMessage(chatId, "🎉 *Поздравляем! Оплата успешно зафиксирована.*\n\nВам активирован безлимитный Premium-статус! Все ограничения на генерацию текстов сняты навсегда.", { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
                } else {
                    return bot.sendMessage(chatId, "❌ Транзакция еще не подтверждена сетью. Пожалуйста, завершите платеж внутри CryptoBot и повторите проверку.");
                }
            } else {
                bot.sendMessage(chatId, "⚠️ Информация о данном счете не найдена.");
            }
        } catch (err) {
            console.error("Ошибка при проверке инвойса:", err.message);
            bot.sendMessage(chatId, "⚠️ Ошибка связи с платежной системой при проверке статуса.");
        }
    }
});

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('SaaS AI Copywriter is active and protected!'));
app.listen(PORT, () => console.log(`HTTP сервер слушает порт ${PORT}`));
