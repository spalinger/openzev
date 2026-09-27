/** Dirty state shared by the settings page and Layout's community switcher. */
let hasUnsavedZevDraft = false

export function setZevUnsavedDraftGuard(isDirty: boolean): void {
    hasUnsavedZevDraft = isDirty
}

export function hasUnsavedZevSettingsDraft(): boolean {
    return hasUnsavedZevDraft
}
