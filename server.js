const express = require('express');
const RSSParser = require('rss-parser');
const axios = require('axios');
const cors = require('cors');

// Подключаем переменные окружения
require('dotenv').config();

// Подключаем парсеры
const TelegramParser = require('./telegramParser'); // Старый парсер как fallback
const TelegramBotParser = require('./TelegramBotParser'); // Новый Bot API парсер

const app = express();
const parser = new RSSParser();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Кэш для новостей
let newsCache = [];
let lastUpdated = null;

// Инициализируем парсеры с fallback логикой
let telegramParser;
let usingBotAPI = false;

async function initializeTelegramParsers() {
    console.log('\n=== ИНИЦИАЛИЗАЦИЯ TELEGRAM ПАРСЕРОВ ===');

    // Пытаемся инициализировать Bot API парсер
    if (process.env.TELEGRAM_BOT_TOKEN) {
        try {
            telegramParser = new TelegramBotParser();

            // Тестируем доступность Bot API
            const testResponse = await axios.get(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
                { timeout: 5000 }
            );

            if (testResponse.data && testResponse.data.ok) {
                console.log('✅ Telegram Bot API инициализирован успешно');
                console.log(`Bot: ${testResponse.data.result.first_name} (@${testResponse.data.result.username})`);
                usingBotAPI = true;
                return;
            }
        } catch (error) {
            console.log('❌ Telegram Bot API недоступен:', error.message);
        }
    } else {
        console.log('⚠️  TELEGRAM_BOT_TOKEN не найден в переменных окружения');
    }

    // Fallback на старый парсер
    console.log('🔄 Переключаемся на веб-скрапинг парсер (fallback)');
    telegramParser = new TelegramParser();
    usingBotAPI = false;
    console.log('=========================================\n');
}

// Остальной код (функции RSS парсинга, endpoints и т.д.) - такой же как в оригинале

// Нижегородские источники новостей (проверенные)
const sources = [
    {
        id: 'vremyan',
        name: 'Время Н',
        url: 'https://www.vremyan.ru/rss/news.rss',
        type: 'RSS',
        baseUrl: 'https://www.vremyan.ru'
    },
    {
        id: 'niann',
        name: 'НИА "Нижний Новгород"',
        url: 'https://www.niann.ru/rss.xml',
        type: 'RSS',
        baseUrl: 'https://www.niann.ru'
    },
    {
        id: 'nta_pfo',
        name: 'НТА Приволжье',
        url: 'https://nta-pfo.ru/rss/',
        type: 'RSS',
        baseUrl: 'https://nta-pfo.ru'
    },
    {
        id: 'vgoroden',
        name: 'В городе N',
        url: 'https://www.vgoroden.ru/rss/',
        type: 'RSS',
        baseUrl: 'https://www.vgoroden.ru'
    }
];

// Функция для определения русского языка
function isRussianText(text) {
    if (!text) return false;
    const cyrillicCount = (text.match(/[а-яё]/gi) || []).length;
    const totalLetters = (text.match(/[а-яёa-z]/gi) || []).length;
    return cyrillicCount > 0 && totalLetters > 0 && (cyrillicCount / totalLetters) > 0.3;
}

// Функция для проверки региона новости
async function checkNewsRegion(url, sourceId) {
    try {
        const response = await axios.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;

        // Специальная проверка для НТА Приволжье
        if (sourceId === 'nta_pfo') {
            const regionMatch = html.match(/<span class="region">Регион:\s*([^<]+)<\/span>/i);
            if (regionMatch) {
                const region = regionMatch[1].trim();
                console.log(`    Регион новости: ${region}`);
                return region.toLowerCase().includes('нижний новгород') ||
                    region.toLowerCase().includes('нижегородская');
            }
            const nnMentions = html.match(/нижн(ий|его)\s+новгород/gi);
            return nnMentions && nnMentions.length > 0;
        }
        return true;

    } catch (error) {
        console.log(`    Ошибка проверки региона для ${url}:`, error.message);
        return sourceId !== 'nta_pfo';
    }
}

// Функция для извлечения изображения из HTML страницы
async function extractImageFromUrl(url, sourceId) {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;
        let imageUrl = null;

        // Специфичные селекторы для каждого нижегородского сайта
        switch (sourceId) {
            case 'vremyan':
                const vremyanMatch = html.match(/<meta property="og:image" content="([^"]+)"/i) ||
                    html.match(/<img[^>]+class="[^"]*article[^"]*"[^>]+src="([^"]+)"/i);
                if (vremyanMatch) {
                    imageUrl = vremyanMatch[1];
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        imageUrl = 'https://www.vremyan.ru' + imageUrl;
                    }
                }
                break;

            case 'niann':
                const niannMatch = html.match(/<meta property="og:image" content="([^"]+)"/i) ||
                    html.match(/<img[^>]+class="[^"]*news[^"]*"[^>]+src="([^"]+)"/i);
                if (niannMatch) {
                    imageUrl = niannMatch[1];
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        imageUrl = 'https://www.niann.ru' + imageUrl;
                    }
                }
                break;

            case 'nta_pfo':
                const ntaMatch = html.match(/<meta property="og:image" content="([^"]+)"/i) ||
                    html.match(/<img[^>]+class="[^"]*photo[^"]*"[^>]+src="([^"]+)"/i);
                if (ntaMatch) {
                    imageUrl = ntaMatch[1];
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        imageUrl = 'https://nta-pfo.ru' + imageUrl;
                    }
                }
                break;

            case 'vgoroden':
                const vgorodenMatch = html.match(/<meta property="og:image" content="([^"]+)"/i) ||
                    html.match(/<img[^>]+class="[^"]*article[^"]*"[^>]+src="([^"]+)"/i);
                if (vgorodenMatch) {
                    imageUrl = vgorodenMatch[1];
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        imageUrl = 'https://www.vgoroden.ru' + imageUrl;
                    }
                }
                break;
        }

        // Fallback - ищем og:image
        if (!imageUrl) {
            const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
            if (ogMatch) {
                imageUrl = ogMatch[1];
            }
        }

        return imageUrl;
    } catch (error) {
        console.log(`    Ошибка извлечения изображения для ${url}:`, error.message);
        return null;
    }
}

// Функция парсинга новостей
async function fetchNews() {
    const allNews = [];

    console.log('Начинаем парсинг нижегородских новостей...');

    for (const source of sources) {
        try {
            console.log(`Пытаемся парсить ${source.name} (${source.url})...`);

            const possibleUrls = [
                source.url,
                `${source.baseUrl}/rss.xml`,
                `${source.baseUrl}/feed/`,
                `${source.baseUrl}/rss/`,
                `${source.baseUrl}/news.rss`
            ];

            let feedParsed = false;

            for (const tryUrl of possibleUrls) {
                try {
                    console.log(`  Пробуем URL: ${tryUrl}`);
                    const feed = await parser.parseURL(tryUrl);

                    console.log(`  ✓ Успешно! Найдено ${feed.items.length} новостей`);

                    let processedCount = 0;
                    let regionFilteredCount = 0;

                    for (const item of feed.items.slice(0, 20)) {
                        if (!isRussianText(item.title)) {
                            continue;
                        }

                        if (source.id === 'nta_pfo' && item.link) {
                            console.log(`    Проверяем регион для: ${item.title.substring(0, 60)}...`);
                            const isNizhnyNovgorod = await checkNewsRegion(item.link, source.id);

                            if (!isNizhnyNovgorod) {
                                regionFilteredCount++;
                                console.log(`    ✗ Отфильтровано (другой регион)`);
                                continue;
                            }
                            console.log(`    ✓ Нижний Новгород`);
                        }

                        let imageUrl = null;
                        if (item.enclosure && item.enclosure.url) {
                            imageUrl = item.enclosure.url;
                        } else if (item.content) {
                            const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/i);
                            if (imgMatch) {
                                imageUrl = imgMatch[1];
                            }
                        }

                        if (!imageUrl && item.link) {
                            imageUrl = await extractImageFromUrl(item.link, source.id);
                        }

                        const newsItem = {
                            id: Buffer.from(item.link || `${source.id}_${Date.now()}_${Math.random()}`).toString('base64'),
                            title: item.title || '',
                            description: item.contentSnippet || item.summary || item.content || '',
                            imageUrl: imageUrl,
                            sourceUrl: item.link || '',
                            publishedAt: formatPublishDate(item.pubDate),
                            rawDate: item.pubDate,
                            source: {
                                id: source.id,
                                name: source.name,
                                type: source.type
                            },
                            category: 'Нижний Новгород',
                            viewCount: Math.floor(Math.random() * 800) + 100,
                            isLiked: false,
                            platform: 'rss'
                        };

                        allNews.push(newsItem);
                        processedCount++;

                        if (processedCount >= 15) break;
                    }

                    console.log(`  Обработано: ${processedCount} новостей`);
                    if (regionFilteredCount > 0) {
                        console.log(`  Отфильтровано по региону: ${regionFilteredCount} новостей`);
                    }

                    feedParsed = true;
                    break;
                } catch (urlError) {
                    console.log(`    ✗ Не удалось: ${urlError.message}`);
                    continue;
                }
            }

            if (!feedParsed) {
                console.log(`  ✗ Все попытки неуспешны для ${source.name}`);
            }

        } catch (error) {
            console.error(`Общая ошибка парсинга ${source.name}:`, error.message);
        }

        // Пауза между источниками
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const uniqueNews = allNews.filter((item, index, self) =>
        index === self.findIndex(t => t.sourceUrl === item.sourceUrl)
    );

    uniqueNews.sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));

    newsCache = uniqueNews.slice(0, 100);
    lastUpdated = new Date();

    console.log(`\n=== ИТОГ RSS ===`);
    console.log(`Всего загружено ${newsCache.length} нижегородских новостей`);
    console.log(`С изображениями: ${newsCache.filter(item => item.imageUrl).length}`);

    const sourceStats = {};
    newsCache.forEach(item => {
        sourceStats[item.source.name] = (sourceStats[item.source.name] || 0) + 1;
    });

    console.log('Статистика по источникам:');
    Object.entries(sourceStats).forEach(([name, count]) => {
        console.log(`  ${name}: ${count} новостей`);
    });
    console.log('===============\n');
}

// Улучшенная функция для парсинга Telegram с fallback
async function fetchTelegramNews() {
    console.log(`\n=== TELEGRAM ПАРСИНГ (${usingBotAPI ? 'Bot API' : 'Web Scraping'}) ===`);

    try {
        if (usingBotAPI) {
            const result = await telegramParser.fetchTelegramNews();

            if (result && result.length > 0) {
                console.log('✅ Bot API парсинг успешен');
                return result;
            }

            console.log('⚠️  Bot API не вернул результатов, переключаемся на веб-скрапинг...');

            if (!(telegramParser instanceof TelegramParser)) {
                telegramParser = new TelegramParser();
                usingBotAPI = false;
            }
        }

        const result = await telegramParser.fetchTelegramNews();
        return result;

    } catch (error) {
        console.error('❌ Ошибка Telegram парсинга:', error.message);

        if (usingBotAPI) {
            console.log('🔄 Пытаемся fallback на веб-скрапинг...');
            try {
                telegramParser = new TelegramParser();
                usingBotAPI = false;
                return await telegramParser.fetchTelegramNews();
            } catch (fallbackError) {
                console.error('❌ Fallback тоже упал:', fallbackError.message);
                return [];
            }
        }

        return [];
    }
}

function formatPublishDate(dateString) {
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

// API Endpoints
app.get('/health', (req, res) => {
    const sourceStats = {};
    newsCache.forEach(item => {
        sourceStats[item.source.name] = (sourceStats[item.source.name] || 0) + 1;
    });

    const telegramStats = telegramParser ? telegramParser.getStats() : { total: 0 };

    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        telegram_mode: usingBotAPI ? 'Bot API' : 'Web Scraping',
        environment: process.env.NODE_ENV || 'development',
        rss: {
            cachedNews: newsCache.length,
            lastUpdated: lastUpdated,
            sources: sourceStats,
            workingSources: Object.keys(sourceStats).length
        },
        telegram: {
            cachedNews: telegramStats.total || 0,
            lastUpdated: telegramStats.lastUpdated,
            channels: telegramStats.channels || {},
            workingChannels: Object.keys(telegramStats.channels || {}).length,
            mode: usingBotAPI ? 'Bot API' : 'Web Scraping'
        }
    });
});

app.get('/api/news/:city', (req, res) => {
    const { city } = req.params;

    if (city === 'nizhny-novgorod' || city === 'нижний-новгород') {
        res.json({
            success: true,
            data: newsCache,
            total: newsCache.length,
            city: 'Нижний Новгород',
            source: 'rss',
            timestamp: new Date().toISOString()
        });
    } else {
        res.json({
            success: true,
            data: [],
            total: 0,
            city: city,
            message: 'Новости для этого города пока не доступны',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/telegram/news', (req, res) => {
    const telegramNews = telegramParser ? telegramParser.getCachedNews() : { data: [], total: 0 };
    res.json({
        success: true,
        data: telegramNews.data || [],
        total: telegramNews.total || 0,
        source: 'telegram',
        mode: usingBotAPI ? 'Bot API' : 'Web Scraping',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/telegram/stats', (req, res) => {
    const stats = telegramParser ? telegramParser.getStats() : { total: 0 };
    res.json({
        ...stats,
        mode: usingBotAPI ? 'Bot API' : 'Web Scraping'
    });
});

app.get('/api/news/combined/:city', (req, res) => {
    const { city } = req.params;

    if (city === 'nizhny-novgorod' || city === 'нижний-новгород') {
        const rssNews = newsCache;
        const telegramNews = telegramParser ? telegramParser.getCachedNews().data : [];

        const combined = [...rssNews, ...telegramNews]
            .sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate))
            .slice(0, 100);

        res.json({
            success: true,
            data: combined,
            total: combined.length,
            sources: {
                rss: rssNews.length,
                telegram: telegramNews.length
            },
            telegram_mode: usingBotAPI ? 'Bot API' : 'Web Scraping',
            city: 'Нижний Новгород',
            timestamp: new Date().toISOString()
        });
    } else {
        res.json({
            success: true,
            data: [],
            total: 0,
            city: city,
            message: 'Новости для этого города пока не доступны',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/news/stats', (req, res) => {
    const sourceStats = {};
    newsCache.forEach(item => {
        const sourceName = item.source.name;
        sourceStats[sourceName] = (sourceStats[sourceName] || 0) + 1;
    });

    const telegramStats = telegramParser ? telegramParser.getStats() : { total: 0 };

    res.json({
        rss: {
            total: newsCache.length,
            sources: sourceStats,
            lastUpdated: lastUpdated,
            withImages: newsCache.filter(item => item.imageUrl).length,
            city: 'Нижний Новгород',
            workingSources: Object.keys(sourceStats).length
        },
        telegram: {
            ...telegramStats,
            mode: usingBotAPI ? 'Bot API' : 'Web Scraping'
        }
    });
});

app.post('/api/telegram/switch-mode', async (req, res) => {
    try {
        await initializeTelegramParsers();
        res.json({
            success: true,
            new_mode: usingBotAPI ? 'Bot API' : 'Web Scraping',
            message: `Переключено на ${usingBotAPI ? 'Bot API' : 'веб-скрапинг'}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Окружение: ${process.env.NODE_ENV || 'development'}`);

    // Инициализируем Telegram парсеры
    await initializeTelegramParsers();

    console.log('Загружаем новости Нижнего Новгорода...');

    fetchNews();

    setTimeout(() => {
        fetchTelegramNews();
    }, 5000);

    setInterval(fetchNews, 20 * 60 * 1000);
    setInterval(() => fetchTelegramNews(), 30 * 60 * 1000);
});
