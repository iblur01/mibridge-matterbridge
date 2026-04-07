/**
 * Tests for FountainService
 *
 * @file devices/fountain/FountainService.test.ts
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { XiaomiServiceConfig } from '../../platform/DeviceService.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPetFountainClient = jest.fn();

jest.unstable_mockModule('@mibridge/core', () => ({
  PetFountainClient: mockPetFountainClient,
}));

jest.unstable_mockModule('matterbridge/logger', () => ({
  AnsiLogger: jest.fn(),
}));

// Dynamic imports after mock registrations
const { FountainService } = await import('./FountainService.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeConfig(overrides: Partial<XiaomiServiceConfig> = {}): XiaomiServiceConfig {
  return {
    session: { userId: 'u1', ssecurity: 's1', serviceToken: 'tk1', savedAt: '2024-01-01T00:00:00.000Z' },
    region: 'de',
    pollInterval: 30000,
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

const fountainDevice = { did: 'did-fountain-1', name: 'Cat Fountain', model: 'mmgg.pet_waterer.wi11' };
const vacuumDevice = { did: 'did-vac-1', name: 'Vacuum', model: 'dreame.vacuum.p2150' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FountainService', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates a service without connecting', () => {
      const svc = new FountainService(log as any, makeConfig());
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('exposes pet_waterer model pattern', () => {
      const svc = new FountainService(log as any, makeConfig());
      expect(svc.modelPatterns).toContain('pet_waterer');
    });
  });

  describe('connect', () => {
    it('filters fountain devices and creates one client per fountain', async () => {
      const mockClientInstance = makeMockClient();
      mockPetFountainClient.mockImplementation(() => mockClientInstance);

      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([fountainDevice, vacuumDevice] as any);

      expect(svc.getDevices()).toHaveLength(1);
      expect(svc.getDevices()[0]!.did).toBe('did-fountain-1');
      expect(mockPetFountainClient).toHaveBeenCalledTimes(1);
      expect(mockPetFountainClient).toHaveBeenCalledWith({
        deviceId: 'did-fountain-1',
        region: 'de',
        pollInterval: 30000,
        session: expect.objectContaining({ userId: 'u1' }),
      });
    });

    it('creates no clients when no fountain devices present', async () => {
      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([vacuumDevice] as any);

      expect(svc.getDevices()).toHaveLength(0);
      expect(mockPetFountainClient).not.toHaveBeenCalled();
    });
  });

  describe('connectDevice', () => {
    it('calls connect() on the client and returns it', async () => {
      const mockClientInstance = makeMockClient(false);
      mockPetFountainClient.mockImplementation(() => mockClientInstance);

      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([fountainDevice] as any);
      const client = await svc.connectDevice('did-fountain-1');

      expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
      expect(client).toBe(mockClientInstance);
    });

    it('does not reconnect an already-connected client', async () => {
      const mockClientInstance = makeMockClient(true);
      mockPetFountainClient.mockImplementation(() => mockClientInstance);

      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([fountainDevice] as any);
      await svc.connectDevice('did-fountain-1');

      expect(mockClientInstance.connect).not.toHaveBeenCalled();
    });

    it('throws when DID is unknown', async () => {
      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([] as any);

      await expect(svc.connectDevice('unknown-did')).rejects.toThrow('No fountain client');
    });
  });

  describe('disconnect', () => {
    it('disconnects all connected clients', async () => {
      const client1 = makeMockClient(true);
      const client2 = makeMockClient(true);
      let callCount = 0;
      mockPetFountainClient.mockImplementation(() => (callCount++ === 0 ? client1 : client2));

      const device2 = { did: 'did-fountain-2', name: 'Fountain 2', model: 'xiaomi.pet_waterer.iv02' };
      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([fountainDevice, device2] as any);
      await svc.disconnect();

      expect(client1.disconnect).toHaveBeenCalledTimes(1);
      expect(client2.disconnect).toHaveBeenCalledTimes(1);
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('skips disconnect for non-connected clients', async () => {
      const mockClientInstance = makeMockClient(false);
      mockPetFountainClient.mockImplementation(() => mockClientInstance);

      const svc = new FountainService(log as any, makeConfig());
      await svc.connect([fountainDevice] as any);
      await svc.disconnect();

      expect(mockClientInstance.disconnect).not.toHaveBeenCalled();
    });
  });
});
