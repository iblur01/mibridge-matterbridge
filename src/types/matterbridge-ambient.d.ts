declare module 'matterbridge' {
  export type PlatformConfigValue = string | number | boolean | bigint | object | undefined | null;
  export type PlatformConfig = {
    name: string;
    type: string;
    version?: string;
    debug?: boolean;
    unregisterOnShutdown?: boolean;
  } & Record<string, PlatformConfigValue>;

  export type PlatformMatterbridge = {
    matterbridgeVersion: string;
  } & Record<string, unknown>;

  export class MatterbridgeEndpoint {
    constructor(...args: unknown[]);
    [key: string]: any;
  }

  export class MatterbridgeDynamicPlatform {
    readonly matterbridge: PlatformMatterbridge;
    readonly log: {
      debug(message: string): void;
      info(message: string): void;
      warn(message: string): void;
      error(message: string): void;
    };
    config: PlatformConfig;
    readonly ready: Promise<void>;
    constructor(matterbridge: PlatformMatterbridge, log: MatterbridgeDynamicPlatform['log'], config: PlatformConfig);
    onStart(reason?: string): Promise<void>;
    onConfigure(): Promise<void>;
    onShutdown(reason?: string): Promise<void>;
    onChangeLoggerLevel(logLevel: unknown): Promise<void>;
    clearSelect(): Promise<void>;
    setSelectDevice(did: string, name: string): void;
    validateDevice(device: string | string[], log?: boolean): boolean;
    registerDevice(device: MatterbridgeEndpoint): Promise<void>;
    unregisterAllDevices(delay?: number): Promise<void>;
    verifyMatterbridgeVersion(requiredVersion: string, destroy?: boolean): boolean;
  }

  export class MatterbridgeFanControlServer {
    constructor(...args: unknown[]);
    [key: string]: any;
  }

  export const powerSource: unknown;
  export const waterValve: unknown;
  export const airPurifier: unknown;
  export const fanDevice: unknown;
}

declare module 'matterbridge/devices' {
  import { MatterbridgeEndpoint } from 'matterbridge';

  export class RoboticVacuumCleaner extends MatterbridgeEndpoint {
    constructor(...args: unknown[]);
    [key: string]: any;
  }
}
