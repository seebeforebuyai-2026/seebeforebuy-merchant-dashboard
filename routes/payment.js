/**
 * Payment routes (Cashfree)
 * POST /api/payment/create-order  — creates Cashfree order
 * POST /api/payment/verify        — verifies payment + upgrades plan via EC2 backend
 */
const express = require('express');
const router = express.Router();
const { Cashfree } = require('cashfree-pg');
const { requireAuth } = require('./auth');

const BACKEND_URL = process.env.BACKEND_URL || 'https://seebeforebuy.in';

// Init Cashfree
Cashfree.XClientId     = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment  = process.env.CASHFREE_ENV === 'PROD'
  ? Cashfree.Environment.PRODUCTION
  : Cashfree.Environment.SANDBOX;

// Plans config
const PLANS = {
  starter: { amount: 500,  images: 300,  label: 'Starter' },
  growth:  { amount: 1000, images: 1000, label: 'Growth'  },
  pro:     { amount: 2000, images: 3000, label: 'Pro'      },
};

// ── POST /api/payment/create-order ────────────────────────────────────────────
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { plan_id } = req.body;
    const plan = PLANS[plan_id];
    if (!plan) return res.status(400).json({ error: 'Invalid plan. Choose: starter, growth, pro' });

    const { shop_domain, shop_email } = req.shop;
    const orderId = `SBB_${shop_domain.split('.')[0]}_${Date.now()}`;
    const returnUrl = `${process.env.DASHBOARD_URL}/payment-success.html?order_id={order_id}&plan=${plan_id}`;

    const request = {
      order_amount: plan.amount,
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: shop_domain.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50),
        customer_email: shop_email,
        customer_phone: '9999999999',
      },
      order_meta: { return_url: returnUrl },
      order_note: `See Before Buy — ${plan.label} Plan (30 days, ${plan.images} images)`,
    };

    const response = await Cashfree.PGCreateOrder('2023-08-01', request);
    const { payment_session_id, order_id } = response.data;

    console.log(`💳 Order created: ${order_id} — ₹${plan.amount} — ${shop_domain}`);

    res.json({ success: true, payment_session_id, order_id, plan });

  } catch (err) {
    console.error('❌ Create order error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create order', message: err.message });
  }
});

// ── POST /api/payment/verify ──────────────────────────────────────────────────
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { order_id, plan_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id is required' });

    const plan = PLANS[plan_id];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const { shop_domain } = req.shop;

    // 1. Fetch order from Cashfree to verify payment status
    const response = await Cashfree.PGFetchOrder('2023-08-01', order_id);
    const order = response.data;

    console.log(`🔍 Order ${order_id} status: ${order.order_status}`);

    if (order.order_status !== 'PAID') {
      return res.json({
        success: false,
        status: order.order_status,
        message: 'Payment not completed',
      });
    }

    // 2. Payment confirmed — upgrade plan via the EC2 backend
    const upgradeRes = await fetch(`${BACKEND_URL}/api/shop-status/upgrade-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop_domain,
        plan_type: plan_id,
        images_limit: plan.images,
      }),
    });

    const upgradeData = await upgradeRes.json();
    if (!upgradeRes.ok) {
      console.error('❌ Upgrade plan failed:', upgradeData);
      return res.status(500).json({ error: 'Payment verified but plan upgrade failed. Contact support.' });
    }

    console.log(`✅ Plan upgraded: ${shop_domain} → ${plan_id} (${plan.images} images)`);

    res.json({
      success: true,
      message: `${plan.label} Plan activated! ${plan.images} images unlocked for 30 days.`,
      plan: plan_id,
      images_limit: plan.images,
    });

  } catch (err) {
    console.error('❌ Verify payment error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to verify payment', message: err.message });
  }
});

module.exports = router;
