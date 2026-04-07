/**
 * Tests for VacuumService
 *
 * @file devices/vacuum/VacuumService.test.ts
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { XiaomiServiceConfig } from '../../platform/DeviceService.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const MockDreameVacuumClient = jest.fn();

jest.unstable_mockModule('@mibridge/core', () => ({
  DreameVacuumClient: MockDreameVacuumClient,
}));

jest.unstable_mockModule('matterbridge/logger', () => ({
  AnsiLogger: jest.fn(),
}));

const { VacuumService } = await import('./VacuumService.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeConfig(overrides: Partial<XiaomiServiceConfig> = {}): XiaomiServiceConfig {
  return {
    session: { userId: 'u1', ssecurity: 's1', serviceToken: 'tk1', savedAt: '2024-01-01T00:00:00.000Z' },
    region: 'de',
    pollInterval: 5000,
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

const vacuumDevice = { did: 'did-vac-1', name: 'Vacuum', model: 'dreame.vacuum.p2150' };
const fountainDevice = { did: 'did-fountain-1', name: 'Fountain', model: 'mmgg.pet_waterer.wi11' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VacuumService', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates a service without connecting', () => {
      const svc = new VacuumService(log as any, makeConfig());
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('exposes dreame, vacuum, roborock patterns', () => {
      const svc = new VacuumService(log as any, makeConfig());
      expect(svc.modelPatterns).toContain('dreame');
      expect(svc.modelPatterns).toContain('roborock');
    });
  });

  describe('connect', () => {
    it('filters vacuum devices and creates one client per vacuum', async () => {
      const mockClientInstance = makeMockClient();
      MockDreameVacuumClient.mockImplementation(() => mockClientInstance);

      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([vacuumDevice, fountainDevice] as any);

      expect(svc.getDevices()).toHaveLength(1);
      expect(svc.getDevices()[0]!.did).toBe('did-vac-1');
      expect(MockDreameVacuumClient).toHaveBeenCalledTimes(1);
      expect(MockDreameVacuumClient).toHaveBeenCalledWith({
        deviceId: 'did-vac-1',
        region: 'de',
        pollInterval: 5000,
        session: expect.objectContaining({ userId: 'u1' }),
      });
    });

    it('creates no clients when no vacuum devices present', async () => {
      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([fountainDevice] as any);

      expect(svc.getDevices()).toHaveLength(0);
      expect(MockDreameVacuumClient).not.toHaveBeenCalled();
    });
  });

  describe('connectDevice', () => {
    it('calls connect() on a disconnected client and returns it', async () => {
      const mockClientInstance = makeMockClient(false);
      MockDreameVacuumClient.mockImplementation(() => mockClientInstance);

      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([vacuumDevice] as any);
      const client = await svc.connectDevice('did-vac-1');

      expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
      expect(client).toBe(mockClientInstance);
    });

    it('does not reconnect an already-connected client', async () => {
      const mockClientInstance = makeMockClient(true);
      MockDreameVacuumClient.mockImplementation(() => mockClientInstance);

      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([vacuumDevice] as any);
      await svc.connectDevice('did-vac-1');

      expect(mockClientInstance.connect).not.toHaveBeenCalled();
    });

    it('throws when DID is unknown', async () => {
      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([] as any);

      await expect(svc.connectDevice('unknown')).rejects.toThrow('No vacuum client');
    });
  });

  describe('disconnect', () => {
    it('disconnects all connected clients and clears state', async () => {
      const mockClientInstance = makeMockClient(true);
      MockDreameVacuumClient.mockImplementation(() => mockClientInstance);

      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([vacuumDevice] as any);
      await svc.disconnect();

      expect(mockClientInstance.disconnect).toHaveBeenCalledTimes(1);
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('skips disconnect for non-connected clients', async () => {
      const mockClientInstance = makeMockClient(false);
      MockDreameVacuumClient.mockImplementation(() => mockClientInstance);

      const svc = new VacuumService(log as any, makeConfig());
      await svc.connect([vacuumDevice] as any);
      await svc.disconnect();

      expect(mockClientInstance.disconnect).not.toHaveBeenCalled();
    });
  });
});
