// The list vite.config.ts's bundled-art plugin builds at dev and build time: every file under
// public/art/{setId}/{characterId}/ named tier-{1-5} or ending-{type} with a .webp, .png or .jpg
// extension, as paths relative to public/ ("art/afterhours/nova/tier-1.webp"), sorted.
declare module 'virtual:bundled-art' {
  const files: readonly string[]
  export default files
}
