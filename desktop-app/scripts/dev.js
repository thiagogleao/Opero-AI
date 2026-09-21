const { spawnSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
process.chdir(root)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const bin = path.join(root, 'node_modules', '.bin', 'electron-vite')
const result = spawnSync(bin, ['dev'], { stdio: 'inherit', env, shell: true, cwd: root })
process.exit(result.status ?? 0)
