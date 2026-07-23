/**
 * Dashboard data route: GET /api/dashboard
 * Fetches data from the live EC2 backend (seebeforebuy.in)
 * so we don't duplicate DynamoDB logic here.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');

const BACKEND_URL = process.env.BACKEND_URL || 'https://seebeforebuy.in';

// ── GET /api/dashboard ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { shop_domain } = req.shop;

    // Call the live backend to get all shop data + metrics
    const response = await fetch(`${BACKEND_URL}/api/shop-status/${shop_domain}`);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.message || 'Backend error' });
    }

    const data = await response.json();

    if (!data.accountExists) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = data.shopStatus;

    // Calculate plan expiry (30 days from plan_activated_at)
    const planExpiresAt = shop.plan_activated_at
      ? new Date(new Date(shop.plan_activated_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const daysLeft = planExpiresAt
      ? Math.max(0, Math.ceil((new Date(planExpiresAt) - new Date()) / (1000 * 60 * 60 * 24)))
      : null;

    // Top products — map from backend format to simpler format
    const topProducts = (data.top_products || []).map(p => ({
      name: p.product_name,
      count: p.try_on_count,
    }));

    res.json({
      success: true,
      shop: {
        domain: shop.shop_domain,
        name: shop.shop_name || shop.shop_domain,
        email: shop.shop_email,
        plan: shop.plan_type || 'free',
        plan_expires_at: planExpiresAt,
        days_left: daysLeft,
        app_status: shop.app_status || 'disabled',
      },
      usage: data.usage,
      metrics: {
        try_on_generated: data.metrics?.try_on_generated || 0,
        unique_users: data.metrics?.unique_users || 0,
        add_to_cart: data.metrics?.add_to_cart_count || 0,
        add_to_cart_rate: data.metrics?.add_to_cart_rate || 0,
        total_revenue: data.metrics?.total_revenue ?? null,
        total_orders: data.metrics?.total_orders ?? null,
        revenue_per_try_on: data.metrics?.revenue_per_try_on ?? null,
        avg_try_on_per_product: data.metrics?.avg_try_on_per_product ?? null,
        credit_remaining: data.metrics?.credit_remaining ?? null,
        credit_used: data.metrics?.credit_used ?? null,
      },
      top_products: topProducts,
    });

  } catch (err) {
    console.error('❌ Dashboard error:', err.message);
    res.status(500).json({ error: 'Failed to load dashboard', message: err.message });
  }
});

module.exports = router;
