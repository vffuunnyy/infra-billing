const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NotificationsService } = require('../dist/notifications/notifications.service');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const configs = [A, B, C].map((projectUuid, i) => ({
  projectUuid,
  project: { name: ['Alpha <team>', 'Beta', 'Disabled'][i] },
  notificationsEnabled: i !== 2,
  upcomingBillingDays: i === 0 ? 1 : 5,
  telegramBotTokenEnc: new Uint8Array([1]),
  telegramChatId: String(i + 1),
  telegramTopicId: null,
  telegramProxyUrl: null,
}));
function fixture({ failA = false, allAlerts = false, dropFirstA = false } = {}) {
  let dropped = false;
  const messages = [];
  const log = new Set();
  const settings = {
    find: async (uuid) => configs.find((c) => c.projectUuid === uuid) ?? null,
    listEnabled: async () => configs.filter((c) => c.notificationsEnabled),
  };
  const services = [
    { projectUuid: A, providerUuid: 'shared' },
    { projectUuid: B, providerUuid: 'shared' },
    { projectUuid: B, providerUuid: 'beta-only' },
  ];
  const upcoming = [A, B].map((uuid) => ({
    projectUuid: uuid,
    serviceUuid: uuid,
    name: uuid === A ? 'alpha-vps' : 'beta-vps',
    providerUuid: 'shared',
    providerName: 'Shared host',
    providerLoginUrl: null,
    nextBillingAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    cost: '10.00',
    currency: 'USD',
    daysUntil: 3,
    covered: allAlerts ? (uuid === A ? false : null) : true,
    severity: allAlerts ? 'critical' : 'ok',
  }));
  const notifications = new NotificationsService(
    settings,
    {
      listErrorsSince: async () =>
        ['shared', 'beta-only', 'unrelated'].map((providerUuid) => ({
          providerUuid,
          error: 'sync failed',
          provider: { name: providerUuid, loginUrl: null },
        })),
    },
    { wasSentSince: async (key) => log.has(key), record: async (key) => log.add(key) },
    {
      summary: async (scope) => ({
        upcomingBillings: scope?.projectUuids
          ? upcoming.filter((s) => scope.projectUuids.includes(s.projectUuid))
          : upcoming,
        overdueBillings: allAlerts
          ? upcoming
              .filter((s) => scope.projectUuids.includes(s.projectUuid))
              .map((s) => ({ ...s, daysOverdue: 3 }))
          : [],
        balanceRunway: allAlerts
          ? [
              {
                providerUuid: scope.projectUuids[0] === A ? 'shared' : 'beta-only',
                providerName: 'Metered host',
                severity: 'critical',
                daysLeft: 2,
                burnPerDay: '5.00',
                balance: '10.00',
                currency: 'USD',
              },
            ]
          : [],
      }),
    },
    {
      isEnabled: async (uuid) =>
        uuid === undefined || configs.some((c) => c.projectUuid === uuid && c.notificationsEnabled),
      send: async (html, uuid) => {
        if (failA && uuid === A) throw new Error('Alpha delivery failed');
        if (dropFirstA && uuid === A && !dropped) {
          dropped = true;
          return false;
        }
        messages.push({ html, uuid });
        return true;
      },
    },
    { listActiveByProject: async (uuid) => services.filter((s) => s.projectUuid === uuid) },
  );
  return { notifications, messages, log };
}

test('low balance, unknown balance, runway and overdue alerts retain project routing', async () => {
  const { notifications, messages } = fixture({ allAlerts: true });
  assert.equal(await notifications.checkAndNotify(), 10);
  const alpha = messages.filter((m) => m.uuid === A);
  const beta = messages.filter((m) => m.uuid === B);
  assert.equal(alpha.length, 4);
  assert.equal(beta.length, 6);
  for (const label of ['Низкий баланс', 'Запас кончается', 'Просроченное списание'])
    assert.ok(alpha.some((m) => m.html.includes(label)));
  assert.ok(beta.some((m) => m.html.includes('Баланс неизвестен')));
  assert.ok(!alpha.some((m) => m.html.includes('beta')));
  assert.ok(!beta.some((m) => m.html.includes('alpha-vps')));
});

test('unsuccessful delivery does not suppress the next retry for that project', async () => {
  const { notifications, messages } = fixture({ dropFirstA: true });
  assert.equal(await notifications.checkAndNotify(), 3);
  assert.equal(await notifications.checkAndNotify(), 1);
  assert.equal(messages.at(-1).uuid, A);
});

test('each project receives only its service reminders and relevant provider errors', async () => {
  const { notifications, messages } = fixture();
  await notifications.checkAndNotify();
  assert.deepEqual(
    messages.map((m) => m.uuid),
    [A, B, B, B],
  );
  assert.ok(messages[0].html.includes('Alpha &lt;team&gt;'));
  assert.ok(!messages.some((m) => m.html.includes('unrelated')));
  assert.ok(!messages.filter((m) => m.uuid === A).some((m) => m.html.includes('beta')));
  assert.ok(messages.filter((m) => m.uuid === B).some((m) => m.html.includes('beta-vps')));
});

test('shared provider alerts are throttled independently for each project', async () => {
  const { notifications, messages } = fixture();
  assert.equal(await notifications.checkAndNotify(), 4);
  assert.equal(await notifications.checkAndNotify(), 0);
  assert.equal(messages.filter((m) => m.html.includes('shared')).length, 2);
});

test('manual check is restricted to its selected project', async () => {
  const { notifications, messages } = fixture();
  await notifications.checkAndNotify(B);
  assert.deepEqual(
    messages.map((m) => m.uuid),
    [B, B, B],
  );
});

test('disabled projects do not send automatic alerts', async () => {
  const { notifications, messages } = fixture();
  assert.equal(await notifications.checkAndNotify(C), 0);
  assert.deepEqual(messages, []);
});

test('one project failure does not prevent delivery to other projects', async () => {
  const { notifications, messages } = fixture({ failA: true });
  assert.equal(await notifications.checkAndNotify(), 3);
  assert.deepEqual(
    messages.map((m) => m.uuid),
    [B, B, B],
  );
});

test('sample notifications use only the selected project', async () => {
  const { notifications, messages } = fixture();
  const sent = await notifications.sendSamples(B);
  assert.ok(sent > 0);
  assert.ok(messages.every((m) => m.uuid === B));
});
