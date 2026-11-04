// Copia plugins/_comum/comum.js para dentro de cada plugin que o usa.
// Cada plugin precisa da propria copia porque o catalogo (aba Descubra)
// instala so a pasta do plugin. Rodar depois de editar _comum/comum.js:
//   node plugins/_comum/sincronizar.mjs

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMUM = dirname(fileURLToPath(import.meta.url))
const PLUGINS = join(COMUM, '..')
const fonte = readFileSync(join(COMUM, 'comum.js'), 'utf8')
const aviso = '// COPIA GERADA de plugins/_comum/comum.js: edite la e rode plugins/_comum/sincronizar.mjs\n'

for (const nome of readdirSync(PLUGINS)) {
  const pasta = join(PLUGINS, nome)
  if (nome.startsWith('_') || !existsSync(join(pasta, 'package.json'))) continue
  const usa = readdirSync(pasta)
    .filter((f) => f.endsWith('.js'))
    .some((f) => readFileSync(join(pasta, f), 'utf8').includes("from './comum.js'"))
  if (!usa) continue
  writeFileSync(join(pasta, 'comum.js'), aviso + fonte)
  console.log(`copiado para ${nome}`)
}
