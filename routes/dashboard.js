/**
 * Dashboard data route: GET /api/dashboard
 * Returns all metrics for the logged-in merchant
 */
const express = require('express');
const router = express.Router();
const { docClient, TABLES } = require('../config/dynamodb');
const { GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { requireAuth } = require('./auth');

// ── GET /api/dashboard ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { shop_domain } = req.shop;

    // Get shop data
    const shopResult = await docClient.send(new GetCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
    }));

    const shop = shopResult.Item;
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    // Get usage logs for stats
    let logs = [];
    try {
      const logsResult = await docClient.send(new QueryCommand({
        TableName: TABLES.USAGE_LOGS,
        IndexName: 'shop_domain-created_at-index',
        KeyConditionExpression: 'shop_domain = :domain',
        ExpressionAttributeValues: { ':domain': shop_domain },
        ScanIndexForward: false,
        Limit: 1000,
      }));
      logs = logsResult.Items || [];
    } catch {
      // GSI may not exist in all envs — fall back to zero stats
      logs = [];
    }

    // Calculate stats
    const tryOnGenerated = logs.filter(l => l.event_type === 'image_generated').length;
    const addToCart = logs.filter(l => l.event_type === 'add_to_cart').length;
    const uniqueUsers = new Set(logs.map(l => l.session_id).filter(Boolean)).size;
    const addToCartRate = tryOnGenerated > 0
      ? ((addToCart / tryOnGenerated) * 100).toFixed(1)
      : '0.0';

    // Top products
    const productMap = {};
    logs.filter(l => l.event_type === 'image_generated').forEach(l => {
      const name = l.product_name || 'Unknown';
      productMap[name] = (productMap[name] || 0) + 1;
    });
    const topProducts = Object.entries(productMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Plan expiry (30-day from plan_activated_at)
    const planExpiresAt = shop.plan_activated_at
      ? new Date(new Date(shop.plan_activated_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const daysLeft = planExpiresAt
      ? Math.max(0, Math.ceil((new Date(planExpiresAt) - new Date()) / (1000 * 60 * 60 * 24)))
      : null;

    res.json({
      success: true,
      shop: {
        domain: shop.shop_domain,
        name: shop.shop_name,
        email: shop.shop_email,
        plan: shop.plan_type,
        plan_expires_at: planExpiresAt,
        days_left: daysLeft,
        app_status: shop.app_status || 'disabled',
      },
      usage: {
        used: shop.images_used || 0,
        limit: shop.images_limit || 50,
        remaining: (shop.images_limit || 50) - (shop.images_used || 0),
      },
      metrics: {
        try_on_generated: tryOnGenerated,
        unique_users: uniqueUsers,
        add_to_cart: addToCart,
        add_to_cart_rate: parseFloat(addToCartRate),
      },
      top_products: topProducts,
    });

  } catch (err) {
    console.error('❌ Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard', message: err.message });
  }
});

module.exports = router;
