const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Расширенная база данных в памяти
const userSettings = {}; 
const LIMIT = 5; 

// Доступные стили текста
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

// Главное меню (шаблон кнопок)
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

// Инициализация юзера
function initUser(chatId) {
    if (!userSettings[chatId]) {
        userSettings[chatId] = { 
            count: 0, 
            isPremium: false, 
            style: 'creative', // стиль по умолчанию
            includeHashtags: true, // хэштеги по умолчанию
            status: 'idle' // статус (ожидает текст или нет)
        };
    }
    return userSettings[chatId];
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    
    bot.sendMessage(chatId, `Привет, ${msg.from.first_name}! 👋\n\nЯ твой профессиональный ИИ-копирайтер для Telegram-каналов. Я превращаю поток мыслей в структурированные посты, которые дочитывают до конца.\n\nИспользуй меню внизу, чтобы настроить стиль нейросети под свой канал.`, getMainKeyboard());
});

// Обработка текстовых кнопок меню
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;
    const user = initUser(chatId);

    // Если это команда, игнорируем базовую обработку
    if (text.startsWith('/')) return;

    // Кнопка: Создать пост
    if (text === "🔥 Создать пост") {
        user.status = 'waiting_text';
        return bot.sendMessage(chatId, "📝 Отправь мне сырой текст, тезисы или голосовой перевод (в виде текста). Я сделаю из этого конфету!");
    }

    // Кнопка: Настройки
    if (text === "⚙️ Настройки стиля") {
        const currentStyleName = user.style === 'expert' ? '💼 Экспертный' : user.style === 'creative' ? '🎨 Креативный' : user.style === 'clickbait' ? '⚡ Кликбейт' : '🤝 Дружелюбный';
        const hashtagsStatus = user.includeHashtags ? '✅ Включены' : '❌ Выключены';

        return bot.sendMessage(chatId, `Управление стилем ИИ:\n\nТекущий стиль: *${currentStyleName}*\nХэштеги в конце: *${hashtagsStatus}*`, {
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

    // Кнопка: Профиль и Оплата
    if (text === "💎 Мой профиль / Купить Premium") {
        const status = user.isPremium ? "💎 Безлимитный Premium" : `🆓 Бесплатный (${user.count}/${LIMIT} генераций)`;
        
        let message = `👤 *Твой профиль:*\n\n• Твой ID: \`${chatId}\`\n• Статус подписки: *${status}*\n\n`;
        
        if (user.isPremium) {
            message += "✨ Вам доступны безлимитные генерации и любые стили без ограничений!";
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            message += `🚀 Закончились лимиты? Активируй Premium-доступ всего за *299 рублей / месяц* и забудь об ограничениях.`;
            
            // Сюда можно вшить ссылку на оплату. Пока оставим тестовую кнопку с симуляцией реальной ссылки.
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "💳 Оплатить картой (299₽)", callback_data: "buy_premium_real" },
                            { text: "🪙 Оплатить Криптой", callback_data: "buy_premium_real" }
                        ]
                    ]
                }
            });
        }
    }

    // Если пользователь просто прислал текст для обработки (или нажал кнопку Создать пост)
    if (user.status === 'waiting_text' || (!text.startsWith('⚙️') && !text.startsWith('💎') && !text.startsWith('🔥'))) {
        
        // Проверка лимитов
        if (user.count >= LIMIT && !user.isPremium) {
            return bot.sendMessage(chatId, `❌ Бесплатные попытки исчерпаны (${LIMIT}/${LIMIT}).\n\nПожалуйста, перейдите в раздел Профиль, чтобы активировать Premium.`, getMainKeyboard());
        }

        bot.sendChatAction(chatId, 'typing');

        // Формируем системный промпт ИИ в зависимости от настроек юзера
        const chosenStyleInstructions = STYLES[user.style];
        const hashtagInstruction = user.includeHashtags ? "В самом конце поста обязательно подбери и добавь 3-5 релевантных хэштегов." : "Не добавляй хэштеги в конце поста.";

        try {
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "model": "google/gemini-2.5-flash", 
                    "max_tokens": 1200, 
                    "messages": [
                        { 
                            role: "system", 
                            content: `Ты — топовый Telegram-копирайтер. Твоя задача — превратить текст пользователя в крутой структурированный пост. Обязательно: броский заголовок, деление на абзацы, списки, эмодзи.
                            Стиль написания: ${chosenStyleInstructions}
                            ${hashtagInstruction}
                            Выдавай только готовый текст поста, без лишней болтовни и мета-комментариев.` 
                        },
                        { role: "user", content: text }
                    ]
                },
                {
                    headers: {
                        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:3000",
                        "X-Title": "TG AI Copywriter SaaS"
                    }
                }
            );

            let aiReply = response.data.choices[0].message.content;
            aiReply = safeMarkdown(aiReply);

            if (!user.isPremium) user.count++;
            user.status = 'idle'; // сбрасываем статус

            try {
                await bot.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.sendMessage(chatId, aiReply);
            }

            bot.sendMessage(chatId, `💡 Использовано генераций: ${user.count}/${LIMIT}`, getMainKeyboard());

        } catch (error) {
            console.error("Ошибка ИИ:", error.response ? error.response.data : error.message);
            bot.sendMessage(chatId, "⚠️ Ошибка связи с ИИ. Повтори запрос чуть позже.", getMainKeyboard());
        }
    }
});

// Обработка инлайн-кнопок (настройки и оплата)
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = initUser(chatId);

    // Переключение стилей
    if (data.startsWith('style_')) {
        const newStyle = data.replace('style_', '');
        user.style = newStyle;
        bot.answerCallbackQuery(query.id, { text: "Стиль успешно изменен! ✨" });
        return bot.sendMessage(chatId, `Стиль ИИ переключен. Теперь посты будут генерироваться в этом режиме.`, getMainKeyboard());
    }

    // Переключение хэштегов
    if (data === 'toggle_hashtags') {
        user.includeHashtags = !user.includeHashtags;
        bot.answerCallbackQuery(query.id, { text: "Настройки хэштегов обновлены!" });
        return bot.sendMessage(chatId, `Генерация хэштегов: ${user.includeHashtags ? 'ВКЛЮЧЕНА ✅' : 'ВЫКЛЮЧЕНА ❌'}`, getMainKeyboard());
    }

    // Симуляция реальной оплаты (Инструкция как сделать интеграцию)
    if (data === 'buy_premium_real') {
        bot.answerCallbackQuery(query.id);
        
        // В реальном бизнесе ты генерируешь платежную ссылку через API Aaio/ЮKassa 
        // и отправляешь её юзеру. Для теста мы просто выдаем премиум и пишем красивый текст.
        user.isPremium = true; 

        bot.sendMessage(chatId, `🔄 *Перенаправление на шлюз оплаты...*\n\n⚠️ _[ТЕСТ]_ Ссылка сгенерирована. Система зафиксировала успешный платеж на 299₽!\n\n🎉 *Поздравляем! Вам выдан вечный безлимитный Premium-доступ!* Попробуйте сгенерировать пост прямо сейчас.`, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
    }
});

// Веб-заглушка для Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('SaaS AI Копирайтер запущен!'));
app.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
