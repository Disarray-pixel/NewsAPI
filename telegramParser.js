const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');

class TelegramParser {
    constructor() {
        this.cache = [];
        this.lastUpdated = null;

        // Нижегородские Telegram каналы
        this.channels = [
            {
                id: 'nn_ru',
                name: 'Новости Нижнего Новгорода | NN.RU',
                username: 'nn_ru',
                url: 'https://t.me/s/nn_ru',
                category: 'Новости'
            },
            {
                id: 'moynnov',
                name: 'Мой Нижний Новгород',
                username: 'moynnov',
                url: 'https://t.me/s/moynnov',
                category: 'Новости'
            },
            {
                id: 'nn_obl',
                name: 'ЧП Нижний Новгород',
                username: 'nn_obl',
                url: 'https://t.me/s/nn_obl',
                category: 'ЧП и происшествия'
            },
            {
                id: 'mynnovgorod',
                name: 'Мой Нижний Новгород',
                username: 'mynnovgorod',
                url: 'https://t.me/s/mynnovgorod',
                category: 'Городские новости'
            },
            {
                id: 'bez_cenz_nn',
                name: 'Нижний Новгород БЕЗ ЦЕНЗУРЫ',
                username: 'bez_cenz_nn',
                url: 'https://t.me/s/bez_cenz_nn',
                category: 'Новости'
            }
        ];
    }

    // Парсинг одного канала
    async parseChannel(channel) {
        try {
            console.log(`Парсим канал ${channel.name}...`);

            const response = await axios.get(channel.url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const posts = [];

            // Парсим посты из канала
            $('.tgme_widget_message').each((index, element) => {
                if (index >= 15) return false; // Ограничиваем количество постов

                const $post = $(element);

                // Извлекаем данные поста
                const postId = $post.attr('data-post');
                const dateTime = $post.find('.tgme_widget_message_date time').attr('datetime');
                const text = $post.find('.tgme_widget_message_text').text().trim();
                const views = $post.find('.tgme_widget_message_views').text().trim();

                // Извлекаем изображения
                let imageUrl = null;
                const photoElement = $post.find('.tgme_widget_message_photo_wrap');
                if (photoElement.length > 0) {
                    const style = photoElement.attr('style');
                    const match = style?.match(/background-image:url\('([^']+)'\)/);
                    if (match) {
                        imageUrl = match[1];
                    }
                }

                // Проверяем что пост содержит текст
                if (!text || text.length < 10) return;

                // Фильтруем только русскоязычные посты
                if (!this.isRussianText(text)) return;

                const post = {
                    id: Buffer.from(`tg_${channel.id}_${postId || Date.now()}_${Math.random()}`).toString('base64'),
                    title: this.extractTitle(text),
                    description: this.cleanText(text),
                    imageUrl: imageUrl,
                    sourceUrl: `https://t.me/${channel.username}/${postId?.split('/')[1] || ''}`,
                    publishedAt: this.formatTelegramDate(dateTime),
                    rawDate: dateTime,
                    source: {
                        id: channel.id,
                        name: channel.name,
                        type: 'Telegram'
                    },
                    category: channel.category,
                    viewCount: this.parseViews(views),
                    isLiked: false,
                    platform: 'telegram'
                };

                posts.push(post);
            });

            console.log(`  ✓ ${channel.name}: найдено ${posts.length} постов`);
            return posts;

        } catch (error) {
            console.error(`Ошибка парсинга ${channel.name}:`, error.message);
            return [];
        }
    }

    // Проверка русского языка
    isRussianText(text) {
        if (!text) return false;
        const cyrillicCount = (text.match(/[а-яё]/gi) || []).length;
        const totalLetters = (text.match(/[а-яёa-z]/gi) || []).length;
        return cyrillicCount > 0 && totalLetters > 0 && (cyrillicCount / totalLetters) > 0.3;
    }

    // Извлечение заголовка из текста
    extractTitle(text) {
        if (!text) return 'Без заголовка';

        // Берем первое предложение или первые 100 символов
        const sentences = text.split(/[.!?]\s+/);
        let title = sentences[0] || text;

        if (title.length > 100) {
            title = title.substring(0, 97) + '...';
        }

        return title.trim();
    }

    // Очистка текста от лишних символов
    cleanText(text) {
        return text
            .replace(/[\n\r\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 500);
    }

    // Парсинг количества просмотров
    parseViews(viewsText) {
        if (!viewsText) return Math.floor(Math.random() * 500) + 100;

        const match = viewsText.match(/(\d+(?:\.\d+)?)\s*([KMкм]?)/i);
        if (match) {
            const number = parseFloat(match[1]);
            const suffix = match[2].toLowerCase();

            switch (suffix) {
                case 'k':
                case 'к':
                    return Math.floor(number * 1000);
                case 'm':
                case 'м':
                    return Math.floor(number * 1000000);
                default:
                    return Math.floor(number);
            }
        }

        return Math.floor(Math.random() * 500) + 100;
    }

    // Форматирование даты Telegram
    formatTelegramDate(dateString) {
        if (!dateString) return 'Неизвестно';

        const publishDate = new Date(dateString);
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

    // Основная функция парсинга всех каналов
    async fetchTelegramNews() {
        console.log('\n=== НАЧИНАЕМ ПАРСИНГ TELEGRAM КАНАЛОВ ===');
        const allPosts = [];

        for (const channel of this.channels) {
            const posts = await this.parseChannel(channel);
            allPosts.push(...posts);

            // Небольшая задержка между запросами
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Удаляем дубликаты и сортируем
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

    // Получение кэшированных новостей
    getCachedNews() {
        return {
            data: this.cache,
            total: this.cache.length,
            lastUpdated: this.lastUpdated,
            source: 'telegram'
        };
    }

    // Статистика
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

module.exports = TelegramParser;
