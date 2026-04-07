/**
 * Tests for FanAccessory
 *
 * @file devices/fan/FanAccessory.test.ts
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── Local FanMode/FanSpeed constants (mirror types.ts) ──────────────────────

const FanMode = { Straight: 'straight', Sleep: 'sleep' } as const;

// ─── Mock Endpoint ────────────────────────────────────────────────────────────

class MockEndpoint extends EventEmitter {
  private attributes: Map<string, unknown> = new Map();
  private commandHandlers: Map<string, (...args: unknown[]) => Promise<void>> = new Map();
  private attributeListeners: Map<string, (newValue: unknown, oldValue: unknown, context: { offline?: boolean }) => void> = new Map();

  createDefaultIdentifyClusterServer = jest.fn().mockReturnValue(this);
  createDefaultBridgedDeviceBasicInformationClusterServer = jest.fn().mockReturnValue(this);
  createDefaultFanControlClusterServer = jest.fn().mockReturnValue(this);

  setAttribute = jest.fn((cluster: string, attr: string, value: unknown) => {
    this.attributes.set(`${cluster}.${attr}`, value);
  });

  getAttribute(cluster: string, attr: string) {
    return this.attributes.get(`${cluster}.${attr}`);
  }

  addCommandHandler = jest.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
    this.commandHandlers.set(name, handler);
  });

  subscribeAttribute = jest.fn(
    async (
      cluster: string,
      attr: string,
      listener: (newValue: unknown, oldValue: unknown, context: { offline?: boolean }) => void,
    ) => {
      this.attributeListeners.set(`${cluster}.${attr}`, listener);
      return true;
    },
  );

  async triggerAttributeChange(
    cluster: string,
    attr: string,
    newValue: unknown,
    oldValue: unknown = undefined,
    context: { offline?: boolean } = {},
  ) {
    const listener = this.attributeListeners.get(`${cluster}.${attr}`);
    if (!listener) throw new Error(`No attribute listener for ${cluster}.${attr}`);
    await listener(newValue, oldValue, context);
  }
}

const MockMatterbridgeEndpoint = jest.fn().mockImplementation(() => new MockEndpoint());

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('matterbridge', () => ({
  MatterbridgeEndpoint: MockMatterbridgeEndpoint,
  fanDevice: { name: 'MA-fan', code: 0x2b },
}));

jest.unstable_mockModule('@mibridge/core', () => ({
  FanMode,
}));

// Dynamic imports after mocks
const { FanAccessory } = await import('./FanAccessory.js');

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

function makeFanClient(overrides: Partial<ReturnType<typeof _makeFanClientBase>> = {}) {
  return Object.assign(_makeFanClientBase(), overrides);
}

function _makeFanClientBase() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isConnected: jest.fn<() => boolean>().mockReturnValue(true),
    getStatus: jest.fn().mockResolvedValue({
      on: true,
      speed: { type: 'level', value: 2 },
      mode: FanMode.Straight,
      oscillating: false,
      timerMinutes: 0,
      buzzer: false,
      led: true,
      locked: false,
    }),
    setOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setSpeed: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
}

const deviceInfo = { did: 'did-fan-1', name: 'Living Room Fan', model: 'dmaker.fan.1c' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FanAccessory', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
    jest.clearAllMocks();
    MockMatterbridgeEndpoint.mockImplementation(() => new MockEndpoint());
  });

  describe('register', () => {
    it('creates endpoint with fanDevice device type', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      expect(MockMatterbridgeEndpoint).toHaveBeenCalledWith(
        [expect.objectContaining({ name: 'MA-fan' })],
        expect.objectContaining({ id: expect.stringContaining('did-fan-1') }),
      );
    });

    it('creates FanControl cluster server with Off mode and OffLowMedHigh sequence', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.createDefaultFanControlClusterServer).toHaveBeenCalledWith(0, 0);
    });

    it('subscribes to fanControl.fanMode attribute changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.subscribeAttribute).toHaveBeenCalledWith(
        'fanControl',
        'fanMode',
        expect.any(Function),
        expect.anything(),
      );
    });

    it('registers device when validateDevice returns true', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      expect(platform.setSelectDevice).toHaveBeenCalledWith('did-fan-1', 'Living Room Fan');
      expect(platform.validateDevice).toHaveBeenCalledWith(['Living Room Fan', 'did-fan-1']);
      expect(platform.registerDevice).toHaveBeenCalled();
    });

    it('returns null when validateDevice returns false', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      platform.validateDevice.mockReturnValue(false);

      const result = await accessory.register(platform, deviceInfo as any, client);

      expect(platform.registerDevice).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('syncState: FanStatus → fanMode', () => {
    it('maps on=true, speed level 2 → fanMode Medium (2)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient(); // default: on=true, speed level 2
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(2); // Medium
    });

    it('maps on=true, speed level 1 → fanMode Low (1)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: true,
        speed: { type: 'level', value: 1 },
        mode: FanMode.Straight,
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(1); // Low
    });

    it('maps on=true, speed level 3 → fanMode High (3)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: true,
        speed: { type: 'level', value: 3 },
        mode: FanMode.Straight,
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(3); // High
    });

    it('maps on=false → fanMode Off (0)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: false,
        speed: { type: 'level', value: 1 },
        mode: FanMode.Straight,
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(0); // Off
    });
  });

  describe('statusChange event', () => {
    it('updates fanMode when status changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: false,
        speed: { type: 'level', value: 1 },
        mode: FanMode.Straight,
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });

      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(0); // Off
    });

    it('updates fanMode to High when speed changes to level 3', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        speed: { type: 'level', value: 3 },
        mode: FanMode.Straight,
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });

      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(3); // High
    });
  });

  describe('fanMode attribute changes (Apple Home → fan)', () => {
    it('fanMode Off (0) → calls setOn(false)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'fanMode', 0, 2);

      expect(client.setOn).toHaveBeenCalledWith(false);
      expect(client.setSpeed).not.toHaveBeenCalled();
    });

    it('fanMode Low (1) → calls setOn(true) + setSpeed level 1', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'fanMode', 1, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 1 });
    });

    it('fanMode Medium (2) → calls setOn(true) + setSpeed level 2', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'fanMode', 2, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 2 });
    });

    it('fanMode High (3) → calls setOn(true) + setSpeed level 3', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'fanMode', 3, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 3 });
    });

    it('fanMode On (4) → calls setOn(true) only', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'fanMode', 4, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).not.toHaveBeenCalled();
    });

    it('ignores offline attribute changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0]!.value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'fanMode', 0, 2, { offline: true });

      expect(client.setOn).not.toHaveBeenCalled();
    });
  });
});
