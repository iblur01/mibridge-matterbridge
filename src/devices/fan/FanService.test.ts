/**
 * Tests for FanService
 *
 * @file devices/fan/FanService.test.ts
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { XiaomiServiceConfig } from '../../platform/DeviceService.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockFanClient = jest.fn();

jest.unstable_mockModule('@mibridge/core', () => ({
  FanClient: mockFanClient,
}));

// Dynamic imports after mock registrations
const { FanService } = await import('./FanService.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeConfig(overrides: Partial<XiaomiServiceConfig> = {}): XiaomiServiceConfig {
  return {
    session: { userId: 'u1', ssecurity: 's1', serviceToken: 'tk1', savedAt: '2024-01-01T00:00:00.000Z' },
    region: 'de',
    pollInterval: 10000,
    ...overrides,
  };
}

function makeMockClient(connected = false) {
  return {
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isConnected: jest.fn<() => boolean>().mockReturnValue(connected),
  };
}

const fanDevice = { did: 'did-fan-1', name: 'Living Room Fan', model: 'dmaker.fan.1c' };
const vacuumDevice = { did: 'did-vac-1', name: 'Vacuum', model: 'dreame.vacuum.p2150' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FanService', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates a service without connecting', () => {
      const svc = new FanService(log as any, makeConfig());
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('exposes dmaker.fan model pattern', () => {
      const svc = new FanService(log as any, makeConfig());
      expect(svc.modelPatterns).toContain('dmaker.fan');
    });
  });

  describe('connect', () => {
    it('filters fan devices and creates one client per fan', async () => {
      const mockClientInstance = makeMockClient();
      mockFanClient.mockImplementation(() => mockClientInstance);

      const svc = new FanService(log as any, makeConfig());
      await svc.connect([fanDevice, vacuumDevice] as any);

      expect(svc.getDevices()).toHaveLength(1);
      expect(svc.getDevices()[0].did).toBe('did-fan-1');
      expect(mockFanClient).toHaveBeenCalledTimes(1);
      expect(mockFanClient).toHaveBeenCalledWith({
        deviceId: 'did-fan-1',
        region: 'de',
        pollInterval: 10000,
        session: expect.objectContaining({ userId: 'u1' }),
      });
    });

    it('creates no clients when no fan devices present', async () => {
      const svc = new FanService(log as any, makeConfig());
      await svc.connect([vacuumDevice] as any);

      expect(svc.getDevices()).toHaveLength(0);
      expect(mockFanClient).not.toHaveBeenCalled();
    });
  });

  describe('connectDevice', () => {
    it('calls connect() on the client and returns it', async () => {
      const mockClientInstance = makeMockClient(false);
      mockFanClient.mockImplementation(() => mockClientInstance);

      const svc = new FanService(log as any, makeConfig());
      await svc.connect([fanDevice] as any);
      const client = await svc.connectDevice('did-fan-1');

      expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
      expect(client).toBe(mockClientInstance);
    });

    it('does not reconnect an already-connected client', async () => {
      const mockClientInstance = makeMockClient(true);
      mockFanClient.mockImplementation(() => mockClientInstance);

      const svc = new FanService(log as any, makeConfig());
      await svc.connect([fanDevice] as any);
      await svc.connectDevice('did-fan-1');

      expect(mockClientInstance.connect).not.toHaveBeenCalled();
    });

    it('throws when DID is unknown', async () => {
      const svc = new FanService(log as any, makeConfig());
      await svc.connect([] as any);

      await expect(svc.connectDevice('unknown-did')).rejects.toThrow('No fan client');
    });
  });

  describe('disconnect', () => {
    it('disconnects all connected clients', async () => {
      const client1 = makeMockClient(true);
      const client2 = makeMockClient(true);
      let callCount = 0;
      mockFanClient.mockImplementation(() => (callCount++ === 0 ? client1 : client2));

      const device2 = { did: 'did-fan-2', name: 'Bedroom Fan', model: 'dmaker.fan.p5' };
      const svc = new FanService(log as any, makeConfig());
      await svc.connect([fanDevice, device2] as any);
      await svc.disconnect();

      expect(client1.disconnect).toHaveBeenCalledTimes(1);
      expect(client2.disconnect).toHaveBeenCalledTimes(1);
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('skips disconnect for non-connected clients', async () => {
      const mockClientInstance = makeMockClient(false);
      mockFanClient.mockImplementation(() => mockClientInstance);

      const svc = new FanService(log as any, makeConfig());
      await svc.connect([fanDevice] as any);
      await svc.disconnect();

      expect(mockClientInstance.disconnect).not.toHaveBeenCalled();
    });

    it('logs error when disconnect throws', async () => {
      const mockClientInstance = makeMockClient(true);
      mockClientInstance.disconnect.mockRejectedValue(new Error('disconnect failed'));
      mockFanClient.mockImplementation(() => mockClientInstance);

      const svc = new FanService(log as any, makeConfig());
      await svc.connect([fanDevice] as any);
      await svc.disconnect(); // should not throw

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('disconnect failed'));
    });
  });
});
