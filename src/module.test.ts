/**
 * Tests for MibridgePlatform (slim orchestrator)
 *
 * @file module.test.ts
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const LogLevel = { Debug: 'debug', Info: 'info', Warn: 'warn', Error: 'error' } as const;

// ─── Shared mock service/accessory factories ───────────────────────────────────

function makeMockService(devices: unknown[] = []) {
  return {
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getDevices: jest.fn<() => unknown[]>().mockReturnValue(devices),
    connectDevice: jest.fn<() => Promise<EventEmitter>>().mockResolvedValue(new EventEmitter()),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeMockAccessory() {
  return {
    register: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  };
}

const MockServiceClass = jest.fn();
const MockAccessoryClass = jest.fn();
const mockListDevices = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);

// ─── Mock registry with one entry ─────────────────────────────────────────────

jest.unstable_mockModule('./platform/registry.js', () => ({
  registry: [{ ServiceClass: MockServiceClass, AccessoryClass: MockAccessoryClass }],
}));

jest.unstable_mockModule('@mibridge/core', () => ({
  listDevices: mockListDevices,
}));

class MockMatterbridgeDynamicPlatform {
  log: Record<string, (...args: unknown[]) => void>;
  config: Record<string, unknown>;
  matterbridge: Record<string, unknown>;
  ready = Promise.resolve();

  constructor(matterbridge: Record<string, unknown>, log: Record<string, (...args: unknown[]) => void>, config: Record<string, unknown>) {
    this.matterbridge = matterbridge;
    this.log = log;
    this.config = config;
  }

  verifyMatterbridgeVersion(_v: string) { return true; }
  clearSelect() { return Promise.resolve(); }
  setSelectDevice(_did: string, _name: string) {}
  validateDevice(_args: string[]) { return true; }
  registerDevice(_device: unknown) { return Promise.resolve(); }
  onConfigure() { return Promise.resolve(); }
  onShutdown(_reason?: string) { return Promise.resolve(); }
  unregisterAllDevices() { return Promise.resolve(); }
}

jest.unstable_mockModule('matterbridge', () => ({
  MatterbridgeDynamicPlatform: MockMatterbridgeDynamicPlatform,
}));

jest.unstable_mockModule('matterbridge/logger', () => ({
  AnsiLogger: jest.fn(),
  LogLevel,
}));

// Dynamic imports after mocks
const moduleExports = await import('./module.js');
const MibridgePlatform = moduleExports.MibridgePlatform;
const initializePlugin = moduleExports.default;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}
function makeMatterbridge() { return { matterbridgeVersion: '3.7.2' }; }
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'matterbridge-mibridge',
    type: 'DynamicPlatform',
    session: { userId: 'u1', ssecurity: 's1', serviceToken: 'tk1' },
    region: 'de',
    pollInterval: 5000,
    verbose: false,
    unregisterOnShutdown: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MibridgePlatform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('initializes without error when version check passes', () => {
      const platform = new MibridgePlatform(makeMatterbridge() as any, makeLog() as any, makeConfig());
      expect(platform).toBeInstanceOf(MibridgePlatform);
    });

    it('throws when matterbridge version is too old', () => {
      const original = MockMatterbridgeDynamicPlatform.prototype.verifyMatterbridgeVersion;
      MockMatterbridgeDynamicPlatform.prototype.verifyMatterbridgeVersion = () => false;
      try {
        expect(() => new MibridgePlatform(makeMatterbridge() as any, makeLog() as any, makeConfig())).toThrow('3.4.0');
      } finally {
        MockMatterbridgeDynamicPlatform.prototype.verifyMatterbridgeVersion = original;
      }
    });
  });

  describe('onStart', () => {
    it('logs error and returns early when session is missing', async () => {
      const log = makeLog();
      const platform = new MibridgePlatform(makeMatterbridge() as any, log as any, makeConfig({ session: undefined }));
      await platform.onStart('test');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('session not configured'));
      expect(mockListDevices).not.toHaveBeenCalled();
    });

    it('calls listDevices with session and region', async () => {
      const mockService = makeMockService();
      MockServiceClass.mockImplementation(() => mockService);
      MockAccessoryClass.mockImplementation(() => makeMockAccessory());

      const platform = new MibridgePlatform(makeMatterbridge() as any, makeLog() as any, makeConfig());
      await platform.onStart('test');

      expect(mockListDevices).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1' }),
        'de',
      );
    });

    it('calls service.connect with all devices from listDevices', async () => {
      const devices = [{ did: 'did-1', name: 'Device', model: 'dreame.vacuum.p2150' }];
      mockListDevices.mockResolvedValue(devices);

      const mockService = makeMockService([]);
      MockServiceClass.mockImplementation(() => mockService);
      MockAccessoryClass.mockImplementation(() => makeMockAccessory());

      const platform = new MibridgePlatform(makeMatterbridge() as any, makeLog() as any, makeConfig());
      await platform.onStart('test');

      expect(mockService.connect).toHaveBeenCalledWith(devices);
    });

    it('calls accessory.register for each device returned by service', async () => {
      const devices = [{ did: 'did-1', name: 'Device', model: 'dreame.vacuum.p2150' }];
      mockListDevices.mockResolvedValue(devices);

      const mockService = makeMockService(devices);
      const mockAccessory = makeMockAccessory();
      MockServiceClass.mockImplementation(() => mockService);
      MockAccessoryClass.mockImplementation(() => mockAccessory);

      const platform = new MibridgePlatform(makeMatterbridge() as any, makeLog() as any, makeConfig());
      await platform.onStart('test');

      expect(mockService.connectDevice).toHaveBeenCalledWith('did-1');
      expect(mockAccessory.register).toHaveBeenCalledTimes(1);
    });

    it('continues processing other devices when one device setup fails', async () => {
      const devices = [
        { did: 'did-1', name: 'Broken', model: 'dreame.vacuum.p2150' },
        { did: 'did-2', name: 'Good', model: 'dreame.vacuum.p2150' },
      ];
      mockListDevices.mockResolvedValue(devices);

      const mockService = makeMockService(devices);
      mockService.connectDevice
        .mockRejectedValueOnce(new Error('connection failed'))
        .mockResolvedValueOnce(new EventEmitter());

      const mockAccessory = makeMockAccessory();
      MockServiceClass.mockImplementation(() => mockService);
      MockAccessoryClass.mockImplementation(() => mockAccessory);

      const log = makeLog();
      const platform = new MibridgePlatform(makeMatterbridge() as any, log as any, makeConfig());
      await platform.onStart('test');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Broken'));
      expect(mockAccessory.register).toHaveBeenCalledTimes(1);
    });
  });

  describe('onShutdown', () => {
    it('disconnects all services on shutdown', async () => {
      const mockService = makeMockService();
      MockServiceClass.mockImplementation(() => mockService);
      MockAccessoryClass.mockImplementation(() => makeMockAccessory());

      const platform = new MibridgePlatform(makeMatterbridge() as any, makeLog() as any, makeConfig());
      await platform.onStart('test');
      await platform.onShutdown('test');

      expect(mockService.disconnect).toHaveBeenCalledTimes(1);
    });

    it('calls unregisterAllDevices when unregisterOnShutdown is true', async () => {
      const mockService = makeMockService();
      MockServiceClass.mockImplementation(() => mockService);
      MockAccessoryClass.mockImplementation(() => makeMockAccessory());

      const matterbridge = makeMatterbridge();
      const unregisterAllDevices = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      (matterbridge as any).unregisterAllDevices = unregisterAllDevices;

      const platform = new MibridgePlatform(matterbridge as any, makeLog() as any, makeConfig({ unregisterOnShutdown: true }));
      // Need to access unregisterAllDevices on the platform itself (it's inherited from base)
      (platform as any).unregisterAllDevices = unregisterAllDevices;
      await platform.onStart('test');
      await platform.onShutdown('test');

      expect(unregisterAllDevices).toHaveBeenCalledTimes(1);
    });
  });

  describe('initializePlugin', () => {
    it('returns a MibridgePlatform instance', () => {
      const result = initializePlugin(makeMatterbridge() as any, makeLog() as any, makeConfig());
      expect(result).toBeInstanceOf(MibridgePlatform);
    });
  });
});
