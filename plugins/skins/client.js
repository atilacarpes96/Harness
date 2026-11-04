// Skins do DSHARNESS: temas para a interface do dsh, no espirito do FlowCursor
// (vidro com cor no fundo, estilo Apple). Cada skin registra um tema pelo
// ctx.theme (troca as cores-base --dsw-alias-*) e, quando tem fundo colorido,
// poe um degrade atras de tudo e deixa os paineis translucidos.
//
// A escolha fica numa linha de Configuracoes > Geral e e lembrada no navegador
// (localStorage), porque o dsh so guarda os temas embutidos (claro/escuro).
//
// Escrito a mao no formato do carregador do dsh (window.__ModuleLoader__).

window.__ModuleLoader__.load({
  id: 'dsh-skins',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const NS = 'dsharness.skins'
    const CHAVE = 'dsharness.skin'
    const CHAVE_BASE = 'dsharness.skin.base'

    // Paineis de vidro: os mesmos valores nas skins de fundo colorido. O fundo
    // principal fica transparente (moldura e conversa usam a mesma cor, e duas
    // camadas escuras apagavam o degrade); barra lateral e caixa de mensagem
    // ficam translucidas, com desfoque (ver aplicarFundo).
    const VIDRO = {
      '--dsw-alias-bg-base': 'rgba(0, 0, 0, 0)',
      '--dsw-specific-sidebar-fill': 'rgba(14, 16, 32, 0.42)',
      '--dsw-specific-input-major': 'rgba(255, 255, 255, 0.09)',
      '--dsw-specific-bubble': 'rgba(255, 255, 255, 0.12)',
      '--dsw-specific-bubble-highlight': 'rgba(255, 255, 255, 0.20)',
      '--dsw-specific-selector': 'rgba(255, 255, 255, 0.12)',
      '--dsw-specific-sidebar-nav-item-active': 'rgba(255, 255, 255, 0.16)',
      '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(255, 255, 255, 0.10)',
      '--dsw-specific-tip': 'rgba(28, 32, 54, 0.92)',
      '--dsw-specific-menu': 'rgba(28, 32, 54, 0.74)',
      '--dsw-specific-login-input': 'rgba(255, 255, 255, 0.08)',
      '--dsw-alias-bg-layer-1': 'rgba(255, 255, 255, 0.06)',
      '--dsw-alias-bg-layer-2': 'rgba(255, 255, 255, 0.09)',
      '--dsw-alias-bg-layer-3': 'rgba(255, 255, 255, 0.14)',
      '--dsw-alias-bg-module-platform': 'rgba(255, 255, 255, 0.12)',
      '--dsw-alias-settings-card-fill': 'rgba(255, 255, 255, 0.07)',
      '--dsw-alias-button-floating-fill': 'rgba(36, 40, 64, 0.78)',
      '--dsw-alias-button-elevated-fill': 'rgba(255, 255, 255, 0.16)',
      '--dsw-alias-label-primary': '#ffffff',
      '--dsw-alias-label-secondary': '#e2e5f0',
      '--dsw-alias-label-tertiary': '#b9bed2',
      '--dsw-alias-label-caption': '#9097b2',
      '--dsw-alias-label-dimmed': '#4e5472',
      '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.10)',
      '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.16)',
      '--dsw-alias-border-l3': 'rgba(255, 255, 255, 0.22)',
      '--dsw-alias-brand-primary': '#ffffff',
      '--dsw-alias-button-primary-fill': '#ffffff',
      '--dsw-alias-button-primary-hover': '#e9edf6',
      '--dsw-alias-interactive-bg-hover': 'rgba(255, 255, 255, 0.10)',
      '--dsw-alias-interactive-bg-active': 'rgba(255, 255, 255, 0.16)',
      '--dsw-alias-scrollbar-bg-l1': 'rgba(255, 255, 255, 0.18)',
    }

    const SKINS = [
      {
        id: 'harness-vidro',
        nome: 'Vidro',
        descricao: 'Fundo azul e roxo com painéis de vidro, como o macOS.',
        colorScheme: 'dark',
        fundo:
          'radial-gradient(1200px 820px at 6% 0%, #6a3bd0 0%, transparent 62%),' +
          'radial-gradient(1100px 800px at 94% 16%, #1677d8 0%, transparent 60%),' +
          'radial-gradient(1100px 800px at 50% 110%, #12909c 0%, transparent 62%),' +
          '#0b0e1d',
        tokens: { ...VIDRO, '--dsw-alias-state-business-primary': '#6cb6ff' },
      },
      {
        id: 'harness-aurora',
        nome: 'Aurora',
        descricao: 'Verde e violeta, como uma aurora boreal.',
        colorScheme: 'dark',
        fundo:
          'radial-gradient(1150px 800px at 10% 6%, #14966c 0%, transparent 62%),' +
          'radial-gradient(1050px 800px at 90% 24%, #5b34c4 0%, transparent 60%),' +
          'radial-gradient(1050px 760px at 46% 112%, #0e8aa0 0%, transparent 62%),' +
          '#06110f',
        tokens: { ...VIDRO, '--dsw-alias-state-business-primary': '#4ade80' },
      },
      {
        id: 'harness-por-do-sol',
        nome: 'Pôr do sol',
        descricao: 'Laranja, rosa e roxo, quente e escuro.',
        colorScheme: 'dark',
        fundo:
          'radial-gradient(1150px 800px at 6% 0%, #b5285e 0%, transparent 62%),' +
          'radial-gradient(1050px 800px at 94% 12%, #d06a12 0%, transparent 58%),' +
          'radial-gradient(1050px 800px at 50% 112%, #5d2a9a 0%, transparent 62%),' +
          '#160b14',
        tokens: { ...VIDRO, '--dsw-alias-state-business-primary': '#ffb340' },
      },
      {
        id: 'harness-grafite',
        nome: 'Grafite',
        descricao: 'Cinza do macOS escuro, sóbrio, com o azul da Apple.',
        colorScheme: 'dark',
        tokens: {
          '--dsw-specific-sidebar-fill': '#161618',
          '--dsw-specific-input-major': '#2c2c2e',
          '--dsw-specific-bubble': '#2c2c2e',
          '--dsw-specific-bubble-highlight': '#48484a',
          '--dsw-specific-selector': '#3a3a3c',
          '--dsw-specific-sidebar-nav-item-active': '#3a3a3c',
          '--dsw-specific-sidebar-nav-item-active-accent': '#2c2c2e',
          '--dsw-specific-tip': '#3a3a3c',
          '--dsw-specific-menu': 'rgba(44, 44, 46, 0.82)',
          '--dsw-alias-bg-base': '#1c1c1e',
          '--dsw-alias-bg-layer-1': '#242426',
          '--dsw-alias-bg-layer-2': '#2c2c2e',
          '--dsw-alias-bg-layer-3': '#3a3a3c',
          '--dsw-alias-bg-module-platform': '#3a3a3c',
          '--dsw-alias-settings-card-fill': '#2c2c2e',
          '--dsw-alias-button-floating-fill': '#2c2c2e',
          '--dsw-alias-button-elevated-fill': '#48484a',
          '--dsw-alias-label-primary': '#f5f5f7',
          '--dsw-alias-label-secondary': '#d1d1d6',
          '--dsw-alias-label-tertiary': '#aeaeb2',
          '--dsw-alias-label-caption': '#8e8e93',
          '--dsw-alias-label-dimmed': '#48484a',
          '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.08)',
          '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.14)',
          '--dsw-alias-border-l3': 'rgba(255, 255, 255, 0.20)',
          '--dsw-alias-brand-primary': '#f5f5f7',
          '--dsw-alias-button-primary-fill': '#f5f5f7',
          '--dsw-alias-button-primary-hover': '#e5e5ea',
          '--dsw-alias-state-business-primary': '#0a84ff',
          '--dsw-alias-interactive-bg-hover': 'rgba(255, 255, 255, 0.08)',
          '--dsw-alias-interactive-bg-active': 'rgba(255, 255, 255, 0.14)',
        },
      },
      {
        id: 'harness-papel',
        nome: 'Papel',
        descricao: 'Claro e limpo, como os apps da Apple de dia.',
        colorScheme: 'light',
        tokens: {
          '--dsw-specific-sidebar-fill': '#ececf0',
          '--dsw-specific-input-major': '#ffffff',
          '--dsw-specific-bubble': '#e9e9ee',
          '--dsw-specific-bubble-highlight': '#dcdce2',
          '--dsw-specific-selector': '#e5e5ea',
          '--dsw-specific-sidebar-nav-item-active': '#dcdce2',
          '--dsw-specific-sidebar-nav-item-active-accent': '#e5e5ea',
          '--dsw-specific-tip': '#ffffff',
          '--dsw-specific-menu': 'rgba(255, 255, 255, 0.82)',
          '--dsw-specific-login-input': '#ffffff',
          '--dsw-alias-bg-base': '#f5f5f7',
          '--dsw-alias-bg-layer-1': '#ffffff',
          '--dsw-alias-bg-layer-2': '#f2f2f7',
          '--dsw-alias-bg-layer-3': '#e5e5ea',
          '--dsw-alias-bg-module-platform': '#e5e5ea',
          '--dsw-alias-settings-card-fill': '#ffffff',
          '--dsw-alias-button-floating-fill': '#ffffff',
          '--dsw-alias-button-elevated-fill': '#ffffff',
          '--dsw-alias-label-primary': '#1d1d1f',
          '--dsw-alias-label-secondary': '#3a3a3c',
          '--dsw-alias-label-tertiary': '#636366',
          '--dsw-alias-label-caption': '#8e8e93',
          '--dsw-alias-label-dimmed': '#c7c7cc',
          '--dsw-alias-border-l1': 'rgba(0, 0, 0, 0.06)',
          '--dsw-alias-border-l2': 'rgba(0, 0, 0, 0.10)',
          '--dsw-alias-border-l3': 'rgba(0, 0, 0, 0.16)',
          '--dsw-alias-brand-primary': '#1d1d1f',
          '--dsw-alias-button-primary-fill': '#1d1d1f',
          '--dsw-alias-button-primary-hover': '#3a3a3c',
          '--dsw-alias-state-business-primary': '#007aff',
          '--dsw-alias-interactive-bg-hover': 'rgba(0, 0, 0, 0.05)',
          '--dsw-alias-interactive-bg-active': 'rgba(0, 0, 0, 0.09)',
        },
      },
    ]
    const POR_ID = new Map(SKINS.map((s) => [s.id, s]))

    const pt = {
      titulo: 'Skin do Harness',
      descricao: 'Muda as cores da interface. A escolha fica salva neste navegador.',
      original: 'Original',
      originalDesc: 'O visual de fábrica do dsh.',
    }
    const en = {
      titulo: 'Harness skin',
      descricao: 'Changes the interface colors. Saved in this browser.',
      original: 'Original',
      originalDesc: 'The stock dsh look.',
    }

    const css = `
.dshsk-linha{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex;flex-direction:column;gap:12px}
.dshsk-titulo{font-size:14px;line-height:20px}
.dshsk-desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.dshsk-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
.dshsk-cartao{appearance:none;border:0;background:none;padding:0;cursor:pointer;display:flex;flex-direction:column;gap:6px;text-align:left;color:var(--dsw-alias-label-primary);font-family:inherit}
.dshsk-amostra{height:64px;border-radius:12px;position:relative;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.dshsk-cartao[aria-pressed="true"] .dshsk-amostra{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}
.dshsk-barra{position:absolute;left:8px;height:8px;border-radius:4px}
.dshsk-ponto{position:absolute;right:8px;bottom:8px;width:12px;height:12px;border-radius:50%;corner-shape:round}
.dshsk-nome{font-size:12px;line-height:16px;font-weight:600}
`
    const tagId = 'dsh-skins/linha.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-skins'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    function ler(chave) {
      try {
        return localStorage.getItem(chave)
      } catch (_e) {
        return null
      }
    }
    function gravar(chave, valor) {
      try {
        if (valor === null) localStorage.removeItem(chave)
        else localStorage.setItem(chave, valor)
      } catch (_e) {}
    }

    // Fundo colorido e paineis translucidos: CSS extra so enquanto a skin vale.
    function aplicarFundo(id) {
      const skin = POR_ID.get(id)
      let tag = document.getElementById('dsharness-skin-fundo')
      if (!skin || !skin.fundo) {
        if (tag) tag.remove()
        return
      }
      if (!tag) {
        tag = document.createElement('style')
        tag.id = 'dsharness-skin-fundo'
        tag.dataset.plugin = 'dsh-skins'
        document.head.appendChild(tag)
      }
      // As classes do dsh tem um prefixo que muda a cada versao (CSS modules);
      // por isso o seletor procura o fim do nome. Se mudar, so perde o desfoque.
      tag.textContent =
        'html,body{background:' + skin.fundo + ' !important;background-attachment:fixed !important}' +
        '[class*="_sidebarCol"],[class*="_composerSeat"] [class*="_card"]' +
        '{-webkit-backdrop-filter:blur(28px) saturate(170%);backdrop-filter:blur(28px) saturate(170%)}'
    }

    // Estado da escolha, para a linha de Configuracoes se redesenhar.
    let escolhida = null
    const ouvintes = new Set()
    function publicar(id) {
      escolhida = id
      for (const f of ouvintes) f()
    }
    function useEscolhida() {
      return React.useSyncExternalStore(
        (f) => {
          ouvintes.add(f)
          return () => ouvintes.delete(f)
        },
        () => escolhida,
        () => escolhida,
      )
    }

    function Amostra({ skin }) {
      const t = skin ? skin.tokens : null
      const fundo = skin ? (skin.fundo || t['--dsw-alias-bg-base']) : '#151517'
      const camada = t ? t['--dsw-alias-bg-layer-3'] : '#353638'
      const texto = t ? t['--dsw-alias-label-tertiary'] : '#adb2b8'
      const acento = t ? t['--dsw-alias-state-business-primary'] : '#7aaaff'
      return jsxs('div', {
        className: 'dshsk-amostra',
        style: { background: fundo },
        children: [
          jsx('div', { className: 'dshsk-barra', style: { top: 10, width: '55%', background: camada } }),
          jsx('div', { className: 'dshsk-barra', style: { top: 24, width: '35%', background: texto, opacity: 0.6 } }),
          jsx('div', { className: 'dshsk-ponto', style: { background: acento } }),
        ],
      })
    }

    function LinhaSkins({ escolher, t }) {
      const atual = useEscolhida()
      const cartoes = [
        jsxs('button', {
          className: 'dshsk-cartao',
          'aria-pressed': atual === null,
          title: t('originalDesc'),
          onClick: () => escolher(null),
          children: [jsx(Amostra, { skin: null }), jsx('span', { className: 'dshsk-nome', children: t('original') })],
        }, 'original'),
        ...SKINS.map((s) =>
          jsxs('button', {
            className: 'dshsk-cartao',
            'aria-pressed': atual === s.id,
            title: s.descricao,
            onClick: () => escolher(s.id),
            children: [jsx(Amostra, { skin: s }), jsx('span', { className: 'dshsk-nome', children: s.nome })],
          }, s.id),
        ),
      ]
      return jsxs('div', {
        className: 'dshsk-linha',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'dshsk-titulo', children: t('titulo') }),
              jsx('div', { className: 'dshsk-desc', children: t('descricao') }),
            ],
          }),
          jsx('div', { className: 'dshsk-grade', children: cartoes }),
        ],
      })
    }

    const inject = ['slots', 'locale', 'theme']
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { pt, en }))
      for (const s of SKINS) {
        ctx.effect(() => ctx.theme.register({ id: s.id, colorScheme: s.colorScheme, tokens: s.tokens }))
      }

      function escolher(id) {
        const preferencia = ctx.theme.getTheme().preference
        if (id === null) {
          const base = ler(CHAVE_BASE) || 'system'
          gravar(CHAVE, null)
          aplicarFundo(null)
          if (POR_ID.has(preferencia)) ctx.theme.setTheme(base)
          publicar(null)
          return
        }
        // Lembra o tema embutido de antes, para o "Original" voltar a ele.
        if (!POR_ID.has(preferencia)) gravar(CHAVE_BASE, preferencia)
        gravar(CHAVE, id)
        ctx.theme.setTheme(id)
        aplicarFundo(id)
        publicar(id)
      }

      // Na carga, o dsh adota o tema salvo dele (claro/escuro/sistema) por cima
      // da skin: nos primeiros segundos, reaplica a skin. Depois disso, trocar
      // a Aparencia nas Configuracoes e escolha do usuario: a skin sai de cena.
      const inicio = Date.now()
      ctx.on('theme/change', (snap) => {
        const id = snap && snap.active ? snap.active.id : null
        if (POR_ID.has(id)) {
          aplicarFundo(id)
          if (escolhida !== id) publicar(id)
          return
        }
        const salva = ler(CHAVE)
        if (salva && POR_ID.has(salva) && Date.now() - inicio < 10000) {
          setTimeout(() => {
            try {
              ctx.theme.setTheme(salva)
            } catch (_e) {}
          }, 0)
          return
        }
        if (salva) gravar(CHAVE, null)
        aplicarFundo(null)
        if (escolhida !== null) publicar(null)
      })

      const salva = ler(CHAVE)
      if (salva && POR_ID.has(salva)) escolher(salva)
      ctx.effect(() => () => aplicarFundo(null))

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'dsharness.skins',
        order: 15,
        locale: NS,
        inject: () => ({ escolher }),
      }, LinhaSkins))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
