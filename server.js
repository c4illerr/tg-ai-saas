const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { CryptoPay } = require('@foile/crypto-pay-api');

// ==========================================
// НАСТРОЙКИ АДМИНИСТРАТОРА (ДАННЫЕ ВШИТЫ)
// ==========================================
const ADMIN_ID = 6583231440; 
const ADMIN_USERNAME = "svrtwww";

// Валидация ключей из окружения Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN; 

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !CRYPTO_BOT_TOKEN) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Проверьте Environment на Render! Не хватает ключей.");
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

const STYLES = {
    expert: "Строгий, экспертный и аналитический стиль. Меньше воды, максимум фактов, цифр и пользы.",
    creative: "Креативный, живой стиль с элементами сторителлинга. Держи интригу и вовлекай читателя.",
    clickbait: "Провокационный, взрывной стиль. Яркие метафоры, кричащий заголовок, сильный призыв к действию (CTA).",
    friendly: "Дружелюбный, простой стиль «как для старого друга». Легкий, ламповый и непринужденный.",
    marketing: "Продающий SMM-стиль. Четкое выделение болей целевой аудитории, презентация решения и сочный оффер.",
    short: "Ультра-короткий формат. Только тезисы, списки и самая суть. Идеально для инфографики и карточек.",
    custom: "Уникальный комбинированный стиль, настроенный пользователем вручную под его нужды."
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
    let styleDisplay = "";
    if (user.style === 'custom') styleDisplay = '⚙️ КОМБИНИРОВАННЫЙ (Ручной)';
    else if (user.style === 'expert') styleDisplay = '💼 Экспертный';
    else if (user.style === 'creative') styleDisplay = '🎨 Креативный';
    else if (user.style === 'clickbait') styleDisplay = '⚡ Кликбейт';
    else if (user.style === 'marketing') styleDisplay = '📈 Продающий';
    else if (user.style === 'short') styleDisplay = '📝 Краткий';
    else styleDisplay = '🤝 Дружелюбный';

    const text = `⚙️ *Меню настроек ИИ-стиля:*\n\n` +
                 `• Активный режим: *${styleDisplay}*\n` +
                 `• Использование эмодзи: *${user.useEmojis ? '✅ Включены' : '❌ Выключены'}*\n` +
                 `• Генерация хэштегов: *${user.includeHashtags ? '✅ Включены' : '❌ Выключены'}*\n\n` +
                 `Вы можете выбрать готовый шаблон стиля или собрать свой собственный микс:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "💼 Экспертный", callback_data: "style_expert" }, { text: "🎨 Креативный", callback_data: "style_creative" }],
            [{ text: "⚡ Кликбейт", callback_data: "style_clickbait" }, { text: "🤝 Дружелюбный", callback_data: "style_friendly" }],
            [{ text: "📈 Продающий", callback_data: "style_marketing" }, { text: "📝 Краткий", callback_data: "style_short" }],
            [{ text: "🎛️ СОБРАТЬ КОМБИНИРОВАННЫЙ ВЫБОР", callback_data: "setup_combined_start" }]
        ]
    };
    return { text, keyboard };
}

// ==========================================
// БЛОК АДМИН-ПАНЕЛИ (С НОВЫМИ ФИЧАМИ)
// ==========================================

bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    bot.sendMessage(chatId, "🛠 *Панель Создателя ботов (svrtwww)*\nУправляй базой данных и продвижением в один клик:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📊 Статистика бота", callback_data: "admin_stats" }, { text: "✉️ Запустить общую рассылку", callback_data: "admin_broadcast_start" }],
                [{ text: "💎 Выдать Premium абсолютно ВСЕМ", callback_data: "admin_premium_all" }],
                [{ text: "🔄 Сбросить лимиты генераций всем", callback_data: "admin_reset_all" }]
            ]
        }
    });
});

bot.onText(/\/userinfo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    const targetId = match[1].trim();
    const target = dbData.users[targetId];

    if (!target) return bot.sendMessage(chatId, "❌ Юзер не найден в БД.");

    const info = `👤 *Инфо о пользователе \`${targetId}\`:*\n\n` +
                 `• Статус: *${target.isPremium ? 'Premium 💎' : 'Обычный 🆓'}*\n` +
                 `• Использовано генераций: *${target.count}/${LIMIT}*\n` +
                 `• Стиль: *${target.style}*\n` +
                 `• Эмодзи: *${target.useEmojis ? 'Да' : 'Нет'}*\n` +
                 `• Хэштеги: *${target.includeHashtags ? 'Да' : 'Нет'}*\n` +
                 `• Ниша проекта: _${target.projectName}_\n` +
                 `• Аудитория: _${target.projectTarget}_`;

    bot.sendMessage(chatId, info, { parse_mode: 'Markdown' });
});

bot.onText(/\/gencode (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    const codeName = match[1].trim().toUpperCase();
    const maxUses = parseInt(match[2], 10);

    if (isNaN(maxUses) || maxUses <= 0) return bot.sendMessage(chatId, "❌ Ошибка в количестве.");

    dbData.promocodes[codeName] = { maxUses: maxUses, usesLeft: maxUses, usersActivated: [] };
    saveDatabase();
    bot.sendMessage(chatId, `✅ Промокод \`${codeName}\` на *${maxUses}* юзеров создан!`, { parse_mode: 'Markdown' });
});

bot.onText(/\/setpremium (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    const targetId = match[1].trim();
    const setPremium = match[2].trim() === 'true';

    if (!dbData.users[targetId]) return bot.sendMessage(chatId, `❌ Пользователь не найден.`);

    dbData.users[targetId].isPremium = setPremium;
    if (setPremium) dbData.users[targetId].count = 0;
    saveDatabase();

    bot.sendMessage(chatId, `✅ ID \`${targetId}\` изменен. Premium: *${setPremium ? 'ВКЛ' : 'ВЫКЛ'}*`, { parse_mode: 'Markdown' });
    bot.sendMessage(targetId, setPremium ? "🎉 Администратор выдал вам полный **Premium-доступ**!" : "⚠️ Ваш Premium-доступ отключен.", { parse_mode: 'Markdown' }).catch(() => {});
});

// ==========================================
// ОСНОВНАЯ ЛОГИКА БОТА И ОПРОСНИКА
// ==========================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    bot.sendMessage(chatId, `Привет, ${msg.from.first_name}! 👋\n\nЯ твой персональный ИИ-копирайтер. Настрой свой стиль и погнали писать контент!`, getMainKeyboard());
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    const user = initUser(chatId);

    // Админская рассылка
    if (chatId === ADMIN_ID && user.status === 'admin_waiting_broadcast') {
        user.status = 'idle';
        saveDatabase();
        const allUserIds = Object.keys(dbData.users);
        bot.sendMessage(chatId, `📢 Рассылаю сообщения для *${allUserIds.length}* человек...`, { parse_mode: 'Markdown' });
        let successCount = 0;
        for (const uId of allUserIds) {
            try {
                await bot.sendMessage(uId, text);
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 50)); 
            } catch (err) {}
        }
        return bot.sendMessage(chatId, `🎉 Рассылка окончена! Доставлено: *${successCount}/${allUserIds.length}*`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }

    // Проверка промокодов
    const inputCode = text.trim().toUpperCase();
    if (dbData.promocodes[inputCode]) {
        const promo = dbData.promocodes[inputCode];
        if (promo.usersActivated.includes(chatId.toString())) return bot.sendMessage(chatId, "⚠️ Этот промокод вы уже вводили!");
        if (promo.usesLeft <= 0) return bot.sendMessage(chatId, "❌ Места на промокод закончились.");

        promo.usesLeft--;
        promo.usersActivated.push(chatId.toString());
        user.isPremium = true;
        user.count = 0;
        user.status = 'idle';
        saveDatabase();
        return bot.sendMessage(chatId, `🎉 Промокод сработал! Безлимит активирован.`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }

    // Текстовая персонализация
    if (user.status === 'waiting_project_name') {
        user.projectName = text.trim();
        user.status = 'waiting_project_target';
        saveDatabase();
        return bot.sendMessage(chatId, `✅ Название сохранено.\n\nТеперь отправьте текстом описание вашей *Целевой аудитории (ЦА)*:`, { parse_mode: 'Markdown' });
    }

    if (user.status === 'waiting_project_target') {
        user.projectTarget = text.trim();
        user.status = 'idle';
        saveDatabase();
        return bot.sendMessage(chatId, `🎉 *Данные бизнеса обновлены!*\n• Проект: *${user.projectName}*\n• Аудитория: *${user.projectTarget}*`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }

    if (text === "⚙️ Настройки стиля") {
        const menu = getSettingsMenuData(user);
        return bot.sendMessage(chatId, menu.text, { parse_mode: 'Markdown', reply_markup: menu.keyboard });
    }

    if (text === "🎯 Мой проект (Персонализация)") {
        return bot.sendMessage(chatId, `🎯 *Персонализация ИИ под ваш бренд:*\n\n• Ниша/Проект: *${user.projectName}*\n• Ваша аудитория: *${user.projectTarget}*`, {
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
            message += `🚀 *Купить Premium-доступ:*\n\n🪙 *Крипта:* 3 USDT через автоматический CryptoBot.\n💳 *Карта РФ:* 290 рублей переводом.\n\nОтправь промокод в чат, если он у тебя есть.`;
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🪙 Оплатить в USDT (CryptoBot)", callback_data: "buy_crypto" }],
                        [{ text: "👤 Оплатить Картой РФ (Админ)", url: `https://t.me/${ADMIN_USERNAME}` }]
                    ]
                }
            });
        }
    }

    if (user.count >= LIMIT && !user.isPremium) {
        return bot.sendMessage(chatId, `❌ *Лимит генераций исчерпан (${LIMIT}/${LIMIT})!*\n\nПерейдите в профиль для разблокировки безлимита.`, {
            reply_markup: { inline_keyboard: [[{ text: "💎 Открыть профиль / Купить", callback_data: "💎 Мой профиль / Купить Premium" }]] }
        });
    }

    if (text === "🔥 Создать пост") {
        user.status = 'waiting_text';
        saveDatabase();
        return bot.sendMessage(chatId, "📝 Отправьте тему поста или тезисы (ИИ переработает их по вашим настройкам):");
    }

    // Генерация текста ИИ
    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥') && !text.startsWith('🎯'))) {
        bot.sendChatAction(chatId, 'typing');
        
        const chosenStyleInstructions = STYLES[user.style] || STYLES['creative'];
        
        let systemPrompt = `Ты — профессиональный Telegram-копирайтер.\n`;
        systemPrompt += `1. ОСНОВНОЙ СТИЛЬ ТЕКСТА: ${chosenStyleInstructions}\n`;
        
        if (user.useEmojis) {
            systemPrompt += `2. ОФОРМЛЕНИЕ (ЭМОДЗИ): Обязательно добавляй релевантные эмодзи для структуры, списков и буллетов. Делай пост ярким.\n`;
        } else {
            systemPrompt += `2. ОФОРМЛЕНИЕ (ЭМОДЗИ): Категорически запрещено использовать абсолютно любые эмодзи, смайлы или иконки. Только текст и буквы.\n`;
        }
        
        if (user.includeHashtags) {
            systemPrompt += `3. МЕТКИ (ХЭШТЕГИ): С новой строки в самом конце поста сгенерируй и вставь 3-5 хэштегов.\n`;
        } else {
            systemPrompt += `3. МЕТКИ (ХЭШТЕГИ): Категорически запрещено вставлять хэштеги.\n`;
        }
        
        systemPrompt += `4. ЦЕЛЕВАЯ АУДИТОРИЯ: Название компании — "${user.projectName}". Мы пишем для людей со следующими болями и интересами: "${user.projectTarget}". Сделай упор на этот контекст.\n`;
        systemPrompt += `Отправь ТОЛЬКО готовый пост. Без комментариев от себя, без фраз "Вот ваш пост:".`;

        try {
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "model": "google/gemini-2.5-flash", 
                    "max_tokens": 1500, 
                    "messages": [
                        { role: "system", content: systemPrompt },
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
            bot.sendMessage(chatId, "⚠️ Ошибка нейросети. Попробуйте еще раз через секунд 10.", getMainKeyboard());
        }
    }
});

// Инлайн-кнопки (Логика и Комбинированный конструктор)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    const answerCallback = () => { try { bot.answerCallbackQuery(query.id); } catch (e) {} };

    // Обработка Мастера Комбинированного выбора
    if (data === 'setup_combined_start') {
        answerCallback();
        return bot.editMessageText("🎛️ *Конструктор комбинированного выбора (Шаг 1 из 2)*\n\nИспользовать эмодзи и иконки для красивой разметки текста списков?", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Да, добавлять эмодзи", callback_data: "comb_emoji_true" }],
                    [{ text: "❌ Нет, строгий текст без смайлов", callback_data: "comb_emoji_false" }]
                ]
            }
        });
    }

    if (data.startsWith('comb_emoji_')) {
        answerCallback();
        user.useEmojis = (data.replace('comb_emoji_', '') === 'true');
        saveDatabase();
        return bot.editMessageText("🎛️ *Конструктор комбинированного выбора (Шаг 2 из 2)*\n\nГенерировать автоматический блок хэштегов (#тег) в конце публикации?", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Да, хэштеги нужны", callback_data: "comb_tags_true" }],
                    [{ text: "❌ Нет, без хэштегов", callback_data: "comb_tags_false" }]
                ]
            }
        });
    }

    if (data.startsWith('comb_tags_')) {
        answerCallback();
        user.includeHashtags = (data.replace('comb_tags_', '') === 'true');
        user.style = 'custom'; // Переключаем режим на кастомный ручной стиль!
        saveDatabase();
        
        bot.sendMessage(chatId, "🚀 *Комбинированный выбор успешно собран и активирован!*\nТеперь ИИ будет создавать посты строго по вашей личной схеме.");
        const menu = getSettingsMenuData(user);
        return bot.sendMessage(chatId, menu.text, { parse_mode: 'Markdown', reply_markup: menu.keyboard });
    }

    // АДМИНСКИЕ ФИЧИ
    if (chatId === ADMIN_ID && data === 'admin_stats') {
        answerCallback();
        const users = Object.values(dbData.users);
        const total = users.length;
        const premium = users.filter(u => u.isPremium).length;
        return bot.sendMessage(chatId, `📊 *Статистика*\n• Пользователей: *${total}*\n• С Premium: *${premium}*`, { parse_mode: 'Markdown' });
    }

    if (chatId === ADMIN_ID && data === 'admin_broadcast_start') {
        answerCallback();
        user.status = 'admin_waiting_broadcast';
        saveDatabase();
        return bot.sendMessage(chatId, "✉️ Отправьте следующим сообщением текст рассылки:");
    }

    if (chatId === ADMIN_ID && data === 'admin_premium_all') {
        answerCallback();
        const keys = Object.keys(dbData.users);
        keys.forEach(k => { dbData.users[k].isPremium = true; dbData.users[k].count = 0; });
        saveDatabase();
        return bot.sendMessage(chatId, `💎 Всем *${keys.length}* пользователям выдан Premium-статус!`);
    }

    if (chatId === ADMIN_ID && data === 'admin_reset_all') {
        answerCallback();
        const keys = Object.keys(dbData.users);
        keys.forEach(k => { dbData.users[k].count = 0; });
        saveDatabase();
        return bot.sendMessage(chatId, `🔄 Счетчики генераций всех *${keys.length}* юзеров успешно обнулены.`);
    }

    // Шаблоны обычных стилей
    if (data.startsWith('style_')) {
        answerCallback();
        user.style = data.replace('style_', '');
        if (user.style === 'expert' || user.style === 'short') user.useEmojis = false; 
        else user.useEmojis = true;
        user.includeHashtags = true;
        saveDatabase();
        
        const menu = getSettingsMenuData(user);
        try {
            await bot.editMessageText(menu.text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: menu.keyboard });
        } catch (e) {}
        return;
    }

    if (data === 'edit_project_data') {
        answerCallback();
        user.status = 'waiting_project_name';
        saveDatabase();
        return bot.sendMessage(chatId, "✏️ Введите название проекта или нишу бизнеса:");
    }

    // Инвойс CryptoBot
    if (data === 'buy_crypto') {
        answerCallback();
        try {
            const invoice = await cryptoPay.createInvoice('USDT', PRICE_USD, {
                description: 'Premium ИИ-Копирайтер', payload: chatId.toString(), create_invoice_link: true 
            });
            if (invoice && invoice.pay_url) {
                bot.sendMessage(chatId, `💸 *Счет: ${PRICE_USD} USDT*\n\nОплатите и нажмите кнопку верификации:`, {
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
            bot.sendMessage(chatId, '⚠️ Крипто-шлюз перегружен. Попробуйте позже.');
        }
    }

    if (data.startsWith('check_pay_')) {
        answerCallback();
        const invoiceId = data.replace('check_pay_', ''); 
        try {
            const invoices = await cryptoPay.getInvoices({ invoice_ids: invoiceId });
            if (invoices && invoices.items && invoices.items.length > 0) {
                const inv = invoices.items[0];
                if (inv.status === 'paid') {
                    user.isPremium = true; user.count = 0; saveDatabase(); 
                    return bot.sendMessage(chatId, "🎉 Premium активирован!", { reply_markup: getMainKeyboard() });
                } else {
                    return bot.sendMessage(chatId, "❌ Оплата не найдена.");
                }
            }
        } catch (err) {
            bot.sendMessage(chatId, "⚠️ Ошибка верификации.");
        }
    }
});

// ==========================================
// ЗАПУСК ВЕБ-СЕРВЕРА И ЗАЩИТА ОТ СПЯЧКИ (PING)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('SaaS API is Online'));

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    
    // Каждые 10 минут (600 000 мс) бот будет пинговать сам себя,
    // чтобы Render не переводил его бесплатный тариф в спящий режим.
    setInterval(async () => {
        try {
            const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
            await axios.get(url);
            console.log(`📡 Авто-пинг выполнен: сервер активен.`);
        } catch (err) {
            console.error(`⚠️ Ошибка авто-пинга:`, err.message);
        }
    }, 600000); 
});
