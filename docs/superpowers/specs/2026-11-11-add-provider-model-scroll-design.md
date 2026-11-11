# add-provider: scroll no import de modelos — design

**Demanda:** `/add-provider` lista todos os modelos do endpoint na fase `import`; com
muitos modelos a lista não rola, o topo/rodapé do form saem da tela e não é possível
ver tudo. Pedido: "quero esse ajuste, escrolar os modelos".

**Tamanho:** mudança pequena (um componente, um caminho de render, um estado local).

## Intent

O `/add-provider` (PR #33, branch `feat/add-provider`) importa **todos** os modelos
que o endpoint anuncia, e a fase `import` renderiza **um `<Text>` por modelo**, sem
teto. O frame do TUI é uma coluna de altura fixa (`app.tsx`, `frameRows(rows)`), então
a lista cresce para fora da viewport.

Medido, não inferido (harness do próprio repo, `renderTui`, terminal de 30 linhas):

```
60 modelos → frame = 69 linhas   (terminal = 30)
```

O cabeçalho (`/add-provider · register an OpenAI-compatible provider`) e o rodapé
(`enter import & save · esc cancel`) saem da tela, e o usuário não tem tecla nenhuma
para chegar ao fim da lista. Com ~300 modelos — o caso real de um gateway — a fase
inteira fica inutilizável.

## Goal

A fase `import` ocupa uma janela fixa de 8 linhas, independente do número de modelos,
com teclas para percorrer a lista. O form continua sempre do mesmo tamanho.

## Non-goals

- **Não** vira checklist (escolher subconjunto). A spec de origem já decidiu
  all-or-nothing (`2026-11-11-add-provider-design.md`, "What is left to the builder":
  "The demand says 'importar todos', so all-or-nothing is the default") e a demanda
  atual pede só rolagem. `enter` continua importando tudo.
- **Não** mexe no `--plain`. Ali cada modelo é impresso no scrollback do próprio
  terminal (`add-provider-repl.ts:136`), que já é rolável nativamente — o defeito é
  do frame fixo do TUI, não do REPL.
- **Não** mexe no `src/core/`, no `discoverModels`, no `saveProvider`, nem no formato
  em disco. Nada é persistido de novo: o offset da janela é estado de UI efêmero.
- **Não** trunca ids longos. Um id que estoura a largura quebra linha no ink, igual ao
  `ModelPicker`; manter a paridade vale mais que inventar elipse aqui.

## Constraints (do `AGENTS.md`)

- TDD: teste ao lado do módulo (`add-provider.tsx` / `add-provider.test.tsx`), ver
  falhar vermelho antes de implementar.
- `src/cli/tui/` pode usar `ink`/`react` (decision-logged); `src/core/` continua com
  zero dependência de runtime — esta mudança nem toca o core.
- Docs em inglês, conventional commits (`fix:`), `bun test` verde antes do commit.
- PR é automático quando verde: push + PR. Como o `/add-provider` não existe em
  `main`, o trabalho **nasce de `feat/add-provider`**, não de `main`.
- `docs/specs/` e `docs/plans/` são gitignored — nunca escrever neles.

## Approaches considered

**A — Janela fixa de 8 + offset de scroll (escolhida).** `MAX_VISIBLE = 8` e
`models.slice(start, start + 8)`, com `scroll`/`scrollRef`; `↑`/`↓` movem 1,
`PgUp`/`PgDn` movem uma página, `Home`/`End` vão ao topo/fim. É exatamente o padrão
que os outros cinco componentes do diretório já usam (`model-picker.tsx`,
`agent-picker.tsx`, `session-picker.tsx`, `skill-list.tsx`, `child-viewer.tsx`), todos
com `MAX_VISIBLE = 8`. Rodapé ganha o hint de scroll só quando a lista excede a
janela.

**B — Janela calculada das linhas do terminal** (`transcriptWindow(rows)` em vez de 8),
como o `ChildViewer` faz para o transcript. Rejeitada: o overlay do form não recebe
`rows` e os seis pickers irmãos usam o teto fixo; introduzir um segundo mecanismo de
dimensionamento para um form de 4 campos é mais peça do que o problema pede.

**C — Paginação com indicador `1-8 de 60` e só `n`/`p`.** Rejeitada: teclas novas
inventadas quando `↑`/`↓`/`PgUp`/`PgDn`/`Home`/`End` são o que todo picker do lugent
já responde — e o teclado do usuário já estava nesses dedos.

Escolhida **A**, com uma diferença em relação ao `ModelPicker`: ali `↑`/`↓` movem um
cursor de **seleção** (`❯`), porque se escolhe um item. Aqui não há escolha — o import
é tudo — então `↑`/`↓` movem a **janela** e não existe linha destacada. Nesse ponto o
modelo é o `SkillList`, que também janela sem seleção persistida.

## Design

Estado novo no componente: `scroll` + `scrollRef` (o ref espelha o estado porque o ink
agrupa teclas num render só — a mesma armadilha que todos os `*Ref` do arquivo já
documentam).

```
MAX_VISIBLE = 8
start = clamp(scroll, 0, max(0, models.length - MAX_VISIBLE))
view  = models.slice(start, start + MAX_VISIBLE)
```

Regras de tecla, todas restritas à fase `import` e aplicadas **antes** do
`if (!k.return) return` que hoje bloqueia tudo que não é enter:

| tecla | efeito |
|---|---|
| `↑` | `scroll - 1` |
| `↓` | `scroll + 1` |
| `PgUp` / `shift+↑` | `scroll - 8` |
| `PgDn` / `shift+↓` | `scroll + 8` |
| `Home` | `0` |
| `End` | `max(0, len - 8)` |
| `enter` | importa tudo (inalterado) |
| `esc` | cancela (inalterado) |

`⌫` na fase `import` hoje não faz nada (o bloco de ação só age em `enter`), então não
há conflito — e continua não fazendo nada.

Render: o cabeçalho passa a dizer a faixa visível quando a lista excede a janela
(`60 models found — 1-8 of 60`), e o rodapé ganha `↑/↓ scroll · pgup/pgdn page` só
nesse caso. Com 8 modelos ou menos a tela fica **byte-idêntica** à de hoje, o que os
testes existentes de `a passing test lists the models and saves on confirm` e
`1 model found` já cobrem.

Chave de render: `key={`${start + i}-${m}`}` em vez de `key={m}` — dois modelos com o
mesmo id (endpoint que anuncia duplicado) hoje colidem na chave do React dentro da
janela; o índice resolve sem custo.

## Por que o `PgUp`/`PgDn` do form não briga com o scroll do transcript

`app.tsx` trata PageUp/PageDown depois de `if (overlayRef.current || ask) return` —
com o overlay do form aberto, o App já desistiu das teclas. O form é o único
`useInput` ativo. Verificado lendo `app.tsx:322-330`.

## Validado antes de entregar (spike em worktree descartável)

A mudança é pequena, mas o plano manda escrever seis testes — e um plano que manda
escrever teste sem provar que o teste fica **vermelho** é uma armadilha. O patch
inteiro do Step 3 foi aplicado num worktree descartável em `f78de89` e medido:

| medição | resultado |
|---|---|
| implementação + testes, arquivo sozinho | 26 pass / 0 fail |
| suíte completa | **611 pass / 0 fail / 55 arquivos** (baseline 605 + 6) |
| testes novos com a implementação revertida | **5 fail / 21 pass** |
| `MAX_VISIBLE = 1_000` (janela desligada) | **5 fail / 21 pass** |
| janela ativa mas o resto da lista renderizado | **1 fail** (só o teste de altura do frame) |

Duas armadilhas de teste que a medição pegou e o plano corrigiu:

1. `expect(lastFrame()).toContain("model-020")` **passa no código quebrado** — sem
   janela, todos os 20 ids são renderizados. A asserção que prova a janela é
   `not.toContain("model-001")`.
2. O teste "enter importa tudo" **passava sozinho** no código quebrado. Ele agora
   assere a janela primeiro; sem isso seria um teste verde que não prova nada.

O sexto teste (`a list that fits the window shows no scroll hint`) fica verde dos
dois lados de propósito: é um pin de regressão da cópia atual para listas curtas,
não um teste de feature.

## Onde os artefatos ficam

Spec e plano vivem no checkout principal (`/home/luiz/projects/lugent/docs/superpowers/`),
porque o worktree de execução (`/home/luiz/projects/lugent/.worktrees/add-provider`)
está com um worker ativo do card `t_43656871` — escrever arquivos lá no meio de um run
poluiria o `git status` dele. **Na aprovação, os dois arquivos precisam ser copiados
para o worktree do card antes do dispatcher subir.**

## O que fica para o implementador


- Texto exato do hint e do indicador de faixa (a forma acima é a decisão, a redação é
  livre desde que caiba na largura e não invente tecla).
- Se `shift+↑/↓` também paginam (a tabela diz que sim; se ficar estranho no ink, basta
  `PgUp`/`PgDn` — os dois são o mesmo `budget`).
