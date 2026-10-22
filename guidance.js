/**
 * The Disciplined preset's configurable interaction rules: the language the
 * agent asks questions in, and the length budget for a turn's final summary.
 *
 * The values live in `<harness-home>/preset-disciplined/config.json`, outside
 * the profile so reinstalling the bundle keeps them, and are re-read on every
 * prompt assembly, so an edit applies to the next request without a restart.
 * They are registered as a prompt section in the preset's agent scope.
 *
 * Plain JavaScript with node built-ins only: a profile links this package from
 * a checkout, whose real path has no third-party packages to import.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const name = 'guidance'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Directory this preset owns under the harness home. */
const STORE_DIR = 'preset-disciplined'

/** File inside {@link STORE_DIR} holding the configurable rules. */
const STORE_FILE = 'config.json'

/** Values used when the file or a field is missing. */
const DEFAULTS = Object.freeze({ askLanguage: '中文', summaryMaxChars: 200 })

/** Last configuration complaint logged, so a broken file warns once, not per request. */
let lastWarning = ''

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Expand a leading `~`, `~/`, or `~\` against the OS home, matching the
 * harness's own home resolution.
 */
function expandHomePath(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/** The harness home: `$DSH_HOME` when it is set to a non-blank value, `~/.dsh` otherwise. */
function harnessHome() {
  const fromEnv = process.env.DSH_HOME
  const selected = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh')
  return resolve(expandHomePath(selected))
}

/** Absolute path of the config file. */
function configPath() {
  return join(harnessHome(), STORE_DIR, STORE_FILE)
}

/** Create the config file from the defaults on first run, so the values are discoverable. */
function seedConfig(ctx) {
  const path = configPath()
  if (existsSync(path)) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(DEFAULTS, null, 2)}\n`, 'utf8')
    ctx.logger.info(`preset-disciplined: created ${path}`)
  } catch (error) {
    ctx.logger.warn(`preset-disciplined: cannot create ${path} (${messageOf(error)})`)
  }
}

/** Report one configuration complaint, once per distinct message. */
function warnOnce(ctx, message) {
  if (message === lastWarning) return
  lastWarning = message
  ctx.logger.warn(`preset-disciplined: ${message}`)
}

/** One reading of the config file, with defaults for anything absent or unusable. */
function readConfig(ctx) {
  const path = configPath()
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') warnOnce(ctx, `${path}: ${messageOf(error)}; using defaults`)
    return { ...DEFAULTS }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnOnce(ctx, `${path}: expected a JSON object; using defaults`)
    return { ...DEFAULTS }
  }
  const askLanguage = typeof parsed.askLanguage === 'string' && parsed.askLanguage.trim() !== ''
    ? parsed.askLanguage.trim()
    : undefined
  const summaryMaxChars = Number.isInteger(parsed.summaryMaxChars) && parsed.summaryMaxChars > 0
    ? parsed.summaryMaxChars
    : undefined
  const issues = [
    ...parsed.askLanguage !== undefined && askLanguage === undefined ? ['askLanguage must be a non-empty string'] : [],
    ...parsed.summaryMaxChars !== undefined && summaryMaxChars === undefined ? ['summaryMaxChars must be a positive integer'] : [],
  ]
  if (issues.length > 0) warnOnce(ctx, `${path}: ${issues.join('; ')}; using defaults for those fields`)
  else lastWarning = ''
  return { askLanguage: askLanguage ?? DEFAULTS.askLanguage, summaryMaxChars: summaryMaxChars ?? DEFAULTS.summaryMaxChars }
}

/** Render the interaction rules for one configuration. */
function renderGuidance({ askLanguage, summaryMaxChars }) {
  return `## 5. Interaction and Reporting

When you need confirmation, a choice, or missing information, call ask_user_question, and write the question, its header, and the option labels and descriptions in ${askLanguage}.

Finish each turn with a short summary for the user and keep that final reply within ${summaryMaxChars} characters — each Chinese character, Latin letter, digit and punctuation mark counts as one. Spend the budget on the outcome and on how it was verified rather than on restating the request. Go over the limit only when the user asks for detail, or when omitting a failure, an error message, or a verification result would hide something the user must know.`
}

/**
 * Register the interaction rules for the mounting context's agent scope.
 * @param ctx - the row's context; the section registration is an effect of it.
 */
export function apply(ctx) {
  seedConfig(ctx)
  ctx.systemPrompt.section({
    name: 'preset:disciplined:guidance',
    // Right after the persona prefix, before any tool guidance.
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
    text: () => renderGuidance(readConfig(ctx)),
  })
}
