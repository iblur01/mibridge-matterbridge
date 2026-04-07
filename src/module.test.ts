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

    jest.clearAllMocks();

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
      expect(log.warn).toHaveBeenCalledWith('No Xiaomi vacuum devices found');
    });
  });

  // ── onShutdown ──────────────────────────────────────────────────────────────

  describe('onShutdown', () => {
    it('clears state on shutdown', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart();
      await platform.onShutdown('test');
      expect((platform as any).vacuumClients.size).toBe(0);
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
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await platform.onStart();
      expect(log.warn).toHaveBeenCalledWith('No Xiaomi vacuum devices found');
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

    it('uses default supported modes when mop is not explicitly detected', async () => {
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
        waterLevel: WaterLevel.Off,
      });
      mockClient.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum]);
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Using default supported modes'));
    });

    it('logs debug when clean mode cluster update throws', async () => {
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
        waterLevel: 'medium',
      });
      mockVacuumInstance.createDefaultRvcCleanModeClusterServer.mockImplementation(() => {
        throw new Error('already configured');
      });
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Could not update clean modes'));
    });

    it('logs detailed mop detection info in verbose mode', async () => {
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Idle,
        batteryLevel: 100,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
        waterLevel: 'medium',
      });
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ verbose: true }) as any);
      await (platform as any).detectAndConfigureMopCapabilities('d1', mockClient, mockVacuumInstance);
      expect(log.info).toHaveBeenCalledWith('[d1] Mop Detection Results:');
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Configured Modes:'));
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

    it('resume rethrows on client error', async () => {
      mockClient.resume.mockRejectedValue(new Error('resume fail'));
      await expect(capturedHandlers['RvcOperationalState.resume']({ request: {} })).rejects.toThrow('resume fail');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to resume'));
    });

    it('pause rethrows on client error', async () => {
      mockClient.pause.mockRejectedValue(new Error('pause fail'));
      await expect(capturedHandlers['RvcOperationalState.pause']({ request: {} })).rejects.toThrow('pause fail');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to pause'));
    });

    it('selectAreas maps area IDs and calls client.selectAreas()', async () => {
      await capturedHandlers['ServiceArea.selectAreas']({ request: { newAreas: [1, 2, 3] } });
      expect(mockClient.selectAreas).toHaveBeenCalledWith(['1', '2', '3']);
    });

    it('selectAreas with empty newAreas calls client.selectAreas([])', async () => {
      await capturedHandlers['ServiceArea.selectAreas']({ request: {} });
      expect(mockClient.selectAreas).toHaveBeenCalledWith([]);
    });

    it('selectAreas rethrows on client error', async () => {
      mockClient.selectAreas.mockRejectedValue(new Error('select fail'));
      await expect(capturedHandlers['ServiceArea.selectAreas']({ request: { newAreas: [42] } })).rejects.toThrow('select fail');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to select areas'));
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

    it('changeToMode rethrows when client operation fails', async () => {
      mockClient.stop.mockRejectedValue(new Error('stop fail'));
      await expect(capturedHandlers['RvcRunMode.changeToMode']({ request: { newMode: 0 } })).rejects.toThrow('stop fail');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to change mode'));
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

    it('cleanMode changeToMode rethrows when setCleanMode fails', async () => {
      mockClient.setCleanMode.mockRejectedValue(new Error('mode fail'));
      await expect(capturedHandlers['RvcCleanMode.changeToMode']({ request: { newMode: 1 } })).rejects.toThrow('mode fail');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to change clean mode'));
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

    it('statusChange logs verbose details when verbose mode is enabled', async () => {
      const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
      const verbosePlatform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ verbose: true }) as any);
      (verbosePlatform as any).setupEventListeners(mockVacuumInstance, mockClient, 'did-v');
      mockClient.emit('statusChange', {
        state: VacuumState.Cleaning,
        batteryLevel: 77,
        cleanMode: CleanMode.Mop,
        runMode: 'cleaning',
        errorCode: VacuumErrorCode.None,
      });
      await flush();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Status update: state=cleaning'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Battery level: 77%'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Operational state: cleaning -> Matter'));
    });

    it('statusChange logs debug when battery update fails', async () => {
      mockVacuumInstance.setAttribute.mockImplementation(async (cluster: string) => {
        if (cluster === 'PowerSource') throw new Error('battery attr fail');
      });
      mockClient.emit('statusChange', {
        state: VacuumState.Docked,
        batteryLevel: 30,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
      });
      await Promise.resolve();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Could not update battery level'));
    });

    it('statusChange logs debug when operational state update fails', async () => {
      const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
      mockVacuumInstance.setAttribute.mockImplementation(async (cluster: string) => {
        if (cluster === 'RvcOperationalState') throw new Error('state attr fail');
      });
      mockClient.emit('statusChange', {
        state: VacuumState.Docked,
        batteryLevel: 30,
        cleanMode: CleanMode.Vacuum,
        runMode: 'idle',
        errorCode: VacuumErrorCode.None,
      });
      await flush();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Could not update operational state'));
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

    it('stateChange logs verbose state transitions when verbose mode is enabled', async () => {
      const verbosePlatform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ verbose: true }) as any);
      (verbosePlatform as any).setupEventListeners(mockVacuumInstance, mockClient, 'did-v');
      mockClient.emit('stateChange', VacuumState.Docked);
      await Promise.resolve();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('State changed to: DOCKED'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Matter state synchronized'));
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

  // ── displayVerboseInfo ───────────────────────────────────────────────────────

  describe('displayVerboseInfo', () => {
    it('prints full verbose details with maps, areas and current settings', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig({ pollInterval: 7000, region: 'us' }) as any);
      mockClient.getInfo.mockResolvedValue({ model: 'dreame.v1', firmwareVersion: '2.0', serialNumber: 'SER-1' });
      mockClient.getStatus.mockResolvedValue({
        state: VacuumState.Cleaning,
        runMode: 'cleaning',
        cleanMode: CleanMode.Mop,
        batteryLevel: 66,
        waterLevel: 'low',
        errorCode: 'stuck',
        currentAreaId: '12',
      });
      mockClient.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop, CleanMode.VacuumThenMop]);
      mockClient.getCleanMode.mockResolvedValue(CleanMode.Mop);
      mockClient.getRunMode.mockResolvedValue('cleaning');

      await (platform as any).displayVerboseInfo(
        { did: 'd1', name: 'Bot' },
        mockClient,
        [{ id: '1', name: 'Home', areas: [{ id: '12', name: 'Kitchen', mapId: '1' }] }],
        [{ id: '12', name: 'Kitchen', mapId: '1' }],
        [{ areaId: 12 }],
      );

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('VERBOSE MODE - Detailed Information'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Supported Clean Modes (3):'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Current Settings:'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Connection:'));
    });

    it('prints fallback verbose details when data retrieval fails', async () => {
      const platform = new MibridgePlatform(matterbridge as any, log as any, makeConfig() as any);
      mockClient.getInfo.mockRejectedValue(new Error('info fail'));
      mockClient.getStatus.mockRejectedValue(new Error('status fail'));
      mockClient.getSupportedCleanModes.mockRejectedValue(new Error('modes fail'));
      mockClient.getCleanMode.mockRejectedValue(new Error('clean mode fail'));
      mockClient.getRunMode.mockRejectedValue(new Error('run mode fail'));

      await (platform as any).displayVerboseInfo({ did: 'd2', name: 'Bot 2' }, mockClient, [], [], []);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not retrieve device info'));
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not retrieve status'));
      expect(log.info).toHaveBeenCalledWith('   No maps found. Create a map in Xiaomi Home app first.');
      expect(log.info).toHaveBeenCalledWith('   No rooms/areas found.');
      expect(log.info).toHaveBeenCalledWith('Supported Clean Modes:');
      expect(log.info).toHaveBeenCalledWith('   Default: Vacuum, Mop, Vacuum+Mop');
    });
  });
});
