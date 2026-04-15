# matterbridge-mibridge

[![npm version](https://img.shields.io/npm/v/matterbridge-mibridge.svg)](https://www.npmjs.com/package/matterbridge-mibridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![powered by matterbridge](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)
[![powered by @mibridge/core](https://img.shields.io/badge/powered%20by-@mibridge/core-blue)](https://www.npmjs.com/package/@mibridge/core)

Matterbridge plugin that exposes Xiaomi smart home devices as native Matter devices, built on top of the [mibridge](https://github.com/iblur01/mibridge) SDK.

## Overview

`matterbridge-mibridge` bridges the [mibridge](https://github.com/iblur01/mibridge) SDK with [Matterbridge](https://github.com/Luligu/matterbridge), making Xiaomi devices (starting with Dreame robot vacuums) available as Matter-native accessories in any compatible smart home controller — Apple Home, Google Home, Home Assistant, etc.

Device states and error codes are mapped to Matter 1.4 cluster semantics via `@mibridge/core`, so no per-device translation logic is needed in the plugin.

## Prerequisites

- [Matterbridge](https://github.com/Luligu/matterbridge) >= 3.4.0
- Node.js >= 20
- A Xiaomi account with linked devices
- Xiaomi Cloud session tokens (obtained via [@mibridge/cli](https://www.npmjs.com/package/@mibridge/cli))

## Installation

```bash
npm install -g matterbridge-mibridge
matterbridge -add matterbridge-mibridge
```

## Getting your session tokens

Use the mibridge CLI to authenticate and retrieve your session tokens:

```bash
npm install -g @mibridge/cli
mibridge login --region de
```

This will produce a session with `userId`, `ssecurity`, and `serviceToken` — paste these into the plugin configuration.

## Configuration

In the Matterbridge frontend, open the plugin settings and fill in:

| Field                  | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `session.userId`       | Your Xiaomi user ID                                                  |
| `session.ssecurity`    | Xiaomi `ssecurity` token                                             |
| `session.serviceToken` | Xiaomi `serviceToken`                                                |
| `region`               | Xiaomi Cloud region (`de`, `cn`, `us`, `sg`, `ru`, `tw`, `in`, `i2`) |
| `pollInterval`         | Status polling interval in ms (default: `5000`)                      |
| `fountainPollInterval` | Pet fountain polling interval in ms (default: `30000`)               |
| `verbose`              | Enable detailed logs at startup                                      |

## Supported devices

| Category     | Models                             |
| ------------ | ---------------------------------- |
| Robot vacuum | Dreame (all MIoT-based models)     |
| Pet fountain | Xiaomi Pet Waterer (`pet_waterer`) |

Additional Xiaomi device categories will be added as `@mibridge/core` expands its coverage.

## Matter integration

Devices are exposed using the following Matter clusters:

- `RvcRunMode` — idle / cleaning / mapping modes
- `RvcCleanMode` — vacuum / mop / vacuum+mop
- `RvcOperationalState` — docked / running / paused / seeking charger / error
- `ServiceArea` — per-room zone selection
- `PowerSource` — battery level

Error codes from the device are mapped to Matter `VacuumErrorCode` semantics (dust bin, water tank, mop pad, navigation errors, etc.) via `@mibridge/core`.

## Related packages

| Package                                                          | Description                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| [`@mibridge/core`](https://www.npmjs.com/package/@mibridge/core) | SDK — device control, authentication, Matter-aligned state  |
| [`@mibridge/cli`](https://www.npmjs.com/package/@mibridge/cli)   | CLI — terminal interface for devices and session management |

Source: [github.com/iblur01/mibridge](https://github.com/iblur01/mibridge)

## License

MIT — see [LICENSE](./LICENSE) for details.
