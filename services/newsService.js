const Parser = require('rss-parser');
const { NIZHNY_SOURCES } = require('../config/sources');

const parser = new Parser({
    customFields: {
        item: ['media:content', 'enclosure', 'description', 'media:thumbnail']
    },
    timeout: 10000 // 10 секунд таймаут
});

let newsCache = [];
let lastUpdate = null;

async function parseRSSFeed(source) {
    try {
        console.log(`Parsing RSS from ${source.name} (${source.url})...`);

        const feed = await parser.parseURL(source.url);

        if (!feed.items || feed.items.length === 0) {
            console.log(`⚠️  ${source.name}: No items found in feed`);
            return [];
        }

        const items = feed.items.map(item => ({
            id: generateId(item.link || item.guid || item.title),
            title: cleanText(item.title || 'Без заголовка'),
            description: cleanDescription(item.description || item.summary || item.content || item.contentSnippet || ''),
            imageUrl: extractImageUrl(item),
            sourceUrl: item.link || item.guid,
            publishedAt: formatDate(item.pubDate || item.isoDate),
            rawDate: new Date(item.pubDate || item.isoDate || Date.now()),
            source: {
                id: source.id,
                name: source.name,
                type: 'RSS'
            },
            category: source.category,
            viewCount: Math.floor(Math.random() * 1000) + 50, // Временно случайные просмотры
            isLiked: false
        })).filter(item => item.title !== 'Без заголовка' && item.sourceUrl); // Фильтруем невалидные новости

        console.log(`✅ Parsed ${items.length} valid items from ${source.name}`);
        return items;
    } catch (error) {
        console.error(`❌ Error parsing RSS from ${source.name}:`, error.message);

        // Более детальная информация об ошибке
        if (error.code === 'ENOTFOUND') {
            console.error(`   DNS lookup failed for ${source.url}`);
        } else if (error.response) {
            console.error(`   HTTP ${error.response.status}: ${error.response.statusText}`);
        }

        return [];
    }
}



async function updateNewsCache() {
    try {
        console.log('\n🔄 Starting news cache update...');
        const allNews = [];

        // Парсим только включенные источники
        const enabledSources = NIZHNY_SOURCES.rss.filter(source => source.enabled);

        for (const source of enabledSources) {
            const news = await parseRSSFeed(source);
            allNews.push(...news);

            // Небольшая пауза между запросами
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Фильтруем, сортируем и ограничиваем количество
        newsCache = removeDuplicates(allNews)
            .filter(news => news.title && news.sourceUrl) // Только валидные новости
            .sort((a, b) => b.rawDate - a.rawDate) // Сортируем по дате (новые сверху)
            .slice(0, 100); // Ограничиваем 100 новостями

        lastUpdate = new Date();
        console.log(`✅ Cache updated: ${newsCache.length} news items from ${enabledSources.length} sources`);
        console.log(`📅 Last update: ${lastUpdate.toLocaleString('ru-RU')}\n`);

    } catch (error) {
        console.error('❌ Error updating news cache:', error);
    }
}

async function getNews(city, options = {}) {
    const { category, limit = 20, offset = 0 } = options;

    let filteredNews = [...newsCache];

    // Фильтруем по категории если указана
    if (category && category !== 'all') {
        filteredNews = filteredNews.filter(news => news.category === category);
    }

    // Применяем offset и limit
    const result = filteredNews.slice(offset, offset + limit);

    console.log(`📰 Returning ${result.length} news items (category: ${category || 'all'}, offset: ${offset})`);
    return result;
}

async function getNewsStats() {
    const stats = {
        totalNews: newsCache.length,
        lastUpdate: lastUpdate,
        sourceStats: {},
        categoryStats: {}
    };

    // Статистика по источникам
    newsCache.forEach(news => {
        const sourceName = news.source.name;
        stats.sourceStats[sourceName] = (stats.sourceStats[sourceName] || 0) + 1;
    });

    // Статистика по категориям
    newsCache.forEach(news => {
        const category = news.category;
        stats.categoryStats[category] = (stats.categoryStats[category] || 0) + 1;
    });

    return stats;
}

// Вспомогательные функции
function generateId(url) {
    if (!url) return Math.random().toString(36).substring(7);
    return Buffer.from(url).toString('base64').substring(0, 16);
}

function cleanText(text) {
    return text
        .replace(/<[^>]*>/g, '') // Удаляем HTML теги
        .replace(/&[^;]+;/g, ' ') // Удаляем HTML entities
        .replace(/\s+/g, ' ') // Заменяем множественные пробелы на один
        .trim();
}

function cleanDescription(description) {
    const cleaned = cleanText(description);
    return cleaned.length > 200 ? cleaned.substring(0, 200) + '...' : cleaned;
}

function extractImageUrl(item) {
    // Проверяем различные поля RSS для изображений

    // media:content
    if (item['media:content'] && item['media:content']['$'] && item['media:content']['$'].url) {
        return item['media:content']['$'].url;
    }

    // enclosure
    if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
        return item.enclosure.url;
    }

    // media:thumbnail
    if (item['media:thumbnail'] && item['media:thumbnail']['$'] && item['media:thumbnail']['$'].url) {
        return item['media:thumbnail']['$'].url;
    }

    // Ищем изображение в description/content
    const content = item.description || item.content || '';
    const imgMatch = content.match(/<img[^>]+src=["']([^"'>]+)["']/i);
    if (imgMatch && imgMatch[1]) {
        return imgMatch[1];
    }

    return null; // Нет изображения
}

function formatDate(dateString) {
    if (!dateString) return 'Неизвестно';

    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Неизвестно';

    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));

    if (diffInMinutes < 1) return 'Только что';
    if (diffInMinutes < 60) return `${diffInMinutes} мин назад`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} ч назад`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays} дн назад`;

    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function removeDuplicates(news) {
    const seen = new Set();
    return news.filter(item => {
        const key = item.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (seen.has(key) || key.length < 10) return false; // Убираем короткие заголовки
        seen.add(key);
        return true;
    });
}

module.exports = {
    getNews,
    getNewsStats,
    updateNewsCache
};
