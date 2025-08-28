const NIZHNY_SOURCES = {
    rss: [
        {
            id: 'tass',
            name: 'ТАСС',
            url: 'https://tass.com/rss/v2.xml',
            category: 'general',
            priority: 1,
            enabled: true
        },
        {
            id: 'rt_russia',
            name: 'RT Россия',
            url: 'https://rt.com/rss/russia/',
            category: 'general',
            priority: 2,
            enabled: true
        },
        {
            id: 'ria',
            name: 'РИА Новости',
            url: 'https://ria.ru/export/rss2/index.xml',
            category: 'general',
            priority: 3,
            enabled: true
        },
        {
            id: 'mk_russia',
            name: 'Московский Комсомолец',
            url: 'https://www.mk.ru/rss/index.xml',
            category: 'general',
            priority: 4,
            enabled: true
        },
        {
            id: 'rg',
            name: 'Российская газета',
            url: 'https://rg.ru/xml/index.xml',
            category: 'politics',
            priority: 5,
            enabled: true
        }
    ]
};

module.exports = { NIZHNY_SOURCES };
