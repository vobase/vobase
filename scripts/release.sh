#!/bin/bash
# Resolve workspace:* dependencies to actual versions before changeset publish.
# Changesets doesn't resolve bun's workspace:* protocol automatically.

set -e

# Resolve workspace:* in packages/cli/package.json
node -e "
const fs = require('fs');
const corePkg = JSON.parse(fs.readFileSync('packages/core/package.json', 'utf8'));
const cliPath = 'packages/cli/package.json';
const cliPkg = JSON.parse(fs.readFileSync(cliPath, 'utf8'));
if (cliPkg.dependencies?.['@vobase/core']?.startsWith('workspace:')) {
  cliPkg.dependencies['@vobase/core'] = corePkg.version;
  fs.writeFileSync(cliPath, JSON.stringify(cliPkg, null, 2) + '\n');
  console.log('Resolved @vobase/core workspace:* to ' + corePkg.version);
}
"

# Publish
changeset publish

# Restore workspace:* after publish
git checkout packages/cli/package.json
