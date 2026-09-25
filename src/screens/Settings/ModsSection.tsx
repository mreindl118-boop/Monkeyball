import { useNav } from '../../store/nav'
import { ImportModButton } from '../CharacterSets/ModImport'
import styles from './ModsSection.module.css'

/** Settings, "Character sets and mods": the sets screen, the editor, and importing a mod file. */
export function ModsSection() {
  const go = useNav((s) => s.go)
  return (
    <div className={styles.stack}>
      <button type="button" className={styles.link} onClick={() => go({ name: 'sets' })}>
        <span className={styles.title}>Character sets</span>
        <span className={styles.text}>Turn sets on and off, read their blurbs, see who's in each one and export packs.</span>
      </button>
      <button type="button" className={styles.link} onClick={() => go({ name: 'editor' })}>
        <span className={styles.title}>Character editor</span>
        <span className={styles.text}>Create, duplicate and export characters as mods.</span>
      </button>
      <div className={styles.importRow}>
        <ImportModButton label="Import mod file" />
        <p className={styles.hint}>
          A .json character or a .zip pack. Every card is checked first: 21 or older, nothing childlike, partners inside the
          pack. Imported sets start in play.
        </p>
      </div>
    </div>
  )
}
