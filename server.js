const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN || ''; 

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// База данных в памяти
const userSettings = {}; 
const LIMIT = 5; 
const PRICE_USD = 3; // Цена Premium подписки

// Расширенные стили текста
const STYLES = {
    expert: "Строгий, экспертный и аналитический стиль. Меньше воды, максимум фактов и пользы.",
    creative: "Креативный, живой стиль с элементами сторителлинга. Удерживай внимание интригой.",
    clickbait: "Провокационный, взрывной стиль. Яркие метафоры, кричащий заголовок, сильный призыв к действию.",
    friendly: "Дружелюбный, простой стиль «как для старого друга». Легкий, ламповый и непринужденный.",
    marketing: "Продающий SMM-стиль. Четкое выделение болей аудитории, презентация решения и оффер.",
    short: "Ультра-короткий формат. Только тезисы и суть. Идеально для карточек или инфографики."
};

// Исправление битых тегов Markdown
function safeMarkdown(text) {
    const stars = (text.match(/\*/g) || []).length;
    if (stars % 2 !== 0) {
        return text.replace(/\*/g, '');
    }
    return text;
}

// Главное меню приложения
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

// Инициализация профиля пользователя
function initUser(chatId) {
    if (!userSettings[chatId]) {
        userSettings[chatId] = { 
            count: 0, 
            isPremium: false, // Для личного теста можешь временно поставить true!
            style: 'creative', 
            includeHashtags: true, 
            useEmojis: true, // Новая настройка персонализации
            status: 'idle' 
        };
    }
    return userSettings[chatId];
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    bot.sendMessage(chatId, `Привет, ${msg.from.first_name}! 👋\n\nЯ твой персональный ИИ-копирайтер для Telegram-каналов. Я превращаю сырые мысли, аудио-записи или тезисы в крутые структурированные посты.\n\nНастрой ИИ под свой канал с помощью меню «⚙️ Настройки стиля».`, getMainKeyboard());
});

// Обработка текстовых сообщений и кнопок
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    const user = initUser(chatId);

    if (text === "🔥 Создать пост") {
        user.status = 'waiting_text';
        return bot.sendMessage(chatId, "📝 Отправь мне сырой текст, тезисы или наброски. Я оформлю их по всем правилам Telegram-копирайтинга!");
    }

    if (text === "⚙️ Настройки стиля") {
        const currentStyleName = 
            user.style === 'expert' ? '💼 Экспертный' : 
            user.style === 'creative' ? '🎨 Креативный' : 
            user.style === 'clickbait' ? '⚡ Кликбейт' : 
            user.style === 'marketing' ? '📈 Продающий' :
            user.style === 'short' ? '📝 Короткий' : '🤝 Дружелюбный';

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
            message += "✨ Вам доступны безлимитные генерации, все 6 стилей текста и любые настройки графики без ограничений!";
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            message += `🚀 Избавься от лимитов! Активируй Premium-доступ всего за *${PRICE_USD} USDT / месяц*.\n\nВы получите полную кастомизацию, генерацию без ограничений и мгновенный отклик ИИ.`;
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

    // Логика отправки запроса в ИИ
    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥'))) {
        if (user.count >= LIMIT && !user.isPremium) {
            return bot.sendMessage(chatId, `❌ Бесплатные генерации исчерпаны (${LIMIT}/${LIMIT}).\n\nПожалуйста, откройте профиль и активируйте Premium, чтобы продолжить работу.`, getMainKeyboard());
        }

        bot.sendChatAction(chatId, 'typing');
        
        const chosenStyleInstructions = STYLES[user.style];
        const hashtagInstruction = user.includeHashtags ? "В самом конце поста обязательно подбери и добавь 3-5 релевантных хэштегов." : "Не добавляй хэштеги в конце поста.";
        const emojiInstruction = user.useEmojis ? "Обязательно используй подходящие эмодзи (смайлики) в заголовке и по тексту для структуры." : "Категорически запрещено использовать эмодзи и смайлики. Текст должен быть полностью без них.";

        try {
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
                    headers: {
                        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json"
                    }
                }
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
            console.error("Ошибка ИИ:", error.message);
            bot.sendMessage(chatId, "⚠️ Ошибка связи с нейросетью. Попробуй еще раз.", getMainKeyboard());
        }
    }
});

// Обработка интерактивных инлайн-кнопок
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    // Смена стилей
    if (data.startsWith('style_')) {
        user.style = data.replace('style_', '');
        bot.answerCallbackQuery(query.id, { text: "Стиль изменен!" });
        return bot.sendMessage(chatId, `Стиль успешно обновлен. Нажмите «🔥 Создать пост», чтобы проверить результат!`, getMainKeyboard());
    }

    // Переключение хэштегов
    if (data === 'toggle_hashtags') {
        user.includeHashtags = !user.includeHashtags;
        bot.answerCallbackQuery(query.id, { text: "Хэштеги изменены!" });
        return bot.sendMessage(chatId, `Генерация хэштегов теперь: ${user.includeHashtags ? 'ВКЛЮЧЕНА ✅' : 'ВЫКЛЮЧЕНА ❌'}`, getMainKeyboard());
    }

    // Переключение эмодзи (смайликов)
    if (data === 'toggle_emojis') {
        user.useEmojis = !user.useEmojis;
        bot.answerCallbackQuery(query.id, { text: "Настройка смайликов изменена!" });
        return bot.sendMessage(chatId, `Использование смайликов теперь: ${user.useEmojis ? 'ВКЛЮЧЕНО ✅' : 'ВЫКЛЮЧЕНО ❌'}`, getMainKeyboard());
    }

    // === НАСТОЯЩАЯ ИНТЕГРАЦИЯ ОПЛАТЫ CRYPTOBOT ===
    if (data === 'buy_crypto') {
        bot.answerCallbackQuery(query.id);

        if (!CRYPTO_BOT_TOKEN) {
            return bot.sendMessage(chatId, "❌ Ошибка конфигурации: На сервере не задан токен CryptoPay.");
        }

        try {
            // Запрашиваем у CryptoBot создание реального счета
            const cryptoResponse = await axios.post(
                'https://pay.crypton.sh/api/createInvoice',
                {
                    asset: 'USDT', 
                    amount: PRICE_USD.toString(),
                    description: 'Premium доступ к ИИ-Копирайтеру',
                    payload: chatId.toString(), 
                    create_invoice_link: true
                },
                { headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN } }
            );

            if (cryptoResponse.data && cryptoResponse.data.result) {
                const invoice = cryptoResponse.data.result;
                const payUrl = invoice.pay_url; 

                bot.sendMessage(chatId, `💸 *Счет на оплату успешно создан!*\n\nСтоимость: *${PRICE_USD} USDT*\n\nНажми кнопку ниже, чтобы перейти в кошелек и оплатить. После завершения платежа вернись сюда и нажми кнопку «🔄 Проверить оплату».`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔗 Оплатить через CryptoBot", url: payUrl }],
                            [{ text: "🔄 Проверить оплату", callback_data: `check_pay_${invoice.invoice_id}` }]
                        ]
                    }
                });
            }
        } catch (error) {
            console.error('Ошибка платежки:', error.message);
            bot.sendMessage(chatId, '⚠️ Не удалось сгенерировать счет. Попробуйте зайти позже.');
        }
    }

    // Кнопка ручной проверки статуса платежа
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
                    user.isPremium = true; // Выдаем премиум!
                    return bot.sendMessage(chatId, "🎉 *Поздравляем! Оплата прошла успешно.*\n\nВам активирован безлимитный Premium-статус! Ограничения сняты навсегда.", { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
                } else {
                    return bot.sendMessage(chatId, "❌ Система еще не зафиксировала оплату. Пожалуйста, завершите платеж в CryptoBot и попробуйте снова через пару секунд.");
                }
            }
        } catch (err) {
            bot.sendMessage(chatId, "⚠️ Ошибка связи с платежным шлюзом при проверке.");
        }
    }
});

// Заглушка сервера для Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('SaaS AI Copywriter is Online!'));
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
