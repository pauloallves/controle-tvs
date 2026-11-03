// Prepara o projeto Android gerado por `npx cap add android`:
//   - copia o plugin nativo (WebSocket + busca de TV) e a MainActivity
//   - adiciona a dependência OkHttp, permissões de rede e tráfego HTTP local
//   - troca os ícones e fixa a chave de assinatura (para o APK poder ser
//     atualizado por cima do anterior)
// Rodar na raiz do projeto, depois de `npx cap add android`.

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const app = path.join(root, 'android', 'app')
const pkgDir = path.join(app, 'src', 'main', 'java', 'com', 'controletv', 'app')

function fail(msg) {
  console.error('patch-android: ' + msg)
  process.exit(1)
}

if (!fs.existsSync(app)) fail('pasta android/app não encontrada (rode "npx cap add android" antes)')

// 1) código nativo
fs.mkdirSync(pkgDir, { recursive: true })
fs.copyFileSync('native/TvSocketPlugin.java', path.join(pkgDir, 'TvSocketPlugin.java'))
fs.copyFileSync('native/MainActivity.java', path.join(pkgDir, 'MainActivity.java'))

// 2) build.gradle: OkHttp, versionCode e assinatura fixa
const gradlePath = path.join(app, 'build.gradle')
let gradle = fs.readFileSync(gradlePath, 'utf8')
if (!gradle.includes('okhttp')) {
  if (!gradle.includes('dependencies {')) fail('bloco dependencies não encontrado no build.gradle')
  gradle = gradle.replace(
    'dependencies {',
    'dependencies {\n    implementation "com.squareup.okhttp3:okhttp:4.12.0"'
  )
}
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

// 3) AndroidManifest: permissões e HTTP em rede local (busca de TV na porta 8001)
const manifestPath = path.join(app, 'src', 'main', 'AndroidManifest.xml')
let manifest = fs.readFileSync(manifestPath, 'utf8')
if (!manifest.includes('usesCleartextTraffic')) {
  if (!manifest.includes('<application')) fail('tag application não encontrada no manifest')
  manifest = manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"')
}
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
