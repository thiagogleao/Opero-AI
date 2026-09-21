const { execSync } = require('child_process')
const path = require('path')

const vbs = path.resolve(__dirname, '..', 'launch.vbs')
const icon = path.resolve(__dirname, '..', 'resources', 'icon.ico')

function createShortcut(dest) {
  const ps = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${dest.replace(/\\/g, '\\\\')}')
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"${vbs.replace(/\\/g, '\\\\')}"'
$s.IconLocation = '${icon.replace(/\\/g, '\\\\')}'
$s.Description = 'Opero Finance'
$s.Save()
`.trim()
  execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`)
}

const desktop = path.join(
  process.env.USERPROFILE || 'C:\\Users\\thiag',
  'Desktop', 'Opero Finance.lnk'
)
const startMenu = path.join(
  process.env.APPDATA || 'C:\\Users\\thiag\\AppData\\Roaming',
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Opero Finance.lnk'
)

createShortcut(desktop)
console.log('✓ Atalho criado: Área de Trabalho')

createShortcut(startMenu)
console.log('✓ Atalho criado: Menu Iniciar')

console.log('\nAgora pode abrir o app pesquisando "Opero Finance" no Windows.')
