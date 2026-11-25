// Prepara o projeto Android gerado por `npx cap add android` (APK de teste do Google TV):
// copia o plugin nativo, a MainActivity, os ícones e a chave de assinatura de teste, e define
// permissões de rede. Rodar dentro da pasta googletv, depois de `npx cap add android`.

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const app = path.join(root, 'android', 'app')
const pkgDir = path.join(app, 'src', 'main', 'java', 'com', 'controletv', 'googletv')

function fail(msg) {
  console.error('patch-android: ' + msg)
  process.exit(1)
}

if (!fs.existsSync(app)) fail('pasta android/app não encontrada (rode "npx cap add android" antes)')

// 1) código nativo
fs.mkdirSync(pkgDir, { recursive: true })
for (const f of ['AtvProtocol.java', 'AtvRemotePlugin.java', 'MainActivity.java']) {
  fs.copyFileSync(path.join('native', f), path.join(pkgDir, f))
}

// 2) build.gradle: assinatura fixa e versão
const gradlePath = path.join(app, 'build.gradle')
let gradle = fs.readFileSync(gradlePath, 'utf8')
if (!gradle.includes('debug.keystore')) {
  if (!gradle.includes('android {')) fail('bloco android não encontrado no build.gradle')
  gradle = gradle.replace(
    'android {',
    'android {\n    signingConfigs {\n        debug {\n            storeFile file("debug.keystore")\n            storePassword "android"\n            keyAlias "androiddebugkey"\n            keyPassword "android"\n        }\n    }'
  )
  fs.copyFileSync('native/debug.keystore', path.join(app, 'debug.keystore'))
}
const run = process.env.GITHUB_RUN_NUMBER || '1'
gradle = gradle.replace(/versionCode \d+/, `versionCode ${run}`)
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "1.0.${run}"`)
fs.writeFileSync(gradlePath, gradle)

// 3) AndroidManifest: permissões de rede
const manifestPath = path.join(app, 'src', 'main', 'AndroidManifest.xml')
let manifest = fs.readFileSync(manifestPath, 'utf8')
const internet = '<uses-permission android:name="android.permission.INTERNET" />'
if (!manifest.includes('ACCESS_NETWORK_STATE')) {
  if (!manifest.includes(internet)) fail('permissão INTERNET não encontrada no manifest')
  manifest = manifest.replace(
    internet,
    internet +
      '\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />' +
      '\n    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />'
  )
}
fs.writeFileSync(manifestPath, manifest)

// 4) ícones
fs.cpSync('native/res', path.join(app, 'src', 'main', 'res'), { recursive: true, force: true })

console.log('patch-android: ok')
