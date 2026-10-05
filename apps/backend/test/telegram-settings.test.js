const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Api } = require('grammy');
const { CryptoService } = require('../dist/crypto/crypto.service');
const { TelegramService } = require('../dist/notifications/telegram.service');
const { TelegramSettingsService } = require('../dist/settings/telegram-settings.service');
const { updateTelegramSettingsSchema, updateSettingsSchema } = require('@infra/shared');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const crypto = new CryptoService({ encryptionKey: Buffer.alloc(32, 7).toString('base64') });
  const rows = new Map();
  const defaults = {
    notificationsEnabled: false,
    upcomingBillingDays: 3,
    telegramBotTokenEnc: null,
    telegramChatId: null,
    telegramTopicId: null,
    telegramProxyUrl: null,
  };
  const repo = {
    find: async (uuid) => rows.get(uuid) ?? null,
    upsert: async (uuid, data) => {
      const row = { ...defaults, ...rows.get(uuid), ...data, projectUuid: uuid };
      rows.set(uuid, row);
      return row;
    },
  };
  return {
    rows,
    crypto,
    settings: new TelegramSettingsService(
      repo,
      { exists: async (uuid) => [A, B].includes(uuid) },
      crypto,
    ),
    telegram: new TelegramService(repo, crypto),
  };
}

test('saving encrypted token and destination affects only its project; API is write-only', async () => {
  const { rows, crypto, settings } = fixture();
  const result = await settings.update(A, {
    notificationsEnabled: true,
    telegramBotToken: '12345:alpha-token',
    telegramChatId: '-1001',
  });
  assert.equal(crypto.decrypt(rows.get(A).telegramBotTokenEnc), '12345:alpha-token');
  assert.equal(result.telegramConfigured, true);
  assert.ok(!JSON.stringify(result).includes('alpha-token'));
  assert.ok(!Object.hasOwn(result, 'telegramBotTokenEnc'));
  assert.deepEqual(await settings.get(B), {
    notificationsEnabled: false,
    upcomingBillingDays: 3,
    telegramChatId: null,
    telegramTopicId: null,
    telegramProxyUrl: null,
    telegramConfigured: false,
  });
  await settings.update(A, { telegramBotToken: '', telegramChatId: '', telegramTopicId: '' });
  assert.equal(crypto.decrypt(rows.get(A).telegramBotTokenEnc), '12345:alpha-token');
  assert.equal((await settings.get(A)).telegramChatId, null);
});

test('unknown projects cannot read or save Telegram settings', async () => {
  const { rows, settings } = fixture();
  await assert.rejects(settings.get('unknown'), { status: 404 });
  await assert.rejects(settings.update('unknown', { telegramBotToken: '12345:token' }), {
    status: 404,
  });
  assert.equal(rows.size, 0);
});

test('delivery uses only selected project bot, chat and topic; automatic switch is re-read', async (t) => {
  const { settings, telegram } = fixture();
  const delivered = [];
  t.mock.method(Api.prototype, 'sendMessage', async function (chatId, html, options) {
    delivered.push({ token: this.token, chatId, html, topicId: options.message_thread_id });
  });
  await settings.update(A, {
    notificationsEnabled: true,
    telegramBotToken: '12345:alpha-token',
    telegramChatId: '-1001',
    telegramTopicId: '7',
  });
  await settings.update(B, {
    notificationsEnabled: true,
    telegramBotToken: '67890:beta-token',
    telegramChatId: '-1002',
    telegramTopicId: '8',
  });
  assert.equal(await telegram.send('alpha', A, true), true);
  assert.equal(await telegram.send('beta', B, true), true);
  assert.deepEqual(delivered, [
    { token: '12345:alpha-token', chatId: '-1001', html: 'alpha', topicId: 7 },
    { token: '67890:beta-token', chatId: '-1002', html: 'beta', topicId: 8 },
  ]);
  await settings.update(A, { notificationsEnabled: false });
  assert.equal(await telegram.isEnabled(A), false);
  assert.equal(await telegram.send('blocked', A, true), false);
  assert.equal(await telegram.send('manual sample', A), true);
  assert.equal(await telegram.send('unknown', 'unknown', true), false);
  assert.equal(delivered.length, 3);
});

test('a failed send can be retried and does not expose bot tokens in logs', async (t) => {
  const { settings, telegram } = fixture();
  await settings.update(A, {
    notificationsEnabled: true,
    telegramBotToken: '12345:secret-token',
    telegramChatId: '-1001',
  });
  const logs = [];
  t.mock.method(telegram.logger, 'error', (...args) => logs.push(args.join(' ')));
  t.mock.method(Api.prototype, 'sendMessage', async () => {
    throw new Error('https://api.telegram.org/bot12345:secret-token/sendMessage');
  });
  assert.equal(await telegram.send('test', A, true), false);
  assert.ok(logs.length);
  assert.ok(!logs.join(' ').includes('secret-token'));
});

test('project fields are validated and the global settings API rejects Telegram writes', () => {
  for (const input of [
    { telegramChatId: 'abc' },
    { telegramTopicId: '-2' },
    { upcomingBillingDays: 0 },
    { telegramProxyUrl: 'https://proxy' },
  ]) {
    assert.equal(updateTelegramSettingsSchema.safeParse(input).success, false);
  }
  assert.equal(updateSettingsSchema.safeParse({ telegramChatId: '-1001' }).success, false);
  assert.deepEqual(
    updateTelegramSettingsSchema.parse({ telegramChatId: ' -1001 ', telegramTopicId: ' 7 ' }),
    { telegramChatId: '-1001', telegramTopicId: '7' },
  );
});
