/**
 * Device registry — maps device service + accessory pairs.
 * To add a new Xiaomi product: create Service + Accessory in src/devices/<product>/,
 * then add one entry here. module.ts requires no modification.
 *
 * @file platform/registry.ts
 */
import { FanAccessory } from '../devices/fan/FanAccessory.js';
import { FanService } from '../devices/fan/FanService.js';
import { FountainAccessory } from '../devices/fountain/FountainAccessory.js';
import { FountainService } from '../devices/fountain/FountainService.js';
import { VacuumAccessory } from '../devices/vacuum/VacuumAccessory.js';
import { VacuumService } from '../devices/vacuum/VacuumService.js';
import { BaseDeviceAccessory } from './DeviceAccessory.js';
import { BaseDeviceService, XiaomiLogger, XiaomiServiceConfig } from './DeviceService.js';

export interface RegistryEntry {
  ServiceClass: new (log: XiaomiLogger, config: XiaomiServiceConfig) => BaseDeviceService;
  AccessoryClass: new (log: XiaomiLogger, verbose: boolean) => BaseDeviceAccessory;
}

export const registry: RegistryEntry[] = [
  { ServiceClass: VacuumService, AccessoryClass: VacuumAccessory },
  { ServiceClass: FountainService, AccessoryClass: FountainAccessory },
  { ServiceClass: FanService, AccessoryClass: FanAccessory },
];
