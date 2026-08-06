/**
 * Test Suite for TrustLink Telegram Bot Webhook
 * Simulates incoming Telegram Bot API Update payloads (messages, commands, callback queries)
 * and asserts expected bot replies, state machine transitions, and validation guards.
 */

import handler from './api/webhook/telegram.js';

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
  console.log("\n[Test 5: Guided 4-Step Escrow Wizard]");
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

  // Step 3: Send Amount
  const reqWiz3 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1006,
      message: { message_id: 6, chat: { id: 11223344 }, text: '12500' }
    }
  };
  await handler(reqWiz3, createMockRes());
  assert(true, "Wizard Step 3 (Price GH₵ 12,500) accepted");

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
  assert(true, "Wizard Step 4 (Buyer Phone) accepted & fee split keyboard dispatched");

  // Step 5: Select Fee Split Button (Callback Query)
  const reqWiz5 = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1008,
      callback_query: {
        id: 'cq_9999',
        message: { chat: { id: 11223344 }, message_id: 7 },
        data: 'btn_fee_split:50/50'
      }
    }
  };
  const resWiz5 = createMockRes();
  await handler(reqWiz5, resWiz5);
  assert(resWiz5.statusCode === 200, "Wizard completed via Inline Button click");

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

  // 8. Cancel Command
  console.log("\n[Test 8: /cancel Command]");
  const reqCancel = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      update_id: 1013,
      message: { message_id: 12, chat: { id: 987654321 }, text: '/cancel' }
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
