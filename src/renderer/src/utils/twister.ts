import { synonymMap } from './synonyms';

// ── Spin-Tax ─────────────────────────────────────────────────────────────────
export function applySpinTax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, match) => {
    const parts = match.split('|');
    if (parts.length === 1) return `{${match}}`;
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

// ── Invisible unicode variation ───────────────────────────────────────────────
function addInvisibleVariation(text: string): string {
  const invisibles = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060']
  const chars = text.split('')
  const result: string[] = []
  for (const ch of chars) {
    result.push(ch)
    // Randomly insert invisible chars mid-word and between words
    if (Math.random() < 0.12) {
      result.push(invisibles[Math.floor(Math.random() * invisibles.length)])
    }
  }
  return result.join('')
}

// ── Punctuation variation ─────────────────────────────────────────────────────
function varyPunctuation(text: string): string {
  return text
    .replace(/\.\.\./g, () => Math.random() > 0.5 ? '…' : '...')
    .replace(/!/g, () => {
      const r = Math.random()
      return r > 0.75 ? '!!' : r > 0.45 ? '!' : '.'
    })
    .replace(/,\s/g, () => Math.random() > 0.5 ? ', ' : ',  ')
    .replace(/\. /g, () => Math.random() > 0.6 ? '.  ' : '. ')
    // Randomly add or remove trailing period
    .replace(/([a-zA-Z])$/, (m) => Math.random() > 0.5 ? m + '.' : m)
}

// ── Sentence-level rephrasing ─────────────────────────────────────────────────
// These patterns rewrite entire sentence structures
const SENTENCE_REWRITES: Array<[RegExp, () => string]> = [
  [/\bI wanted to\b/gi, () => pick(['I thought I should', 'I figured I could', 'I had to', 'I needed to'])],
  [/\bI am writing to\b/gi, () => pick(['I am reaching out to', 'I wanted to', 'I am contacting you to', 'Just dropping a line to'])],
  [/\bplease find\b/gi, () => pick(['here is', 'attached is', 'below is', 'I have included'])],
  [/\bkindly\b/gi, () => pick(['please', 'could you', 'would you'])],
  [/\bas soon as possible\b/gi, () => pick(['at your earliest convenience', 'when you get a chance', 'whenever you can', 'at your earliest'])],
  [/\bplease let me know\b/gi, () => pick(['feel free to reach out', 'do not hesitate to reply', 'I would love to hear from you', 'drop me a message'])],
  [/\bI hope this (message|text|note) finds you well\b/gi, () => pick(['hope you are doing great', 'hope all is well with you', 'trust you are doing well', 'hope your day is going great'])],
  [/\bdon't hesitate\b/gi, () => pick(['feel free', 'go ahead', 'please do'])],
  [/\bI look forward to\b/gi, () => pick(['looking forward to', 'can not wait to', 'excited to'])],
  [/\bbest regards\b/gi, () => pick(['warm regards', 'kind regards', 'cheers', 'with appreciation'])],
  [/\bcheck out\b/gi, () => pick(['have a look at', 'take a look at', 'see', 'explore', 'discover'])],
  [/\bget in touch\b/gi, () => pick(['reach out', 'connect with us', 'contact us', 'drop us a line'])],
  [/\bright now\b/gi, () => pick(['today', 'at the moment', 'currently', 'this moment', 'immediately'])],
  [/\bfor free\b/gi, () => pick(['at no cost', 'completely free', 'without any charge', 'on us'])],
  [/\bwe are offering\b/gi, () => pick(['we have', 'we are providing', 'we bring you', 'we present'])],
  [/\bspecial offer\b/gi, () => pick(['exclusive deal', 'amazing opportunity', 'great deal', 'limited-time offer'])],
]

function applySentenceRewrites(text: string): string {
  let result = text
  for (const [pattern, replacer] of SENTENCE_REWRITES) {
    if (pattern.test(result) && Math.random() > 0.3) {
      result = result.replace(pattern, replacer)
    }
    pattern.lastIndex = 0 // reset global regex
  }
  return result
}

// ── Sentence order shuffle (for multi-sentence messages) ──────────────────────
function maybeShuffleSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/)
  if (sentences.length < 3) return text
  if (Math.random() > 0.5) return text // only shuffle 50% of the time
  // Keep first and last, shuffle middle
  const first = sentences[0]
  const last = sentences[sentences.length - 1]
  const middle = sentences.slice(1, -1).sort(() => Math.random() - 0.5)
  return [first, ...middle, last].join(' ')
}

// ── Filler phrases ────────────────────────────────────────────────────────────
const OPENERS = [
  '', '', '', '',
  'Hey there, ', 'Hi, ', 'Hello, ', 'Good day, ',
  'Hope you\'re well — ', 'Quick note — ', 'Just wanted to say — ',
]
const CLOSERS = [
  '', '', '', '',
  ' 😊', ' 👋', ' ✅', ' 🙏', ' 💯', ' 🌟',
  '\nHave a wonderful day!', '\nLooking forward to connecting.',
  '\nFeel free to reply anytime.', '\nTake care!',
  '\nBest wishes!', '\nUntil next time!',
]

function addFillers(text: string): string {
  const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)]
  const closer = CLOSERS[Math.floor(Math.random() * CLOSERS.length)]
  const hasGreeting = /^(hey|hi|hello|good|dear|greet|hope|quick|just)/i.test(text.trim())
  return `${hasGreeting ? '' : opener}${text}${closer}`
}

// ── Line break variation ──────────────────────────────────────────────────────
function varyLineBreaks(text: string): string {
  if (!text.includes('\n')) return text
  return text.replace(/\n/g, () => Math.random() > 0.4 ? '\n' : '\n\n')
}

// ── Typing jitter — vary character timing description ─────────────────────────
// (This is metadata returned alongside message for the UI typing sim)
export function getTypingJitter(msgLength: number): number {
  const base = Math.min(Math.max(msgLength * 45, 2000), 9000)
  const jitter = base * (0.8 + Math.random() * 0.4) // ±20% jitter
  return Math.round(jitter)
}

// ── Helper ────────────────────────────────────────────────────────────────────
function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Main export ───────────────────────────────────────────────────────────────
export function twistMessage(text: string, frequency: number = 0.40): string {
  // 1. Apply spin-tax first
  let result = applySpinTax(text)

  // 2. Sentence-level rewrites (structural changes)
  result = applySentenceRewrites(result)

  // 3. Word-level synonym replacement
  const parts = result.split(/(\{.*?\})/g)
  const twistedParts = parts.map(part => {
    if (part.startsWith('{') && part.endsWith('}')) return part
    return part.split(/\b/).map(word => {
      const lowerWord = word.toLowerCase()
      if (synonymMap[lowerWord] && Math.random() < frequency) {
        const options = synonymMap[lowerWord]
        const replacement = options[Math.floor(Math.random() * options.length)]
        // Preserve capitalisation
        if (word[0] >= 'A' && word[0] <= 'Z') {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1)
        }
        return replacement
      }
      return word
    }).join('')
  })
  result = twistedParts.join('')

  // 4. Shuffle sentences in long messages
  result = maybeShuffleSentences(result)

  // 5. Punctuation variation
  result = varyPunctuation(result)

  // 6. Line break variation
  result = varyLineBreaks(result)

  // 7. Add opener/closer fillers
  result = addFillers(result)

  // 8. Invisible unicode chars (must be last)
  result = addInvisibleVariation(result)

  return result
}
