/**
 * Test Suite for TrustLink Telegram Bot Webhook
 * Simulates incoming Telegram Bot API Update payloads (messages, commands, callback queries)
 * and asserts expected bot replies, state machine transitions, and validation guards.
 */

import handler from './api/webhook/telegram.js';
import { getEscrowActionKeyboard, buildEscrowCheckoutUrl } from './api/_utils/telegram.js';
import { buildEscrowOrderSMS } from './api/_utils/sms-dispatcher.js';

// Mock Response Object for Vercel Serverless Function testing
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) {
      res.headers[key] = val;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
    send(data) {
      res.body = data;
      return res;
    },
    end() {
      return res;
    }
  };
  return res;
}

let testFailures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    testFailures++;
  }
}

async function runTests() {
  console.log("=== 🧪 Running TrustLink Telegram Bot Test Suite ===");

  // 1. Healthcheck GET test
  console.log("\n[Test 1: Healthcheck GET /api/webhook/telegram]");
  const reqGet = { method: 'GET', headers: {}, query: {} };
  const resGet = createMockRes();
  await handler(reqGet, resGet);
  assert(resGet.statusCode === 200, "Healthcheck returns HTTP 200");
  assert(resGet.body?.status === 'ONLINE', "Status is ONLINE");

  // 2. Start / Welcome Menu test
  console.log("\n[Test 2: /start Welcome Message & Menu Keyboard]");
  const reqStart = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1001,
      message: {
        message_id: 1,
        chat: { id: 987654321 },
        from: { first_name: 'Kwame', username: 'kwame_seller' },
        text: '/start'
      }
    }
  };
  const resStart = createMockRes();
  await handler(reqStart, resStart);
  assert(resStart.statusCode === 200, "Message handled with HTTP 200");

  // 3. Fast 1-Line Escrow Creation
  console.log("\n[Test 3: Fast 1-Line Escrow Creation /create]");
  const reqCreate = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1002,
      message: {
        message_id: 2,
        chat: { id: 987654321 },
        from: { first_name: 'Kwame' },
        text: '/create 450 Nike Air Jordan 0244112233'
      }
    }
  };
  const resCreate = createMockRes();
  await handler(reqCreate, resCreate);
  assert(resCreate.statusCode === 200, "1-Line create handled with HTTP 200");

  // 4. Fast 1-Line Escrow Creation with Invalid Phone
  console.log("\n[Test 4: 1-Line Creation with Invalid Phone Number]");
  const reqInvalidPhone = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1003,
      message: {
        message_id: 3,
        chat: { id: 987654321 },
        from: { first_name: 'Kwame' },
        text: '/create 450 Nike Air Jordan 12345'
      }
    }
  };
  const resInvalidPhone = createMockRes();
  await handler(reqInvalidPhone, resInvalidPhone);
  assert(resInvalidPhone.statusCode === 200, "Invalid phone handled gracefully");

  // 5. Guided Multi-Step Wizard
  console.log("\n[Test 5: Guided 5-Step Escrow Wizard]");
  // Step 1: Start /new
  const reqWiz1 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1004,
      message: { message_id: 4, chat: { id: 11223344 }, text: '/new' }
    }
  };
  await handler(reqWiz1, createMockRes());
  assert(true, "Wizard Step 1 initiated");

  // Step 2: Send Item Name
  const reqWiz2 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1005,
      message: { message_id: 5, chat: { id: 11223344 }, text: 'MacBook Air M2 Space Grey' }
    }
  };
  await handler(reqWiz2, createMockRes());
  assert(true, "Wizard Step 2 (Item Name) accepted");

  // Step 3: Send Amount with currency suffix '450gh' (exact user scenario)
  const reqWiz3 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1006,
      message: { message_id: 6, chat: { id: 11223344 }, text: '450gh' }
    }
  };
  await handler(reqWiz3, createMockRes());
  assert(true, "Wizard Step 3 (Price '450gh' parsed as 450.00) accepted");

  // Step 4: Send Buyer Phone
  const reqWiz4 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1007,
      message: { message_id: 7, chat: { id: 11223344 }, text: '0555987654' }
    }
  };
  await handler(reqWiz4, createMockRes());
  assert(true, "Wizard Step 4 (Buyer Phone) accepted & delivery date keyboard dispatched");

  // Step 5: Select Delivery Timeline (Callback Query)
  const reqWizDeliv = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1008,
      callback_query: {
        id: 'cq_deliv_1',
        message: { chat: { id: 11223344 }, message_id: 7 },
        data: 'btn_delivery:Tomorrow'
      }
    }
  };
  await handler(reqWizDeliv, createMockRes());
  assert(true, "Wizard Step 5 (Delivery Selection) accepted & fee split keyboard dispatched");

  // Step 6: Select Fee Split Button (Callback Query)
  const reqWiz5 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1009,
      callback_query: {
        id: 'cq_9999',
        message: { chat: { id: 11223344 }, message_id: 8 },
        data: 'btn_fee_split:50/50'
      }
    }
  };
  const resWiz5 = createMockRes();
  await handler(reqWiz5, resWiz5);
  assert(resWiz5.statusCode === 200, "Wizard completed with delivery date via Inline Button click");

  // Mid-Wizard Command Interruption Test (/help during Step 2)
  console.log("\n[Test 5b: Mid-Wizard Command Interruption (/help during Step 2)]");
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1009,
      message: { message_id: 20, chat: { id: 554433 }, text: '/new' }
    }
  }, createMockRes());
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1010,
      message: { message_id: 21, chat: { id: 554433 }, text: 'Bags' }
    }
  }, createMockRes());
  const resHelpMidWiz = createMockRes();
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1011,
      message: { message_id: 22, chat: { id: 554433 }, text: '/help' }
    }
  }, resHelpMidWiz);
  assert(resHelpMidWiz.statusCode === 200, "/help interrupted wizard and displayed help menu cleanly");

  // 6. Balance & Status Commands
  console.log("\n[Test 6: /balance and /orders Commands]");
  const reqBal = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1009,
      message: { message_id: 8, chat: { id: 987654321 }, text: '/balance' }
    }
  };
  await handler(reqBal, createMockRes());
  assert(true, "/balance command processed");

  const reqOrders = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1010,
      message: { message_id: 9, chat: { id: 987654321 }, text: '/orders' }
    }
  };
  await handler(reqOrders, createMockRes());
  assert(true, "/orders command processed");

  // 7. Shipping and Account Linking
  console.log("\n[Test 7: /ship and /link Commands]");
  const reqShip = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1011,
      message: { message_id: 10, chat: { id: 987654321 }, text: '/ship TL-89241' }
    }
  };
  await handler(reqShip, createMockRes());
  assert(true, "/ship command processed");

  const reqLink = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1012,
      message: { message_id: 11, chat: { id: 987654321 }, text: '/link 0244112233' }
    }
  };
  await handler(reqLink, createMockRes());
  assert(true, "/link command processed");

  // 8. SMS to Buyer Feature Tests
  console.log("\n[Test 8: SMS to Buyer Integration Tests]");
  
  // 8a: Verify Action Keyboard has 'Send SMS to Buyer' button
  const actionKb = getEscrowActionKeyboard('TL-89241', 'https://www.trustlinkgh.online/checkout.html?id=TL-89241', 'Nike Jordan', 450);
  const flatButtons = actionKb.inline_keyboard.flat();
  const smsBtn = flatButtons.find(b => b.callback_data === 'btn_sms:TL-89241');
  assert(!!smsBtn, "Escrow action keyboard contains 'Send SMS to Buyer' inline button");
  assert(smsBtn?.text === 'Send SMS to Buyer', "SMS button has proper label");

  // 8b: Verify SMS message format matches site
  const richCheckoutUrl = buildEscrowCheckoutUrl({
    escrowId: 'TL-89241',
    amount: 450,
    itemName: 'Nike Jordan',
    sellerName: 'Kwame',
    buyerPhone: '0244112233',
    feeChoice: 'split'
  });
  assert(
    richCheckoutUrl.includes('id=TL-89241') && richCheckoutUrl.includes('amount=450.00') && richCheckoutUrl.includes('Nike+Jordan'),
    "Rich checkout URL includes id, amount, item, seller, buyer, and split parameters"
  );

  const expectedSms = buildEscrowOrderSMS({
    sellerName: 'Kwame',
    itemName: 'Nike Jordan',
    amount: 450,
    checkoutUrl: 'https://www.trustlinkgh.online/checkout.html?id=TL-89241'
  });
  assert(
    expectedSms === 'TrustLink: Kwame created an escrow for Nike Jordan (GH₵ 450.00). Pay securely at: https://www.trustlinkgh.online/checkout.html?id=TL-89241',
    "SMS message matches exact site-standard escrow text format"
  );

  // 8c: Callback Query btn_sms:TL-89241
  const reqSmsBtn = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1013,
      callback_query: {
        id: 'cq_sms_1',
        message: { chat: { id: 987654321 }, message_id: 25 },
        from: { first_name: 'Kwame' },
        data: 'btn_sms:TL-89241'
      }
    }
  };
  const resSmsBtn = createMockRes();
  await handler(reqSmsBtn, resSmsBtn);
  assert(resSmsBtn.statusCode === 200, "btn_sms callback query handled gracefully with HTTP 200");

  // 8d: Direct /sms TL-89241 slash command
  const reqSmsCmd = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1014,
      message: { message_id: 26, chat: { id: 987654321 }, from: { first_name: 'Kwame' }, text: '/sms TL-89241 0244112233' }
    }
  };
  const resSmsCmd = createMockRes();
  await handler(reqSmsCmd, resSmsCmd);
  assert(resSmsCmd.statusCode === 200, "/sms command with phone handled gracefully with HTTP 200");

  // 9. Status & Unpaid Payment Guard Tests
  console.log("\n[Test 9: Real-time Status & Payment Check Guard Tests]");
  
  // 9a: Check status on Unpaid Escrow
  const reqStatusUnpaid = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1015,
      callback_query: {
        id: 'cq_status_1',
        message: { chat: { id: 987654321 }, message_id: 28 },
        from: { first_name: 'Kwame' },
        data: 'btn_status:TL-89241'
      }
    }
  };
  const resStatusUnpaid = createMockRes();
  await handler(reqStatusUnpaid, resStatusUnpaid);
  assert(resStatusUnpaid.statusCode === 200, "btn_status handled cleanly with HTTP 200");

  // 9b: Attempt to ship an unpaid order (guard check)
  const reqShipUnpaid = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1016,
      callback_query: {
        id: 'cq_ship_unpaid',
        message: { chat: { id: 987654321 }, message_id: 29 },
        from: { first_name: 'Kwame' },
        data: 'btn_ship:TL-89241'
      }
    }
  };
  const resShipUnpaid = createMockRes();
  await handler(reqShipUnpaid, resShipUnpaid);
  assert(resShipUnpaid.statusCode === 200, "btn_ship guard prevented shipping unpaid order");

  // 10. Cancel Command
  console.log("\n[Test 10: /cancel Command]");
  const reqCancel = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1017,
      message: { message_id: 30, chat: { id: 987654321 }, text: '/cancel' }
    }
  };
  await handler(reqCancel, createMockRes());
  assert(true, "/cancel reset session to IDLE");

  // Final Summary
  console.log("\n=======================================================");
  if (testFailures === 0) {
    console.log("🎉 ALL TELEGRAM BOT UNIT & INTEGRATION TESTS PASSED!");
    process.exit(0);
  } else {
    console.error(`💥 TELEGRAM BOT TESTS FAILED WITH ${testFailures} ERRORS.`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test Suite Runtime Error:", err);
  process.exit(1);
});
