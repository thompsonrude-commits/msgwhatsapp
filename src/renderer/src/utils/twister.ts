import { synonymMap } from './synonyms';

/**
 * Spin-Tax: {word1|word2|word3}
 */
export function applySpinTax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, match) => {
    const parts = match.split('|');
    if (parts.length === 1) return `{${match}}`;
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

/**
 * Invisible unicode chars — make each message unique at byte level
 */
function addInvisibleVariation(text: string): string {
  const invisibles = ['\u200B', '\u200C', '\u200D', '\uFEFF']
  const words = text.split(' ')
  return words.map((word, i) => {
    if (i > 0 && Math.random() < 0.25) {
      return invisibles[Math.floor(Math.random() * invisibles.length)] + word
    }
    return word
  }).join(' ')
}

/**
 * Vary punctuation and spacing
 */
function varyPunctuation(text: string): string {
  return text
    .replace(/\.\.\./g, () => Math.random() > 0.5 ? '…' : '...')
    .replace(/!/g, () => {
      const r = Math.random()
      return r > 0.7 ? '!!' : r > 0.4 ? '!' : '.'
    })
    .replace(/,\s/g, () => Math.random() > 0.5 ? ', ' : ',  ')
    .replace(/\. /g, () => Math.random() > 0.7 ? '.  ' : '. ')
}

/**
 * Random filler phrases appended or prepended
 */
const FILLERS_START = [
  '', '', '', // mostly no filler
  'Hey, ', 'Hi, ', 'Hello, ', 'Greetings, ', 'Good day, ',
]
const FILLERS_END = [
  '', '', '', '',
  ' 😊', ' 👋', ' ✅', ' 🙏', ' 💯',
  '\nHave a great day!', '\nLooking forward to hearing from you.',
  '\nFeel free to reply anytime.', '\nTake care!',
]

function addFillers(text: string): string {
  const start = FILLERS_START[Math.floor(Math.random() * FILLERS_START.length)]
  const end = FILLERS_END[Math.floor(Math.random() * FILLERS_END.length)]
  // Only add start filler if message doesn't already start with greeting
  const hasGreeting = /^(hey|hi|hello|good|dear|greet)/i.test(text.trim())
  return `${hasGreeting ? '' : start}${text}${end}`
}

/**
 * Randomly vary line breaks in multi-line messages
 */
function varyLineBreaks(text: string): string {
  if (!text.includes('\n')) return text
  return text.replace(/\n/g, () => Math.random() > 0.4 ? '\n' : '\n\n')
}

/**
 * Main twist function — replaces words with synonyms + all variations
 */
export function twistMessage(text: string, frequency: number = 0.35): string {
  const parts = text.split(/(\{.*?\})/g);

  const twistedParts = parts.map(part => {
    if (part.startsWith('{') && part.endsWith('}')) return part;

    return part.split(/\b/).map(word => {
      const lowerWord = word.toLowerCase();
      if (synonymMap[lowerWord] && Math.random() < frequency) {
        const options = synonymMap[lowerWord];
        const replacement = options[Math.floor(Math.random() * options.length)];
        if (word[0] === word[0].toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      }
      return word;
    }).join('');
  });

  let result = applySpinTax(twistedParts.join(''))
  result = varyPunctuation(result)
  result = varyLineBreaks(result)
  result = addFillers(result)
  result = addInvisibleVariation(result)
  return result
}
