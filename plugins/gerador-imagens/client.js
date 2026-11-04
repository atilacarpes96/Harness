// Parte do plugin que roda na pagina do dsh: o item "ComfyUI" da barra lateral
// (com uma bolinha verde quando ele esta ligado) e o painel com o botao de
// desligar e a chave "desligar sozinho depois de cada imagem".
//
// Escrito a mao no formato que o carregador do dsh espera
// (window.__ModuleLoader__), sem etapa de compilacao. Fala com o lado servidor
// do plugin pelo endereco local de comfy.js (127.0.0.1:48231).

window.__ModuleLoader__.load({
  id: 'dsh-gerador-imagens',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const NS = 'gerador-imagens.comfy'
    const PAINEL = 'gerador-imagens.comfyui'
    const BASE = 'http://127.0.0.1:48231'

    const pt = {
      panel: 'ComfyUI',
      titulo: 'ComfyUI',
      subtitulo: 'O motor do Gerador de Imagens. Ele liga sozinho quando você pede uma imagem.',
      ligado: 'Ligado',
      desligado: 'Desligado',
      semConexao: 'Não consegui falar com o plugin do Gerador. O DSHARNESS está aberto?',
      usandoRam: 'usando {ram} de RAM',
      rapido: 'Com ele ligado, cada imagem sai em cerca de 40 segundos.',
      parado: 'A próxima imagem liga o ComfyUI sozinha e leva cerca de 1 minuto a mais.',
      desligar: 'Desligar o ComfyUI',
      aviso: 'Desligar libera a memória, mas a próxima imagem vai demorar cerca de 1 minuto a mais, porque o ComfyUI precisa ligar de novo.',
      confirmar: 'Desligar mesmo',
      cancelar: 'Cancelar',
      desligando: 'Desligando...',
      autoTitulo: 'Desligar sozinho depois de cada imagem',
      autoTexto: 'Libera a máquina logo depois de gerar. Em troca, cada imagem leva cerca de 1 minuto a mais.',
    }
    const en = {
      panel: 'ComfyUI',
      titulo: 'ComfyUI',
      subtitulo: 'The Image Generator engine. It starts on its own when you ask for an image.',
      ligado: 'Running',
      desligado: 'Stopped',
      semConexao: 'Could not reach the Image Generator plugin. Is DSHARNESS open?',
      usandoRam: 'using {ram} of RAM',
      rapido: 'While it runs, each image takes about 40 seconds.',
      parado: 'The next image starts ComfyUI by itself and takes about 1 extra minute.',
      desligar: 'Stop ComfyUI',
      aviso: 'Stopping frees the memory, but the next image will take about 1 extra minute while ComfyUI starts again.',
      confirmar: 'Stop it',
      cancelar: 'Cancel',
      desligando: 'Stopping...',
      autoTitulo: 'Stop after every image',
      autoTexto: 'Frees the machine right after each image. In exchange, every image takes about 1 extra minute.',
    }

    const css = `
.dshgi-icone{position:relative;display:inline-flex;align-items:center;justify-content:center}
.dshgi-ponto{position:absolute;right:-1px;bottom:-1px;width:7px;height:7px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-caption);box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base)}
.dshgi-ponto.dshgi-on{background:var(--dsw-alias-state-success-primary)}
.dshgi-pagina{max-width:720px;margin:0 auto;padding:40px 32px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}
.dshgi-h1{font-size:22px;line-height:30px;font-weight:600;margin:0}
.dshgi-sub{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:-8px 0 8px}
.dshgi-cartao{background:var(--dsw-alias-settings-card-fill);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px}
.dshgi-estado{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600}
.dshgi-bola{width:10px;height:10px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-caption)}
.dshgi-bola.dshgi-on{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 10px var(--dsw-alias-state-success-primary)}
.dshgi-ram{font-weight:400;color:var(--dsw-alias-label-secondary)}
.dshgi-texto{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0}
.dshgi-aviso{color:var(--dsw-alias-state-warn-primary);font-size:13px;line-height:20px;margin:0}
.dshgi-linha{display:flex;gap:8px;flex-wrap:wrap}
.dshgi-btn{appearance:none;border:0;cursor:pointer;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;font-family:inherit}
.dshgi-btn:disabled{opacity:.5;cursor:default}
.dshgi-perigo{background:var(--dsw-alias-state-error-primary);color:#fff}
.dshgi-neutro{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.dshgi-pref{display:flex;align-items:center;justify-content:space-between;gap:24px}
.dshgi-pref-t{font-size:14px;line-height:20px;font-weight:500}
.dshgi-chave{appearance:none;width:44px;height:26px;border-radius:13px;corner-shape:round;border:0;cursor:pointer;background:var(--dsw-alias-bg-layer-3);position:relative;flex:none;transition:background .2s}
.dshgi-chave::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;corner-shape:round;background:#fff;transition:transform .2s}
.dshgi-chave.dshgi-on{background:var(--dsw-alias-state-success-primary)}
.dshgi-chave.dshgi-on::after{transform:translateX(18px)}
`
    const tagId = 'dsh-gerador-imagens/painel.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-gerador-imagens'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // --- estado do ComfyUI, compartilhado pelo icone e pelo painel ----------
    let snap = { estado: null, erro: false }
    const ouvintes = new Set()
    let timer = null
    function publicar(novo) {
      snap = { ...snap, ...novo }
      for (const f of ouvintes) f()
    }
    async function atualizar() {
      try {
        const r = await fetch(BASE + '/comfy', { cache: 'no-store' })
        publicar({ estado: await r.json(), erro: false })
      } catch (_e) {
        publicar({ erro: true })
      }
    }
    function assinar(f) {
      ouvintes.add(f)
      if (timer === null) {
        atualizar()
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') atualizar()
        }, 8000)
      }
      return () => {
        ouvintes.delete(f)
        if (ouvintes.size === 0 && timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
    }
    function useComfy() {
      return React.useSyncExternalStore(assinar, () => snap, () => snap)
    }
    async function post(caminho, corpo) {
      const r = await fetch(BASE + caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo || {}),
      })
      return r.json()
    }
    function formatarRam(mb) {
      if (!mb) return ''
      return mb >= 1024 ? (mb / 1024).toFixed(1).replace('.', ',') + ' GB' : mb + ' MB'
    }

    function IconeComfy({ size }) {
      const s = useComfy()
      const n = size || 16
      const ligado = s.estado && s.estado.ligado
      return jsxs('span', {
        className: 'dshgi-icone',
        style: { width: n, height: n },
        children: [
          jsxs('svg', {
            width: n,
            height: n,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            children: [
              jsx('rect', { x: 3, y: 4, width: 18, height: 14, rx: 3 }),
              jsx('circle', { cx: 9, cy: 10, r: 2 }),
              jsx('path', { d: 'M21 15l-5-5-8 8' }),
              jsx('path', { d: 'M8 21h8' }),
            ],
          }),
          jsx('span', { className: 'dshgi-ponto' + (ligado ? ' dshgi-on' : '') }),
        ],
      })
    }

    function PainelComfy({ t }) {
      const s = useComfy()
      const [confirmando, setConfirmando] = React.useState(false)
      const [ocupado, setOcupado] = React.useState(false)
      const [mensagem, setMensagem] = React.useState(null)
      const e = s.estado
      const ligado = !!(e && e.ligado)

      async function desligar() {
        setOcupado(true)
        try {
          const r = await post('/comfy/desligar')
          setMensagem(r.mensagem || null)
        } catch (_e) {
          setMensagem(t('semConexao'))
        }
        setConfirmando(false)
        setOcupado(false)
        atualizar()
      }
      async function trocarAuto() {
        const novo = !(e && e.desligarDepois)
        try {
          await post('/comfy/preferencia', { desligarDepois: novo })
        } catch (_e) {}
        atualizar()
      }

      const estadoLinha = jsxs('div', {
        className: 'dshgi-estado',
        children: [
          jsx('span', { className: 'dshgi-bola' + (ligado ? ' dshgi-on' : '') }),
          jsx('span', { children: ligado ? t('ligado') : t('desligado') }),
          ligado && e.ramMB
            ? jsx('span', { className: 'dshgi-ram', children: '· ' + t('usandoRam').replace('{ram}', formatarRam(e.ramMB)) })
            : null,
        ],
      })

      const botoes = !ligado
        ? null
        : confirmando
          ? jsxs('div', {
              className: 'dshgi-linha',
              children: [
                jsx('button', { className: 'dshgi-btn dshgi-perigo', disabled: ocupado, onClick: desligar, children: ocupado ? t('desligando') : t('confirmar') }),
                jsx('button', { className: 'dshgi-btn dshgi-neutro', disabled: ocupado, onClick: () => setConfirmando(false), children: t('cancelar') }),
              ],
            })
          : jsx('div', {
              className: 'dshgi-linha',
              children: jsx('button', { className: 'dshgi-btn dshgi-perigo', onClick: () => setConfirmando(true), children: t('desligar') }),
            })

      return jsxs('div', {
        className: 'dshgi-pagina',
        children: [
          jsx('h1', { className: 'dshgi-h1', children: t('titulo') }),
          jsx('p', { className: 'dshgi-sub', children: t('subtitulo') }),
          s.erro && !e
            ? jsx('div', { className: 'dshgi-cartao', children: jsx('p', { className: 'dshgi-aviso', children: t('semConexao') }) })
            : jsxs('div', {
                className: 'dshgi-cartao',
                children: [
                  estadoLinha,
                  jsx('p', { className: 'dshgi-texto', children: ligado ? t('rapido') : t('parado') }),
                  botoes,
                  ligado ? jsx('p', { className: 'dshgi-aviso', children: t('aviso') }) : null,
                  mensagem ? jsx('p', { className: 'dshgi-texto', children: mensagem }) : null,
                ],
              }),
          jsx('div', {
            className: 'dshgi-cartao',
            children: jsxs('div', {
              className: 'dshgi-pref',
              children: [
                jsxs('div', {
                  children: [
                    jsx('div', { className: 'dshgi-pref-t', children: t('autoTitulo') }),
                    jsx('p', { className: 'dshgi-texto', children: t('autoTexto') }),
                  ],
                }),
                jsx('button', {
                  className: 'dshgi-chave' + (e && e.desligarDepois ? ' dshgi-on' : ''),
                  role: 'switch',
                  'aria-checked': !!(e && e.desligarDepois),
                  'aria-label': t('autoTitulo'),
                  disabled: !e,
                  onClick: trocarAuto,
                }),
              ],
            }),
          }),
        ],
      })
    }

    const inject = ['slots', 'locale']
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { pt, en }))
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PAINEL,
        locale: NS,
        inject: () => ({}),
      }, PainelComfy))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PAINEL,
        order: 20,
        locale: NS,
        label: () => t('panel'),
      }, IconeComfy))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
