// Shared by the save import button (Settings, onboarding) and the save slots.

import { flashNextLoad } from '../../ui/toastStore'

/**
 * What the save picker lets through. Android storage providers (Drive, some Downloads providers)
 * often report a .json file as octet-stream or plain text; the importer checks the content anyway.
 */
export const SAVE_ACCEPT = '.json,application/json,application/octet-stream,text/plain'

/** Reload the app on the hub so every store re-reads the replaced data. */
export function reloadToHub(message: string) {
  flashNextLoad(message)
  window.location.hash = '#/hub'
  window.location.reload()
}
