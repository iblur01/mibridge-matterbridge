/**
 * Tests for XiaomiVacuumService
 *
 * @file xiaomiService.test.ts
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { XiaomiServiceConfig } from './xiaomiService.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// jest.unstable_mockModule must be called before dynamic imports of modules
// that depend on the mocked modules. Static imports of types are fine.

const mockListDevices = jest.fn();
const MockDreameVacuumClient = jest.fn();

jest.unstable_mockModule('@mibridge/core', () => ({
  listDevices: mockListDevices,
  DreameVacuumClient: MockDreameVacuumClient,
}));

jest.unstable_mockModule('matterbridge/logger', () => ({
  AnsiLogger: jest.fn(),
}));

// Dynamic imports must come after mock registrations
const { XiaomiVacuumService } = await import('./xiaomiService.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function makeSession() {
  return { userId: 'u1', ssecurity: 's1', serviceToken: 'tk1', savedAt: '2024-01-01T00:00:00.000Z' };
}

function makeConfig(overrides: Partial<XiaomiServiceConfig> = {}): XiaomiServiceConfig {
  return { session: makeSession(), region: 'de', pollInterval: 5000, ...overrides };
}

function makeMockClientObj(connected = false) {
  return {
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isConnected: jest.fn<() => boolean>().mockReturnValue(connected),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('XiaomiVacuumService', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    log = makeLog();
    jest.clearAllMocks();
  });

  // ── constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a service instance without connecting', () => {
      const svc = new XiaomiVacuumService(log as any, makeConfig());
      expect(svc.isServiceConnected()).toBe(false);
      expect(svc.getDevices()).toHaveLength(0);
    });
  });

  // ── connect ─────────────────────────────────────────────────────────────────

  describe('connect', () => {
    it('fetches devices and creates clients for vacuum models', async () => {
      const devices = [
        { did: 'd1', name: 'Dreame Bot', model: 'dreame.vacuum.l10s' },
        { did: 'd2', name: 'Other Device', model: 'light.bulb.generic' },
      ];
      mockListDevices.mockResolvedValue(devices);
      MockDreameVacuumClient.mockImplementation(() => makeMockClientObj() as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      expect(mockListDevices).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 'de');
      expect(svc.isServiceConnected()).toBe(true);
      expect(svc.getClient('d1')).toBeDefined();
      expect(svc.getClient('d2')).toBeUndefined();
    });

    it('creates clients for roborock and vacuum keyword models', async () => {
      const devices = [
        { did: 'r1', name: 'Roborock', model: 'roborock.sweep.t7s' },
        { did: 'v1', name: 'Generic Vac', model: 'generic.vacuum.1' },
      ];
      mockListDevices.mockResolvedValue(devices);
      MockDreameVacuumClient.mockImplementation(() => makeMockClientObj() as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      expect(svc.getClient('r1')).toBeDefined();
      expect(svc.getClient('v1')).toBeDefined();
    });

    it('warns and returns early if already connected', async () => {
      mockListDevices.mockResolvedValue([]);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      await svc.connect();

      expect(log.warn).toHaveBeenCalledWith('XiaomiVacuumService already connected');
      expect(mockListDevices).toHaveBeenCalledTimes(1);
    });

    it('logs error and rethrows if listDevices fails', async () => {
      mockListDevices.mockRejectedValue(new Error('network error'));

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await expect(svc.connect()).rejects.toThrow('network error');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to connect'));
      expect(svc.isServiceConnected()).toBe(false);
    });

    it('uses default region "de" and pollInterval 5000 when not provided', async () => {
      const devices = [{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }];
      mockListDevices.mockResolvedValue(devices);
      MockDreameVacuumClient.mockImplementation(() => makeMockClientObj() as any);

      const svc = new XiaomiVacuumService(log as any, { session: makeSession() });
      await svc.connect();

      expect(MockDreameVacuumClient).toHaveBeenCalledWith(expect.objectContaining({ region: 'de', pollInterval: 5000 }));
    });
  });

  // ── connectVacuum ───────────────────────────────────────────────────────────

  describe('connectVacuum', () => {
    it('returns an already-connected client without calling connect()', async () => {
      const mockClient = makeMockClientObj(true);
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => mockClient as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      const client = await svc.connectVacuum('d1');

      expect(client).toBe(mockClient);
      expect(mockClient.connect).not.toHaveBeenCalled();
    });

    it('calls connect() if client is not connected yet', async () => {
      const mockClient = makeMockClientObj(false);
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => mockClient as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      await svc.connectVacuum('d1');

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('throws if DID is unknown', async () => {
      mockListDevices.mockResolvedValue([]);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      await expect(svc.connectVacuum('unknown-did')).rejects.toThrow('No client found for device unknown-did');
    });
  });

  // ── disconnect ──────────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('returns early without logging if not connected', async () => {
      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.disconnect();
      expect(log.info).not.toHaveBeenCalled();
    });

    it('disconnects all connected clients and resets state', async () => {
      const mockClient = makeMockClientObj(true);
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => mockClient as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      await svc.disconnect();

      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
      expect(svc.isServiceConnected()).toBe(false);
      expect(svc.getDevices()).toHaveLength(0);
    });

    it('skips disconnect() for clients that are not connected', async () => {
      const mockClient = makeMockClientObj(false);
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => mockClient as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      await svc.disconnect();

      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('logs error and continues if a client disconnect throws', async () => {
      const mockClient = makeMockClientObj(true);
      (mockClient.disconnect as ReturnType<typeof jest.fn>).mockRejectedValue(new Error('disconnect fail'));
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => mockClient as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      await svc.disconnect();

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Error disconnecting vacuum d1'));
      expect(svc.isServiceConnected()).toBe(false);
    });
  });

  // ── getVacuums ──────────────────────────────────────────────────────────────

  describe('getVacuums', () => {
    it('filters devices by dreame/vacuum/roborock model keywords', async () => {
      const devices = [
        { did: 'd1', name: 'Dreame', model: 'dreame.vacuum.x' },
        { did: 'd2', name: 'Roborock', model: 'roborock.sweep.s' },
        { did: 'd3', name: 'Vac', model: 'generic.vacuum.v1' },
        { did: 'd4', name: 'Light', model: 'yeelink.light.color1' },
      ];
      mockListDevices.mockResolvedValue(devices);
      MockDreameVacuumClient.mockImplementation(() => makeMockClientObj() as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      const vacuums = svc.getVacuums();
      expect(vacuums).toHaveLength(3);
      expect(vacuums.map((v) => v.did)).toEqual(['d1', 'd2', 'd3']);
    });

    it('returns empty array when no vacuum devices are found', async () => {
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Light', model: 'yeelink.light.x' }]);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      expect(svc.getVacuums()).toHaveLength(0);
    });
  });

  // ── getDevices ──────────────────────────────────────────────────────────────

  describe('getDevices', () => {
    it('returns all discovered devices (not just vacuums)', async () => {
      const devices = [
        { did: 'd1', name: 'Dreame', model: 'dreame.vacuum.x' },
        { did: 'd2', name: 'Light', model: 'yeelink.light.x' },
      ];
      mockListDevices.mockResolvedValue(devices);
      MockDreameVacuumClient.mockImplementation(() => makeMockClientObj() as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      expect(svc.getDevices()).toHaveLength(2);
    });

    it('returns a copy — mutations do not affect internal state', async () => {
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => makeMockClientObj() as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      const devices = svc.getDevices();
      devices.push({ did: 'injected', name: 'Evil', model: 'evil' });

      expect(svc.getDevices()).toHaveLength(1);
    });
  });

  // ── getClient ───────────────────────────────────────────────────────────────

  describe('getClient', () => {
    it('returns the client for a known DID', async () => {
      const mockClient = makeMockClientObj();
      mockListDevices.mockResolvedValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      MockDreameVacuumClient.mockImplementation(() => mockClient as any);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      expect(svc.getClient('d1')).toBe(mockClient);
    });

    it('returns undefined for an unknown DID', async () => {
      mockListDevices.mockResolvedValue([]);

      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();

      expect(svc.getClient('unknown')).toBeUndefined();
    });
  });

  // ── isServiceConnected ──────────────────────────────────────────────────────

  describe('isServiceConnected', () => {
    it('returns false before connect()', () => {
      const svc = new XiaomiVacuumService(log as any, makeConfig());
      expect(svc.isServiceConnected()).toBe(false);
    });

    it('returns true after successful connect()', async () => {
      mockListDevices.mockResolvedValue([]);
      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      expect(svc.isServiceConnected()).toBe(true);
    });

    it('returns false after disconnect()', async () => {
      mockListDevices.mockResolvedValue([]);
      const svc = new XiaomiVacuumService(log as any, makeConfig());
      await svc.connect();
      await svc.disconnect();
      expect(svc.isServiceConnected()).toBe(false);
    });
  });
});
