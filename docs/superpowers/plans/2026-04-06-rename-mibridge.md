# Rename to matterbridge-mibridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the plugin from `matterbridge-xiaomi-wrapper` to `matterbridge-mibridge`, clean up template/test leftovers, and make the package ready for npm publication.

**Architecture:** Pure rename and file cleanup — no logic changes. All references to the old name are updated in source, config, schema, and package metadata. Unnecessary directories and template files are deleted.

**Tech Stack:** TypeScript, Node.js ESM, Matterbridge plugin system, npm

---

### Task 1: Delete unnecessary files and directories

**Files:**
- Delete: `test/`
- Delete: `vitest/`
- Delete: `scripts/`
- Delete: `matterbridge-plugin-template.config.json`
- Delete: `matterbridge-plugin-template.schema.json`
- Delete: `CONTRIBUTING.md`
- Delete: `CODE_OF_CONDUCT.md`
- Delete: `CODEOWNERS`
- Delete: `STYLEGUIDE.md`

- [ ] **Step 1: Delete directories and template files**

```bash
rm -rf test/ vitest/ scripts/
rm -f matterbridge-plugin-template.config.json matterbridge-plugin-template.schema.json
rm -f CONTRIBUTING.md CODE_OF_CONDUCT.md CODEOWNERS STYLEGUIDE.md
```

- [ ] **Step 2: Verify deletions**

```bash
ls test/ vitest/ scripts/ 2>&1 | grep "No such file"
ls matterbridge-plugin-template.*.json 2>&1 | grep "No such file"
```

Expected: all paths report "No such file or directory"

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove template files, test suites, and unused scripts"
```

---

### Task 2: Rename schema and config files

**Files:**
- Rename: `matterbridge-xiaomi-wrapper.schema.json` → `matterbridge-mibridge.schema.json`
- Rename: `matterbridge-xiaomi-wrapper.config.json` → `matterbridge-mibridge.config.json`

- [ ] **Step 1: Rename the files**

```bash
mv matterbridge-xiaomi-wrapper.schema.json matterbridge-mibridge.schema.json
mv matterbridge-xiaomi-wrapper.config.json matterbridge-mibridge.config.json
```

- [ ] **Step 2: Update schema title and description**

Edit `matterbridge-mibridge.schema.json` — change:
```json
"title": "Matterbridge MiBridge",
"description": "matterbridge-mibridge by iblur01",
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: rename schema and config files to matterbridge-mibridge"
```

---

### Task 3: Update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update metadata fields**

Replace in `package.json`:
```json
"name": "matterbridge-mibridge",
"description": "Matterbridge MiBridge Plugin — bridges MiHome API to Matter",
"author": "https://github.com/iblur01",
"homepage": "https://github.com/iblur01/matterbridge-mibridge",
```

Remove `"private": true` entirely.

- [ ] **Step 2: Update repository and bugs URLs**

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/iblur01/matterbridge-mibridge.git"
},
"bugs": {
  "url": "https://github.com/iblur01/matterbridge-mibridge/issues"
},
```

- [ ] **Step 3: Clean up scripts that reference deleted files**

Remove these scripts (they reference deleted `scripts/` folder or deleted test files):
- `"automator"`
- `"npmPack"`
- `"npmPublishTagDev"`
- `"npmPublishTagEdge"`
- `"npmPublishTagLatest"`
- `"test:vitest"`, `"test:vitest:watch"`, `"test:vitest:verbose"`, `"test:vitest:coverage"`, `"test:vitest:typecheck"`
- `"test"`, `"test:watch"`, `"test:verbose"`, `"test:coverage"`, `"test:typecheck"`, `"test:debug"`

Simplify `"runMeBeforePublish"` to:
```json
"runMeBeforePublish": "npm run cleanBuild && npm run lint && npm run format"
```

- [ ] **Step 4: Verify package.json is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"
```

Expected: `valid`

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: update package.json for matterbridge-mibridge npm publication"
```

---

### Task 4: Rename class in source code

**Files:**
- Modify: `src/module.ts`

- [ ] **Step 1: Rename class and update log prefix**

In `src/module.ts`, replace all occurrences of `XiaomiWrapperPlatform` with `MibridgePlatform`:
- Class declaration: `export class MibridgePlatform extends MatterbridgeAccessoryPlatform`
- `initializePlugin` return type and instantiation: `return new MibridgePlatform(...)`
- The log message in constructor: `Initializing MiBridge Platform...`

- [ ] **Step 2: Verify build still passes**

```bash
npm run build
```

Expected: no errors, `dist/` updated

- [ ] **Step 3: Commit**

```bash
git add src/module.ts
git commit -m "refactor: rename XiaomiWrapperPlatform to MibridgePlatform"
```

---

### Task 5: Update config.example.json and README

**Files:**
- Modify: `config.example.json`
- Modify: `README.md`

- [ ] **Step 1: Update config.example.json**

Replace `"name"` value:
```json
{
  "name": "matterbridge-mibridge",
  "type": "AccessoryPlatform",
  ...
}
```

- [ ] **Step 2: Update README.md**

Replace all occurrences of:
- `matterbridge-xiaomi-wrapper` → `matterbridge-mibridge`
- `Matterbridge Xiaomi Wrapper` → `Matterbridge MiBridge`
- `XiaomiWrapperPlatform` → `MibridgePlatform`
- Repository URL: `theo-delannoy/matterbridge-xiaomi-wrapper` → `iblur01/matterbridge-mibridge`

- [ ] **Step 3: Verify build and start**

```bash
npm run build && npm run start
```

Expected: plugin loads without errors, log shows `[Matterbridge MiBridge Plugin]` or similar

- [ ] **Step 4: Commit**

```bash
git add config.example.json README.md
git commit -m "docs: update config example and README for matterbridge-mibridge"
```

---

### Task 6: Final verification

- [ ] **Step 1: Clean build from scratch**

```bash
npm run cleanBuild
```

Expected: no TypeScript errors

- [ ] **Step 2: Verify no old name remains in tracked files**

```bash
git grep -i "xiaomi-wrapper" -- '*.ts' '*.json' '*.md' 2>/dev/null
```

Expected: no output

- [ ] **Step 3: Verify package is publishable**

```bash
npm pack --dry-run
```

Expected: lists `matterbridge-mibridge-1.0.14.tgz` contents — should include `dist/`, `*.schema.json`, `*.config.json`, `CHANGELOG.md`, `package.json`; should NOT include `src/`, `test/`, `scripts/`, `tsconfig.*`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize matterbridge-mibridge rename and npm publication prep"
```
