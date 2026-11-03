// Registro de marcas. Para suportar outra TV (LG webOS, Roku, etc.):
//   1. crie src/drivers/<marca>.js seguindo o contrato descrito em samsung.js
//   2. registre aqui embaixo (discover é opcional: busca automática no app Android)
// A interface (App.jsx) usa só o vocabulário universal de teclas e não muda.

import { SamsungDriver, discover as discoverSamsung } from './samsung.js'

export const BRANDS = {
  samsung: { label: 'Samsung (Tizen)', Driver: SamsungDriver, discover: discoverSamsung },
}

export const DEFAULT_BRAND = 'samsung'

export function createDriver(brand, onStatus) {
  const entry = BRANDS[brand] || BRANDS[DEFAULT_BRAND]
  return new entry.Driver(onStatus)
}
