/**
 * Smoke tests for VacuumAccessory
 *
 * @file devices/vacuum/VacuumAccessory.test.ts
 */
import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const VacuumState = {
  Idle: 'idle',
  Cleaning: 'cleaning',
  Mapping: 'mapping',
  Returning: 'returning',
  Docked: 'docked',
  Paused: 'paused',
  Error: 'error',
} as const;
const VacuumErrorCode = { None: 'none', MopPadMissing: 'mopPadMissing', WaterTankMissing: 'waterTankMissing', WaterTankEmpty: 'waterTankEmpty' } as const;
const CleanMode = { Vacuum: 'vacuum', Mop: 'mop', VacuumThenMop: 'vacuumThenMop' } as const;

function makeVacuumEndpoint() {
  return Object.assign(new EventEmitter(), {
    setAttribute: jest.fn<(cluster: string, attr: string, value: unknown) => Promise<void>>().mockResolvedValue(undefined),
    addCommandHandler: jest.fn<(name: string, handler: (...args: unknown[]) => Promise<void>) => void>(),
    createDefaultRvcCleanModeClusterServer: jest.fn<(mode: number, modes: unknown[]) => unknown>().mockReturnValue(undefined),
  });
}

const MockRoboticVacuumCleaner = jest.fn().mockImplementation(makeVacuumEndpoint);

jest.unstable_mockModule('matterbridge/devices', () => ({
  RoboticVacuumCleaner: MockRoboticVacuumCleaner,
}));

jest.unstable_mockModule('@mibridge/core', () => ({
  VacuumState,
  VacuumErrorCode,
  CleanMode,
}));

// Dynamic imports after mock registrations
const { VacuumAccessory } = await import('./VacuumAccessory.js');

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

type VacuumStatus = { state: string; batteryLevel: number; errorCode: string };
type VacuumMap = { id: string; name: string; areas: { id: string; name: string; mapId: string }[] };
type VacuumInfo = { model: string; firmwareVersion: string; serialNumber: string };

function makeVacuumClient() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getMaps: jest.fn<() => Promise<VacuumMap[]>>().mockResolvedValue([]),
    getStatus: jest.fn<() => Promise<VacuumStatus>>().mockResolvedValue({ state: VacuumState.Docked, batteryLevel: 100, errorCode: VacuumErrorCode.None }),
    getSupportedCleanModes: jest.fn<() => Promise<string[]>>().mockResolvedValue([CleanMode.Vacuum]),
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isConnected: jest.fn<() => boolean>().mockReturnValue(true),
    returnToDock: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    resume: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    pause: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    start: jest.fn<(areas?: string[]) => Promise<void>>().mockResolvedValue(undefined),
    startMapping: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    selectAreas: jest.fn<(areas: string[]) => Promise<void>>().mockResolvedValue(undefined),
    getSelectedAreas: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
    startCleaningAreas: jest.fn<(areas: string[]) => Promise<void>>().mockResolvedValue(undefined),
    setCleanMode: jest.fn<(mode: string) => Promise<void>>().mockResolvedValue(undefined),
    getInfo: jest.fn<() => Promise<VacuumInfo>>().mockResolvedValue({ model: 'dreame', firmwareVersion: '1.0', serialNumber: 'SN1' }),
  });
}

/**
 * Helper: find a registered command handler by name.
 *
 * @param {ReturnType<typeof makeVacuumEndpoint>} vacuum - The mock vacuum instance with addCommandHandler calls.
 * @param {string} name - The command handler name to find.
 * @returns {(...args: unknown[]) => Promise<void>} The registered handler function.
 */
function getHandler(vacuum: ReturnType<typeof makeVacuumEndpoint>, name: string): (...args: unknown[]) => Promise<void> {
  const call = (vacuum.addCommandHandler as jest.Mock).mock.calls.find(([n]) => n === name) as [string, (...args: unknown[]) => Promise<void>] | undefined;
  if (!call) throw new Error(`No handler registered for ${name}`);
  return call[1];
}

const deviceInfo = { did: 'did-vac-1', name: 'My Vacuum', model: 'dreame.vacuum.p2150' };

describe('VacuumAccessory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates RoboticVacuumCleaner and calls registerDevice', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);

    const callArgs = MockRoboticVacuumCleaner.mock.calls[0] as unknown[];
    expect(callArgs[0]).toBe('My Vacuum');
    expect(callArgs[1]).toBe('did-vac-1');
    expect(callArgs[2]).toBe('server');
    expect(callArgs).toHaveLength(15);
    expect(platform.registerDevice).toHaveBeenCalledTimes(1);
  });

  it('builds supportedAreas and supportedMaps from maps with areas', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getMaps.mockResolvedValue([
      {
        id: '10',
        name: 'Floor 1',
        areas: [
          { id: '101', name: 'Living Room', mapId: '10' },
          { id: 'abc', name: 'Kitchen', mapId: '10' }, // non-numeric id → uses index+1
        ],
      },
    ]);

    await accessory.register(platform, deviceInfo as any, client);

    const callArgs = MockRoboticVacuumCleaner.mock.calls[0] as unknown[];
    // supportedAreas is arg index 11 (0-indexed)
    const supportedAreas = callArgs[11] as Array<{ areaId: number }>;
    expect(supportedAreas).toHaveLength(2);
    expect(supportedAreas[0].areaId).toBe(101);
    expect(supportedAreas[1].areaId).toBe(2); // 'abc' → NaN → fallback index+1
  });

  it('returns null when validateDevice rejects the device', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    platform.validateDevice.mockReturnValue(false);
    const client = makeVacuumClient();

    const result = await accessory.register(platform, deviceInfo as any, client);

    expect(result).toBeNull();
    expect(platform.registerDevice).not.toHaveBeenCalled();
  });

  it('verbose mode calls displayVerboseInfo', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, true);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);

    expect(log2.info).toHaveBeenCalledWith(expect.stringContaining('VERBOSE MODE'));
  });

  it('propagates statusChange battery level to Matter', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    client.emit('statusChange', {
      state: VacuumState.Cleaning,
      batteryLevel: 50,
      errorCode: VacuumErrorCode.None,
    });

    // Wait for async handlers
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vacuum.setAttribute).toHaveBeenCalledWith('PowerSource', 'batPercentRemaining', 100);
  });

  it('statusChange battery setAttribute failure is silently handled', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;
    vacuum.setAttribute.mockRejectedValue(new Error('setAttribute failed'));

    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 50, errorCode: VacuumErrorCode.None });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No uncaught error — handler silently catches it
    expect(vacuum.setAttribute).toHaveBeenCalled();
  });

  it('statusChange state setAttribute failure is silently handled', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;
    let callCount = 0;
    vacuum.setAttribute.mockImplementation(() => {
      callCount++;
      if (callCount >= 2) throw new Error('state failed');
      return Promise.resolve();
    });

    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 50, errorCode: VacuumErrorCode.None });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Second call (state) threw but was caught
    expect(vacuum.setAttribute).toHaveBeenCalledTimes(2);
  });

  it('statusChange with verbose logs battery and state', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, true);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    log2.info.mockClear();

    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 75, errorCode: VacuumErrorCode.None });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log2.info).toHaveBeenCalledWith(expect.stringContaining('battery=75%'));
  });

  it('statusChange mop pad removal triggers reconfiguration', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop]);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    // First event: no error → mopPresent=true
    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 100, errorCode: VacuumErrorCode.None });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const callsBefore = (vacuum.createDefaultRvcCleanModeClusterServer as jest.Mock).mock.calls.length;

    // Second event: mop pad missing → triggers reconfiguration
    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 100, errorCode: VacuumErrorCode.MopPadMissing });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((vacuum.createDefaultRvcCleanModeClusterServer as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('error event logs the error', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    client.emit('error', new Error('connection lost'));

    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

  it('connected event logs connection', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    client.emit('connected');

    expect(log2.info).toHaveBeenCalledWith(expect.stringContaining('connected'));
  });

  it('disconnected event logs disconnection', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    client.emit('disconnected');

    expect(log2.warn).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  });

  it('goHome command calls returnToDock on the client', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcOperationalState.goHome')();

    expect(client.returnToDock).toHaveBeenCalledTimes(1);
  });

  it('goHome catch block logs error and rethrows', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.returnToDock.mockRejectedValue(new Error('dock failed'));

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await expect(getHandler(vacuum, 'RvcOperationalState.goHome')()).rejects.toThrow('dock failed');
    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('goHome failed'));
  });

  it('resume command calls client.resume()', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcOperationalState.resume')();

    expect(client.resume).toHaveBeenCalledTimes(1);
  });

  it('resume catch block logs error and rethrows', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.resume.mockRejectedValue(new Error('resume failed'));

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await expect(getHandler(vacuum, 'RvcOperationalState.resume')()).rejects.toThrow('resume failed');
    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('resume failed'));
  });

  it('pause command calls client.pause()', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcOperationalState.pause')();

    expect(client.pause).toHaveBeenCalledTimes(1);
  });

  it('pause catch block logs error and rethrows', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.pause.mockRejectedValue(new Error('pause failed'));

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await expect(getHandler(vacuum, 'RvcOperationalState.pause')()).rejects.toThrow('pause failed');
    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('pause failed'));
  });

  it('selectAreas command passes area IDs to client', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'ServiceArea.selectAreas')({ request: { newAreas: [1, 2] } });

    expect(client.selectAreas).toHaveBeenCalledWith(['1', '2']);
  });

  it('selectAreas with undefined newAreas passes empty array', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'ServiceArea.selectAreas')({ request: {} });

    expect(client.selectAreas).toHaveBeenCalledWith([]);
  });

  it('selectAreas catch block logs error and rethrows', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.selectAreas.mockRejectedValue(new Error('select failed'));

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await expect(getHandler(vacuum, 'ServiceArea.selectAreas')({ request: { newAreas: [] } })).rejects.toThrow('select failed');
    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('selectAreas failed'));
  });

  it('changeToMode 0 calls client.stop()', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcRunMode.changeToMode')({ request: { newMode: 0 } });

    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('changeToMode 1 with no selected areas calls client.start()', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getSelectedAreas.mockResolvedValue([]);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcRunMode.changeToMode')({ request: { newMode: 1 } });

    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it('changeToMode 1 with selected areas calls startCleaningAreas', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getSelectedAreas.mockResolvedValue(['area1']);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcRunMode.changeToMode')({ request: { newMode: 1 } });

    expect(client.startCleaningAreas).toHaveBeenCalledWith(['area1']);
  });

  it('changeToMode 2 calls startMapping', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcRunMode.changeToMode')({ request: { newMode: 2 } });

    expect(client.startMapping).toHaveBeenCalledTimes(1);
  });

  it('changeToMode catch block logs error and rethrows', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.stop.mockRejectedValue(new Error('stop failed'));

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await expect(getHandler(vacuum, 'RvcRunMode.changeToMode')({ request: { newMode: 0 } })).rejects.toThrow('stop failed');
    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('changeToMode failed'));
  });

  it('RvcCleanMode.changeToMode 0 calls setCleanMode(Vacuum)', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcCleanMode.changeToMode')({ request: { newMode: 0 } });

    expect(client.setCleanMode).toHaveBeenCalledWith(CleanMode.Vacuum);
  });

  it('RvcCleanMode.changeToMode 1 calls setCleanMode(Mop)', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcCleanMode.changeToMode')({ request: { newMode: 1 } });

    expect(client.setCleanMode).toHaveBeenCalledWith(CleanMode.Mop);
  });

  it('RvcCleanMode.changeToMode 2 calls setCleanMode(VacuumThenMop)', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcCleanMode.changeToMode')({ request: { newMode: 2 } });

    expect(client.setCleanMode).toHaveBeenCalledWith(CleanMode.VacuumThenMop);
  });

  it('RvcCleanMode.changeToMode with unknown mode does nothing', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await getHandler(vacuum, 'RvcCleanMode.changeToMode')({ request: { newMode: 99 } });

    expect(client.setCleanMode).not.toHaveBeenCalled();
  });

  it('RvcCleanMode.changeToMode catch block logs error and rethrows', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.setCleanMode.mockRejectedValue(new Error('setCleanMode failed'));

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    await expect(getHandler(vacuum, 'RvcCleanMode.changeToMode')({ request: { newMode: 0 } })).rejects.toThrow('setCleanMode failed');
    expect(log2.error).toHaveBeenCalledWith(expect.stringContaining('setCleanMode failed'));
  });

  it('uses vacuum-only mode when mop pad is missing', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    client.getStatus.mockResolvedValue({
      state: VacuumState.Docked,
      batteryLevel: 100,
      errorCode: VacuumErrorCode.MopPadMissing,
    });
    client.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop, CleanMode.VacuumThenMop]);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    const cleanModeCall = vacuum.createDefaultRvcCleanModeClusterServer.mock.calls[0] as [number, Array<{ label: string; mode: number }>];
    const modeOptions = cleanModeCall[1];
    expect(modeOptions).toHaveLength(1);
    expect(modeOptions[0].label).toBe('Vacuum');
  });

  it('uses vacuum-only mode when water tank is missing', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getStatus.mockResolvedValue({ state: VacuumState.Docked, batteryLevel: 100, errorCode: VacuumErrorCode.WaterTankMissing });
    client.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop]);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    const call = vacuum.createDefaultRvcCleanModeClusterServer.mock.calls[0] as [number, Array<{ label: string }>];
    expect(call[1]).toHaveLength(1);
  });

  it('uses vacuum-only mode when water tank is empty', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getStatus.mockResolvedValue({ state: VacuumState.Docked, batteryLevel: 100, errorCode: VacuumErrorCode.WaterTankEmpty });
    client.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop]);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    const call = vacuum.createDefaultRvcCleanModeClusterServer.mock.calls[0] as [number, Array<{ label: string }>];
    expect(call[1]).toHaveLength(1);
  });

  it('uses all modes when mop is supported', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getStatus.mockResolvedValue({ state: VacuumState.Docked, batteryLevel: 100, errorCode: VacuumErrorCode.None });
    client.getSupportedCleanModes.mockResolvedValue([CleanMode.Vacuum, CleanMode.Mop, CleanMode.VacuumThenMop]);

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    const call = vacuum.createDefaultRvcCleanModeClusterServer.mock.calls[0] as [number, Array<{ label: string }>];
    expect(call[1]).toHaveLength(3);
  });

  it('detectAndConfigureMopCapabilities handles createCleanModeServer error', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;
    vacuum.createDefaultRvcCleanModeClusterServer.mockImplementation(() => {
      throw new Error('cluster error');
    });

    // Trigger reconfiguration via mop pad change
    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 100, errorCode: VacuumErrorCode.None });
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.emit('statusChange', { state: VacuumState.Cleaning, batteryLevel: 100, errorCode: VacuumErrorCode.MopPadMissing });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log2.debug).toHaveBeenCalledWith(expect.stringContaining('Could not update clean modes'));
  });

  it('detectAndConfigureMopCapabilities handles getStatus error', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getStatus.mockRejectedValue(new Error('status failed'));

    await accessory.register(platform, deviceInfo as any, client);

    expect(log2.warn).toHaveBeenCalledWith(expect.stringContaining('Could not detect mop capabilities'));
  });

  it('maps VacuumState.Docked to 0x42 and VacuumState.Cleaning to 0x01', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    client.emit('statusChange', {
      state: VacuumState.Docked,
      batteryLevel: 100,
      errorCode: VacuumErrorCode.None,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vacuum.setAttribute).toHaveBeenCalledWith('RvcOperationalState', 'operationalState', 0x42);

    vacuum.setAttribute.mockClear();

    client.emit('statusChange', {
      state: VacuumState.Cleaning,
      batteryLevel: 100,
      errorCode: VacuumErrorCode.None,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vacuum.setAttribute).toHaveBeenCalledWith('RvcOperationalState', 'operationalState', 0x01);
  });

  it('maps all VacuumState values correctly', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0].value as ReturnType<typeof makeVacuumEndpoint>;

    const cases: [string, number][] = [
      [VacuumState.Idle, 0x00],
      [VacuumState.Mapping, 0x01],
      [VacuumState.Returning, 0x40],
      [VacuumState.Paused, 0x02],
      [VacuumState.Error, 0x03],
    ];

    for (const [state, expected] of cases) {
      vacuum.setAttribute.mockClear();
      client.emit('statusChange', { state, batteryLevel: 100, errorCode: VacuumErrorCode.None });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(vacuum.setAttribute).toHaveBeenCalledWith('RvcOperationalState', 'operationalState', expected);
    }
  });

  it('displayVerboseInfo handles getInfo error gracefully', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, true);
    const platform = makePlatform();
    const client = makeVacuumClient();
    client.getInfo.mockRejectedValue(new Error('info failed'));

    // Should not throw even if getInfo fails
    await expect(accessory.register(platform, deviceInfo as any, client)).resolves.not.toBeNull();
    expect(log2.info).toHaveBeenCalledWith(expect.stringContaining('VERBOSE MODE'));
  });

  it('displayVerboseInfo handles getStatus error gracefully', async () => {
    const log2 = makeLog();
    const accessory = new VacuumAccessory(log2 as any, true);
    const platform = makePlatform();
    const client = makeVacuumClient();
    // getStatus called in detectAndConfigureMopCapabilities too — only fail after that
    let callCount = 0;
    client.getStatus.mockImplementation(() => {
      callCount++;
      if (callCount > 1) return Promise.reject(new Error('status failed'));
      return Promise.resolve({ state: VacuumState.Docked, batteryLevel: 100, errorCode: VacuumErrorCode.None });
    });

    await expect(accessory.register(platform, deviceInfo as any, client)).resolves.not.toBeNull();
  });
});
