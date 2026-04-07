/**
 * Smoke tests for VacuumAccessory
 *
 * @file devices/vacuum/VacuumAccessory.test.ts
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const VacuumState = {
  Idle: 'idle', Cleaning: 'cleaning', Mapping: 'mapping',
  Returning: 'returning', Docked: 'docked', Paused: 'paused', Error: 'error',
} as const;
const VacuumErrorCode = { None: 'none', MopPadMissing: 'mopPadMissing', WaterTankMissing: 'waterTankMissing', WaterTankEmpty: 'waterTankEmpty' } as const;
const CleanMode = { Vacuum: 'vacuum', Mop: 'mop', VacuumThenMop: 'vacuumThenMop' } as const;

const MockRoboticVacuumCleaner = jest.fn().mockImplementation(function () {
  return Object.assign(new EventEmitter(), {
    setAttribute: jest.fn().mockResolvedValue(undefined),
    addCommandHandler: jest.fn(),
    createDefaultRvcCleanModeClusterServer: jest.fn(),
  });
});

jest.unstable_mockModule('matterbridge/devices', () => ({
  RoboticVacuumCleaner: MockRoboticVacuumCleaner,
}));

jest.unstable_mockModule('matterbridge/logger', () => ({ AnsiLogger: jest.fn() }));

jest.unstable_mockModule('@mibridge/core', () => ({
  VacuumState, VacuumErrorCode, CleanMode,
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

function makeVacuumClient() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getMaps: jest.fn().mockResolvedValue([]),
    getStatus: jest.fn().mockResolvedValue({ state: VacuumState.Docked, batteryLevel: 100, errorCode: VacuumErrorCode.None }),
    getSupportedCleanModes: jest.fn().mockResolvedValue([CleanMode.Vacuum]),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    returnToDock: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    startMapping: jest.fn().mockResolvedValue(undefined),
    selectAreas: jest.fn().mockResolvedValue(undefined),
    getSelectedAreas: jest.fn().mockResolvedValue([]),
    startCleaningAreas: jest.fn().mockResolvedValue(undefined),
    setCleanMode: jest.fn().mockResolvedValue(undefined),
    getInfo: jest.fn().mockResolvedValue({ model: 'dreame', firmwareVersion: '1.0', serialNumber: 'SN1' }),
  });
}

const deviceInfo = { did: 'did-vac-1', name: 'My Vacuum', model: 'dreame.vacuum.p2150' };

describe('VacuumAccessory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates RoboticVacuumCleaner and calls registerDevice', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);

    const callArgs = MockRoboticVacuumCleaner.mock.calls[0]!;
    expect(callArgs[0]).toBe('My Vacuum');
    expect(callArgs[1]).toBe('did-vac-1');
    expect(callArgs[2]).toBe('server');
    // Remaining 12 positional args (runMode through supportedMaps) are present
    expect(callArgs).toHaveLength(15);
    expect(platform.registerDevice).toHaveBeenCalledTimes(1);
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

  it('propagates statusChange battery level to Matter', async () => {
    const accessory = new VacuumAccessory(makeLog() as any, false);
    const platform = makePlatform();
    const client = makeVacuumClient();

    await accessory.register(platform, deviceInfo as any, client);
    const vacuum = MockRoboticVacuumCleaner.mock.results[0]!.value;

    client.emit('statusChange', {
      state: VacuumState.Cleaning,
      batteryLevel: 50,
      errorCode: VacuumErrorCode.None,
    });

    // Wait for async handlers
    await new Promise((r) => setTimeout(r, 0));

    expect(vacuum.setAttribute).toHaveBeenCalledWith('PowerSource', 'batPercentRemaining', 100);
  });
});
