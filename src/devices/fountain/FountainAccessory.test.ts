/**
 * Tests for FountainAccessory
 *
 * @file devices/fountain/FountainAccessory.test.ts
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── Enum values ──────────────────────────────────────────────────────────────

const FountainMode = { Continuous: 'continuous', Intermittent: 'intermittent', Sensor: 'sensor' } as const;
const FountainFaultCode = {
  None: 'none',
  WaterShortage: 'waterShortage',
  PumpBlocked: 'pumpBlocked',
  FilterExpired: 'filterExpired',
  LidRemoved: 'lidRemoved',
} as const;

// ─── Mock Endpoint ────────────────────────────────────────────────────────────

class MockEndpoint extends EventEmitter {
  private attributes: Map<string, unknown> = new Map();
  private commandHandlers: Map<string, (...args: unknown[]) => Promise<void>> = new Map();

  createDefaultIdentifyClusterServer = jest.fn().mockReturnValue(this);
  createDefaultBasicInformationClusterServer = jest.fn().mockReturnValue(this);
  createDefaultPowerSourceRechargeableBatteryClusterServer = jest.fn().mockReturnValue(this);
  createDefaultValveConfigurationAndControlClusterServer = jest.fn().mockReturnValue(this);
  createDefaultActivatedCarbonFilterMonitoringClusterServer = jest.fn().mockReturnValue(this);
  createDefaultBooleanStateClusterServer = jest.fn().mockReturnValue(this);

  setAttribute = jest.fn((cluster: string, attr: string, value: unknown) => {
    this.attributes.set(`${cluster}.${attr}`, value);
  });

  getAttribute(cluster: string, attr: string) {
    return this.attributes.get(`${cluster}.${attr}`);
  }

  addCommandHandler = jest.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
    this.commandHandlers.set(name, handler);
  });

  async invokeCommand(name: string, ...args: unknown[]) {
    const handler = this.commandHandlers.get(name);
    if (!handler) throw new Error(`No handler for ${name}`);
    await handler(...args);
  }
}

const MockMatterbridgeEndpoint = jest.fn().mockImplementation(() => new MockEndpoint());

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('matterbridge', () => ({
  MatterbridgeEndpoint: MockMatterbridgeEndpoint,
  waterValve: { name: 'MA-waterValve', code: 66 },
  powerSource: { name: 'MA-powerSource', code: 17 },
}));

jest.unstable_mockModule('matterbridge/logger', () => ({
  AnsiLogger: jest.fn(),
}));

jest.unstable_mockModule('@mibridge/core', () => ({
  FountainFaultCode,
  FountainMode,
}));

// Dynamic imports after mocks
const { FountainAccessory } = await import('./FountainAccessory.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makePlatform() {
  return {
    log: makeLog() as any,
    verbose: false,
    setSelectDevice: jest.fn(),
    validateDevice: jest.fn<() => boolean>().mockReturnValue(true),
    registerDevice: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeFountainClient() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isConnected: jest.fn<() => boolean>().mockReturnValue(true),
    getStatus: jest.fn().mockResolvedValue({
      on: true,
      mode: FountainMode.Continuous,
      fault: FountainFaultCode.None,
      waterShortage: false,
      filterLifeLeft: 80,
      filterLeftTime: 12,
      batteryLevel: 75,
    }),
    setOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    resetFilter: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
}

const deviceInfo = { did: 'did-1', name: 'Cat Fountain', model: 'mmgg.pet_waterer.wi11' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FountainAccessory', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
    jest.clearAllMocks();
    MockMatterbridgeEndpoint.mockImplementation(() => new MockEndpoint());
  });

  describe('register', () => {
    it('creates endpoint with waterValve and powerSource device types', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      expect(MockMatterbridgeEndpoint).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MA-waterValve' }),
          expect.objectContaining({ name: 'MA-powerSource' }),
        ]),
        expect.objectContaining({ id: expect.stringContaining('did-1') }),
        'server',
      );
    });

    it('adds all required cluster servers', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.createDefaultIdentifyClusterServer).toHaveBeenCalled();
      expect(endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalled();
      expect(endpoint.createDefaultValveConfigurationAndControlClusterServer).toHaveBeenCalled();
      expect(endpoint.createDefaultActivatedCarbonFilterMonitoringClusterServer).toHaveBeenCalled();
      expect(endpoint.createDefaultBooleanStateClusterServer).toHaveBeenCalled();
      expect(endpoint.createDefaultPowerSourceRechargeableBatteryClusterServer).toHaveBeenCalled();
    });

    it('syncs initial status from getStatus()', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      // on: true → valve Open (1)
      expect(endpoint.getAttribute('valveConfigurationAndControl', 'currentState')).toBe(1);
      // batteryLevel: 75 → batPercentRemaining: 150 (×2)
      expect(endpoint.getAttribute('powerSource', 'batPercentRemaining')).toBe(150);
      // filterLifeLeft: 80 → condition: 80
      expect(endpoint.getAttribute('activatedCarbonFilterMonitoring', 'condition')).toBe(80);
      // filterLifeLeft 80 → Ok (0)
      expect(endpoint.getAttribute('activatedCarbonFilterMonitoring', 'changeIndication')).toBe(0);
      // waterShortage: false, fault: none → stateValue: false
      expect(endpoint.getAttribute('booleanState', 'stateValue')).toBe(false);
    });

    it('calls registerDevice on the platform when validateDevice returns true', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      expect(platform.setSelectDevice).toHaveBeenCalledWith('did-1', 'Cat Fountain');
      expect(platform.validateDevice).toHaveBeenCalledWith(['Cat Fountain', 'did-1']);
      expect(platform.registerDevice).toHaveBeenCalled();
    });

    it('skips registerDevice when validateDevice returns false', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      platform.validateDevice.mockReturnValue(false);

      const result = await accessory.register(platform, deviceInfo as any, client);

      expect(platform.registerDevice).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('statusChange event', () => {
    it('updates valve state when on changes', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: false,
        fault: FountainFaultCode.None,
        waterShortage: false,
        filterLifeLeft: 80,
        filterLeftTime: 12,
        batteryLevel: 75,
        mode: FountainMode.Continuous,
      });

      // on: false → Closed (0)
      expect(endpoint.getAttribute('valveConfigurationAndControl', 'currentState')).toBe(0);
    });

    it('sets booleanState when waterShortage is true', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        fault: FountainFaultCode.None,
        waterShortage: true,
        filterLifeLeft: 80,
        filterLeftTime: 12,
        batteryLevel: 75,
        mode: FountainMode.Continuous,
      });

      expect(endpoint.getAttribute('booleanState', 'stateValue')).toBe(true);
    });

    it('sets booleanState when fault is lidRemoved', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        fault: FountainFaultCode.LidRemoved,
        waterShortage: false,
        filterLifeLeft: 80,
        filterLeftTime: 12,
        batteryLevel: 75,
        mode: FountainMode.Continuous,
      });

      expect(endpoint.getAttribute('booleanState', 'stateValue')).toBe(true);
    });

    it('sets filterIndication to Critical when fault is filterExpired', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        fault: FountainFaultCode.FilterExpired,
        waterShortage: false,
        filterLifeLeft: 5,
        filterLeftTime: 0,
        batteryLevel: 75,
        mode: FountainMode.Continuous,
      });

      expect(endpoint.getAttribute('activatedCarbonFilterMonitoring', 'changeIndication')).toBe(2); // Critical
    });

    it('sets filterIndication to Warning when filterLifeLeft <= 30', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        fault: FountainFaultCode.None,
        waterShortage: false,
        filterLifeLeft: 20,
        filterLeftTime: 3,
        batteryLevel: 75,
        mode: FountainMode.Continuous,
      });

      expect(endpoint.getAttribute('activatedCarbonFilterMonitoring', 'changeIndication')).toBe(1); // Warning
    });
  });

  describe('command handlers', () => {
    it('open valve calls setOn(true)', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.invokeCommand('valveConfigurationAndControl.open');

      expect(client.setOn).toHaveBeenCalledWith(true);
    });

    it('close valve calls setOn(false)', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.invokeCommand('valveConfigurationAndControl.close');

      expect(client.setOn).toHaveBeenCalledWith(false);
    });

    it('resetCondition calls resetFilter()', async () => {
      const accessory = new FountainAccessory(log as any, false);
      const client = makeFountainClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.invokeCommand('resetCondition');

      expect(client.resetFilter).toHaveBeenCalledTimes(1);
    });
  });
});
