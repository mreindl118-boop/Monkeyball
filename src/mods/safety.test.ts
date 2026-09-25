import { describe, expect, it } from 'vitest'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import type { Character, SetManifest } from '../types'
import { normalizeCharacter } from './normalize'
import { scanManifestSafety, scanSafety, scanText, underageMentions } from './safety'

const nova = (): Character => normalizeCharacter(novaJson)

describe('scanText: minor and childlike terms', () => {
  it.each([
    'a child at heart',
    'Loves kids',
    'the kid next door',
    'dating a minor',
    'Minors welcome',
    'a teen idol look',
    'teenage rebellion',
    'a teenager again',
    'preteen',
    'pre-teen',
    'tweens',
    'underage',
    'under-aged',
    'under 18',
    'loli fashion',
    'shota',
    'lolita dress',
    'schoolgirl uniform',
    'school uniform',
    'a high school crush',
    'middle-school',
    'junior high',
    'elementary school',
    'barely legal',
    'jailbait',
    'childlike wonder',
    'child-like',
    'a little girl voice',
    'little boy',
    'age play',
    'toddler',
    'adolescent',
    'kindergarten teacher',
    // School-age words and nouns for minors that slipped through before.
    'a high schooler',
    'high-schooler',
    'highschooler',
    'Talks like a middle-schooler',
    'a middle schooler',
    'a grade schooler',
    'Being treated like a schoolchild',
    'schoolchildren',
    'jr high',
    'jr. high',
    'a sixth-grader',
    'preschoolers',
    'a minor in the eyes of the law',
    'dated a minor in college',
    'caught with a minor in the back room',
    'she sleeps with minors in her building',
    'under 16',
    'under seventeen',
    'under the age of 18',
  ])('blocks "%s"', (text) => {
    expect(scanText(text)).not.toEqual([])
  })

  it.each([
    'No kidding, she said.',
    'skid marks on the dance floor',
    'a kidney bean stew',
    'minority report',
    'a minor detail',
    'songs in a minor key',
    'played it in A minor',
    'the key of F sharp minor',
    'a minor in art history',
    'a minor in gender studies',
    'a minor degree of fame',
    'minor-key ballads',
    'eighteen karat gold',
    'the canteen at the depot',
    'her boyfriend and girlfriend',
    'a torpedo of a laugh',
  ])('lets "%s" through', (text) => {
    expect(scanText(text)).toEqual([])
  })

  it('allows "childhood" in the backstory only', () => {
    expect(scanText('A lonely childhood by the sea', { backstory: true })).toEqual([])
    expect(scanText('A lonely childhood by the sea')).toEqual(['childhood'])
    expect(scanText('Her childhood bedroom', { appearance: true })).toEqual(['childhood'])
    // The backstory still can't say anything else.
    expect(scanText('Dropped out of high school', { backstory: true })).toEqual(['high school'])
  })

  it('blocks "girl", "boy" and "young" in appearance fields only', () => {
    expect(scanText('a girl with a teal undercut', { appearance: true })).toEqual(['girl'])
    expect(scanText('young and slim', { appearance: true })).toEqual(['young'])
    expect(scanText('baby-faced', { appearance: true })).toEqual(['baby-faced'])
    expect(scanText('Girls night out is her favorite thing')).toEqual([])
    expect(scanText('Young at heart')).toEqual([])
    expect(scanText('her girlfriend', { appearance: true })).toEqual([])
  })

  it('keeps times and measures clear of the under-18 rule', () => {
    expect(scanText('Can solve a cube in under 18 seconds')).toEqual([])
    expect(scanText('Runs a mile in under 16 minutes')).toEqual([])
    expect(scanText('Nobody under 18 gets in')).toEqual(['under 18'])
  })

  it('blocks written ages under 21 in every field, not just appearance', () => {
    expect(scanText("I'm only seventeen, so don't tell the bouncer.")).toEqual(["I'm only seventeen"])
    expect(scanText('I’m only seventeen, so don’t tell the bouncer.')).toEqual(["I'm only seventeen"])
    expect(scanText("She's secretly 16 years old, on paper.")).toEqual(['16 years old'])
    expect(scanText('Acts like the 15-year-old she really is')).toEqual(['15-year-old'])
    expect(scanText('a 17 year old')).toEqual(['17 year old'])
    expect(scanText('she turns 19 tomorrow')).toEqual(['turns 19'])
    expect(scanText("I'm 20, maybe")).toEqual(["I'm 20"])
    expect(scanText('Left home at the age of 17.')).toEqual(['age of 17'])
    // Counts aren't ages.
    expect(scanText("There's only one.")).toEqual([])
    expect(scanText('He is one of the few')).toEqual([])
    expect(scanText('I was two drinks in')).toEqual([])
    expect(scanText('turned 3 heads')).toEqual([])
    expect(scanText('a 12-year-old scotch, bourbon aged 12 years')).toEqual([])
    expect(scanText("I've been awake for twenty hours")).toEqual([])
    expect(scanText('He was twenty-three; now he runs the late shift')).toEqual([])
  })

  it('catches the character stating their age by name', () => {
    const names = ['Nova Castellanos', 'Nova']
    expect(scanText('Nova is 17.', { names })).toEqual(['Nova is 17'])
    expect(scanText('Nova, 17, DJ', { names })).toEqual(['Nova, 17'])
    expect(scanText('Nova is 28.', { names })).toEqual([])
  })

  it('lets the backstory place past events at an age, but not say they are under 21', () => {
    const b = { backstory: true }
    expect(scanText('Moved to the city at 19 with a crate of records', b)).toEqual([])
    expect(scanText('Left home at the age of 17.', b)).toEqual([])
    expect(scanText('when she was 16 she left', b)).toEqual([])
    expect(scanText('When she turned 18, she left.', b)).toEqual([])
    expect(scanText('She is 19 years old.', b)).toEqual(['19 years old'])
    expect(scanText('She was 16 years old.', b)).toEqual(['16 years old'])
    expect(scanText("She's 17 and on the run.", b)).toEqual(["She's 17"])
  })

  it('reads bare numbers and hedged numbers as ages in appearance fields', () => {
    const a = { appearance: true }
    expect(scanText('she is 17', a)).toEqual(['she is 17'])
    expect(scanText('just turned 18', a)).toEqual(['turned 18'])
    expect(scanText('almost 18', a)).toEqual(['almost 18'])
    expect(scanText('adult woman, 17, red hair', a)).toEqual(['17'])
    expect(scanText('1girl, red hair', a)).toEqual(['girl'])
    expect(scanText('just two silver hoops', a)).toEqual([])
    expect(scanText('She\'s 5\'2" in heels', a)).toEqual([])
    expect(scanText('adult woman, 28, red hair', a)).toEqual([])
  })
})

describe('underageMentions', () => {
  it.each([
    ['19 years old', '19 years old'],
    ['a 17-year-old', '17-year-old'],
    ['looks 16', 'looks 16'],
    ['aged 15', 'aged 15'],
    ['sixteen years old', 'sixteen years old'],
    ['an eighteen-year-old', 'eighteen-year-old'],
    ['19yo', '19yo'],
    ['age: 12', 'age: 12'],
    ['twenty years old', 'twenty years old'],
    ["looks like she's about 17", "looks like she's about 17"],
    ["I'm only seventeen, honestly", "I'm only seventeen"],
  ])('finds "%s"', (text, found) => {
    expect(underageMentions(text)).toEqual([found])
  })

  it.each([
    'adult woman, 28 years old',
    'twenty-one years old',
    'twenty one years old',
    '21-year-old',
    '35 years old',
    'a 12-string guitar',
    'size 10 boots',
    'three silver hoops',
    'looks about 6 feet tall',
    'looks ten years younger',
    'a 12-year-old scotch',
  ])('ignores "%s"', (text) => {
    expect(underageMentions(text)).toEqual([])
  })
})

describe('scanSafety', () => {
  it('passes the reference card', () => {
    expect(scanSafety(nova())).toEqual([])
  })

  it('reports each field with its path and a readable message', () => {
    const c = nova()
    c.look = 'A teal undercut and the face of a 19 year old'
    c.artTags = 'adult woman, 18 years old, schoolgirl outfit'
    c.likes[1] = { id: 'kids', label: 'Babysitting kids' }
    c.gallery[2] = { ...c.gallery[2], scene: 'A high school gym at night' }
    c.secrets[0] = { unlockAt: 60, text: 'She was a teen runaway.' }
    c.backstory = 'A loud childhood above a record shop.'
    const issues = scanSafety(c)
    const fields = issues.map((i) => i.field)
    expect(fields).toContain('look')
    expect(fields).toContain('artTags')
    expect(fields).toContain('likes[1].id')
    expect(fields).toContain('likes[1].label')
    expect(fields).toContain('gallery[2].scene')
    expect(fields).toContain('secrets[0].text')
    expect(fields).not.toContain('backstory')
    const look = issues.find((i) => i.field === 'look')!
    expect(look.term).toBe('19 year old')
    expect(look.message).toBe('Look says "19 year old". Every character is 21 or older, and looks it.')
    const art = issues.filter((i) => i.field === 'artTags').map((i) => i.term)
    expect(art).toEqual(['schoolgirl', '18 years old'])
    const tier = issues.find((i) => i.field === 'gallery[2].scene')!
    expect(tier.message).toBe('Tier 3 scene mentions "high school". Characters are adults: no references to minors or childlike traits.')
  })

  it('scans written ages in every field; the backstory can say "at 19"', () => {
    const c = nova()
    expect(c.backstory).toContain('at 19')
    expect(scanSafety(c)).toEqual([])
    c.bodyNotes = 'Looks 17'
    expect(scanSafety(c).map((i) => i.field)).toEqual(['bodyNotes'])
    c.bodyNotes = undefined
    c.opener = "I'm only seventeen, so don't tell the bouncer."
    c.secrets[0] = { unlockAt: 60, text: "She's secretly 16 years old." }
    c.secrets[1] = { unlockAt: 80, text: 'A high schooler still, on paper.' }
    c.personality = 'Acts like the 15-year-old she really is'
    c.voice = 'Talks like a middle-schooler'
    c.likes[0] = { id: 'schoolchild', label: 'Being treated like a schoolchild' }
    c.occupation = 'Nova is 17 and works the door'
    const fields = scanSafety(c).map((i) => i.field)
    expect(fields).toEqual(
      expect.arrayContaining(['opener', 'secrets[0].text', 'secrets[1].text', 'personality', 'voice', 'likes[0].id', 'likes[0].label', 'occupation']),
    )
    expect(scanSafety(c).find((i) => i.field === 'opener')?.message).toBe(
      'Opener says "I\'m only seventeen". Every character is 21 or older, and looks it.',
    )
  })

  it('scans optional fields: endings, prompts, ace label, identity', () => {
    const c = nova()
    c.endings = { good: { title: 'Home', scene: 'A little girl in the doorway' } }
    c.prompts = { story: 'Play her as childlike.' }
    const fields = scanSafety(c).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(['endings.good.scene', 'prompts.story']))
  })
})

describe('scanManifestSafety', () => {
  it('scans blurb, setting, relationship notes and rumors', () => {
    const m: SetManifest = {
      id: 'x',
      name: 'X',
      blurb: 'A set about teenagers.',
      setting: 'A town.',
      characters: ['a', 'b'],
      relationships: [{ a: 'a', b: 'b', kind: 'friend', note: 'Met in middle school.' }],
      rumors: [{ id: 'r', teller: 'a', about: ['b'], text: 'B was a child star.', truth: 'false' }],
    }
    expect(scanManifestSafety(m).map((i) => i.field)).toEqual(['blurb', 'relationships[0].note', 'rumors[0].text'])
  })
})
