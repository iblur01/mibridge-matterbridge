/**
 * Tests for MibridgePlatform
 *
 * @file module.test.ts
 */

import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── Enum values (shared across mocks and tests) ──────────────────────────────

const CleanMode = { Vacuum: 'vacuum', Mop: 'mop', VacuumThenMop: 'vacuumThenMop' } as const;
const VacuumState = {
  Idle: 'idle',
  Cleaning: 'cleaning',
  Mapping: 'mapping',
  Returning: 'returning',
  Docked: 'docked',
  Paused: 'paused',
  Error: 'error',
} as const;
const VacuumErrorCode = {
  None: 'none',
  MopPadMissing: 'mopPadMissing',
  WaterTankMissing: 'waterTankMissing',
  WaterTankEmpty: 'waterTankEmpty',
} as const;
const WaterLevel = { Off: 'off', Low: 'low', Medium: 'medium', High: 'high' } as const;
const LogLevel = { Debug: 'debug', Info: 'info', Warn: 'warn', Error: 'error' } as const;

// ─── Mock factories ───────────────────────────────────────────────────────────
// jest.unstable_mockModule must be called before dynamic imports that load
// the mocked modules. Factories can reference outer variables (no hoisting).

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

  verifyMatterbridgeVersion(_v: string) {
    return true;
  }
  clearSelect() {
    return Promise.resolve();
  }
  setSelectDevice(_did: string, _name: string) {}
  validateDevice(_args: string[]) {
    return true;
  }
  registerDevice(_device: unknown) {
    return Promise.resolve();
  }
  unregisterAllDevices() {
    return Promise.resolve();
  }
  onConfigure() {
    return Promise.resolve();
  }
  onShutdown(_reason?: string) {
    return Promise.resolve();
  }
}

const MockRoboticVacuumCleaner = jest.fn();
const MockXiaomiVacuumService = jest.fn();

jest.unstable_mockModule('matterbridge', () => ({
  MatterbridgeDynamicPlatform: MockMatterbridgeDynamicPlatform,
}));

jest.unstable_mockModule('matterbridge/devices', () => ({
  RoboticVacuumCleaner: MockRoboticVacuumCleaner,
}));

jest.unstable_mockModule('matterbridge/logger', () => ({
  AnsiLogger: jest.fn(),
  LogLevel,
}));

jest.unstable_mockModule('@mibridge/core', () => ({
  CleanMode,
  VacuumState,
  VacuumErrorCode,
  WaterLevel,
  DreameVacuumClient: jest.fn(),
}));

jest.unstable_mockModule('./xiaomiService.js', () => ({
  XiaomiVacuumService: MockXiaomiVacuumService,
}));

// ─── Dynamic imports (after mocks are registered) ─────────────────────────────

const moduleExports = await import('./module.js');
const MibridgePlatform = moduleExports.MibridgePlatform;
const initializePlugin = moduleExports.default;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMatterbridge(version = '3.7.2') {
  return { matterbridgeVersion: version };
}

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

function makeMockClient() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isConnected: jest.fn<() => boolean>().mockReturnValue(false),
    getMaps: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    getStatus: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      state: VacuumState.Docked,
      batteryLevel: 100,
      cleanMode: CleanMode.Vacuum,
      runMode: 'idle',
      errorCode: VacuumErrorCode.None,
    }),
    getSupportedCleanModes: jest.fn<() => Promise<string[]>>().mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop, CleanMode.VacuumThenMop]),
    returnToDock: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    resume: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    pause: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startMapping: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    selectAreas: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getSelectedAreas: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
    startCleaningAreas: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setCleanMode: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getInfo: jest.fn<() => Promise<unknown>>().mockResolvedValue({ model: 'dreame', firmwareVersion: '1.0', serialNumber: 'SN1' }),
    getCleanMode: jest.fn<() => Promise<string>>().mockResolvedValue(CleanMode.Vacuum),
    getRunMode: jest.fn<() => Promise<string>>().mockResolvedValue('idle'),
  });
}

type MockClient = ReturnType<typeof makeMockClient>;

// ─── Per-test state (populated in beforeEach) ─────────────────────────────────

let log: ReturnType<typeof makeLog>;
let matterbridge: ReturnType<typeof makeMatterbridge>;
let mockClient: MockClient;
let mockServiceInstance: {
  connect: ReturnType<typeof jest.fn>;
  disconnect: ReturnType<typeof jest.fn>;
  getVacuums: ReturnType<typeof jest.fn>;
  connectVacuum: ReturnType<typeof jest.fn>;
  isServiceConnected: ReturnType<typeof jest.fn>;
};
let capturedHandlers: Record<string, (args: { request: Record<string, unknown> }) => Promise<void>>;
let mockVacuumInstance: {
  addCommandHandler: ReturnType<typeof jest.fn>;
  setAttribute: ReturnType<typeof jest.fn>;
  createDefaultRvcCleanModeClusterServer: ReturnType<typeof jest.fn>;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('initializePlugin', () => {
  it('returns a MibridgePlatform instance', () => {
    const l = makeLog();
    MockXiaomiVacuumService.mockImplementation(() => ({ connect: jest.fn(), disconnect: jest.fn(), getVacuums: jest.fn().mockReturnValue([]) }) as any);
    const platform = initializePlugin(makeMatterbridge() as any, l as any, makeConfig() as any);
    expect(platform).toBeInstanceOf(MibridgePlatform);
  });
});

describe('MibridgePlatform', () => {
  beforeEach(() => {
    log = makeLog();
    matterbridge = makeMatterbridge();
    mockClient = makeMockClient();
    capturedHandlers = {};

    mockVacuumInstance = {
      addCommandHandler: jest.fn((name: unknown, handler: unknown) => {
        capturedHandlers[name as string] = handler as (args: { request: Record<string, unknown> }) => Promise<void>;
      }),
      setAttribute: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      createDefaultRvcCleanModeClusterServer: jest.fn(),
    };

    mockServiceInstance = {
      connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getVacuums: jest.fn<() => unknown[]>().mockReturnValue([]),
      connectVacuum: jest.fn<() => Promise<unknown>>().mockResolvedValue(mockClient),
      isServiceConnected: jest.fn<() => boolean>().mockReturnValue(true),
    };

    jest.clearAllMocks();

    MockXiaomiVacuumService.mockImplementation(() => mockServiceInstance as any);
    MockRoboticVacuumCleaner.mockImplementation(() => mockVacuumInstance as any);
  });

  // ── constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes with verbose=false by default', () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      expect((platform as any).verbose).toBe(false);
    });

    it('enables verbose mode when config.verbose=true', () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ verbose: true }) as any);
      expect((platform as any).verbose).toBe(true);
    });

    it('throws if verifyMatterbridgeVersion returns false', () => {
      jest.spyOn(MockMatterbridgeDynamicPlatform.prototype, 'verifyMatterbridgeVersion').mockReturnValueOnce(false);
      expect(() => new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any)).toThrow('This plugin requires Matterbridge version');
    });
  });

  // ── onStart ─────────────────────────────────────────────────────────────────

  describe('onStart', () => {
    it('logs error and returns early when session is not configured', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ session: undefined }) as any);
      await platform.onStart('test');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Xiaomi session not configured'));
    });

    it('returns early when session fields are empty', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ session: { userId: '', ssecurity: '', serviceToken: '' } }) as any);
      await platform.onStart('test');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Xiaomi session not configured'));
    });

    it('connects and discovers devices on valid session', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart('test');
      expect(MockXiaomiVacuumService).toHaveBeenCalled();
      expect(mockServiceInstance.connect).toHaveBeenCalledTimes(1);
    });

    it('logs error if xiaomiService.connect() throws', async () => {
      mockServiceInstance.connect.mockRejectedValue(new Error('cloud down'));
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart('test');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize Xiaomi service'));
    });

    it('uses configured region and pollInterval', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ region: 'us', pollInterval: 10000 }) as any);
      await platform.onStart();
      expect(MockXiaomiVacuumService).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ region: 'us', pollInterval: 10000 }));
    });
  });

  // ── onShutdown ──────────────────────────────────────────────────────────────

  describe('onShutdown', () => {
    it('disconnects the xiaomi service and nullifies it', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart();
      await platform.onShutdown('test');
      expect(mockServiceInstance.disconnect).toHaveBeenCalledTimes(1);
      expect((platform as any).xiaomiService).toBeNull();
    });

    it('clears the vacuum clients map', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      (platform as any).vacuumClients.set('did-1', mockClient);
      await platform.onShutdown();
      expect((platform as any).vacuumClients.size).toBe(0);
    });

    it('calls unregisterAllDevices when config says so', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ unregisterOnShutdown: true }) as any);
      const spy = jest.spyOn(platform as any, 'unregisterAllDevices').mockResolvedValue(undefined);
      await platform.onStart();
      await platform.onShutdown();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not call unregisterAllDevices by default', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      const spy = jest.spyOn(platform as any, 'unregisterAllDevices').mockResolvedValue(undefined);
      await platform.onStart();
      await platform.onShutdown();
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not throw if xiaomiService is null', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await expect(platform.onShutdown()).resolves.not.toThrow();
    });
  });

  // ── onConfigure ─────────────────────────────────────────────────────────────

  describe('onConfigure', () => {
    it('logs that it was called', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onConfigure();
      expect(log.info).toHaveBeenCalledWith('onConfigure called');
    });
  });

  // ── onChangeLoggerLevel ─────────────────────────────────────────────────────

  describe('onChangeLoggerLevel', () => {
    it('logs the new log level', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onChangeLoggerLevel(LogLevel.Debug as any);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('onChangeLoggerLevel'));
    });
  });

  // ── mapVacuumStateToMatter ──────────────────────────────────────────────────

  describe('mapVacuumStateToMatter', () => {
    it.each([
      [VacuumState.Idle, 0x00],
      [VacuumState.Cleaning, 0x01],
      [VacuumState.Mapping, 0x01],
      [VacuumState.Returning, 0x40],
      [VacuumState.Docked, 0x42],
      [VacuumState.Paused, 0x02],
      [VacuumState.Error, 0x03],
    ])('maps %s → %i', (state, expected) => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      expect((platform as any).mapVacuumStateToMatter(state)).toBe(expected);
    });

    it('returns 0x00 for unknown state', () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      expect((platform as any).mapVacuumStateToMatter('unknown-state')).toBe(0x00);
    });
  });

  // ── discoverDevices ─────────────────────────────────────────────────────────

  describe('discoverDevices', () => {
    it('warns when no vacuums are found', async () => {
      mockServiceInstance.getVacuums.mockReturnValue([]);
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart();
      expect(log.warn).toHaveBeenCalledWith('No Xiaomi vacuum devices found');
    });

    it('registers a vacuum device for each discovered vacuum', async () => {
      mockServiceInstance.getVacuums.mockReturnValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      const spy = jest.spyOn(platform as any, 'registerDevice').mockResolvedValue(undefined);
      await platform.onStart();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('skips registration when validateDevice returns false', async () => {
      mockServiceInstance.getVacuums.mockReturnValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      jest.spyOn(platform as any, 'validateDevice').mockReturnValue(false);
      const spy = jest.spyOn(platform as any, 'registerDevice').mockResolvedValue(undefined);
      await platform.onStart();
      expect(spy).not.toHaveBeenCalled();
    });

    it('logs error and continues on per-device failure', async () => {
      mockServiceInstance.getVacuums.mockReturnValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      mockServiceInstance.connectVacuum.mockRejectedValue(new Error('connect failed'));
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to setup vacuum'));
    });

    it('uses areas from the first map', async () => {
      mockServiceInstance.getVacuums.mockReturnValue([{ did: 'd1', name: 'Bot', model: 'dreame.vacuum.x' }]);
      mockClient.getMaps.mockResolvedValue([{ id: '1', name: 'Ground', areas: [{ id: '10', name: 'Living Room', mapId: '1' }] }]);
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      jest.spyOn(platform as any, 'registerDevice').mockResolvedValue(undefined);
      await platform.onStart();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Found 1 area(s)'));
    });
  });

  // ── detectAndConfigureMopCapabilities ──────────────────────────────────────

  describe('detectAndConfigureMopCapabilities', () => {
    it('configures vacuum-only mode when mop pad is missing', async () => {
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.MopPadMissing,
      });
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);

      const modes = mockVacuumInstance.createDefaultRvcCleanModeClusterServer.mock.calls[0][1] as Array<{
        label: string;
      }>;
      expect(modes).toHaveLength(1);
      expect(modes[0].label).toBe('Vacuum');
    });

    it('configures vacuum-only mode when water tank is missing', async () => {
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.WaterTankMissing,
      });
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);

      const modes = mockVacuumInstance.createDefaultRvcCleanModeClusterServer.mock.calls[0][1] as Array<{
        label: string;
      }>;
      expect(modes).toHaveLength(1);
      expect(modes[0].label).toBe('Vacuum');
    });

    it('configures all modes when mop is detected via water level', async () => {
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
        waterLevel: 'medium',
      });
      mockClient.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop, CleanMode.VacuumThenMop]);
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);

      const modes = mockVacuumInstance.createDefaultRvcCleanModeClusterServer.mock.calls[0][1] as Array<{
        label: string;
      }>;
      expect(modes).toHaveLength(3);
    });

    it('logs warning and continues if getStatus throws', async () => {
      mockClient.getStatus.mockRejectedValue(new Error('timeout'));
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not detect mop capabilities'));
    });
  });

  // ── setupCommandHandlers ────────────────────────────────────────────────────

  describe('setupCommandHandlers', () => {
    let platform: InstanceType<typeof MibridgePlatform>;

    beforeEach(() => {
      platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      (platform as any).setupCommandHandlers(mockVacuumInstance, mockClient, 'did-1');
    });

    it('registers all expected command handlers', () => {
      expect(capturedHandlers['RvcOperationalState.goHome']).toBeDefined();
      expect(capturedHandlers['RvcOperationalState.resume']).toBeDefined();
      expect(capturedHandlers['RvcOperationalState.pause']).toBeDefined();
      expect(capturedHandlers['ServiceArea.selectAreas']).toBeDefined();
      expect(capturedHandlers['RvcRunMode.changeToMode']).toBeDefined();
      expect(capturedHandlers['RvcCleanMode.changeToMode']).toBeDefined();
    });

    it('goHome calls client.returnToDock()', async () => {
      await capturedHandlers['RvcOperationalState.goHome']({ request: {} });
      expect(mockClient.returnToDock).toHaveBeenCalledTimes(1);
    });

    it('goHome rethrows on client error', async () => {
      mockClient.returnToDock.mockRejectedValue(new Error('dock fail'));
      await expect(capturedHandlers['RvcOperationalState.goHome']({ request: {} })).rejects.toThrow('dock fail');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to return to dock'));
    });

    it('resume calls client.resume()', async () => {
      await capturedHandlers['RvcOperationalState.resume']({ request: {} });
      expect(mockClient.resume).toHaveBeenCalledTimes(1);
    });

    it('pause calls client.pause()', async () => {
      await capturedHandlers['RvcOperationalState.pause']({ request: {} });
      expect(mockClient.pause).toHaveBeenCalledTimes(1);
    });

    it('selectAreas maps area IDs and calls client.selectAreas()', async () => {
      await capturedHandlers['ServiceArea.selectAreas']({ request: { newAreas: [1, 2, 3] } });
      expect(mockClient.selectAreas).toHaveBeenCalledWith(['1', '2', '3']);
    });

    it('selectAreas with empty newAreas calls client.selectAreas([])', async () => {
      await capturedHandlers['ServiceArea.selectAreas']({ request: {} });
      expect(mockClient.selectAreas).toHaveBeenCalledWith([]);
    });

    it('changeToMode(0) calls client.stop()', async () => {
      await capturedHandlers['RvcRunMode.changeToMode']({ request: { newMode: 0 } });
      expect(mockClient.stop).toHaveBeenCalledTimes(1);
    });

    it('changeToMode(1) with no selected areas calls client.start()', async () => {
      mockClient.getSelectedAreas.mockResolvedValue([]);
      await capturedHandlers['RvcRunMode.changeToMode']({ request: { newMode: 1 } });
      expect(mockClient.start).toHaveBeenCalledTimes(1);
      expect(mockClient.startCleaningAreas).not.toHaveBeenCalled();
    });

    it('changeToMode(1) with selected areas calls client.startCleaningAreas()', async () => {
      mockClient.getSelectedAreas.mockResolvedValue(['area-1', 'area-2']);
      await capturedHandlers['RvcRunMode.changeToMode']({ request: { newMode: 1 } });
      expect(mockClient.startCleaningAreas).toHaveBeenCalledWith(['area-1', 'area-2']);
      expect(mockClient.start).not.toHaveBeenCalled();
    });

    it('changeToMode(2) calls client.startMapping()', async () => {
      await capturedHandlers['RvcRunMode.changeToMode']({ request: { newMode: 2 } });
      expect(mockClient.startMapping).toHaveBeenCalledTimes(1);
    });

    it('cleanMode changeToMode(0) calls client.setCleanMode(Vacuum)', async () => {
      await capturedHandlers['RvcCleanMode.changeToMode']({ request: { newMode: 0 } });
      expect(mockClient.setCleanMode).toHaveBeenCalledWith(CleanMode.Vacuum);
    });

    it('cleanMode changeToMode(1) calls client.setCleanMode(Mop)', async () => {
      await capturedHandlers['RvcCleanMode.changeToMode']({ request: { newMode: 1 } });
      expect(mockClient.setCleanMode).toHaveBeenCalledWith(CleanMode.Mop);
    });

    it('cleanMode changeToMode(2) calls client.setCleanMode(VacuumThenMop)', async () => {
      await capturedHandlers['RvcCleanMode.changeToMode']({ request: { newMode: 2 } });
      expect(mockClient.setCleanMode).toHaveBeenCalledWith(CleanMode.VacuumThenMop);
    });

    it('cleanMode changeToMode with unknown mode does nothing', async () => {
      await capturedHandlers['RvcCleanMode.changeToMode']({ request: { newMode: 99 } });
      expect(mockClient.setCleanMode).not.toHaveBeenCalled();
    });
  });

  // ── setupEventListeners ─────────────────────────────────────────────────────

  describe('setupEventListeners', () => {
    let platform: InstanceType<typeof MibridgePlatform>;

    beforeEach(() => {
      platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      (platform as any).setupEventListeners(mockVacuumInstance, mockClient, 'did-1');
    });

    it('statusChange updates battery attribute (100% → 200)', async () => {
      mockClient.emit('statusChange', {
        state: VacuumState.Docked,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
      });
      await Promise.resolve();
      expect(mockVacuumInstance.setAttribute).toHaveBeenCalledWith('PowerSource', 'batPercentRemaining', 200);
    });

    it('statusChange updates battery attribute (50% → 100)', async () => {
      mockClient.emit('statusChange', {
        state: VacuumState.Cleaning,
        batteryLevel: 50,
        cleanMode: CleanMode.Vacuum,
        runMode: 'cleaning',
        errorCode: VacuumErrorCode.None,
      });
      await Promise.resolve();
      expect(mockVacuumInstance.setAttribute).toHaveBeenCalledWith('PowerSource', 'batPercentRemaining', 100);
    });

    it('statusChange updates operational state from vacuum state', async () => {
      mockClient.emit('statusChange', {
        state: VacuumState.Cleaning,
        batteryLevel: 80,
        cleanMode: CleanMode.Vacuum,
        runMode: 'cleaning',
        errorCode: VacuumErrorCode.None,
      });
      await Promise.resolve();
      expect(mockVacuumInstance.setAttribute).toHaveBeenCalledWith('RvcOperationalState', 'operationalState', 0x01);
    });

    it('statusChange reconfigures mop when mop is detected after being absent', async () => {
      // Flush helper: drains all microtasks (setTimeout runs after all pending microtasks)
      const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

      // First: mop missing — must fully complete before we set the spy
      mockClient.emit('statusChange', {
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.MopPadMissing,
      });
      await flush(); // wait for all awaits inside the handler to settle

      const spy = jest.spyOn(platform as any, 'detectAndConfigureMopCapabilities').mockResolvedValue(undefined);

      // Second: mop present
      mockClient.emit('statusChange', {
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
      });
      await flush();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Mop pad detected'));
    });

    it('statusChange reconfigures mop when mop is removed', async () => {
      const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

      // First: mop present — must fully complete before we set the spy
      mockClient.emit('statusChange', {
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
      });
      await flush();

      const spy = jest.spyOn(platform as any, 'detectAndConfigureMopCapabilities').mockResolvedValue(undefined);

      // Second: mop missing
      mockClient.emit('statusChange', {
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.MopPadMissing,
      });
      await flush();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Mop pad removed'));
    });

    it('stateChange updates Matter operational state', async () => {
      mockClient.emit('stateChange', VacuumState.Returning);
      await Promise.resolve();
      expect(mockVacuumInstance.setAttribute).toHaveBeenCalledWith('RvcOperationalState', 'operationalState', 0x40);
    });

    it('stateChange logs error if setAttribute throws', async () => {
      mockVacuumInstance.setAttribute.mockRejectedValue(new Error('attr fail'));
      mockClient.emit('stateChange', VacuumState.Docked);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to update Matter state'));
    });

    it('error event logs the error', () => {
      mockClient.emit('error', new Error('connection lost'));
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Vacuum error'));
    });

    it('connected event logs info', () => {
      mockClient.emit('connected');
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Vacuum client connected'));
    });

    it('disconnected event logs warning', () => {
      mockClient.emit('disconnected');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Vacuum client disconnected'));
    });
  });
});
