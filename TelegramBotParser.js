// telegramBotParser.js
const axios = require('axios');

class TelegramBotParser {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.cache = [];
        this.lastUpdated = null;
        this.baseURL = `https://api.telegram.org/bot${this.botToken}`;

        // Нижегородские Telegram каналы (публичные)
        this.channels = [
            {
                id: 'nn_ru',
                username: '@nn_ru',
                name: 'Новости Нижнего Новгорода | NN.RU',
                category: 'Новости'
            },
            {
                id: 'moynnov',
                username: '@moynnov',
                name: 'Мой Нижний Новгород',
                category: 'Новости'
            },
            {
                id: 'nn_obl',
                username: '@nn_obl',
                name: 'ЧП Нижний Новгород',
                category: 'ЧП и происшествия'
            },
            {
                id: 'mynnovgorod',
                username: '@mynnovgorod',
                name: 'Мой Нижний Новгород',
                category: 'Городские новости'
            },
            {
                id: 'bez_cenz_nn',
                username: '@bez_cenz_nn',
                name: 'Нижний Новгород БЕЗ ЦЕНЗУРЫ',
                category: 'Новости'
            }
        ];
    }

    // Получение чата по username
    async getChat(username) {
        try {
            const response = await axios.get(`${this.baseURL}/getChat`, {
                params: { chat_id: username },
                timeout: 10000
            });
            return response.data.result;
        } catch (error) {
            console.error(`Ошибка получения чата ${username}:`, error.message);
            return null;
        }
    }

    // Получение обновлений канала (только для ботов с правами админа)
    async getChannelPosts(channel, limit = 15) {
        try {
            // ВАЖНО: Этот метод работает только если бот добавлен в канал как админ
            console.log(`Получаем посты из канала ${channel.name}...`);

            const response = await axios.get(`${this.baseURL}/getUpdates`, {
                params: {
                    offset: -100,
                    limit: limit,
                    allowed_updates: ['channel_post']
                },
                timeout: 15000
            });

            if (!response.data.ok) {
                throw new Error(response.data.description);
            }

            const updates = response.data.result;
            const posts = [];

            for (const update of updates) {
                if (update.channel_post && update.channel_post.chat.username === channel.username.replace('@', '')) {
                    const post = await this.parseChannelPost(update.channel_post, channel);
                    if (post) posts.push(post);
                }
            }

            return posts;

        } catch (error) {
            console.error(`Ошибка получения постов ${channel.name}:`, error.message);
            return [];
        }
    }

    // Альтернативный метод через RSS прокси
    async getChannelPostsViaRSS(channel, limit = 15) {
        try {
            // Используем публичный RSS для Telegram каналов
            const rssUrl = `https://rsshub.app/telegram/channel/${channel.username.replace('@', '')}`;

            const response = await axios.get(rssUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'NewsApp/1.0 (RSS Reader)'
                }
            });

            const RSSParser = require('rss-parser');
            const parser = new RSSParser();
            const feed = await parser.parseString(response.data);

            const posts = [];
            for (const item of feed.items.slice(0, limit)) {
                const post = await this.parseRSSItem(item, channel);
                if (post) posts.push(post);
            }

            return posts;

        } catch (error) {
            console.error(`RSS парсинг ${channel.name}:`, error.message);
            return [];
        }
    }

    // Парсинг поста из Bot API
    async parseChannelPost(post, channel) {
        try {
            if (!post.text || post.text.length < 10) return null;
            if (!this.isRussianText(post.text)) return null;

            // Извлекаем изображение
            let imageUrl = null;
            if (post.photo && post.photo.length > 0) {
                const photo = post.photo[post.photo.length - 1]; // Берем самое большое фото
                imageUrl = await this.getFileUrl(photo.file_id);
            }

            return {
                id: Buffer.from(`tg_bot_${channel.id}_${post.message_id}_${post.date}`).toString('base64'),
                title: this.extractTitle(post.text),
                description: this.cleanText(post.text),
                imageUrl: imageUrl,
                sourceUrl: `https://t.me/${channel.username.replace('@', '')}/${post.message_id}`,
                publishedAt: this.formatTelegramDate(post.date * 1000), // Unix timestamp to ms
                rawDate: new Date(post.date * 1000).toISOString(),
                source: {
                    id: channel.id,
                    name: channel.name,
                    type: 'Telegram'
                },
                category: channel.category,
                viewCount: post.views || Math.floor(Math.random() * 500) + 100,
                isLiked: false,
                platform: 'telegram'
            };

        } catch (error) {
            console.error(`Ошибка парсинга поста:`, error);
            return null;
        }
    }

    // Получение URL файла через Bot API
    async getFileUrl(fileId) {
        try {
            const response = await axios.get(`${this.baseURL}/getFile`, {
                params: { file_id: fileId },
                timeout: 5000
            });

            if (response.data.ok) {
                const filePath = response.data.result.file_path;
                return `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
            }
            return null;
        } catch (error) {
            console.error('Ошибка получения файла:', error.message);
            return null;
        }
    }

    // Парсинг RSS элемента
    async parseRSSItem(item, channel) {
        try {
            if (!item.title || item.title.length < 10) return null;
            if (!this.isRussianText(item.title + ' ' + (item.contentSnippet || ''))) return null;

            // Извлекаем изображение из content
            let imageUrl = null;
            if (item.content) {
                const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/i);
                if (imgMatch) {
                    imageUrl = imgMatch[1];
                }
            }

            return {
                id: Buffer.from(`tg_rss_${channel.id}_${item.guid || item.link}_${Date.now()}`).toString('base64'),
                title: this.extractTitle(item.title),
                description: this.cleanText(item.contentSnippet || item.content || item.title),
                imageUrl: imageUrl,
                sourceUrl: item.link,
                publishedAt: this.formatTelegramDate(new Date(item.pubDate)),
                rawDate: item.pubDate,
                source: {
                    id: channel.id,
                    name: channel.name,
                    type: 'Telegram'
                },
                category: channel.category,
                viewCount: Math.floor(Math.random() * 500) + 100,
                isLiked: false,
                platform: 'telegram'
            };

        } catch (error) {
            console.error(`Ошибка парсинга RSS:`, error);
            return null;
        }
    }

    // Основной метод парсинга
    async fetchTelegramNews() {
        console.log('\n=== НАЧИНАЕМ ПАРСИНГ TELEGRAM КАНАЛОВ (BOT API) ===');
        const allPosts = [];

        // Проверяем доступность Bot API
        if (!this.botToken) {
            console.log('⚠️  TELEGRAM_BOT_TOKEN не установлен, используем RSS fallback');

            for (const channel of this.channels) {
                const posts = await this.getChannelPostsViaRSS(channel);
                allPosts.push(...posts);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Пауза между запросами
            }
        } else {
            // Пробуем Bot API, если не работает - fallback на RSS
            let botApiWorking = true;

            for (const channel of this.channels) {
                let posts = await this.getChannelPosts(channel);

                if (posts.length === 0 && botApiWorking) {
                    console.log(`Bot API не работает для ${channel.name}, пробуем RSS...`);
                    posts = await this.getChannelPostsViaRSS(channel);

                    if (posts.length === 0) {
                        botApiWorking = false;
                    }
                }

                allPosts.push(...posts);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Меньшая пауза для Bot API
            }
        }

        // Дедупликация и сортировка
        const uniquePosts = allPosts.filter((item, index, self) =>
            index === self.findIndex(t => t.sourceUrl === item.sourceUrl || t.description === item.description)
        );

        uniquePosts.sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));

        this.cache = uniquePosts.slice(0, 50);
        this.lastUpdated = new Date();

        console.log('\n=== ИТОГ TELEGRAM ПАРСИНГА ===');
        console.log(`Всего загружено ${this.cache.length} постов из Telegram`);
        console.log(`С изображениями: ${this.cache.filter(item => item.imageUrl).length}`);

        // Статистика по каналам
        const channelStats = {};
        this.cache.forEach(item => {
            channelStats[item.source.name] = (channelStats[item.source.name] || 0) + 1;
        });

        console.log('Статистика по каналам:');
        Object.entries(channelStats).forEach(([name, count]) => {
            console.log(`  ${name}: ${count} постов`);
        });
        console.log('=====================================\n');

        return this.cache;
    }

    // Вспомогательные методы (аналогичные текущим)
    isRussianText(text) {
        if (!text) return false;
        const cyrillicCount = (text.match(/[а-яё]/gi) || []).length;
        const totalLetters = (text.match(/[а-яёa-z]/gi) || []).length;
        return cyrillicCount > 0 && totalLetters > 0 && (cyrillicCount / totalLetters) > 0.3;
    }

    extractTitle(text) {
        if (!text) return 'Без заголовка';
        const sentences = text.split(/[.!?]\s+/);
        let title = sentences[0] || text;
        if (title.length > 100) {
            title = title.substring(0, 97) + '...';
        }
        return title.trim();
    }

    cleanText(text) {
        return text
            .replace(/[\n\r\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 500);
    }

    formatTelegramDate(date) {
        if (!date) return 'Неизвестно';

        const publishDate = new Date(date);
        const now = new Date();
        const diffInMinutes = Math.floor((now - publishDate) / (1000 * 60));

        if (diffInMinutes < 1) return 'только что';
        if (diffInMinutes < 60) return `${diffInMinutes} мин назад`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} ч назад`;

        const diffInDays = Math.floor(diffInMinutes / 1440);
        if (diffInDays === 1) return 'вчера';
        if (diffInDays < 7) return `${diffInDays} дн назад`;

        return publishDate.toLocaleDateString('ru-RU');
    }

    // API совместимость с текущим парсером
    getCachedNews() {
        return {
            data: this.cache,
            total: this.cache.length,
            lastUpdated: this.lastUpdated,
            source: 'telegram'
        };
    }

    getStats() {
        const channelStats = {};
        this.cache.forEach(item => {
            channelStats[item.source.name] = (channelStats[item.source.name] || 0) + 1;
        });

        return {
            total: this.cache.length,
            channels: channelStats,
            lastUpdated: this.lastUpdated,
            withImages: this.cache.filter(item => item.imageUrl).length
        };
    }
}

module.exports = TelegramBotParser;
