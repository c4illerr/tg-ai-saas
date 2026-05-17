const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { CryptoPay } = require('@foile/crypto-pay-api');

// ==========================================
// НАСТРОЙКИ АДМИНИСТРАТОРА (ТВОЙ ID ВШИТ)
// ==========================================
const ADMIN_ID = 6583231440; 

// Валидация ключей из окружения Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN; 
const YOOKASSA_TOKEN = process.env.YOOKASSA_TOKEN; 

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !CRYPTO_BOT_TOKEN || !YOOKASSA_TOKEN) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Проверьте Environment на Render! Не хватает ключей!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const cryptoPay = new CryptoPay(CRYPTO_BOT_TOKEN);

// Файловая база данных пользователей и промокодов
const DB_PATH = path.join(__dirname, 'users.json');
let dbData = { users: {}, promocodes: {} };

function loadDatabase() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const fileData = fs.readFileSync(DB_PATH, 'utf8');
            if (fileData.trim()) {
                const parsed = JSON.parse(fileData);
                if (parsed.users && parsed.promocodes) {
                    dbData = parsed;
                } else {
                    dbData = { users: parsed, promocodes: {} };
                }
                console.log("✅ База данных успешно загружена.");
            }
        }
    } catch (err) {
        console.error("⚠️ Создаем чистую БД:", err.message);
        dbData = { users: {}, promocodes: {} };
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (err) {
        console.error("⚠️ Ошибка записи БД:", err.message);
    }
}

loadDatabase();

const LIMIT = 5; 
const PRICE_USD = 3; 
const PRICE_RUB = 290; 

const STYLES = {
    expert: "Строгий, экспертный и аналитический стиль. Меньше воды, максимум фактов, цифр и пользы.",
    creative: "Креативный, живой стиль с элементами сторителлинга. Держи интригу и вовлекай читателя.",
    clickbait: "Провокационный, взрывной стиль. Яркие метафоры, кричащий заголовок, сильный призыв к действию (CTA).",
    friendly: "Дружелюбный, простой стиль «как для старого друга». Легкий, ламповый и непринужденный.",
    marketing: "Продающий SMM-стиль. Четкое выделение болей целевой аудитории, презентация решения и сочный оффер.",
    short: "Ультра-короткий формат. Только тезисы, списки и самая суть. Идеально для инфографики и карточек."
};

function safeMarkdown(text) {
    if (!text) return '';
    const stars = (text.match(/\*/g) || []).length;
    if (stars % 2 !== 0) return text.replace(/\*/g, '');
    return text;
}

function getMainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: "🔥 Создать пост" }, { text: "⚙️ Настройки стиля" }],
                [{ text: "💎 Мой профиль / Купить Premium" }, { text: "🎯 Мой проект (Персонализация)" }]
            ],
            resize_keyboard: true
        }
    };
}

function initUser(chatId) {
    const idStr = chatId.toString();
    if (!dbData.users[idStr]) {
        dbData.users[idStr] = { 
            count: 0, 
            isPremium: false, 
            style: 'creative', 
            includeHashtags: true, 
            useEmojis: true, 
            status: 'idle',
            projectName: 'Не указано', 
            projectTarget: 'Общая аудитория' 
        };
        saveDatabase();
    }
    return dbData.users[idStr];
}

function getSettingsMenuData(user) {
    const currentStyleName = 
        user.style === 'expert' ? '💼 Экспертный' : 
        user.style === 'creative' ? '🎨 Креативный' : 
        user.style === 'clickbait' ? '⚡ Кликбейт' : 
        user.style === 'marketing' ? '📈 Продающий' :
        user.style === 'short' ? '📝 Краткий' : '🤝 Дружелюбный';

    const text = `⚙️ *Управление комбинацией параметров ИИ:*\n\n` +
                 `• Выбранный стиль: *${currentStyleName}*\n` +
                 `• Использование эмодзи: *${user.useEmojis ? '✅ Да' : '❌ Нет'}*\n` +
                 `• Генерация хэштегов: *${user.includeHashtags ? '✅ Да' : '❌ Нет'}*\n\n` +
                 `Параметры комбинируются автоматически! Измените их кнопками:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "💼 Экспертный", callback_data: "style_expert" }, { text: "🎨 Креативный", callback_data: "style_creative" }],
            [{ text: "⚡ Кликбейт", callback_data: "style_clickbait" }, { text: "🤝 Дружелюбный", callback_data: "style_friendly" }],
            [{ text: "📈 Продающий SMM", callback_data: "style_marketing" }, { text: "📝 Краткий тезисный", callback_data: "style_short" }],
            [{ text: `${user.useEmojis ? '🟢 Эмодзи: ВКЛ' : '🔴 Эмодзи: ВЫКЛ'}`, callback_data: "toggle_emojis" }],
            [{ text: `${user.includeHashtags ? '🟢 Хэштеги: ВКЛ' : '🔴 Хэштеги: ВЫКЛ'}`, callback_data: "toggle_hashtags" }]
        ]
    };
    return { text, keyboard };
}

// ==========================================
// БЛОК АДМИН-ПАНЕЛИ (ТОЛЬКО ДЛЯ ТЕБЯ)
// ==========================================

// 1. Вызов админки командой /admin
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    bot.sendMessage(chatId, "🛠️ *Добро пожаловать в Админ-панель управления ботом!*", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📊 Статистика бота", callback_data: "admin_stats" }],
                [{ text: "✉️ Запустить общую рассылку", callback_data: "admin_broadcast_start" }]
            ]
        }
    });
});

// 2. Команда генерации промокода: /gencode КОД КОЛИЧЕСТВО
bot.onText(/\/gencode (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    const codeName = match[1].trim().toUpperCase();
    const maxUses = parseInt(match[2], 10);

    if (isNaN(maxUses) || maxUses <= 0) {
        return bot.sendMessage(chatId, "❌ Ошибка. Количество активаций должно быть числом.");
    }

    dbData.promocodes[codeName] = { maxUses: maxUses, usesLeft: maxUses, usersActivated: [] };
    saveDatabase();
    bot.sendMessage(chatId, `✅ *Промокод успешно создан!*\n\n• Код: \`${codeName}\`\n• Активаций: *${maxUses}*`, { parse_mode: 'Markdown' });
});

// 3. Ручное управление Premium по ID: /setpremium ID true/false
bot.onText(/\/setpremium (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    const targetId = match[1].trim();
    const setPremium = match[2].trim() === 'true';

    if (!dbData.users[targetId]) {
        return bot.sendMessage(chatId, `❌ Пользователь с ID \`${targetId}\` не найден в базе данных.`, { parse_mode: 'Markdown' });
    }

    dbData.users[targetId].isPremium = setPremium;
    if (setPremium) dbData.users[targetId].count = 0;
    saveDatabase();

    bot.sendMessage(chatId, `✅ Статус пользователя \`${targetId}\` успешно изменен.\n• Premium: *${setPremium ? 'ВКЛ 💎' : 'ВЫКЛ 🆓'}*`, { parse_mode: 'Markdown' });
    
    // Уведомляем пользователя об изменении статуса
    bot.sendMessage(targetId, setPremium 
        ? "🎉 Администратор вручную активировал вам полный **Premium-доступ**! Все лимиты сняты." 
        : "⚠️ Ваш Premium-статус был изменен администратором на базовый.", { parse_mode: 'Markdown' }).catch(() => {});
});


// ==========================================
// ОСНОВНАЯ ЛОГИКА БОТА
// ==========================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    const welcomeText = `Привет, ${msg.from.first_name}! 👋\n\nЯ твой персональный ИИ-копирайтер для Telegram-каналов.\n\nНастрой параметры текста под себя в меню «⚙️ Настройки стиля» и присылай задачу!`;
    bot.sendMessage(chatId, welcomeText, getMainKeyboard());
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    const user = initUser(chatId);

    // Админская рассылка: ловим сообщение для отправки
    if (chatId === ADMIN_ID && user.status === 'admin_waiting_broadcast') {
        user.status = 'idle';
        saveDatabase();
        
        const allUserIds = Object.keys(dbData.users);
        bot.sendMessage(chatId, `📢 Начинаю рассылку для *${allUserIds.length}* пользователей...`, { parse_mode: 'Markdown' });
        
        let successCount = 0;
        for (const uId of allUserIds) {
            try {
                await bot.sendMessage(uId, text);
                successCount++;
                // Небольшая задержка, чтобы Телеграм не заблокировал за спам
                await new Promise(resolve => setTimeout(resolve, 50)); 
            } catch (err) {
                // Пользователь мог заблокировать бота
            }
        }
        return bot.sendMessage(chatId, `🎉 *Рассылка успешно завершена!*\n\nДоставлено пользователей: *${successCount}/${allUserIds.length}*`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }

    // Проверка промокодов
    const inputCode = text.trim().toUpperCase();
    if (dbData.promocodes[inputCode]) {
        const promo = dbData.promocodes[inputCode];
        if (promo.usersActivated.includes(chatId.toString())) {
            return bot.sendMessage(chatId, "⚠️ Вы уже активировали этот промокод ранее!");
        }
        if (promo.usesLeft <= 0) {
            return bot.sendMessage(chatId, "❌ К сожалению, этот промокод уже закончился.");
        }

        promo.usesLeft--;
        promo.usersActivated.push(chatId.toString());
        user.isPremium = true;
        user.count = 0;
        user.status = 'idle';
        saveDatabase();

        return bot.sendMessage(chatId, `🎉 *Промокод успешно применен!*\n\nЛимиты сброшены!`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }

    // Текстовая персонализация
    if (user.status === 'waiting_project_name') {
        user.projectName = text.trim();
        user.status = 'idle';
        saveDatabase();
        return bot.sendMessage(chatId, `✅ Сохранено: *${user.projectName}*.\n\nТеперь введите описание вашей целевой аудитории:`, { parse_mode: 'Markdown' });
    }

    if (user.status === 'waiting_project_target') {
        user.projectTarget = text.trim();
        user.status = 'idle';
        saveDatabase();
        return bot.sendMessage(chatId, `🎉 *Персонализация настроена!*\n\n• Проект: *${user.projectName}*\n• Аудитория: *${user.projectTarget}*`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }

    if (text === "⚙️ Настройки стиля") {
        const menu = getSettingsMenuData(user);
        return bot.sendMessage(chatId, menu.text, { parse_mode: 'Markdown', reply_markup: menu.keyboard });
    }

    if (text === "🎯 Мой проект (Персонализация)") {
        const message = `🎯 *Персонализация текстов под ваш бизнес:*\n\n` +
                        `• Ваш проект/канал: *${user.projectName}*\n` +
                        `• Целевая аудитория: *${user.projectTarget}*\n\n` +
                        `Нейросеть адаптирует контент под эти данные!`;
        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: "✏️ Изменить данные проекта", callback_data: "edit_project_data" }]] }
        });
    }

    if (text === "💎 Мой профиль / Купить Premium") {
        const status = user.isPremium ? "💎 Безлимитный Premium" : `🆓 Бесплатный план (${user.count}/${LIMIT} генераций)`;
        let message = `👤 *Твой профиль:*\n\n• Твой ID: \`${chatId}\`\n• Статус подписки: *${status}*\n\n`;
        
        if (user.isPremium) {
            message += "✨ Вам доступны безлимитные генерации без ограничений!";
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            message += `🚀 Избавься от лимитов! Выберите удобный способ оплаты подписки на месяц:\n\nЕсли у вас есть промокод — просто отправьте его текстовым сообщением в чат!`;
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "💳 Оплатить Картой РФ / СБП (290 руб)", callback_data: "buy_yookassa" }],
                        [{ text: "🪙 Оплатить Криптовалютой (3 USDT)", callback_data: "buy_crypto" }]
                    ]
                }
            });
        }
    }

    if (user.count >= LIMIT && !user.isPremium) {
        user.status = 'idle';
        saveDatabase();
        return bot.sendMessage(chatId, `❌ *Доступ заблокирован!*\n\nВы исчерпали лимит бесплатных генераций (${LIMIT}/${LIMIT}).`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💳 Картой РФ / СБП (290 руб)", callback_data: "buy_yookassa" }],
                    [{ text: "🪙 Криптой через CryptoBot (3 USDT)", callback_data: "buy_crypto" }]
                ]
            }
        });
    }

    if (text === "🔥 Создать пост") {
        user.status = 'waiting_text';
        saveDatabase();
        return bot.sendMessage(chatId, "📝 Отправь мне сырой текст или тему поста:");
    }

    // Генерация текста ИИ
    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥') && !text.startsWith('🎯'))) {
        bot.sendChatAction(chatId, 'typing');
        
        const chosenStyleInstructions = STYLES[user.style];
        const hashtagInstruction = user.includeHashtags ? "В самом конце поста добавь 3-5 хэштегов." : "Не добавляй хэштеги.";
        const emojiInstruction = user.useEmojis ? "Используй подходящие эмодзи для структуры." : "Категорически запрещено использовать эмодзи.";
        const personalizationInstruction = `Контекст проекта: Название проекта — "${user.projectName}". Целевая аудитория — "${user.projectTarget}". Адаптируй боли текста под эту аудиторию.`;

        try {
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "model": "google/gemini-2.5-flash", 
                    "max_tokens": 1500, 
                    "messages": [
                        { role: "system", content: `Ты — копирайтер для Telegram. Стиль: ${chosenStyleInstructions}. Эмодзи: ${emojiInstruction}. Хэштеги: ${hashtagInstruction}. ${personalizationInstruction} Выдай только готовый текст.` },
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
            console.error('Ошибка OpenRouter:', error.message);
            bot.sendMessage(chatId, "⚠️ Ошибка связи с нейросетью. Попробуйте еще раз.", getMainKeyboard());
        }
    }
});

// Инлайн-кнопки
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    const answerCallback = () => { try { bot.answerCallbackQuery(query.id); } catch (e) {} };

    const refreshMenu = async () => {
        const menu = getSettingsMenuData(user);
        try {
            await bot.editMessageText(menu.text, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: menu.keyboard
            });
        } catch (e) {}
    };

    // Админские инлайн-действия
    if (chatId === ADMIN_ID && data === 'admin_stats') {
        answerCallback();
        const users = Object.values(dbData.users);
        const total = users.length;
        const premium = users.filter(u => u.isPremium).length;
        const free = total - premium;
        
        return bot.sendMessage(chatId, `📊 *Текущая статистика проекта:*\n\n• Всего пользователей в БД: *${total}*\n• С активным Premium: *${premium} 💎*\n• На бесплатном плане: *${free} 🆓*`, { parse_mode: 'Markdown' });
    }

    if (chatId === ADMIN_ID && data === 'admin_broadcast_start') {
        answerCallback();
        user.status = 'admin_waiting_broadcast';
        saveDatabase();
        return bot.sendMessage(chatId, "✉️ *Введите текст для общей рассылки всем пользователям:*\n\n_(Внимание: следующее ваше сообщение уйдет абсолютно всем людям из базы данных!)_", { parse_mode: 'Markdown' });
    }

    if (data.startsWith('style_')) {
        answerCallback(); user.style = data.replace('style_', ''); saveDatabase(); await refreshMenu(); return;
    }
    if (data === 'toggle_hashtags') {
        answerCallback(); user.includeHashtags = !user.includeHashtags; saveDatabase(); await refreshMenu(); return;
    }
    if (data === 'toggle_emojis') {
        answerCallback(); user.useEmojis = !user.useEmojis; saveDatabase(); await refreshMenu(); return;
    }
    if (data === 'edit_project_data') {
        answerCallback(); user.status = 'waiting_project_name'; saveDatabase();
        return bot.sendMessage(chatId, "✏️ Введите название вашего проекта или нишу бизнеса:");
    }

    // Оплата ЮKassa
    if (data === 'buy_yookassa') {
        answerCallback();
        try {
            await bot.sendInvoice(
                chatId,
                'Premium подписка (1 месяц)',
                'Полный безлимит на генерацию постов, доступ ко всем 6 стилям ИИ-копирайтера и приоритетная скорость ответов.',
                `premium_sub_${chatId}_${Date.now()}`, 
                YOOKASSA_TOKEN,
                'RUB',
                [{ label: 'Premium Доступ', amount: PRICE_RUB * 100 }] 
            );
        } catch (error) {
            console.error('Ошибка отправки инвойса ЮKassa:', error.message);
            bot.sendMessage(chatId, '⚠️ Не удалось запустить рублевый шлюз. Попробуйте оплату через Криптовалюту.');
        }
    }

    // Оплата CryptoBot
    if (data === 'buy_crypto') {
        answerCallback();
        try {
            const invoice = await cryptoPay.createInvoice('USDT', PRICE_USD, {
                description: 'Premium ИИ-Копирайтер', payload: chatId.toString(), create_invoice_link: true 
            });
            if (invoice && invoice.pay_url) {
                bot.sendMessage(chatId, `💸 *Счет в USDT успешно создан!*\n\nСтоимость: *${PRICE_USD} USDT*\n\nОплатите счет и нажмите кнопку проверки ниже.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔗 Оплатить в CryptoBot", url: invoice.pay_url }],
                            [{ text: "🔄 Проверить статус оплаты", callback_data: `check_pay_${invoice.invoice_id}` }]
                        ]
                    }
                });
            }
        } catch (error) {
            bot.sendMessage(chatId, '⚠️ Ошибка шлюза криптовалюты. Попробуйте позже.');
        }
    }

    // Проверка CryptoBot
    if (data.startsWith('check_pay_')) {
        answerCallback();
        const invoiceId = data.replace('check_pay_', ''); 
        try {
            const invoices = await cryptoPay.getInvoices({ invoice_ids: invoiceId });
            if (invoices && invoices.items && invoices.items.length > 0) {
                const inv = invoices.items[0];
                if (inv.status === 'paid') {
                    user.isPremium = true; user.count = 0; saveDatabase(); 
                    return bot.sendMessage(chatId, "🎉 *Premium-статус активирован через CryptoBot!*", { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
                } else {
                    return bot.sendMessage(chatId, "❌ Оплата еще не проведена в кошельке.");
                }
            }
        } catch (err) {
            bot.sendMessage(chatId, "⚠️ Ошибка верификации.");
        }
    }
});

// ОБРАБОТЧИКИ ОПЛАТЫ ЮKASSA
bot.on('pre_checkout_query', (query) => {
    bot.answerPreCheckoutQuery(query.id, true).catch(err => console.error('Ошибка PreCheckout:', err.message));
});

bot.on('successful_payment', (msg) => {
    const chatId = msg.chat.id;
    const user = initUser(chatId);
    
    user.isPremium = true;
    user.count = 0;
    user.status = 'idle';
    saveDatabase();

    bot.sendMessage(chatId, "🎉 *Оплата картой прошла успешно!*\n\nВаш Premium-статус активирован на 30 дней. Ограничения полностью сняты, спасибо за покупку!", { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
});

// Запуск веб-сервера 
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Protected AI SaaS is Live!'));
app.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
