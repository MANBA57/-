/**
 * 游戏的 React 壳：标题页 / 答题弹层 / 过关与结算画面 / 虚拟摇杆。
 * 画布内是像素世界（480×270），弹层用 DOM 保证中文排版清晰。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Game, VIEW_W, VIEW_H, DEFAULT_KEYS, type KeyBindings } from './game'
import { LEVELS, UPGRADE_CYCLE, UPGRADE_LABEL } from './data/levels'
import { CHEST_COINS, type ChestCoin } from './data/coins'
import { QUESTIONS, type QuizQuestion } from './data/questions'
import {
  loadBest,
  loadCollection,
  addCollection,
  saveBest,
  loadSfx,
  saveSfx,
  loadRun,
  saveRun,
  clearRun,
  loadKeys,
  saveKeys,
  loadVol,
  saveVol,
  loadAutoAim,
  saveAutoAim,
  type RunState,
} from './save'

interface Props {
  startLevel?: number
  onExit: () => void
}

type Phase = 'title' | 'play' | 'quiz' | 'clear' | 'dead' | 'victory' | 'paused'

interface QuizState {
  question: QuizQuestion
  coin: ChestCoin
  picked: number | null
}

/** 触屏判定：粗指针设备显示双摇杆 */
const IS_TOUCH =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false

export default function GameCanvas({ startLevel = 0, onExit }: Props) {
  const [phase, setPhase] = useState<'title' | 'run'>('title')
  const [runLevel, setRunLevel] = useState(startLevel)
  const [runKey, setRunKey] = useState(0)
  const [carry, setCarry] = useState<RunState | null>(null)

  if (phase === 'title') {
    return (
      <TitleScreen
        startLevel={startLevel}
        onStart={(lv, c) => {
          setRunLevel(lv)
          setCarry(c ?? null)
          setRunKey((k) => k + 1)
          setPhase('run')
        }}
        onExit={onExit}
      />
    )
  }
  return (
    <GameStage
      key={runKey}
      startLevel={runLevel}
      carry={carry}
      onExit={onExit}
      onBackTitle={() => {
        setPhase('title')
        setRunLevel(startLevel)
        setCarry(null)
      }}
      onRestart={() => {
        clearRun()
        setRunLevel(0)
        setCarry(null)
        setRunKey((k) => k + 1)
      }}
    />
  )
}

/* ------------------------------------------------------------ 标题页 */

function TitleScreen({
  startLevel = 0,
  onStart,
  onExit,
}: {
  startLevel?: number
  onStart: (level: number, carry?: RunState | null) => void
  onExit: () => void
}) {
  const best = loadBest()
  const collected = loadCollection().length
  const keys = loadKeys()
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <Shell onExit={onExit} dim>
      <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="space-y-2">
          <h1 className="text-hero font-bold tracking-widest text-[#ffd23f] [text-shadow:2px_2px_0_#7a5a26]">
            秘境寻泉
          </h1>
          <p className="text-caption text-[#c8cdd8]">
            穿越七个朝代的地牢 · 集齐四十二枚钱币 · 打倒铁面钱王
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          {best > 0 && best < 7 ? (
            <button
              type="button"
              className="btn-game px-8 py-2 text-body"
              onClick={() => {
                const run = loadRun()
                onStart(Math.min(best, 6), run && run.level === best ? run : null)
              }}
            >
              继续 · 第 {best + 1} 关 {LEVELS[best]?.era}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-game px-8 py-2 text-body"
            onClick={() => {
              clearRun()
              onStart(startLevel)
            }}
          >
            {best > 0 ? '从头开始' : '开始探索'}
          </button>
          <button
            type="button"
            className="btn-game-ghost px-6 py-1.5 text-caption"
            onClick={() => setSettingsOpen(true)}
          >
            设置
          </button>
        </div>

        <p className="max-w-md text-micro leading-relaxed text-[#8a8f98]">
          {IS_TOUCH
            ? '左摇杆移动，右摇杆瞄准射击；清空敌人后开箱答题，答对强化武器。'
            : `${keyLabel(keys.up)}${keyLabel(keys.left)}${keyLabel(keys.down)}${keyLabel(keys.right)} / 方向键移动，鼠标瞄准，${keys.fire ? `${keyLabel(keys.fire)} 或左键` : '按住左键'}射击，${keyLabel(keys.interact)} 开箱，Esc 暂停。`}
          {collected > 0 ? `　图鉴已集 ${collected} / 42。` : ''}
        </p>
      </div>
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </Shell>
  )
}

/* ------------------------------------------------------------ 游戏舞台 */

function GameStage({
  startLevel,
  carry,
  onExit,
  onBackTitle,
  onRestart,
}: {
  startLevel: number
  carry?: RunState | null
  onExit: () => void
  onBackTitle: () => void
  onRestart: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [phase, setPhase] = useState<Phase>('play')
  const [quiz, setQuiz] = useState<QuizState | null>(null)
  const [clearLevel, setClearLevel] = useState(0)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [sfxOn, setSfxOn] = useState(loadSfx())
  const [collectedCount, setCollectedCount] = useState(loadCollection().length)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsOpenRef = useRef(false)
  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])
  const applySettings = useCallback((keys: KeyBindings, vol: number, autoAim: boolean): void => {
    const g = gameRef.current
    if (g) {
      g.input.keymap = { ...keys }
      g.sfx.setVolume(vol)
      g.autoAim = autoAim
    }
  }, [])

  /** 每关的题目洗牌牌堆（宝箱按序抽取） */
  const deckRef = useRef<number[]>([])
  const chestIdxRef = useRef(0)
  const levelRef = useRef(startLevel)

  const pickQuestion = useCallback((level: number): QuizQuestion => {
    if (deckRef.current.length === 0) {
      const idxs = (QUESTIONS[level] ?? []).map((_, i) => i)
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[idxs[i], idxs[j]] = [idxs[j]!, idxs[i]!]
      }
      deckRef.current = idxs
    }
    const i = deckRef.current.pop() ?? 0
    return QUESTIONS[level]?.[i] ?? QUESTIONS[0]![0]!
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const game = new Game(
      canvas,
      {
        onChest: () => {
          const level = levelRef.current
          const question = pickQuestion(level)
          const coin = CHEST_COINS[level]?.[chestIdxRef.current % (CHEST_COINS[level]?.length ?? 1)] ?? CHEST_COINS[0]![0]!
          chestIdxRef.current++
          addCollection(coin.slug)
          setCollectedCount(loadCollection().length)
          setQuiz({ question, coin, picked: null })
          setPhase('quiz')
        },
        onLevelClear: (levelIdx) => {
          saveBest(levelIdx + 1)
          const gg = gameRef.current
          if (gg) {
            // 续玩存档：下一关的血量上限（与 nextLevel 的 +1 规则一致）+ 当前武器
            saveRun({
              level: levelIdx + 1,
              maxHp: Math.min(8, gg.player.maxHp + 1),
              weapon: { ...gg.weapon },
            })
          }
          setClearLevel(levelIdx)
          setPhase('clear')
        },
        onVictory: () => {
          saveBest(7)
          clearRun()
          setCollectedCount(loadCollection().length)
          setPhase('victory')
        },
        onGameOver: () => setPhase('dead'),
        onPrompt: (text) => setPrompt(text),
      },
      startLevel,
    )
    gameRef.current = game
    // 已存设置：键位 + 音量 + 自动瞄准
    game.input.keymap = loadKeys()
    game.sfx.setVolume(loadVol())
    game.autoAim = loadAutoAim()
    // 续玩：恢复上次的武器与血量上限（与死亡重试保留武器的规则一致）
    if (carry) {
      game.weapon = { ...carry.weapon }
      game.player.maxHp = carry.maxHp
      game.player.hp = carry.maxHp
    }
    game.sfx.muted = !sfxOn
    game.start()

    const onVis = (): void => {
      if (document.hidden) {
        game.pause()
        setPhase((p) => (p === 'play' ? 'paused' : p))
      }
    }
    document.addEventListener('visibilitychange', onVis)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      document.body.style.overflow = ''
      game.destroy()
      gameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLevel, pickQuestion])

  // Esc / P 暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (settingsOpenRef.current) return
      if (e.code !== 'Escape' && e.code !== 'KeyP') return
      setPhase((p) => {
        const game = gameRef.current
        if (!game) return p
        if (p === 'play') {
          game.pause()
          return 'paused'
        }
        if (p === 'paused') {
          game.resume()
          return 'play'
        }
        return p
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setStick = (which: 'move' | 'aim', v: { x: number; y: number } | null): void => {
    const game = gameRef.current
    if (!game) return
    if (which === 'move') game.input.stickMove = v
    else game.input.stickAim = v
  }

  const answerQuiz = (picked: number): void => {
    setQuiz((q) => (q ? { ...q, picked } : q))
    const correct = quiz?.question.answer === picked
    gameRef.current?.sfx.play(correct ? 'correct' : 'wrong')
  }

  const closeQuiz = (): void => {
    const correct = quiz?.picked === quiz?.question.answer
    gameRef.current?.answerChest(correct === true)
    setQuiz(null)
    setPhase('play')
  }

  const toggleSfx = (): void => {
    const next = !sfxOn
    setSfxOn(next)
    saveSfx(next)
    const game = gameRef.current
    if (game) game.sfx.muted = !next
  }

  const lv = LEVELS[levelRef.current]!
  const nextLv = LEVELS[Math.min(6, clearLevel + 1)]!

  return (
    <Shell onExit={onExit} onSfx={toggleSfx} sfxOn={sfxOn}>
      <canvas
        ref={canvasRef}
        width={VIEW_W}
        height={VIEW_H}
        className="game-canvas h-full w-full"
      />

      {/* 触屏摇杆 */}
      {IS_TOUCH && phase === 'play' ? (
        <>
          <Joystick className="left-4" onChange={(v) => setStick('move', v)} label="移动" />
          <Joystick className="right-4" onChange={(v) => setStick('aim', v)} label="射击" />
          {prompt?.includes('开') ? (
            <button
              type="button"
              className="btn-game absolute bottom-24 left-1/2 z-10 -translate-x-1/2 px-6 py-2 text-body"
              onClick={() => gameRef.current?.requestInteract()}
            >
              开启宝箱
            </button>
          ) : null}
        </>
      ) : null}

      {/* 桌面提示条 */}
      {!IS_TOUCH && prompt && phase === 'play' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 text-center text-micro text-[#ffd23f]">
          {prompt}
        </div>
      ) : null}

      {/* 答题弹层 */}
      {phase === 'quiz' && quiz ? (
        <QuizOverlay key={quiz.coin.slug} quiz={quiz} onPick={answerQuiz} onClose={closeQuiz} game={gameRef.current} />
      ) : null}

      {/* 暂停 */}
      {phase === 'paused' ? (
        <Overlay>
          <h2 className="text-display font-bold text-[#ffd23f]">暂停</h2>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn-game px-8 py-2"
              onClick={() => {
                gameRef.current?.resume()
                setPhase('play')
              }}
            >
              继续冒险
            </button>
            <button
              type="button"
              className="btn-game-ghost px-8 py-2"
              onClick={() => {
                gameRef.current?.retryLevel()
                chestIdxRef.current = 0
                deckRef.current = []
                setPhase('play')
              }}
            >
              重玩本关
            </button>
            <button type="button" className="btn-game-ghost px-8 py-2" onClick={() => setSettingsOpen(true)}>
              设置
            </button>
            <button type="button" className="btn-game-ghost px-8 py-2" onClick={onBackTitle}>
              返回封面
            </button>
          </div>
        </Overlay>
      ) : null}

      {/* 设置 */}
      {settingsOpen ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} onApply={applySettings} />
      ) : null}

      {/* 过关 */}
      {phase === 'clear' ? (
        <Overlay>
          <p className="text-caption text-[#8a8f98]">
            第 {clearLevel + 1} 关 · {LEVELS[clearLevel]?.era} 通过
          </p>
          <h2 className="text-display font-bold text-[#ffd23f]">钱路向前！</h2>
          <div className="space-y-1 text-center text-body text-[#c8cdd8]">
            <p>
              弹丸进化：<span className="text-[#f5f5f7]">{LEVELS[clearLevel]?.projName}</span> →{' '}
              <span className="text-[#ffd23f]">{nextLv.projName}</span>
            </p>
            <p>血量上限 +1，已全部回满</p>
          </div>
          <button
            type="button"
            className="btn-game px-10 py-2"
            onClick={() => {
              levelRef.current = Math.min(6, clearLevel + 1)
              chestIdxRef.current = 0
              deckRef.current = []
              gameRef.current?.nextLevel()
              setPhase('play')
            }}
          >
            进入 {nextLv.era}
          </button>
        </Overlay>
      ) : null}

      {/* 死亡 */}
      {phase === 'dead' ? (
        <Overlay>
          <h2 className="text-display font-bold text-[#e0453a]">泉侠倒下了…</h2>
          <p className="text-body text-[#c8cdd8]">
            止步 第 {levelRef.current + 1} 关 · {lv.era}。武器强化会保留，再来一次！
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-game px-8 py-2"
              onClick={() => {
                chestIdxRef.current = 0
                deckRef.current = []
                gameRef.current?.retryLevel()
                setPhase('play')
              }}
            >
              重试本关
            </button>
            <button type="button" className="btn-game-ghost px-8 py-2" onClick={onBackTitle}>
              返回封面
            </button>
          </div>
        </Overlay>
      ) : null}

      {/* 通关 */}
      {phase === 'victory' ? (
        <Overlay>
          <h2 className="text-display font-bold text-[#ffd23f]">泉界守护者！</h2>
          <p className="max-w-md text-center text-body leading-relaxed text-[#c8cdd8]">
            铁面钱王熔于当百虚值，千年钱脉重归有序。
            <br />
            钱币图鉴已集 <span className="text-[#ffd23f]">{collectedCount}</span> / 42 枚
            {collectedCount < 42 ? '——去博物馆页面补完图鉴吧' : '，全部集齐！'}。
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-game px-8 py-2" onClick={onRestart}>
              再来一局
            </button>
            <button type="button" className="btn-game-ghost px-8 py-2" onClick={onExit}>
              返回网站
            </button>
          </div>
        </Overlay>
      ) : null}
    </Shell>
  )
}

/* ------------------------------------------------------------ 答题弹层 */

function QuizOverlay({
  quiz,
  onPick,
  onClose,
  game,
}: {
  quiz: QuizState
  onPick: (i: number) => void
  onClose: () => void
  game: Game | null
}) {
  const { question, coin, picked } = quiz
  const answered = picked !== null
  const correct = picked === question.answer
  const [imgSrc, setImgSrc] = useState(coin.thumb)
  const [imgErr, setImgErr] = useState(false)
  const upgradeLabel = game
    ? UPGRADE_LABEL[UPGRADE_CYCLE[game.weapon.upgrades % UPGRADE_CYCLE.length]!]
    : ''

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(10,10,14,0.82)] p-4">
      <div className="game-panel max-h-full w-full max-w-lg overflow-y-auto p-5">
        {/* 宝箱开出的钱币 */}
        <div className="mb-4 flex items-center gap-4">
          {imgErr ? (
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border-2 border-[#3a3d46] bg-[#1d1e26]">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f4c542] shadow-[inset_0_0_0_3px_#c8971e]">
                <div className="h-3.5 w-3.5 bg-[#1d1e26]" />
              </div>
            </div>
          ) : (
            <img
              src={imgSrc}
              alt={coin.name}
              width={72}
              height={72}
              className="h-[72px] w-[72px] shrink-0 rounded-lg border-2 border-[#3a3d46] bg-[#1d1e26] object-contain p-1"
              loading="eager"
              onError={() => {
                if (!imgSrc.includes('?')) setImgSrc(coin.thumb + '?r=1')
                else setImgErr(true)
              }}
            />
          )}
          <div className="min-w-0">
            <p className="text-body font-semibold text-[#ffd23f]">
              {coin.name}
              <span className="ml-2 text-micro font-normal text-[#8a8f98]">{coin.era}</span>
            </p>
            <p className="mt-0.5 text-micro leading-relaxed text-[#c8cdd8]">{coin.note}</p>
          </div>
        </div>

        <p className="text-body font-semibold leading-relaxed text-[#f5f5f7]">{question.q}</p>

        <div className="mt-3 space-y-2">
          {question.options.map((opt, i) => {
            const isAnswer = i === question.answer
            const isPicked = i === picked
            let cls = 'game-option'
            if (answered && isAnswer) cls += ' game-option-right'
            else if (answered && isPicked) cls += ' game-option-wrong'
            return (
              <button key={i} type="button" className={cls} disabled={answered} onClick={() => onPick(i)}>
                <span className="mr-2 text-[#8a8f98]">{['甲', '乙', '丙'][i]}</span>
                {opt}
              </button>
            )
          })}
        </div>

        {answered ? (
          <div className="mt-4 space-y-3">
            <p className={`text-body font-semibold ${correct ? 'text-[#6ecf7d]' : 'text-[#e0453a]'}`}>
              {correct
                ? `答对了！${upgradeLabel} —— 武器更上一层${game && game.player.hp < game.player.maxHp ? '，血量 +1' : ''}`
                : `答错了，正确答案是「${question.options[question.answer]}」`}
            </p>
            <p className="text-micro leading-relaxed text-[#8a8f98]">{question.explain}</p>
            <button type="button" className="btn-game w-full py-2" onClick={onClose}>
              继续冒险
            </button>
          </div>
        ) : (
          <p className="mt-3 text-center text-micro text-[#8a8f98]">答对可强化武器并回血 · 钱币无论如何都收入图鉴</p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ 通用壳与摇杆 */

function Shell({
  children,
  onExit,
  dim,
  onSfx,
  sfxOn,
}: {
  children: React.ReactNode
  onExit: () => void
  dim?: boolean
  onSfx?: () => void
  sfxOn?: boolean
}) {
  return (
    <div className={`fixed inset-0 z-[100] flex flex-col bg-[#0e0f14] ${dim ? '' : 'select-none'}`} style={{ touchAction: 'none' }}>
      <div className="relative mx-auto flex w-full max-w-[calc(100vh*16/9)] flex-1 items-stretch">
        <div className="relative aspect-video w-full">
          {children}
          <div className="absolute left-2 top-2 z-30 flex gap-2">
            <button type="button" className="btn-game-ghost px-3 py-1 text-micro" onClick={onExit}>
              ← 离开
            </button>
            {onSfx ? (
              <button type="button" className="btn-game-ghost px-3 py-1 text-micro" onClick={onSfx}>
                {sfxOn ? '♪ 音效开' : '♪ 音效关'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[rgba(10,10,14,0.85)] p-6 text-center">
      {children}
    </div>
  )
}

function Joystick({
  className,
  onChange,
  label,
}: {
  className: string
  onChange: (v: { x: number; y: number } | null) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const active = useRef(false)

  const update = (e: React.PointerEvent): void => {
    const el = ref.current!
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let dx = e.clientX - cx
    let dy = e.clientY - cy
    const len = Math.hypot(dx, dy)
    const max = r.width / 2 - 12
    if (len > max) {
      dx = (dx / len) * max
      dy = (dy / len) * max
    }
    setKnob({ x: dx, y: dy })
    if (Math.hypot(dx, dy) > 6) onChange({ x: dx / max, y: dy / max })
    else onChange(null)
  }

  return (
    <div
      ref={ref}
      className={`game-joystick absolute bottom-6 z-10 h-24 w-24 ${className}`}
      onPointerDown={(e) => {
        active.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e)
      }}
      onPointerMove={(e) => {
        if (active.current) update(e)
      }}
      onPointerUp={() => {
        active.current = false
        setKnob({ x: 0, y: 0 })
        onChange(null)
      }}
      onPointerCancel={() => {
        active.current = false
        setKnob({ x: 0, y: 0 })
        onChange(null)
      }}
    >
      <span className="absolute inset-0 rounded-full border-2 border-[#3a3d46] bg-[rgba(20,21,28,0.5)]" />
      <span
        className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#8a8f98] bg-[#2a2b35]"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-micro text-[#8a8f98]">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------ 设置 */

const KEY_SLOTS: { slot: keyof KeyBindings; label: string }[] = [
  { slot: 'up', label: '上移' },
  { slot: 'left', label: '左移' },
  { slot: 'down', label: '下移' },
  { slot: 'right', label: '右移' },
  { slot: 'interact', label: '开箱 / 互动' },
  { slot: 'fire', label: '攻击' },
]

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: '空格',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    Enter: '回车',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Minus: '-',
    Equal: '=',
  }
  return map[code] ?? code
}

function SettingsPanel({
  onClose,
  onApply,
}: {
  onClose: () => void
  /** 每次改动后回调（GameStage 热套到游戏实例） */
  onApply?: (keys: KeyBindings, vol: number, autoAim: boolean) => void
}) {
  const [keys, setKeys] = useState<KeyBindings>(() => loadKeys())
  const [vol, setVol] = useState<number>(() => loadVol())
  const [autoAim, setAutoAim] = useState<boolean>(() => loadAutoAim())
  const [listening, setListening] = useState<keyof KeyBindings | null>(null)

  // 拦截全部按键：改键捕获 / Esc 关面板 / 防漏进游戏
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (listening) {
        if (e.code !== 'Escape') setKeys((k) => ({ ...k, [listening]: e.code }))
        setListening(null)
      } else if (e.code === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions)
  }, [listening, onClose])

  useEffect(() => {
    saveKeys(keys)
    saveVol(vol)
    saveAutoAim(autoAim)
    onApply?.(keys, vol, autoAim)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, vol, autoAim])

  return (
    <Overlay>
      <h2 className="text-display font-bold text-[#ffd23f]">设置</h2>
      <div className="w-72 space-y-4 text-left">
        <div className="space-y-1">
          <p className="text-micro text-[#8a8f98]">音效音量</p>
          <div className="flex items-center gap-2">
            <span className="text-micro">♪</span>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={Math.round(vol * 100)}
              onChange={(e) => setVol(Number(e.target.value) / 100)}
              className="h-1.5 w-full accent-[#ffd23f]"
            />
            <span className="w-8 text-right text-micro text-[#c8cdd8]">{Math.round(vol * 100)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-micro leading-relaxed text-[#8a8f98]">自动瞄准（锁定最近敌人）</p>
          <button
            type="button"
            className={autoAim ? 'btn-game px-4 py-1 text-micro' : 'btn-game-ghost px-4 py-1 text-micro'}
            onClick={() => setAutoAim((v) => !v)}
          >
            {autoAim ? '开' : '关'}
          </button>
        </div>

        {!IS_TOUCH ? (
          <div className="space-y-1.5">
            <p className="text-micro leading-relaxed text-[#8a8f98]">键位（点击后按新键；方向键始终可用）</p>
            <div className="grid grid-cols-2 gap-1.5">
              {KEY_SLOTS.map(({ slot, label }) => (
                <button
                  key={slot}
                  type="button"
                  className={`flex items-center justify-between px-2 py-1.5 text-micro ${
                    listening === slot ? 'btn-game animate-pulse' : 'btn-game-ghost'
                  }`}
                  onClick={() => setListening(listening === slot ? null : slot)}
                >
                  <span>{label}</span>
                  <span className={listening === slot ? 'text-[#1b1c24]' : 'text-[#ffd23f]'}>
                    {listening === slot ? '按新键…' : keys[slot] ? keyLabel(keys[slot]) : '鼠标'}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-game-ghost w-full py-1 text-micro"
              onClick={() => setKeys({ ...DEFAULT_KEYS })}
            >
              恢复默认键位
            </button>
          </div>
        ) : null}

        <button type="button" className="btn-game w-full py-2" onClick={onClose}>
          完成
        </button>
      </div>
    </Overlay>
  )
}
