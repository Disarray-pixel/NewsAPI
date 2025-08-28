const express = require('express');
const { getNews, getNewsStats } = require('../services/newsService');
const router = express.Router();

// Получение новостей для Нижнего Новгорода
router.get('/nizhny-novgorod', async (req, res) => {
    try {
        const { category, limit = 20, offset = 0 } = req.query;
        const news = await getNews('nizhny-novgorod', {
            category,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            data: news,
            total: news.length,
            city: 'nizhny-novgorod',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch news',
            message: error.message
        });
    }
});

// Статистика API
router.get('/stats', async (req, res) => {
    try {
        const stats = await getNewsStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get stats'
        });
    }
});

module.exports = router;
