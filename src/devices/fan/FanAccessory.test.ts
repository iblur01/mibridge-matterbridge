/**
 * Tests for FanAccessory (percent + oscillation)
 *
 * @file devices/fan/FanAccessory.test.ts
 */
import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── Mock FanControlServer (3-level prototype chain for Object.getPrototypeOf x2) ──

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class FanControlBase {
  static with(_feature: string) {
    return FanControlBase;
  }
}
class FanControlServerWith extends FanControlBase {}
class MockFanControlServerClass extends FanControlServerWith {}

// ─── Mock Endpoint ────────────────────────────────────────────────────────────

class MockEndpoint extends EventEmitter {
  private attributes: Map<string, unknown> = new Map();
  private attributeListeners: Map<string, (newValue: unknown, oldValue: unknown, context: { offline?: boolean }) => void> = new Map();

  behaviors = { require: jest.fn() };

  createDefaultIdentifyClusterServer = jest.fn().mockReturnValue(this);
  createDefaultBridgedDeviceBasicInformationClusterServer = jest.fn().mockReturnValue(this);

  setAttribute = jest.fn((cluster: string, attr: string, value: unknown) => {
    this.attributes.set(`${cluster}.${attr}`, value);
  });

  getAttribute(cluster: string, attr: string) {
    return this.attributes.get(`${cluster}.${attr}`);
  }

  addCommandHandler = jest.fn();

  subscribeAttribute = jest.fn(async (cluster: string, attr: string, listener: (newValue: unknown, oldValue: unknown, context: { offline?: boolean }) => void, _log?: unknown) => {
    this.attributeListeners.set(`${cluster}.${attr}`, listener);
    return true;
  });

  async triggerAttributeChange(cluster: string, attr: string, newValue: unknown, oldValue: unknown = undefined, context: { offline?: boolean } = {}) {
    const listener = this.attributeListeners.get(`${cluster}.${attr}`);
    if (!listener) throw new Error(`No attribute listener for ${cluster}.${attr}`);
    await listener(newValue, oldValue, context);
  }
}

const MockMatterbridgeEndpoint = jest.fn().mockImplementation(() => new MockEndpoint());

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('matterbridge', () => ({
  MatterbridgeEndpoint: MockMatterbridgeEndpoint,
  MatterbridgeFanControlServer: MockFanControlServerClass,
  fanDevice: { name: 'MA-fan', code: 0x2b },
}));

jest.unstable_mockModule('@mibridge/core', () => ({}));

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
    validateDevice: jest.fn<(args: string[]) => boolean>().mockReturnValue(true),
    registerDevice: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeFanClient(overrides: Partial<ReturnType<typeof _makeFanClientBase>> = {}) {
  return Object.assign(_makeFanClientBase(), overrides);
}

type FanStatus = { on: boolean; speed: { type: string; value: number }; oscillating: boolean; timerMinutes: number; buzzer: boolean; led: boolean; locked: boolean };

function _makeFanClientBase() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isConnected: jest.fn<() => boolean>().mockReturnValue(true),
    getStatus: jest.fn<() => Promise<FanStatus>>().mockResolvedValue({
      on: true,
      speed: { type: 'level', value: 2 },
      oscillating: false,
      timerMinutes: 0,
      buzzer: false,
      led: true,
      locked: false,
    }),
    setOn: jest.fn<(on: boolean) => Promise<void>>().mockResolvedValue(undefined),
    setSpeed: jest.fn<(speed: { type: string; value: number }) => Promise<void>>().mockResolvedValue(undefined),
    setOscillating: jest.fn<(oscillating: boolean) => Promise<void>>().mockResolvedValue(undefined),
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

      expect(MockMatterbridgeEndpoint).toHaveBeenCalledWith([expect.objectContaining({ name: 'MA-fan' })], expect.objectContaining({ id: expect.stringContaining('did-fan-1') }));
    });

    it('creates FanControl cluster with percent and rock support via behaviors.require', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.behaviors.require).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          fanMode: 0,
          fanModeSequence: 0,
          percentSetting: 0,
          percentCurrent: 0,
          rockSupport: expect.objectContaining({ rockLeftRight: true }),
          rockSetting: expect.objectContaining({ rockLeftRight: false }),
        }),
      );
    });

    it('subscribes to percentSetting attribute changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.subscribeAttribute).toHaveBeenCalledWith('fanControl', 'percentSetting', expect.any(Function), expect.anything());
    });

    it('subscribes to rockSetting attribute changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.subscribeAttribute).toHaveBeenCalledWith('fanControl', 'rockSetting', expect.any(Function), expect.anything());
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

  describe('syncState: FanStatus → Matter attributes', () => {
    it('maps on=true, speed level 2 → fanMode Medium, percentSetting 50, percentCurrent 50, rockSetting off', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient(); // default: on=true, speed level 2, oscillating=false
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(2); // Medium
      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(50);
      expect(endpoint.getAttribute('fanControl', 'percentCurrent')).toBe(50);
      expect(endpoint.getAttribute('fanControl', 'rockSetting')).toEqual({ rockLeftRight: false, rockUpDown: false, rockRound: false });
    });

    it('maps on=true, speed level 1 → fanMode Low, percent 25', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: true,
        speed: { type: 'level', value: 1 },
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(1); // Low
      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(25);
      expect(endpoint.getAttribute('fanControl', 'percentCurrent')).toBe(25);
    });

    it('maps on=true, speed level 3 → fanMode High, percent 75', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: true,
        speed: { type: 'level', value: 3 },
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(3); // High
      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(75);
      expect(endpoint.getAttribute('fanControl', 'percentCurrent')).toBe(75);
    });

    it('maps on=false → fanMode Off, percent 0', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: false,
        speed: { type: 'level', value: 1 },
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(0); // Off
      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(0);
      expect(endpoint.getAttribute('fanControl', 'percentCurrent')).toBe(0);
    });

    it('maps oscillating=true → rockSetting.rockLeftRight true', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: true,
        speed: { type: 'level', value: 2 },
        oscillating: true,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();

      await accessory.register(platform, deviceInfo as any, client);

      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;
      expect(endpoint.getAttribute('fanControl', 'rockSetting')).toEqual({ rockLeftRight: true, rockUpDown: false, rockRound: false });
    });
  });

  describe('statusChange event', () => {
    it('updates all four attributes when status changes to off', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      client.emit('statusChange', {
        on: false,
        speed: { type: 'level', value: 1 },
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });

      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(0);
      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(0);
      expect(endpoint.getAttribute('fanControl', 'percentCurrent')).toBe(0);
      expect(endpoint.getAttribute('fanControl', 'rockSetting')).toEqual({ rockLeftRight: false, rockUpDown: false, rockRound: false });
    });

    it('updates fanMode to High and percent 75 when speed changes to level 3', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        speed: { type: 'level', value: 3 },
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });

      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(3);
      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(75);
      expect(endpoint.getAttribute('fanControl', 'percentCurrent')).toBe(75);
    });

    it('updates rockSetting when oscillating changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      client.emit('statusChange', {
        on: true,
        speed: { type: 'level', value: 2 },
        oscillating: true,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });

      expect(endpoint.getAttribute('fanControl', 'rockSetting')).toEqual({ rockLeftRight: true, rockUpDown: false, rockRound: false });
    });
  });

  describe('percentSetting attribute changes (Apple Home → fan)', () => {
    it('percentSetting 0 → calls setOn(false)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 0, 50);

      expect(client.setOn).toHaveBeenCalledWith(false);
      expect(client.setSpeed).not.toHaveBeenCalled();
    });

    it('percentSetting 1 (low boundary) → setOn(true) + setSpeed level 1', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 1, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 1 });
    });

    it('percentSetting 33 (low top) → setOn(true) + setSpeed level 1', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 33, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 1 });
    });

    it('percentSetting 34 (medium bottom) → setOn(true) + setSpeed level 2', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 34, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 2 });
    });

    it('percentSetting 66 (medium top) → setOn(true) + setSpeed level 2', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 66, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 2 });
    });

    it('percentSetting 67 (high bottom) → setOn(true) + setSpeed level 3', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 67, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 3 });
    });

    it('percentSetting 100 (max) → setOn(true) + setSpeed level 3', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 100, 0);

      expect(client.setOn).toHaveBeenCalledWith(true);
      expect(client.setSpeed).toHaveBeenCalledWith({ type: 'level', value: 3 });
    });

    it('ignores offline percentSetting changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 0, 50, { offline: true });

      expect(client.setOn).not.toHaveBeenCalled();
    });
  });

  describe('rockSetting attribute changes (Apple Home → fan)', () => {
    it('rockSetting.rockLeftRight true → calls setOscillating(true)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'rockSetting', { rockLeftRight: true, rockUpDown: false, rockRound: false }, undefined);

      expect(client.setOscillating).toHaveBeenCalledWith(true);
    });

    it('rockSetting.rockLeftRight false → calls setOscillating(false)', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'rockSetting', { rockLeftRight: false, rockUpDown: false, rockRound: false }, undefined);

      expect(client.setOscillating).toHaveBeenCalledWith(false);
    });

    it('ignores offline rockSetting changes', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'rockSetting', { rockLeftRight: true, rockUpDown: false, rockRound: false }, undefined, { offline: true });

      expect(client.setOscillating).not.toHaveBeenCalled();
    });

    it('logs error when setOscillating throws', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.setOscillating.mockRejectedValue(new Error('osc failed'));
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'rockSetting', { rockLeftRight: true, rockUpDown: false, rockRound: false }, undefined);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to apply rockSetting'));
    });
  });

  describe('percentSetting error path', () => {
    it('logs error when applyPercent throws', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.setOn.mockRejectedValue(new Error('setOn failed'));
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      await endpoint.triggerAttributeChange('fanControl', 'percentSetting', 0, 50);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to apply percentSetting'));
    });
  });

  describe('device events', () => {
    it('statusChange with verbose=true logs detailed info', async () => {
      const log2 = makeLog();
      const accessory = new FanAccessory(log2 as any, true);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);

      client.emit('statusChange', { on: true, speed: { type: 'level', value: 2 }, oscillating: false, timerMinutes: 0, buzzer: false, led: true, locked: false });

      expect(log2.info).toHaveBeenCalledWith(expect.stringContaining('oscillating=false'));
    });

    it('error event logs the error message', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);

      client.emit('error', new Error('connection lost'));

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
    });

    it('connected event logs connection', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);

      client.emit('connected');

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('connected'));
    });

    it('disconnected event logs disconnection', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);

      client.emit('disconnected');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
    });
  });

  describe('statusToPercent and statusToFanMode fallthrough', () => {
    it('status with non-level speed type maps to medium percent and fanMode', async () => {
      const accessory = new FanAccessory(log as any, false);
      const client = makeFanClient();
      client.getStatus.mockResolvedValue({
        on: true,
        speed: { type: 'percentage', value: 50 },
        oscillating: false,
        timerMinutes: 0,
        buzzer: false,
        led: true,
        locked: false,
      });
      const platform = makePlatform();
      await accessory.register(platform, deviceInfo as any, client);
      const endpoint = MockMatterbridgeEndpoint.mock.results[0].value as MockEndpoint;

      expect(endpoint.getAttribute('fanControl', 'percentSetting')).toBe(50); // LEVEL_PERCENT.medium
      expect(endpoint.getAttribute('fanControl', 'fanMode')).toBe(2); // MatterFanMode.Medium
    });
  });
});
