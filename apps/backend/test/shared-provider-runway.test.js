const { test } = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { AnalyticsService } = require('../dist/analytics/analytics.service');
const { NotificationsService } = require('../dist/notifications/notifications.service');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const provider = {
    uuid: 'shared',
    name: 'Shared host',
    kind: 'manual',
    balance: new Decimal(10),
    balanceCurrency: 'USD',
    manualBalance: true,
    isPostpaid: false,
  };
  const services = [A, B].map((projectUuid) => ({
    uuid: projectUuid,
    projectUuid,
    providerUuid: provider.uuid,
    name: projectUuid === A ? 'alpha-vps' : 'beta-vps',
    cost: new Decimal(60),
    currency: 'USD',
    period: 'monthly',
    nextBillingAt: null,
    type: 'vps',
    countryCode: null,
    meta: null,
  }));
  const analytics = new AnalyticsService(
    { listAll: async () => [provider], findByUuid: async () => provider },
    { listAll: async () => [A, B, C].map((uuid) => ({ uuid, name: uuid })) },
    { listActive: async () => services },
    { listAll: async () => [] },
    { listSince: async () => [], listForProvider: async () => [] },
    {},
    {
      getEffectiveSettings: async () => ({ baseCurrency: 'USD' }),
      getRubRates: async () => new Map([['USD', new Decimal(1)]]),
      getHistoricalRates: async (rates) => ({ ratesOn: () => rates }),
      convert: (amount) => amount,
    },
  );
  return { analytics, services };
}

function scope(projectUuid) {
  return {
    projectUuids: [projectUuid],
    explicitFilter: true,
    includeBalances: true,
    includePayments: false,
  };
}

test('project filtering preserves the full burn of a shared provider balance', async () => {
  const { analytics } = fixture();
  const global = await analytics.summary();
  const runway = await analytics.providerRunway('shared');
  assert.equal(runway.daysLeft, 2);
  for (const uuid of [A, B]) {
    const summary = await analytics.summary(scope(uuid));
    assert.equal(summary.monthlyTotal, '60.00');
    assert.equal(summary.balanceRunway.length, 1);
    assert.equal(summary.balanceRunway[0].severity, 'critical');
    assert.equal(summary.balanceRunway[0].daysLeft, runway.daysLeft);
    assert.equal(summary.balanceRunway[0].burnPerDay, global.balanceRunway[0].burnPerDay);
  }
  assert.deepEqual((await analytics.summary(scope(C))).balanceRunway, []);
});

test('real analytics sends shared critical runway alerts to each affected project only', async () => {
  const { analytics, services } = fixture();
  const messages = [];
  const configs = [A, B, C].map((projectUuid) => ({
    projectUuid,
    project: { name: projectUuid },
    notificationsEnabled: true,
    upcomingBillingDays: 3,
  }));
  const notifications = new NotificationsService(
    { listEnabled: async () => configs },
    { listErrorsSince: async () => [] },
    { wasSentSince: async () => false, record: async () => {} },
    analytics,
    {
      isEnabled: async () => true,
      send: async (html, uuid) => {
        messages.push({ html, uuid });
        return true;
      },
    },
    {
      listActiveByProject: async (uuid) =>
        services.filter((service) => service.projectUuid === uuid),
    },
  );
  assert.equal(await notifications.checkAndNotify(), 2);
  assert.deepEqual(
    messages.map((message) => message.uuid),
    [A, B],
  );
  assert.ok(messages.every((message) => message.html.includes('Запас кончается')));
});
