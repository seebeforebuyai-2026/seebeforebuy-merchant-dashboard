/**
 * Payment routes (Cashfree)
 * POST /api/payment/create-order
 * POST /api/payment/verify
 */
const express = require('express');
const router = express.Router();
const { Cashfree } = require('cashfree-pg');
const { docClient, TABLES } = require('../config/dynamodb');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireAuth } = require('./auth');

// Init Cashfree
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment = process.env.CASHFREE_ENV === 'PROD'
  ? Cashfree.Environment.PRODUCTION
  : Cashfree.Environment.SANDBOX;

// Plans config
const PLANS = {
  starter:  { amount: 500,  images: 300,  label: 'Starter' },
  growth:   { amount: 1000, images: 1000, label: 'Growth' },
  pro:      { amount: 2000, images: 3000, label: 'Pro' },
};

// ── POST /api/payment/create-order ────────────────────────────────────────────
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { plan_id } = req.body;
    const plan = PLANS[plan_id];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const { shop_domain, shop_email } = req.shop;
    const orderId = `SBB_${shop_domain.split('.')[0]}_${Date.now()}`;

    const request = {
      order_amount: plan.amount,
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: shop_domain.replace(/[^a-zA-Z0-9]/g, '_'),
        customer_email: shop_email,
        customer_phone: '9999999999', // required field — merchant can update later
      },
      order_meta: {
        return_url: `${process.env.DASHBOARD_URL}/payment-success.html?order_id={order_id}&plan=${plan_id}`,
        notify_url: `${process.env.DASHBOARD_URL}/api/payment/webhook`,
      },
      order_note: `See Before Buy - ${plan.label} Plan (30 days, ${plan.images} images)`,
    };

    const response = await Cashfree.PGCreateOrder('2023-08-01', request);
    const { payment_session_id, order_id } = response.data;

    console.log(`💳 Order created: ${order_id} for ${shop_domain} — ₹${plan.amount}`);

    res.json({
      success: true,
      payment_session_id,
      order_id,
      plan,
    });

  } catch (err) {
    console.error('❌ Create order error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create order', message: err.message });
  }
});

// ── POST /api/payment/verify ───────────────────────────────────────────────────
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { order_id, plan_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id is required' });

    const { shop_domain } = req.shop;
    const plan = PLANS[plan_id];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    // Fetch order from Cashfree
    const response = await Cashfree.PGFetchOrder('2023-08-01', order_id);
    const order = response.data;

    console.log(`🔍 Order status for ${order_id}: ${order.order_status}`);

    if (order.order_status !== 'PAID') {
      return res.json({ success: false, status: order.order_status, message: 'Payment not completed' });
    }

    // Payment confirmed — upgrade the plan in DynamoDB
    const now = new Date().toISOString();
    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
      UpdateExpression: `
        SET plan_type = :plan,
            images_limit = :limit,
            images_used = :zero,
            plan_activated_at = :now,
            subscription_status = :status,
            last_payment_order_id = :order_id,
            last_payment_amount = :amount,
            updated_at = :now
      `,
      ExpressionAttributeValues: {
        ':plan': plan_id,
        ':limit': plan.images,
        ':zero': 0,
        ':now': now,
        ':status': 'active',
        ':order_id': order_id,
        ':amount': plan.amount,
      },
    }));

    console.log(`✅ Plan upgraded: ${shop_domain} → ${plan_id} (${plan.images} images)`);

    res.json({
      success: true,
      message: `Plan upgraded to ${plan.label}! ${plan.images} images unlocked for 30 days.`,
      plan: plan_id,
      images_limit: plan.images,
    });

  } catch (err) {
    console.error('❌ Verify payment error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to verify payment', message: err.message });
  }
});

module.exports = router;
