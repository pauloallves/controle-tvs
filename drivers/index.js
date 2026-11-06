// Registro de marcas. Para suportar outra TV (Roku, Android TV, etc.):
//   1. crie src/drivers/<marca>.js seguindo o contrato descrito em samsung.js
//   2. registre aqui embaixo (discover é opcional: busca automática no app Android)
//   3. liste os modelos/anos em `models` (o primeiro é o padrão)
// A interface (App.jsx) usa só o vocabulário universal de teclas e não muda.

import { SamsungDriver, discover as discoverSamsung } from './samsung.js'
import { LgDriver } from './lg.js'

export const BRANDS = {
  samsung: {
    label: 'Samsung',
    Driver: SamsungDriver,
    discover: discoverSamsung,
    models: [
      { id: '2020+', label: '2020 ou mais novo (ex.: AU8000, Q60/Q70 série T e posteriores)' },
      { id: '2016-2019', label: '2016 a 2019 (Tizen 2.4 a 5.0)' },
    ],
  },
  lg: {
    label: 'LG (webOS) — experimental',
    Driver: LgDriver,
    models: [
      { id: '2018+', label: '2018 ou mais novo (webOS 4 em diante)' },
      { id: '2014-2017', label: '2014 a 2017 (webOS 1 a 3)' },
    ],
    note: 'Ainda não foi testado em TV LG real. A LG só liga por controle: este app consegue desligar, mas não ligar a TV.',
  },
}

export const DEFAULT_BRAND = 'samsung'

export function createDriver(brand, onStatus) {
  const entry = BRANDS[brand] || BRANDS[DEFAULT_BRAND]
  return new entry.Driver(onStatus)
}
